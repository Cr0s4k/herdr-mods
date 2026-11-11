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
            self.assertEqual(usage.usage("/Users/me/.herdr/worktrees/shop/T-1", home, home), {"read": 105, "cached": 1000, "written": 47, "turns": 2})

    def test_a_folder_without_transcripts_has_no_usage(self):
        with tempfile.TemporaryDirectory() as home:
            self.assertIsNone(usage.usage("/nowhere", home, home))

    def test_adds_the_last_running_total_of_each_codex_session_in_the_worktree(self):
        with tempfile.TemporaryDirectory() as home:
            day = Path(home) / "sessions/2026/11/11"
            day.mkdir(parents=True)
            meta = lambda cwd: json.dumps({"type": "session_meta", "payload": {"cwd": cwd}})
            count = lambda i, c, o: json.dumps({"type": "event_msg", "payload": {"type": "token_count", "info": {"total_token_usage": {"input_tokens": i, "cached_input_tokens": c, "output_tokens": o}}}})
            (day / "a.jsonl").write_text("\n".join([meta("/w/T-1"), count(100, 60, 5), count(100, 60, 5), json.dumps({"type": "event_msg", "payload": {"type": "token_count", "info": None}}), count(300, 200, 20)]) + "\n")
            (day / "b.jsonl").write_text("\n".join([meta("/w/T-1/src"), count(50, 0, 3)]) + "\n")
            (day / "c.jsonl").write_text("\n".join([meta("/w/T-10"), count(999, 0, 9)]) + "\n")
            (day / "d.jsonl").write_text("not json\n")
            self.assertEqual(usage.usage("/w/T-1", home, home), {"read": 150, "cached": 200, "written": 23, "turns": 3})


if __name__ == "__main__":
    unittest.main()
