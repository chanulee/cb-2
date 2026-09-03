import unittest

from bloom_garden.session import PROMPTS, Turn, next_turn, opening_turn


class SessionTests(unittest.TestCase):
    def test_one_turn_is_pure_and_wraps(self):
        state = opening_turn(len(PROMPTS) - 1)
        result = next_turn(state.prompt_index, "  I made time to walk.  ", 640)

        self.assertEqual(state, Turn(len(PROMPTS) - 1, PROMPTS[-1]))
        self.assertEqual(result, Turn(0, PROMPTS[0], "I made time to walk.", 640))

    def test_generated_prompt_replaces_fallback(self):
        result = next_turn(0, "I noticed a pattern.", 64, "What might I try tomorrow?")
        self.assertEqual(result.prompt, "What might I try tomorrow?")


if __name__ == "__main__":
    unittest.main()
