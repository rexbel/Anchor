"""Contract tests for the twin TTS server, using the stub engine (no GPU or model).

    TWIN_ENGINE=stub python -m unittest test_server.py
"""

import base64
import io
import json
import os
import threading
import unittest
import urllib.error
import urllib.request
import wave

os.environ.setdefault("TWIN_ENGINE", "stub")

import numpy as np  # noqa: E402

import server  # noqa: E402


def wav_bytes(seconds=6.0, rate=22050, width=2):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(width)
        w.setframerate(rate)
        t = np.arange(int(rate * seconds)) / rate
        pcm = (np.sin(2 * np.pi * 180 * t) * 8000).astype("<i2")
        w.writeframes(pcm.tobytes() if width == 2 else pcm.astype("<i4").tobytes())
    return buf.getvalue()


class TwinServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.make_handler(server.StubEngine()))
        cls.base = f"http://127.0.0.1:{cls.httpd.server_address[1]}"
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()

    def post(self, payload, raw=None):
        data = raw if raw is not None else json.dumps(payload).encode()
        req = urllib.request.Request(f"{self.base}/twin", data=data, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req) as res:
                return res.status, res.headers.get("Content-Type"), res.read()
        except urllib.error.HTTPError as err:
            return err.code, err.headers.get("Content-Type"), err.read()

    def test_health(self):
        with urllib.request.urlopen(f"{self.base}/health") as res:
            self.assertEqual(json.load(res)["engine"], "stub")

    def test_returns_wav_audio(self):
        status, ctype, body = self.post({"text": "Hello there", "language": "en", "speaker_wav": base64.b64encode(wav_bytes()).decode()})
        self.assertEqual((status, ctype), (200, "audio/wav"))
        with wave.open(io.BytesIO(body)) as w:
            self.assertEqual((w.getnchannels(), w.getsampwidth(), w.getframerate()), (1, 2, 24000))
            self.assertGreater(w.getnframes(), 0)

    def test_matches_anchor_contract_body(self):
        # Exactly what Anchor's synthesize() sends.
        body = {"text": "Checking in.", "language": "en", "speaker_wav": base64.b64encode(wav_bytes()).decode()}
        self.assertEqual(self.post(body)[0], 200)

    def test_rejects_bad_input(self):
        good = base64.b64encode(wav_bytes()).decode()
        cases = [
            ({"language": "en", "speaker_wav": good}, 400),
            ({"text": "  ", "speaker_wav": good}, 400),
            ({"text": "hi", "language": "xx", "speaker_wav": good}, 400),
            ({"text": "hi"}, 400),
            ({"text": "hi", "speaker_wav": "not base64!"}, 400),
            ({"text": "hi", "speaker_wav": base64.b64encode(b"RIFFnope").decode()}, 400),
            ({"text": "hi", "speaker_wav": base64.b64encode(wav_bytes(width=4)).decode()}, 400),
            ({"text": "x" * (server.MAX_TEXT + 1), "speaker_wav": good}, 413),
        ]
        for payload, expected in cases:
            with self.subTest(payload=list(payload)):
                status, ctype, body = self.post(payload)
                self.assertEqual(status, expected)
                self.assertEqual(ctype, "application/json")
                self.assertIn("error", json.loads(body))

    def test_rejects_non_json(self):
        self.assertEqual(self.post(None, raw=b"text=hi")[0], 400)

    def test_speaker_text_must_be_a_string(self):
        good = base64.b64encode(wav_bytes()).decode()
        self.assertEqual(self.post({"text": "hi", "speaker_wav": good, "speaker_text": 42})[0], 400)
        self.assertEqual(self.post({"text": "hi", "speaker_wav": good, "speaker_text": "I said this."})[0], 200)

    def test_decode_wav_downmixes_stereo(self):
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(2)
            w.setsampwidth(2)
            w.setframerate(16000)
            w.writeframes(np.array([16384, 0] * 100, dtype="<i2").tobytes())
        audio, rate = server.decode_wav(buf.getvalue())
        self.assertEqual((rate, audio.shape[0]), (16000, 100))
        self.assertAlmostEqual(float(audio[0]), 0.25, places=3)


class CsmRulesTest(unittest.TestCase):
    """The csm engine's request rules, exercised through the stub-csm engine (no model)."""

    @classmethod
    def setUpClass(cls):
        cls.httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.make_handler(server.StubEngine(require_transcript=True)))
        cls.base = f"http://127.0.0.1:{cls.httpd.server_address[1]}"
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()

    post = TwinServerTest.post

    def test_requires_transcript(self):
        status, _, body = self.post({"text": "hi", "speaker_wav": base64.b64encode(wav_bytes(8)).decode()})
        self.assertEqual(status, 400)
        self.assertIn("speaker_text", json.loads(body)["error"])

    def test_reference_length_window(self):
        for seconds, expected in [(2.0, 400), (8.0, 200), (13.0, 400)]:
            with self.subTest(seconds=seconds):
                payload = {"text": "hi", "speaker_wav": base64.b64encode(wav_bytes(seconds)).decode(), "speaker_text": "Most mornings I make coffee."}
                self.assertEqual(self.post(payload)[0], expected)

    def test_split_for_csm(self):
        text = "First sentence. Second one here! " + "word " * 120
        chunks = server.split_for_csm(text, limit=120)
        self.assertTrue(all(0 < len(c) <= 120 for c in chunks))
        self.assertEqual(" ".join(chunks).split(), text.split())
        self.assertEqual(server.split_for_csm("Short. Also short."), ["Short. Also short."])


if __name__ == "__main__":
    unittest.main()
