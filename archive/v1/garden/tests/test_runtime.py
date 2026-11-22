import unittest

from bloom_garden.runtime import Runtime, parse_prometheus, parse_tegrastats


class RuntimeTests(unittest.TestCase):
    def test_native_metrics_parsers(self):
        jetson = parse_tegrastats(
            "RAM 4657/7486MB SWAP 16/8192MB CPU [9%@729,5%@729] "
            "GR3D_FREQ 42% gpu@48.25C VDD_IN 3144mW"
        )
        llama = parse_prometheus(
            "llamacpp:prompt_tokens_seconds 81.5\nllamacpp:predicted_tokens_seconds 22.4\n"
        )
        self.assertEqual((jetson["ram_used_mb"], jetson["gpu"], jetson["cpu"]), (4657, 42, 7.0))
        self.assertEqual(llama["predicted_tokens_seconds"], 22.4)

    def test_stop_clears_the_single_managed_process(self):
        class Process:
            stopped = False

            def poll(self): return None
            def terminate(self): self.stopped = True
            def wait(self, timeout): return 0

        runtime = Runtime()
        runtime.process = Process()  # type: ignore[assignment]
        runtime.stop()
        self.assertTrue(runtime.process is None)


if __name__ == "__main__":
    unittest.main()
