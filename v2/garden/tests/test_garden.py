"""Garden tests. No model, GPU or network is needed: local fake servers stand in."""

import http.client
import json
import os
import struct
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

os.environ["BLOOM_CONFIG"] = str(Path(tempfile.mkdtemp(prefix="bloom-test-")) / "garden.json")

from bloom_garden import config as cfg  # noqa: E402
from bloom_garden import firmware, pipeline, server  # noqa: E402


def fake_image(version: str = "1.2.3", sha: bytes = b"\xab" * 32) -> bytes:
    """Smallest byte layout that looks like an ESP-IDF app image to describe()."""
    desc = struct.pack(
        "<II8s32s32s16s16s32s32s", firmware.APP_DESC_MAGIC, 0, b"", version.encode(),
        b"bloom-pond", b"12:00:00", b"Nov 22 2026", b"v5.5", sha,
    )
    return bytes([firmware.IMAGE_MAGIC]) + b"\0" * 31 + desc + b"\0" * 96


def serve(handler) -> tuple[ThreadingHTTPServer, str]:
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}"


class FakeModels(BaseHTTPRequestHandler):
    """Answers like whisper-server (/inference) and llama-server (chat completions)."""
    seen: dict = {}

    def do_GET(self):  # noqa: N802
        self.send_response(200)
        self.send_header("Content-Length", "15")
        self.end_headers()
        self.wfile.write(b'{"status":"ok"}')

    def do_POST(self):  # noqa: N802
        body = self.rfile.read(int(self.headers["Content-Length"]))
        if self.path == "/inference":
            FakeModels.seen["stt_type"] = self.headers["Content-Type"]
            FakeModels.seen["stt_has_wav"] = b"RIFF" in body and b'name="file"' in body
            out = json.dumps({"text": " [BLANK_AUDIO] I skipped a call today.\n"}).encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(out)))
            self.end_headers()
            self.wfile.write(out)
            return
        FakeModels.seen["chat"] = json.loads(body)
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        for piece in (" It", " seems", " I’m", " avoiding", " it.", " **Why**", " now?"):
            chunk = {"choices": [{"delta": {"content": piece}}]}
            self.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode())
        self.wfile.write(b'data: {"choices":[{"delta":{}}]}\n\ndata: [DONE]\n\n')

    def log_message(self, *args):
        pass


def request(base: str, method: str, path: str, body: bytes = b"", headers: dict | None = None):
    host = base.removeprefix("http://")
    connection = http.client.HTTPConnection(host, timeout=10)
    connection.request(method, path, body=body or None, headers=headers or {})
    response = connection.getresponse()
    data = response.read()          # http.client decodes chunked transfer encoding
    connection.close()
    return response.status, data


def events(data: bytes) -> list[dict]:
    return [json.loads(line) for line in data.splitlines() if line]


class PureTests(unittest.TestCase):
    def test_display_text_is_ascii_without_markdown(self):
        text = pipeline.display_text("It’s **café** time — “now”… \U0001f331")
        self.assertEqual(text, "It's cafe time  -  \"now\"... ")

    def test_transcript_drops_non_speech_markers(self):
        self.assertEqual(pipeline.clean_transcript(" [BLANK_AUDIO] hello (wind)  there "), "hello there")

    def test_sse_parser_stops_at_done(self):
        lines = [b'data: {"choices":[{"delta":{"content":"a"}}]}', b"", b": ping",
                 b'data: {"choices":[{"delta":{}}]}', b"data: [DONE]", b'data: {"choices":[{"delta":{"content":"z"}}]}']
        self.assertEqual(list(pipeline.parse_sse(lines)), ["a"])

    def test_wav_wrapper(self):
        wav = pipeline.pcm_to_wav(b"\0\0" * 160)
        self.assertEqual((wav[:4], len(wav)), (b"RIFF", 44 + 320))

    def test_sessions_trim_and_expire(self):
        sessions = pipeline.Sessions({"history_turns": 1, "session_idle_minutes": 1})
        sessions.add("pond", "u1", "a1", now=0)
        sessions.add("pond", "u2", "a2", now=10)
        self.assertEqual([m["content"] for m in sessions.history("pond", now=20)], ["u2", "a2"])
        self.assertEqual(sessions.history("pond", now=200), [])

    def test_firmware_descriptor(self):
        info = firmware.describe(fake_image("0.4.0"))
        self.assertEqual((info["version"], info["project"], info["sha256"]), ("0.4.0", "bloom-pond", "ab" * 32))
        with self.assertRaises(ValueError):
            firmware.describe(b"not an image" * 40)

    def test_config_merge_keeps_nested_defaults(self):
        merged = cfg.merge(cfg.DEFAULTS, {"llm": {"ctx_size": 4096}, "wpm": 300})
        self.assertEqual((merged["llm"]["ctx_size"], merged["llm"]["max_tokens"], merged["wpm"]), (4096, 160, 300))

    def test_short_audio_is_rejected_before_any_model(self):
        sessions = pipeline.Sessions(cfg.DEFAULTS)
        result = list(pipeline.run_turn(cfg.DEFAULTS, sessions, "pond", pcm=b"\0" * 100))
        self.assertEqual([event["type"] for event in result], ["error"])


