import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


READER = Path(__file__).resolve().parents[1] / "mods/loops/claude-loops.py"
spec = importlib.util.spec_from_file_location("claude_loops", READER)
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)
NOW = 1793880000000


class ClaudeLoopsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.home = self.root / "config"
        self.project = self.root / "project with ' spaces"

    def row(self, **fields):
        return {"cwd": str(self.project), "timestamp": "2026-11-05T12:00:00Z", **fields}

    def task(self, task_id="job-one", **fields):
        return {"id": task_id, "cron": "*/5 * * * *", "prompt": "Check the deploy",
                "createdAt": NOW - 60000, "recurring": True, **fields}

    def snapshot(self, tasks, **fields):
        return self.row(type="attachment", attachment={"type": "session_cron_carry", "tasks": tasks, **fields})

    def call(self, name, args, call_id="call-one"):
        return self.row(type="assistant", message={"content": [
            {"type": "tool_use", "name": name, "id": call_id, "input": args}]})

    def result(self, data, call_id="call-one", error=False, text="Success"):
        return self.row(type="user", toolUseResult=data, message={"content": [
            {"type": "tool_result", "tool_use_id": call_id, "is_error": error, "content": text}]})

    def transcript(self, *rows, session="session"):
        path = self.home / "projects" / "encoded-project" / f"{session}.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("".join(json.dumps(row) + "\n" for row in rows))
        return path

    def load(self, projects=(), now=NOW):
        return reader.load_schedules(self.home, projects=projects, now_ms=now)["goals"]

    def project_file(self, tasks):
        path = self.project / ".claude" / "scheduled_tasks.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"tasks": tasks}))
        return path

    def test_missing_home_and_empty_snapshots_create_nothing(self):
        self.assertEqual(self.load(), [])
        self.assertFalse(self.home.exists())
        self.transcript(self.snapshot([]))
        self.assertEqual(self.load(), [])

    def test_snapshot_restores_multiple_tasks_and_never_claims_live_execution(self):
        path = self.transcript(self.snapshot([self.task(), self.task("two", recurring=False)]))
        before = path.read_bytes()
        items = self.load()
        self.assertEqual(len(items), 2)
        self.assertEqual({item["status"] for item in items}, {"saved_schedule"})
        self.assertEqual(items[0]["thread_id"], "session")
        self.assertEqual(items[0]["cron"], "*/5 * * * *")
        self.assertEqual(items[0]["cwd"], str(self.project))
        self.assertNotEqual(items[0]["record_id"], items[1]["record_id"])
        self.assertIsNone(items[0]["tokens_used"])
        self.assertIn("may no longer be running", items[0]["reason"])
        self.assertEqual(before, path.read_bytes())

    def test_create_requires_successful_matching_result(self):
        self.transcript(self.call("CronCreate", {"cron": "0 * * * *", "prompt": "Check CI"}),
                        self.result({"id": "wrong"}, call_id="unrelated"))
        self.assertEqual(self.load(), [])
        self.transcript(self.call("CronCreate", {"cron": "0 * * * *", "prompt": "Check CI"}),
                        self.result({"id": "rejected"}, error=True))
        self.assertEqual(self.load(), [])
        self.transcript(self.call("CronCreate", {"cron": "0 * * * *", "prompt": "Check CI"}),
                        self.result({"id": "created", "nextFireAt": NOW + 60000, "durable": False}))
        item = self.load()[0]
        self.assertEqual(item["task_id"], "created")
        self.assertTrue(item["recurring"])
        self.assertEqual(item["recorded_next_run_ms"], NOW + 60000)

    def test_failed_delete_does_not_cancel_and_successful_delete_does(self):
        rows = [self.snapshot([self.task()]), self.call("CronDelete", {"id": "job-one"})]
        self.transcript(*rows, self.result({"id": "job-one"}, error=True))
        self.assertEqual(self.load()[0]["status"], "saved_schedule")
        self.transcript(*rows, self.result({"id": "job-one"}))
        self.assertEqual(self.load()[0]["status"], "cancelled")

    def test_empty_snapshot_ends_previous_tasks_without_claiming_success(self):
        self.transcript(self.snapshot([self.task()]), self.snapshot([]))
        item = self.load()[0]
        self.assertEqual(item["status"], "ended")
        self.assertIn("outcome not recorded", item["reason"])

    def test_ended_snapshot_ids_other_armed_and_compaction(self):
        self.transcript(self.snapshot([self.task()]), self.snapshot([], ended=["job-one"], otherArmed=[self.task("other")]))
        items = {item["task_id"]: item for item in self.load()}
        self.assertEqual(items["job-one"]["status"], "ended")
        self.assertEqual(items["other"]["status"], "saved_schedule")

    def test_cron_list_reconciles_tasks_and_retains_creation_time_for_expiry(self):
        old = self.task(createdAt=NOW - reader.WEEK_MS - 1)
        listed = {"id": "job-one", "cron": "0 * * * *", "prompt": "Check CI", "recurring": True}
        self.transcript(self.snapshot([old, self.task("removed")]), self.call("CronList", {}), self.result({"jobs": [listed]}))
        items = {item["task_id"]: item for item in self.load()}
        self.assertEqual(items["job-one"]["status"], "expired")
        self.assertEqual(items["removed"]["status"], "ended")

    def test_expiry_uses_creation_and_does_not_expire_permanent_or_one_shot_tasks(self):
        self.transcript(self.snapshot([
            self.task("expired", createdAt=NOW - reader.WEEK_MS),
            self.task("permanent", createdAt=NOW - reader.WEEK_MS, permanent=True),
            self.task("one-shot", createdAt=NOW - reader.WEEK_MS, recurring=False),
        ]))
        items = {item["task_id"]: item for item in self.load()}
        self.assertEqual(items["expired"]["status"], "expired")
        self.assertEqual(items["permanent"]["status"], "saved_schedule")
        self.assertEqual(items["one-shot"]["status"], "saved_schedule")

    def test_dynamic_wakeup_reschedules_and_stop_does_not_cancel_fixed_cron(self):
        self.transcript(self.snapshot([self.task()], wakeup={"prompt": "Watch CI", "scheduledFor": NOW + 60000}),
                        self.call("ScheduleWakeup", {"prompt": "Watch CI", "delaySeconds": 120, "reason": "Build running"}),
                        self.result({"scheduledFor": NOW + 120000}),
                        self.call("ScheduleWakeup", {"stop": True}, call_id="stop"),
                        self.result({"stopped": True, "scheduledFor": 0}, call_id="stop"))
        items = {item["task_id"]: item for item in self.load()}
        self.assertEqual(len(items), 2)
        self.assertEqual(items["wakeup"]["status"], "cancelled")
        self.assertEqual(items["wakeup"]["recorded_next_run_ms"], NOW + 120000)
        self.assertEqual(items["job-one"]["status"], "saved_schedule")

    def test_passed_wakeup_is_unknown_not_completed_or_recomputed(self):
        self.transcript(self.snapshot([], wakeup={"prompt": "Watch CI", "scheduledFor": NOW - 1}))
        item = self.load()[0]
        self.assertEqual(item["status"], "schedule_due")
        self.assertEqual(item["recorded_next_run_ms"], NOW - 1)
        self.assertIn("not confirmed", item["reason"])

    def test_listed_dynamic_wakeup_is_not_duplicated_and_can_be_cancelled_by_id(self):
        self.transcript(self.snapshot([], wakeup={"prompt": "Watch CI", "scheduledFor": NOW + 60000}),
                        self.call("CronList", {}), self.result({"jobs": [self.task("internal-id", prompt="Watch CI", recurring=False, nextFireAt=NOW + 60000)]}),
                        self.call("CronDelete", {"id": "internal-id"}, call_id="delete"),
                        self.result({"id": "internal-id"}, call_id="delete"))
        items = self.load()
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["schedule_kind"], "dynamic")
        self.assertEqual(items[0]["status"], "cancelled")

    def test_scheduler_can_report_dynamic_expiry(self):
        self.transcript(self.snapshot([], wakeup={"prompt": "Watch CI", "scheduledFor": NOW + 1}),
                        self.call("ScheduleWakeup", {"prompt": "Watch CI", "delaySeconds": 120, "reason": "waiting"}),
                        self.result({"scheduledFor": 0, "clampedDelaySeconds": 0}))
        self.assertEqual(self.load()[0]["status"], "expired")

    def test_durable_file_is_authoritative_and_deduplicates_transcript_entries(self):
        path = self.project_file([self.task(createdBySessionId="session")])
        self.transcript(self.call("CronCreate", {"cron": "*/5 * * * *", "prompt": "Check the deploy", "durable": True}),
                        self.result({"id": "job-one", "durable": True}))
        before = path.read_bytes()
        items = self.load()
        self.assertEqual(len(items), 1)
        self.assertTrue(items[0]["durable"])
        self.assertEqual(items[0]["thread_id"], "session")
        self.assertEqual(before, path.read_bytes())
        self.project_file([])
        self.assertEqual(self.load()[0]["status"], "ended")

    def test_explicit_project_finds_durable_tasks_without_transcripts_or_session(self):
        self.project_file([self.task()])
        items = self.load(projects=[self.project / "src"])
        self.assertEqual(len(items), 1)
        self.assertIsNone(items[0]["thread_id"])
        self.assertEqual(items[0]["cwd"], str(self.project))

    def test_copied_project_schedule_is_inactive(self):
        self.project_file([self.task(createdInProject=str(self.root / "other-project"))])
        item = self.load(projects=[self.project])[0]
        self.assertEqual(item["status"], "inactive")
        self.assertIn("does not run in this folder", item["reason"])

    def test_sidechains_subagents_and_ordinary_text_do_not_create_tasks(self):
        self.transcript({**self.snapshot([self.task()]), "isSidechain": True},
                        self.row(type="user", message={"content": "CronCreate ScheduleWakeup /loop 5m check CI"}))
        path = self.home / "projects" / "encoded-project" / "session" / "subagents" / "agent-one.jsonl"
        path.parent.mkdir(parents=True)
        path.write_text(json.dumps(self.snapshot([self.task()])) + "\n")
        self.assertEqual(self.load(), [])

    def test_partial_result_is_replayed_only_after_writer_finishes(self):
        path = self.transcript(self.call("CronCreate", {"cron": "*/5 * * * *", "prompt": "Watch CI"}))
        result = json.dumps(self.result({"id": "job-one"}))
        with path.open("a") as stream:
            stream.write(result[:80])
        self.assertEqual(self.load(), [])
        with path.open("a") as stream:
            stream.write(result[80:] + "\n")
        self.assertEqual(len(self.load()), 1)

    def test_older_text_create_and_delete_results_are_confirmed(self):
        self.transcript(self.call("CronCreate", {"cron": "*/5 * * * *", "prompt": "Watch CI"}),
                        self.result(None, text="Scheduled recurring job old-job (every 5 min). Session-only."),
                        self.call("CronDelete", {"id": "old-job"}, call_id="delete"),
                        self.result(None, call_id="delete", text="Cancelled job old-job."))
        self.assertEqual(self.load()[0]["status"], "cancelled")

    def test_incompatible_snapshot_and_schedule_file_report_errors(self):
        self.transcript(self.snapshot("unknown"))
        with self.assertRaisesRegex(ValueError, "Unsupported"):
            self.load()
        self.transcript(self.snapshot([]))
        path = self.project_file([])
        path.write_text('{"tasks": "unknown"}')
        with self.assertRaisesRegex(ValueError, "Unsupported"):
            self.load()

    def test_default_prompt_sentinel_is_displayed_as_a_task(self):
        self.transcript(self.snapshot([self.task(prompt="<<autonomous-loop>>")]))
        self.assertEqual(self.load()[0]["objective"], "Run the default /loop prompt")

    def test_custom_config_and_project_work_with_no_executables_on_path(self):
        self.project_file([self.task()])
        result = subprocess.run([sys.executable, str(READER), "--project", str(self.project)],
                                env={**os.environ, "CLAUDE_CONFIG_DIR": str(self.home), "PATH": str(self.root / "empty-bin")},
                                capture_output=True, text=True, check=True)
        self.assertEqual(json.loads(result.stdout)["goals"][0]["task_id"], "job-one")


if __name__ == "__main__":
    unittest.main()
