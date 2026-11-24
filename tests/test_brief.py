import importlib.machinery
import importlib.util
import json
import os
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

loader = importlib.machinery.SourceFileLoader("brief", str(Path(__file__).parents[1] / "mods/brief/herdr-brief"))
spec = importlib.util.spec_from_loader(loader.name, loader)
brief = importlib.util.module_from_spec(spec)
loader.exec_module(brief)


class BriefTests(unittest.TestCase):
    def setUp(self):
        self.spaces = [{"id": "one", "tabs": [{"terminals": [{"terminal": "t1"}]}]},
                       {"id": "two", "tabs": [{"terminals": [{"terminal": "remote/t1"}]}]}]
        self.worker = {"address": "t1", "cwd": "/work/project", "status": "working", "state": "live"}

    def test_exact_identity_beats_folder_and_machine_collisions(self):
        self.assertEqual(brief.destination(self.spaces, [], "/different", "remote/t1"), ("two", "remote/t1"))
        self.assertEqual(brief.destination(self.spaces, [self.worker], "/work/project"), ("one", "t1"))

    def test_ambiguous_missing_and_similar_paths_refuse_to_post(self):
        for workers, cwd in [([], "/work/project"), ([self.worker] * 2, "/work/project"),
                             ([self.worker], "/work/project-other")]:
            with self.assertRaises(ValueError):
                brief.destination(self.spaces, workers, cwd)
        with self.assertRaises(ValueError):
            brief.destination(self.spaces, [], "/work/project", "missing")

    def test_concurrent_posts_are_atomic_and_round_trip(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {"HERDR_APP_HOME": folder}), \
                patch.object(brief, "command_json", return_value={"spaces": self.spaces}):
            args = SimpleNamespace(cwd=folder, terminal="t1", title="Fixed", summary="Result",
                                   change=["Callback"], test=["42 passed"], question=["Ship?"], caveat=[])
            with ThreadPoolExecutor(max_workers=8) as pool:
                results = list(pool.map(lambda _: brief.post(args), range(24)))
            items = brief.listing()["items"]
            self.assertEqual(len(items), 24)
            self.assertEqual(len({item["id"] for item in results}), 24)
            self.assertTrue(all(item["tests"] == ["42 passed"] and item["space"] == "one" for item in items))
            self.assertEqual(list(brief.store().glob("*.tmp")), [])
            (brief.store() / "invalid.json").write_text("null")
            listed = brief.listing()
            self.assertEqual(len(listed["items"]), 24)
            self.assertIn("1 handoff", listed["warning"])

    def test_repeated_caveats_round_trip_through_the_command(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {"HERDR_APP_HOME": folder}), \
                patch.object(brief, "command_json", return_value={"spaces": self.spaces}), \
                patch.object(brief.sys, "argv", ["herdr-brief", "post", "--terminal", "t1", "--cwd", folder,
                                                "--title", "Sign-in fixed", "--summary", "Returns to your page",
                                                "--caveat", "Safari has not been checked", "--caveat", "Restart required"]), \
                patch("builtins.print"):
            self.assertEqual(brief.main(), 0)
            item = brief.listing()["items"][0]
            self.assertEqual(item["caveats"], ["Safari has not been checked", "Restart required"])
            self.assertEqual(item["tests"], [])

    def test_empty_sections_are_optional_but_invalid_claim_payloads_rejected(self):
        item = {"source": "agent", "id": "one", "space": "one", "terminal": "t1", "time": 1,
                "title": "Ready", "summary": "Done", "changes": [], "tests": [], "questions": []}
        self.assertEqual(brief.validate(item)["tests"], [])
        for value in ("warning", [""], [None], ["Too long"] * 31):
            with self.assertRaises(ValueError):
                brief.validate({**item, "caveats": value})
        with self.assertRaises(ValueError):
            brief.validate({**item, "tests": "passed"})
        with self.assertRaises(ValueError):
            brief.validate({**item, "summary": " "})


