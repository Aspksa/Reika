import io
import json
import unittest
from unittest.mock import patch

from reika.updates import Updates, release_info, LIMIT


def fixture():
    return {"tag_name": "v99.0.0", "body": "Полное описание на русском", "assets": [{
        "name": "Reika-99.0.0.zip", "state": "uploaded", "size": 100,
        "digest": "sha256:" + "a" * 64,
        "browser_download_url": "https://github.com/Aspksa/Reika/releases/download/v99.0.0/Reika-99.0.0.zip"}]}


class UpdateTests(unittest.TestCase):
    def test_release_and_missing_digest(self):
        data = fixture()
        result = release_info(data)
        self.assertTrue(result['newer'])
        self.assertEqual(result['notes'], data['body'])
        self.assertEqual(result['archive']['sha256'], 'a' * 64)
        data['assets'][0]['digest'] = None
        self.assertIsNone(release_info(data)['archive']['sha256'])
        data['assets'] = []
        self.assertIsNone(release_info(data)['archive'])

    def test_invalid_release_rejected(self):
        for key, value in [('draft', True), ('prerelease', True), ('tag_name', 'v1.0.0-rc1')]:
            with self.subTest(key=key):
                data = fixture(); data[key] = value
                with self.assertRaises(ValueError): release_info(data)
        data = fixture(); data['assets'][0]['browser_download_url'] = 'https://example.com/file.zip'
        with self.assertRaises(ValueError): release_info(data)

    def test_fetch_is_cached_and_bounded(self):
        service = Updates()
        with patch('reika.updates.urlopen', return_value=io.BytesIO(json.dumps(fixture()).encode())) as fetch:
            first = service.get()
            self.assertEqual(first['release']['version'], '99.0.0')
            self.assertIs(first, service.get())
            self.assertEqual(fetch.call_count, 1)
        with patch('reika.updates.urlopen', return_value=io.BytesIO(b'x' * (LIMIT + 1))):
            self.assertIsNotNone(Updates().get()['error'])

    def test_network_and_malformed_errors(self):
        with patch('reika.updates.urlopen', side_effect=OSError('private detail')):
            result = Updates().get()
            self.assertIsNone(result['release'])
            self.assertNotIn('private detail', result['error'])
        for body in [b'not json', b'[]', b'null']:
            with patch('reika.updates.urlopen', return_value=io.BytesIO(body)):
                self.assertIsNotNone(Updates().get()['error'])
