import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


READER = Path(__file__).resolve().parents[1] / "mods/loops/claude-goals.py"
spec = importlib.util.spec_from_file_location("claude_goals", READER)
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


class ClaudeGoalsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def record(self, **attachment):
        return {"type": "attachment", "isSidechain": False, "sessionId": "session",
                "cwd": str(self.root / "project with ' spaces"), "timestamp": "2026-11-05T12:00:00Z",
                "attachment": {"type": "goal_status", "condition": "Tests pass", "met": False, **attachment}}

    def transcript(self, *rows, session="session"):
        path = self.root / "projects" / "encoded-project" / f"{session}.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("".join(json.dumps(row) + "\n" for row in rows))
        return path

    def goal(self):
        return reader.load_goals(self.root)["goals"][0]

    def test_no_claude_home_creates_nothing(self):
        self.assertFalse(reader.load_goals(self.root)["available"])
        self.assertEqual(reader.load_goals(self.root)["goals"], [])
        self.assertEqual(list(self.root.iterdir()), [])

    def test_only_structured_goals_are_read_and_unknown_metrics_stay_unknown(self):
        path = self.transcript(
            {"type": "user", "message": {"content": "/goal ordinary text is not authoritative"}},
            {"type": "assistant", "attachment": {"type": "goal_status", "condition": "Fake", "met": True}},
            self.record(sentinel=True),
        )
        before = path.read_bytes()
        goal = self.goal()
        self.assertEqual(goal["status"], "saved")
        self.assertEqual(goal["objective"], "Tests pass")
        self.assertEqual(goal["thread_id"], "session")
        self.assertEqual(goal["cwd"], str((self.root / "project with ' spaces").resolve()))
        self.assertIsNone(goal["tokens_used"])
        self.assertIsNone(goal["time_used_seconds"])
        self.assertIsNone(goal["token_budget"])
        self.assertEqual(path.read_bytes(), before)

    def test_completion_uses_recorded_metrics_not_transcript_age(self):
        self.transcript(self.record(sentinel=True), self.record(met=True, tokens=1293,
                        durationMs=38185, iterations=2, reason="Tests passed"))
        goal = self.goal()
        self.assertEqual(goal["status"], "complete")
        self.assertEqual(goal["tokens_used"], 1293)
        self.assertEqual(goal["time_used_seconds"], 38.185)
        self.assertEqual(goal["iterations"], 2)
        self.assertEqual(goal["reason"], "Tests passed")
        self.assertEqual(goal["updated_at_ms"], 1793880000000)

    def test_clear_sentinel_is_not_success(self):
        self.transcript(self.record(sentinel=True), self.record(met=True, sentinel=True))
        self.assertEqual(self.goal()["status"], "cleared")

    def test_failed_goal_is_not_complete(self):
        self.transcript(self.record(sentinel=True), self.record(failed=True, reason="Impossible", tokens=100))
        self.assertEqual(self.goal()["status"], "failed")
        self.assertEqual(self.goal()["reason"], "Impossible")

    def test_compaction_terminal_sentinel_preserves_completed_verdict_and_metrics(self):
        self.transcript(self.record(sentinel=True), self.record(met=True, tokens=42, durationMs=1000),
                        self.record(met=True, sentinel=True))
        self.assertEqual(self.goal()["status"], "complete")
        self.assertEqual(self.goal()["tokens_used"], 42)

    def test_replacement_resets_previous_goal_metrics(self):
        self.transcript(self.record(met=True, tokens=42, durationMs=1000),
                        self.record(sentinel=True, condition="New outcome"),
                        self.record(condition="New outcome", reason="One check left"))
        goal = self.goal()
        self.assertEqual(goal["status"], "saved")
        self.assertEqual(goal["objective"], "New outcome")
        self.assertEqual(goal["reason"], "One check left")
        self.assertIsNone(goal["tokens_used"])
        self.assertIsNone(goal["time_used_seconds"])

    def test_sidechains_and_subagent_files_do_not_override_session_goal(self):
        sidechain = {**self.record(met=True), "isSidechain": True}
        path = self.transcript(self.record(sentinel=True), sidechain)
        sub = path.parent / "session" / "subagents" / "agent-test.jsonl"
        sub.parent.mkdir(parents=True)
        sub.write_text(json.dumps(self.record(met=True)) + "\n")
        self.assertEqual(len(reader.load_goals(self.root)["goals"]), 1)
        self.assertEqual(self.goal()["status"], "saved")

    def test_partial_final_line_is_ignored_and_seen_at_next_refresh(self):
        path = self.transcript(self.record(sentinel=True))
        final = json.dumps(self.record(met=True))
        with path.open("a") as stream:
            stream.write(final[:60])
        self.assertEqual(self.goal()["status"], "saved")
        with path.open("a") as stream:
            stream.write(final[60:] + "\n")
        self.assertEqual(self.goal()["status"], "complete")

    def test_incompatible_records_report_error_instead_of_stale_goals(self):
        self.transcript(self.record(sentinel=True), self.record(met="unknown"))
        result = subprocess.run(["python3", str(READER), "--home", str(self.root)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn("not supported", json.loads(result.stdout)["error"])

    def test_provider_home_override_and_missing_metadata(self):
        row = self.record(sentinel=True, tokens=-1, durationMs="unknown", iterations=True)
        del row["cwd"]
        self.transcript(row)
        result = subprocess.run(["python3", str(READER)],
                                env={**os.environ, "CLAUDE_CONFIG_DIR": str(self.root)},
                                capture_output=True, text=True, check=True)
        data = json.loads(result.stdout)
        self.assertEqual(data["goals"][0]["thread_id"], "session")
        self.assertIsNone(data["goals"][0]["cwd"])
        self.assertIsNone(data["goals"][0]["tokens_used"])
        self.assertIsNone(data["goals"][0]["iterations"])
        self.assertIn("All projects", data["warning"])


if __name__ == "__main__":
    unittest.main()
