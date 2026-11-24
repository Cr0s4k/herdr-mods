import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / "mods/toggles/herdr-usage"
PANELS = ["files", "changes", "show", "brief", "loops", "skills", "watchers", "linear", "plane"]


class UsageTest(unittest.TestCase):
    def run_cli(self, home, *args):
        return subprocess.run([str(CLI), *args], capture_output=True, text=True, env={**os.environ, "HERDR_APP_HOME": str(home)})

    def test_it_counts_recent_use_by_feature_and_names_what_was_never_used(self):
        with tempfile.TemporaryDirectory() as home:
            now = time.time() * 1000
            rows = [{"at": now, "feature": "find-chat", "name": "open"}, {"at": now, "feature": "find-chat", "name": "open"}, {"at": now - 1000, "feature": "find-chat", "name": "resume"},
                    {"at": now, "feature": "loops", "name": "panel"}, {"at": now - 30 * 86400000, "feature": "skills", "name": "panel"}, {"feature": "broken"}]
            (Path(home) / "usage").mkdir()
            (Path(home) / "usage/mods.jsonl").write_text("\n".join(json.dumps(row) for row in rows) + "\nnot json\n")
            text = self.run_cli(home).stdout
            self.assertRegex(text, r"\s3  Find conversation\s+last \d{4}-\d\d-\d\d  \(open 2, resume 1\)\n\s+1  Loops")
            self.assertRegex(text, r"Never used: .*Skills")
            self.assertNotRegex(text, r"Never used: .*Loops")
            self.assertRegex(self.run_cli(home, "60").stdout, r"\s1  Skills")
            self.assertIn("herdr-pipeline --usage", text)

    def test_with_no_log_it_says_so(self):
        with tempfile.TemporaryDirectory() as home:
            done = self.run_cli(home)
            self.assertEqual(done.returncode, 1)
            self.assertIn("nothing logged yet", done.stderr)

    def test_every_feature_a_mod_logs_has_a_name_and_every_named_one_is_logged(self):
        features = set(re.findall(r'"([\w-]+)": "', CLI.read_text().split("FEATURES = {")[1].split("}")[0]))
        logged = set()
        for file in (ROOT / "mods").glob("*/*.js"):
            if not file.is_symlink():
                logged.update(re.findall(r'track\("([\w-]+)", "', file.read_text()))
        self.assertEqual(logged - features, set())
        self.assertEqual(features - logged - set(PANELS), set())
        self.assertIn('track(id, "panel")', (ROOT / "mods/tabs-show/main.js").read_text())

    def test_every_mod_that_logs_has_the_logger_linked_in(self):
        for file in (ROOT / "mods").glob("*/*.js"):
            if 'from "./usage.js"' in file.read_text():
                link = file.parent / "usage.js"
                self.assertTrue(link.exists(), f"{file.parent.name} imports usage.js")
                if file.parent.name != "toggles":
                    self.assertEqual(os.readlink(link), "../toggles/usage.js")


if __name__ == "__main__":
    unittest.main()
