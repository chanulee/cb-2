import unittest

from bloom_garden.inference import chat_payload


class InferenceTest(unittest.TestCase):
    def test_prompt_uses_first_person_inner_voice(self):
        payload = chat_payload("  I made time to walk.  ")
        messages = payload["messages"]
        self.assertIn("first-person", messages[0]["content"])
        self.assertEqual(messages[1]["content"], "My reflection: I made time to walk.")
        self.assertEqual(payload["reasoning_effort"], "none")


if __name__ == "__main__":
    unittest.main()
