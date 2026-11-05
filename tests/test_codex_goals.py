import importlib.util
import json
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest


READER = Path(__file__).resolve().parents[1] / "mods/loops/codex-goals.py"
spec = importlib.util.spec_from_file_location("codex_goals", READER)
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


class CodexGoalsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def goals(self, rows, version=1):
        p = self.root / f"goals_{version}.sqlite"
        with sqlite3.connect(p) as db:
            db.execute("CREATE TABLE thread_goals (thread_id TEXT PRIMARY KEY, objective TEXT, "
                       "status TEXT, token_budget INTEGER, tokens_used INTEGER, "
                       "time_used_seconds INTEGER, updated_at_ms INTEGER)")
            db.executemany("INSERT INTO thread_goals VALUES (?, ?, ?, ?, ?, ?, ?)", rows)
        return p

    def threads(self, rows):
        p = self.root / "state_5.sqlite"
        with sqlite3.connect(p) as db:
            db.execute("CREATE TABLE threads (id TEXT PRIMARY KEY, cwd TEXT)")
            db.executemany("INSERT INTO threads VALUES (?, ?)", rows)

    def test_no_database_does_not_create_one(self):
        self.assertEqual(reader.load_goals(self.root)["goals"], [])
        self.assertEqual(list(self.root.iterdir()), [])
        self.assertFalse(reader.load_goals(self.root)["available"])

    def test_metadata_budget_and_priority_without_writing(self):
        goal_db = self.goals([
            ("done", "Shipped", "complete", None, 400, 240, 900),
            ("active", "Keep going", "active", 1000, 250, 60, 800),
            ("blocked", "Need input", "blocked", 1000, 300, 90, 700),
        ])
        cwd = str(self.root / "project with ' quotes")
        self.threads([(tid, cwd) for tid in ["done", "active", "blocked"]])
        before = goal_db.read_bytes()
        data = reader.load_goals(self.root)
        self.assertEqual([g["thread_id"] for g in data["goals"]], ["blocked", "active", "done"])
        self.assertEqual(data["goals"][1]["tokens_used"], 250)
        self.assertEqual(data["goals"][1]["cwd"], str(Path(cwd).resolve()))
        self.assertIsNone(data["warning"])
        self.assertEqual(goal_db.read_bytes(), before)

    def test_newest_schema_is_used_numerically(self):
        self.goals([("old", "Old", "active", None, 0, 0, 0)], version=2)
        self.goals([("new", "New", "paused", None, 0, 0, 0)], version=10)
        self.assertEqual(reader.load_goals(self.root)["goals"][0]["thread_id"], "new")

    def test_missing_session_metadata_preserves_goal(self):
        self.goals([("unknown", "Preserve me", "active", None, 0, 0, 0)])
        data = reader.load_goals(self.root)
        self.assertIsNone(data["goals"][0]["cwd"])
        self.assertIn("All projects", data["warning"])
        self.assertFalse((self.root / "state_5.sqlite").exists())

    def test_unknown_status_is_preserved(self):
        self.goals([("future", "Future status", "something_new", None, 0, 0, 0)])
        self.assertEqual(reader.load_goals(self.root)["goals"][0]["status"], "something_new")

    def test_incompatible_newest_database_does_not_show_stale_goals(self):
        self.goals([("old", "Stale", "active", None, 0, 0, 0)])
        with sqlite3.connect(self.root / "goals_2.sqlite") as db:
            db.execute("CREATE TABLE thread_goals (changed TEXT)")
        result = subprocess.run(["python3", str(READER), "--home", str(self.root)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn("not supported", json.loads(result.stdout)["error"])

    def test_cli_respects_codex_home(self):
        import os
        self.goals([("custom", "Custom home", "active", None, 0, 0, 0)])
        result = subprocess.run(["python3", str(READER)], env={**os.environ, "CODEX_HOME": str(self.root)},
                                capture_output=True, text=True, check=True)
        self.assertEqual(json.loads(result.stdout)["goals"][0]["thread_id"], "custom")


if __name__ == "__main__":
    unittest.main()