class PipelineOverHttpTests(unittest.TestCase):
    def test_real_stt_and_llm_clients_against_fake_servers(self):
        httpd, base = serve(FakeModels)
        self.addCleanup(httpd.server_close)
        self.addCleanup(httpd.shutdown)
        config = cfg.merge(cfg.DEFAULTS, {"llm": {"url": base}, "stt": {"url": base}})
        sessions = pipeline.Sessions(config)
        result = list(pipeline.run_turn(config, sessions, "pond", pcm=b"\1\0" * 16000))

        self.assertEqual([e["type"] for e in result][:3], ["stage", "transcript", "stage"])
        self.assertEqual(result[1]["text"], "I skipped a call today.")
        self.assertEqual(result[-1]["type"], "done")
        self.assertEqual(result[-1]["text"], "It seems I'm avoiding it. Why now?")
        self.assertEqual("".join(e["text"] for e in result if e["type"] == "delta"), result[-1]["text"])
        self.assertTrue(FakeModels.seen["stt_has_wav"])
        self.assertIn("multipart/form-data", FakeModels.seen["stt_type"])
        chat = FakeModels.seen["chat"]
        self.assertTrue(chat["stream"])
        self.assertEqual([m["role"] for m in chat["messages"]], ["system", "user"])
        # The next turn carries the remembered exchange.
        list(pipeline.run_turn(config, sessions, "pond", text="And then?"))
        self.assertEqual([m["role"] for m in FakeModels.seen["chat"]["messages"]],
                         ["system", "user", "assistant", "user"])

    def test_unreachable_model_becomes_an_error_event(self):
        config = cfg.merge(cfg.DEFAULTS, {"llm": {"url": "http://127.0.0.1:9"}})
        result = list(pipeline.run_turn(config, pipeline.Sessions(config), "pond", text="hello"))
        self.assertEqual(result[-1]["type"], "error")
        self.assertIn("Garden could not finish", result[-1]["message"])


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.config = cfg.merge(cfg.load(), {"data_dir": tempfile.mkdtemp(prefix="bloom-data-")})
        cls.garden = server.Garden(cls.config, mock=True)

        class Handler(server.Handler):
            garden = cls.garden

            def log_message(self, *args):
                pass

        cls.httpd, cls.base = serve(Handler)

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def test_hello_registers_the_pond(self):
        status, data = request(self.base, "GET", "/api/hello",
                               headers={"X-Bloom-Device": "pond-a1b2c3", "X-Bloom-Version": "0.1.0"})
        hello = json.loads(data)
        self.assertEqual((status, hello["protocol"], hello["ready"], hello["wpm"]), (200, 1, True, 270))
        self.assertEqual(self.garden.ponds["pond-a1b2c3"]["version"], "0.1.0")

    def test_audio_turn_streams_ndjson(self):
        status, data = request(self.base, "POST", "/api/turn", b"\1\0" * 16000,
                               {"X-Bloom-Device": "pond-a1b2c3", "Content-Type": "audio/L16;rate=16000"})
        result = events(data)
        self.assertEqual(status, 200)
        self.assertEqual([e["type"] for e in result][:3], ["stage", "transcript", "stage"])
        self.assertEqual(result[-1]["type"], "done")
        self.assertEqual(result[-1]["text"], pipeline.MOCK_REPLY)
        self.assertEqual(self.garden.turns[0]["reply"], pipeline.MOCK_REPLY)

    def test_chunked_upload_is_accepted(self):
        pcm = b"\1\0" * 16000
        body = b"%x\r\n%s\r\n0\r\n\r\n" % (len(pcm), pcm)
        status, data = request(self.base, "POST", "/api/turn", body, {"Transfer-Encoding": "chunked"})
        self.assertEqual((status, events(data)[-1]["type"]), (200, "done"))

    def test_firmware_upload_needs_token_then_is_served(self):
        image = fake_image("0.9.0")
        status, _ = request(self.base, "POST", "/api/firmware", image, {"X-Bloom-Token": "wrong"})
        self.assertEqual(status, 403)
        status, data = request(self.base, "POST", "/api/firmware", image,
                               {"X-Bloom-Token": self.config["upload_token"]})
        self.assertEqual((status, json.loads(data)["version"]), (200, "0.9.0"))
        offer = json.loads(request(self.base, "GET", "/api/hello")[1])["firmware"]
        self.assertEqual((offer["version"], offer["url"], offer["size"]), ("0.9.0", "/firmware/pond.bin", len(image)))
        self.assertEqual(request(self.base, "GET", "/firmware/pond.bin")[1], image)
        status, data = request(self.base, "POST", "/api/firmware", b"junk" * 100,
                               {"X-Bloom-Token": self.config["upload_token"]})
        self.assertEqual(status, 400)

    def test_dashboard_and_path_traversal(self):
        status, data = request(self.base, "GET", "/")
        self.assertEqual(status, 200)
        self.assertIn(b"Bloom Garden", data)
        self.assertEqual(request(self.base, "GET", "/../server.py")[0], 404)
        self.assertEqual(json.loads(request(self.base, "GET", "/api/status")[1])["services"]["mock"], True)


if __name__ == "__main__":
    unittest.main()
