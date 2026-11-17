import importlib.machinery
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

loader = importlib.machinery.SourceFileLoader("watch", str(Path(__file__).parents[1] / "mods/watchers/herdr-watch"))
spec = importlib.util.spec_from_loader(loader.name, loader)
watch = importlib.util.module_from_spec(spec)
loader.exec_module(watch)


def reading(**changes):
    base = {"number": 12, "title": "Add login", "url": "https://github.com/o/r/pull/12", "state": "OPEN", "draft": False,
            "mergeable": "MERGEABLE", "review": {"state": "required", "by": [], "at": ""},
            "checks": {"passed": 0, "failed": [], "pending": 0}, "activity": 2}
    return {**base, **changes}


def item(until, **baseline):
    return {"kind": "pr", "until": until, "baseline": {"review": "required", "reviewAt": "", "activity": 2, **baseline}}


class JudgeTests(unittest.TestCase):
    def test_review_waits_then_reports_approval_or_requested_changes(self):
        self.assertIsNone(watch.judge_pr(item("review"), reading()))
        approved = watch.judge_pr(item("review"), reading(review={"state": "approved", "by": ["ana"], "at": "t1"}))
        self.assertEqual((approved["title"], approved["level"]), ("PR #12 approved", "success"))
        self.assertIn("ana", approved["body"])
        changes = watch.judge_pr(item("review"), reading(review={"state": "changes_requested", "by": ["ana"], "at": "t1"}))
        self.assertEqual(changes["level"], "warning")

    def test_a_review_that_was_there_when_the_watch_began_is_not_news(self):
        old = {"state": "changes_requested", "by": ["ana"], "at": "t1"}
        waiting = item("review", review="changes_requested", reviewAt="t1")
        self.assertIsNone(watch.judge_pr(waiting, reading(review=old)))
        self.assertIsNotNone(watch.judge_pr(waiting, reading(review={**old, "at": "t2"})))

    def test_checks_fire_only_when_none_is_running(self):
        self.assertIsNone(watch.judge_pr(item("checks"), reading()))
        self.assertIsNone(watch.judge_pr(item("checks"), reading(checks={"passed": 3, "failed": ["lint"], "pending": 1})))
        failed = watch.judge_pr(item("checks"), reading(checks={"passed": 3, "failed": ["lint"], "pending": 0}))
        self.assertEqual((failed["level"], failed["body"]), ("error", "lint"))
        self.assertEqual(watch.judge_pr(item("checks"), reading(checks={"passed": 4, "failed": [], "pending": 0}))["level"], "success")

    def test_ready_needs_everything_and_reports_what_blocks(self):
        passed = {"passed": 2, "failed": [], "pending": 0}
        approved = {"state": "approved", "by": ["ana"], "at": "t1"}
        self.assertIsNone(watch.judge_pr(item("ready"), reading(checks=passed)))
        self.assertIsNone(watch.judge_pr(item("ready"), reading(checks=passed, review=approved, draft=True)))
        self.assertIsNone(watch.judge_pr(item("ready"), reading(checks={**passed, "pending": 1}, review=approved)))
        self.assertEqual(watch.judge_pr(item("ready"), reading(checks=passed, review=approved))["title"], "PR #12 is ready to merge")
        self.assertEqual(watch.judge_pr(item("ready"), reading(review=approved, mergeable="CONFLICTING"))["title"], "PR #12 has conflicts")

    def test_merged_and_closed_end_any_watch(self):
        for until in watch.UNTIL:
            self.assertEqual(watch.judge_pr(item(until), reading(state="MERGED"))["level"], "success")
            self.assertEqual(watch.judge_pr(item(until), reading(state="CLOSED"))["level"], "warning")

    def test_comment_counts_from_the_start(self):
        self.assertIsNone(watch.judge_pr(item("comment"), reading()))
        self.assertIsNotNone(watch.judge_pr(item("comment"), reading(activity=3)))

    def test_review_falls_back_to_the_latest_reviews_without_a_required_review(self):
        pr = {"reviewDecision": "", "latestReviews": [{"state": "APPROVED", "author": {"login": "ana"}, "submittedAt": "t1"},
                                                      {"state": "COMMENTED", "author": {"login": "bo"}, "submittedAt": "t2"}]}
        self.assertEqual(watch.review(pr), {"state": "approved", "by": ["ana"], "at": "t1"})
        pr["latestReviews"].append({"state": "CHANGES_REQUESTED", "author": {"login": "cy"}, "submittedAt": "t3"})
        self.assertEqual(watch.review(pr)["state"], "changes_requested")
        self.assertEqual(watch.review({"reviewDecision": "REVIEW_REQUIRED"})["state"], "required")

    def test_checks_count_runs_and_statuses(self):
        rollup = [{"status": "COMPLETED", "conclusion": "SUCCESS", "name": "build"},
                  {"status": "IN_PROGRESS", "conclusion": "", "name": "e2e"},
                  {"status": "COMPLETED", "conclusion": "FAILURE", "name": "lint"},
                  {"state": "PENDING", "context": "deploy"}, {"state": "SUCCESS", "context": "cla"},
                  {"status": "COMPLETED", "conclusion": "SKIPPED", "name": "docs"}]
        self.assertEqual(watch.checks(rollup), {"passed": 3, "failed": ["lint"], "pending": 2})


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.TemporaryDirectory()
        self.addCleanup(self.home.cleanup)
        patcher = patch.dict(os.environ, {"HERDR_APP_HOME": self.home.name, "HC_TERMINAL_ID": "t9"})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.args = SimpleNamespace(cwd=self.home.name, every=1, then=None, terminal=None)

    def command(self, line, until="succeeds", **extra):
        args = SimpleNamespace(**{**vars(self.args), **extra})
        return watch.add(watch.new("command", args, name="Marker", command=line, until=until), args)

    def test_command_waits_fires_once_and_tells_its_terminal(self):
        marker = Path(self.home.name) / "marker"
        added = self.command(f"cat {marker}", then="Deploy it")
        self.assertEqual((added["every"], added["terminal"], added["state"]["code"]), (15, "t9", 1))
        watch.tick(True, None)
        self.assertIsNone(watch.load()[0]["fired"])
        marker.write_text("ready\n")
        real = watch.subprocess.run
        with patch.object(watch.subprocess, "run") as run:
            run.side_effect = lambda argv, **kw: SimpleNamespace(returncode=0, stderr="") if argv[0] == "hc" else real(argv, **kw)
            watch.tick(True, None)
            sent = [call.args[0] for call in run.call_args_list if call.args[0][0] == "hc"]
        fired = watch.load()[0]
        self.assertEqual((fired["fired"]["title"], fired["fired"]["body"], fired["told"]), ("Marker succeeded", "ready", True))
        self.assertEqual(sent[0][:3], ["hc", "send", "t9"])
        self.assertIn("Deploy it", sent[0][3])
        at = fired["fired"]["at"]
        watch.tick(True, None)
        self.assertEqual(watch.load()[0]["fired"]["at"], at)

    def test_refuses_what_already_holds_and_then_without_a_terminal(self):
        with self.assertRaisesRegex(ValueError, "already"):
            self.command("true")
        with patch.dict(os.environ, {"HC_TERMINAL_ID": ""}):
            with self.assertRaisesRegex(ValueError, "terminal"):
                self.command("false", then="Go")
        self.assertEqual(watch.load(), [])

    def test_changes_mode_and_only_due_watchers_are_checked(self):
        counter = Path(self.home.name) / "n"
        counter.write_text("1")
        self.command(f"cat {counter}", until="changes")
        counter.write_text("2")
        watch.tick(False, None)
        self.assertIsNone(watch.load()[0]["fired"])
        watch.tick(True, None)
        self.assertEqual(watch.load()[0]["fired"]["title"], "Marker changed")

    def test_a_failed_reading_keeps_the_watcher_and_removal_clears_finished_ones(self):
        self.command("false")
        saved = watch.load()[0]
        watch.save({**saved, "kind": "pr", "ref": "1", "until": "review", "cwd": "/nonexistent-herdr-watch"})
        watch.tick(True, None)
        broken = watch.load()[0]
        self.assertTrue(broken["error"])
        self.assertIsNone(broken["fired"])
        watch.save({**broken, "fired": {"title": "x", "body": "", "level": "info", "at": 1}})
        self.assertEqual(watch.remove(SimpleNamespace(id=None, fired=True)), [broken["id"]])
        self.assertEqual(json.dumps(watch.load()), "[]")


if __name__ == "__main__":
    unittest.main()
