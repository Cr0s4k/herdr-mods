import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest


READER = Path(__file__).resolve().parents[1] / "mods/loops/opencode-goals.py"
spec = importlib.util.spec_from_file_location("opencode_goals", READER)
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


class OpenCodeGoalsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "opencode.db"

    def database(self, goals, sessions):
        with sqlite3.connect(self.path) as db:
            db.execute("CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT)")
            db.execute("CREATE TABLE session_v2 (id TEXT PRIMARY KEY, directory TEXT)")
            db.executemany("INSERT INTO kv VALUES (?, ?)", goals)
            db.executemany("INSERT INTO session_v2 VALUES (?, ?)", sessions)

    def test_goals_are_read_with_their_session_folder_active_first(self):
        key = "plugin:006f00700065006e0063006f00640065002e0067006f0061006c:session:"
        self.assertEqual(reader.PREFIX, key)
        self.database([
            (key + "ses_done", json.dumps({"objective": "Ship it", "status": "complete", "rounds": 3, "updatedAt": 50, "reason": "Tests pass."})),
            (key + "ses_live", json.dumps({"objective": "Fix the build", "status": "active", "rounds": 1, "updatedAt": 20})),
            (key + "ses_gone", json.dumps({"objective": "Its session was deleted", "status": "active"})),
            (key + "ses_bad", "not json"),
            ("models-dev:v2:catalog", "{}"),
        ], [("ses_done", "/work/app"), ("ses_live", "/work/api"), ("ses_bad", "/work/api")])
        result = reader.load_goals(self.path)
        self.assertEqual([(g["thread_id"], g["status"], g["cwd"], g["iterations"]) for g in result["goals"]],
                         [("ses_live", "active", "/work/api", 1), ("ses_done", "complete", "/work/app", 3)])
        self.assertEqual(result["goals"][1]["reason"], "Tests pass.")
        self.assertIsNone(result["goals"][0]["tokens_used"])

    def test_a_missing_database_has_no_goals(self):
        self.assertEqual(reader.load_goals(self.path), {"available": False, "goals": [], "warning": None})


if __name__ == "__main__":
    unittest.main()
