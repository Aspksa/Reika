import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from reika.cloud_settings import CloudSettings, CATALOG


class CloudSettingsTests(unittest.TestCase):
    def test_catalog_has_prices_and_descriptions(self):
        self.assertGreaterEqual(len(CATALOG), 7)
        for model in CATALOG:
            self.assertTrue(model["id"])
            self.assertTrue(model["usage"])
            self.assertGreaterEqual(model["input"], 0)
            self.assertGreaterEqual(model["output"], 0)

    @unittest.skipUnless(os.name == "nt", "DPAPI хранение только Windows")
    def test_windows_key_is_encrypted_and_not_exposed(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {"LOCALAPPDATA": tmp}):
            store = CloudSettings(Path(tmp))
            key = "example-local-test-token-123456"
            info = store.update({"key": key, "model": CATALOG[1]["id"]})
            self.assertTrue(info["configured"])
            self.assertEqual(info["model"], CATALOG[1]["id"])
            self.assertNotIn(key, json.dumps(info))
            self.assertNotIn(key, store.file.read_text("utf-8"))
            self.assertTrue(CloudSettings(Path(tmp)).has_key())
            store.update({"delete_key": True})
            self.assertFalse(store.has_key())

    def test_bad_model_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {"LOCALAPPDATA": tmp}):
            store = CloudSettings(Path(tmp))
            with self.assertRaises(ValueError):
                store.update({"model": "unknown/deprecated"})
