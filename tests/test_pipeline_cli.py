import importlib.machinery
import importlib.util
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

loader = importlib.machinery.SourceFileLoader("herdr_pipeline", str(Path(__file__).parents[1] / "mods/pipeline/herdr-pipeline"))
spec = importlib.util.spec_from_loader(loader.name, loader)
cli = importlib.util.module_from_spec(spec)
loader.exec_module(cli)

NOW = 1_800_000_000


def task(id, status, **extra):
    return {"id": id, "title": f"Task {id}", "status": status, "since": (NOW - 300) * 1000, **extra}


class PipelineCliTests(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.TemporaryDirectory()
        self.addCleanup(self.home.cleanup)
        worktree = f"{self.home.name}/wt/t-2"
        self.worktree = worktree
        state = {"context": {"cwd": "/proj", "name": "proj"}, "running": True, "parallel": 2, "lastTick": 1,
                 "events": [{"id": 2, "task": "T-2", "message": "T-2 · Claude Code started.", "at": (NOW - 60) * 1000}],
                 "tasks": [task("T-1", "done"),
                           task("T-2", "working", workspaces={"proj": {"root": worktree, "branch": "t-2", "target": "main", "base": "abcdef123"}},
                                log=[{"message": "T-2 · Claude Code started.", "at": (NOW - 60) * 1000}, "T-2 joined the queue."],
                                checked="failed", checkOutput="\n".join(f"line {n}" for n in range(30))),
                           task("T-3", "review", error="Uncommitted changes in proj.")]}
        shared = {cli.STORE: {cli.LIVE + '[null,"/proj"]': state, '[null,"/proj"]': {"tasks": [task("DEMO-1", "queued")]}}}
        Path(self.home.name, "shared.json").write_text(json.dumps(shared))
        patcher = patch.dict(os.environ, {"HERDR_APP_HOME": self.home.name})
        patcher.start()
        self.addCleanup(patcher.stop)

    def run_cli(self, *argv, cwd="/proj", root="/proj"):
        out = io.StringIO()
        with patch("sys.argv", ["herdr-pipeline", *argv]), patch("os.getcwd", return_value=cwd), \
                patch.object(cli, "project_root", return_value=root), patch("time.time", return_value=NOW), redirect_stdout(out):
            cli.main()
        return out.getvalue()

    def test_overview_lists_unfinished_tasks_and_counts_done_ones(self):
        text = self.run_cli()
        self.assertIn("proj · running · 1/2 slots · local merge", text)
        self.assertRegex(text, r"T-2\s+working\s+5m  Task T-2")
        self.assertIn("! Uncommitted changes in proj.", text)
        self.assertNotIn("T-1 ", text)
        self.assertIn("+1 done", text)
        self.assertNotIn("DEMO-1", text, "the simulation is not a live pipeline")

    def test_dot_finds_the_task_of_the_current_worktree(self):
        text = self.run_cli(".", cwd=f"{self.worktree}/sub", root=None)
        self.assertTrue(text.startswith("T-2 working for 5m"))
        self.assertIn("t-2 from main@abcdef1", text)
        self.assertIn("check failed, last 12 of 30 lines:", text)
        self.assertNotIn("line 17\n", text)
        lines = text.split("history:\n")[1].splitlines()
        self.assertEqual(lines[0].strip(), "joined the queue.", "oldest first, a line saved without a time has none")
        self.assertRegex(lines[1], r"^  \d\d-\d\d \d\d:\d\d  Claude Code started\.$")

    def test_full_keeps_the_whole_check_output(self):
        self.assertIn("line 0\n", self.run_cli("t-2", "--full"))

    def test_json_drops_bulky_fields(self):
        data = json.loads(self.run_cli("--json"))
        self.assertNotIn("events", data)
        self.assertEqual([row["id"] for row in data["tasks"]], ["T-2", "T-3"])
        self.assertNotIn("checkOutput", data["tasks"][0])

    def test_events_are_oldest_first_with_times(self):
        self.assertRegex(self.run_cli("--events", "5"), r"\n  \d\d-\d\d \d\d:\d\d  T-2 · Claude Code started\.\n")

    def test_another_folder_has_no_pipeline(self):
        with self.assertRaises(SystemExit) as stop:
            self.run_cli(cwd="/elsewhere", root="/elsewhere")
        self.assertIn("no live pipeline", str(stop.exception.code))


if __name__ == "__main__":
    unittest.main()


class UsageLogTest(PipelineCliTests):
    def test_usage_counts_recent_presses_and_names_what_was_never_pressed(self):
        folder = Path(self.home.name, "pipeline")
        folder.mkdir()
        rows = [{"at": NOW * 1000, "name": "approve", "task": "T-1"}, {"at": (NOW - 3600) * 1000, "name": "approve"},
                {"at": NOW * 1000, "name": "open", "drawer": "settings", "section": "delivery"}, {"at": (NOW - 40 * 86400) * 1000, "name": "revert"}]
        (folder / "usage.jsonl").write_text("\n".join(json.dumps(row) for row in rows) + "\nnot json\n")
        text = self.run_cli("--usage")
        self.assertRegex(text, r"\s2  approve")
        self.assertIn("open drawer=settings section=delivery", text)
        never = text.split("Never pressed: ")[1]
        self.assertIn("revert", never, "pressed too long ago to count")
        self.assertNotIn("approve,", never)
        self.assertNotIn("launched", never, "what only the runner sends was never a button")
        self.assertRegex(self.run_cli("--usage", "60"), r"\s1  revert")
