import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("pipeline_usage", ROOT / "mods/pipeline/usage.py")
usage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(usage)


def reply(id, **counts):
    return json.dumps({"type": "assistant", "message": {"id": id, "usage": counts}})


class UsageTest(unittest.TestCase):
    def test_sums_each_reply_once_across_transcripts(self):
        with tempfile.TemporaryDirectory() as home:
            folder = usage.folder("/Users/me/.herdr/worktrees/shop/T-1", home)
            self.assertEqual(folder.name, "-Users-me--herdr-worktrees-shop-T-1")
            folder.mkdir(parents=True)
            first = reply("a", input_tokens=10, cache_creation_input_tokens=90, cache_read_input_tokens=1000, output_tokens=40)
            (folder / "one.jsonl").write_text("\n".join([first, first, json.dumps({"type": "user", "message": {"content": "usage"}}), "not json \"usage\""]) + "\n")
            (folder / "two.jsonl").write_text(reply("b", input_tokens=5, output_tokens=7, service_tier="standard") + "\n")
            self.assertEqual(usage.usage("/Users/me/.herdr/worktrees/shop/T-1", home), {"read": 105, "cached": 1000, "written": 47, "turns": 2})

    def test_a_folder_without_transcripts_has_no_usage(self):
        with tempfile.TemporaryDirectory() as home:
            self.assertIsNone(usage.usage("/nowhere", home))


if __name__ == "__main__":
    unittest.main()