class ReplyTests(unittest.TestCase):
    def setUp(self):
        self.home = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: __import__("shutil").rmtree(self.home))
        self.turn = {"space": "one", "terminal": "t1", "title": "Fix login", "agent": "claude", "since": 1000, "time": 90000, "pid": 41, "cwd": "/work/shop"}
        lines = lambda *rows: "\n".join(json.dumps(row) for row in rows) + "\n"
        (self.home / "sessions").mkdir()
        (self.home / "sessions/41.json").write_text(json.dumps({"pid": 41, "sessionId": "abc", "cwd": "/work/shop"}))
        folder = self.home / "projects/-work-shop"
        folder.mkdir(parents=True)
        said = lambda text, **more: {"type": "assistant", "message": {"content": [{"type": "thinking", "thinking": "hm"}, {"type": "text", "text": text}]}, **more}
        (folder / "abc.jsonl").write_text(lines(said("An earlier reply."), {"type": "user", "message": {"content": "go on"}},
                                               said("The login works again.\n\n- The cookie is host-only.\n- Tests pass.\n\nShould I also remove the old flag?"),
                                               said("A helper's words", isSidechain=True), {"type": "assistant", "message": {"content": [{"type": "tool_use", "input": {}}]}}))
        day = self.home / "sessions/2026/11/24"
        day.mkdir(parents=True)
        (day / "one.jsonl").write_text(lines({"type": "session_meta", "payload": {"id": "cx1", "cwd": "/work/shop"}},
                                             {"type": "response_item", "payload": {"role": "assistant", "content": [{"type": "output_text", "text": "Cached the lookups."}]}}))
        (day / "two.jsonl").write_text(lines({"type": "session_meta", "payload": {"id": "cx2", "cwd": "/elsewhere"}},
                                             {"type": "response_item", "payload": {"role": "assistant", "content": [{"type": "output_text", "text": "Not this one."}]}}))

    def wrap(self, **more):
        with patch.dict(os.environ, {"HERDR_APP_HOME": str(self.home / "app")}):
            done = brief.wrap({**self.turn, **more}, self.home, self.home)
            return done, brief.listing()["items"]

    def test_a_reply_becomes_its_first_paragraph_the_rest_and_a_closing_question(self):
        done, items = self.wrap()
        self.assertEqual(done["space"], "one")
        item = items[0]
        self.assertEqual((item["title"], item["summary"], item["changes"], item["questions"]),
                         ("Fix login", "The login works again.", ["- The cookie is host-only.\n- Tests pass."], ["Should I also remove the old flag?"]))
        self.assertEqual((item["auto"], item["source"], item["terminal"], item["time"], item["tests"]), (True, "agent", "t1", 90000, []))
        self.assertEqual(brief.shape("Is this what you meant?"), {"summary": "Is this what you meant?", "changes": [], "questions": []})
        long = brief.shape("x" * 700 + "\n\n" + "y" * 7000)
        self.assertEqual((len(long["summary"]), len(long["changes"][0])), (601, 6001))

    def test_the_agent_s_own_brief_from_that_turn_wins_and_an_older_one_does_not(self):
        with patch.dict(os.environ, {"HERDR_APP_HOME": str(self.home / "app")}):
            own = {"id": "handoff-1-a", "space": "one", "terminal": "t1", "time": 500, "source": "agent", "title": "Old", "summary": "Before this turn.", "changes": [], "tests": [], "questions": []}
            brief.save(own)
        self.assertIn("id", self.wrap()[0])
        with patch.dict(os.environ, {"HERDR_APP_HOME": str(self.home / "app")}):
            brief.save({**own, "id": "handoff-2-b", "time": 5000})
        done, items = self.wrap()
        self.assertEqual(done, {"skipped": "The agent left its own brief."})
        self.assertEqual(len(items), 3)

    def test_codex_is_read_from_the_folder_s_conversation_and_what_can_t_be_read_is_skipped(self):
        done, items = self.wrap(agent="codex", since=0)
        self.assertEqual(items[0]["summary"], "Cached the lookups.")
        self.assertEqual(self.wrap(agent="codex", since=0, terminal="t2", cwd="/nowhere")[0], {"skipped": "No reply could be read."})
        self.assertEqual(self.wrap(agent="opencode", terminal="t3")[0], {"skipped": "No reply could be read."})
        self.assertEqual(self.wrap(pid=99, terminal="t4")[0], {"skipped": "No reply could be read."})
        self.assertEqual(self.wrap(pid=None, terminal="t5")[0], {"skipped": "No reply could be read."})


if __name__ == "__main__":
    unittest.main()
