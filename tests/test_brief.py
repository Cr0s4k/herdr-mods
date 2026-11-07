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


if __name__ == "__main__":
    unittest.main()
