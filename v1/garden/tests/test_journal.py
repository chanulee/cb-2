import tempfile
import unittest
from datetime import date, datetime
from pathlib import Path

from bloom_garden import journal


class JournalTests(unittest.TestCase):
    def test_days_group_by_date_with_age_and_topics(self):
        entries = [
            journal.entry("Walked by the river, the river was quiet.", "q", datetime(2026, 10, 20, 9)),
            journal.entry("Drew trees and a garden of memory.", "q", datetime(2026, 10, 27, 9)),
            journal.entry("The garden grew again.", "q", datetime(2026, 10, 27, 21)),
        ]
        result = journal.days(entries, date(2026, 10, 27))
        self.assertEqual([day["date"] for day in result], ["2026-10-20", "2026-10-27"])
        self.assertEqual([day["age"] for day in result], [7, 0])
        self.assertEqual(result[0]["topics"][0], "river")
        self.assertEqual(result[1]["topics"][0], "garden")
        self.assertEqual(result[1]["turns"], 2)

    def test_append_and_load_round_trip(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "garden.jsonl"
            item = journal.entry("hello there", "q", datetime(2026, 10, 27))
            journal.append(item, path)
            path.write_text(path.read_text() + "not json\n")
            self.assertEqual(journal.load(path), [item])


if __name__ == "__main__":
    unittest.main()
