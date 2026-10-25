import http.client
import json
import threading
import unittest
from pathlib import Path

from reika.server import ReikaServer


ROOT = Path(__file__).resolve().parents[1]


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ReikaServer(ROOT / "web", "test-instance", "test-control-token")
        cls.thread = threading.Thread(target=cls.server.serve_forever)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.thread.join(timeout=5)
        cls.server.server_close()

    def request(self, path="/", method="GET", headers=None):
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=3)
        try:
            connection.request(method, path, headers=headers or {})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def test_only_loopback_is_bound(self):
        self.assertEqual(self.server.server_address[0], "127.0.0.1")
        self.assertGreater(self.server.server_address[1], 0)

    def test_real_status_does_not_expose_control_token(self):
        status, headers, body = self.request("/api/status")
        data = json.loads(body)
        self.assertEqual(status, 200)
        self.assertEqual(data["instance_id"], "test-instance")
        self.assertEqual(data["url"], self.server.url)
        self.assertEqual(data["status"], "ready")
        self.assertNotIn("test-control-token", body.decode())
        self.assertNotIn(str(ROOT), body.decode())

    def test_all_required_assets_and_security_headers(self):
        for route in ("/", "/assets/app.css", "/assets/app.js", "/assets/reika.svg"):
            with self.subTest(route=route):
                status, headers, body = self.request(route)
                self.assertEqual(status, 200)
                self.assertTrue(body)
                self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
                self.assertEqual(headers["Cache-Control"], "no-store")
                self.assertIn("frame-ancestors 'none'", headers["Content-Security-Policy"])
                self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_head_has_no_body(self):
        status, headers, body = self.request("/", method="HEAD")
        self.assertEqual(status, 200)
        self.assertGreater(int(headers["Content-Length"]), 0)
        self.assertEqual(body, b"")

    def test_project_files_are_never_served(self):
        for path in ("/run.py", "/README.md", "/logs/reika.log", "/.runtime/instance.json",
                     "/../run.py", "/assets/../run.py", "/%2e%2e/run.py", "http://example.com/"):
            with self.subTest(path=path):
                self.assertEqual(self.request(path, headers={
                    "Host": f"127.0.0.1:{self.server.server_address[1]}"
                })[0], 404)

    def test_dns_rebinding_and_foreign_origin_are_rejected(self):
        self.assertEqual(self.request(headers={"Host": "attacker.example"})[0], 403)
        self.assertEqual(self.request(headers={"Origin": "https://attacker.example"})[0], 403)
        self.assertEqual(self.request(headers={"Origin": "null"})[0], 403)
        self.assertEqual(self.request(headers={"Sec-Fetch-Site": "cross-site"})[0], 403)
        self.assertEqual(self.request(headers={"Origin": self.server.url})[0], 200)

    def test_duplicate_host_is_rejected(self):
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=3)
        try:
            connection.putrequest("GET", "/")
            connection.putheader("Host", "attacker.example")
            connection.endheaders()
            self.assertEqual(connection.getresponse().status, 403)
        finally:
            connection.close()

    def test_shutdown_requires_token_and_same_origin(self):
        self.server.stop_requested.clear()
        self.assertEqual(self.request("/api/shutdown", "POST")[0], 403)
        self.assertEqual(self.request("/api/shutdown", "POST", {"X-Reika-Token": "wrong"})[0], 403)
        self.assertEqual(self.request("/api/shutdown", "POST", {
            "X-Reika-Token": "test-control-token", "Origin": "https://attacker.example"
        })[0], 403)
        self.assertFalse(self.server.stop_requested.is_set())
        self.assertEqual(self.request("/api/shutdown", "POST", {
            "X-Reika-Token": "test-control-token", "Origin": self.server.url
        })[0], 200)
        self.assertTrue(self.server.stop_requested.is_set())
        self.server.stop_requested.clear()

    def test_shutdown_rejects_body_and_transfer_encoding(self):
        for headers in ({"Content-Length": "-1"}, {"Content-Length": "1025"},
                        {"Content-Length": "wrong"}, {"Transfer-Encoding": "chunked"}):
            with self.subTest(headers=headers):
                self.assertEqual(self.request("/api/shutdown", "POST", {
                    **headers, "X-Reika-Token": "test-control-token"
                })[0], 400)

    def test_cors_preflight_cannot_authorize_commands(self):
        self.assertEqual(self.request("/api/shutdown", "OPTIONS")[0], 405)

    def test_port_is_reserved_without_scan_race(self):
        other = ReikaServer(ROOT / "web", "other", "other-token")
        try:
            self.assertNotEqual(other.server_address[1], self.server.server_address[1])
        finally:
            other.server_close()


if __name__ == "__main__":
    unittest.main()
