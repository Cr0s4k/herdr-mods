import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("pipeline_limits", ROOT / "mods/pipeline/limits.py")
limits = importlib.util.module_from_spec(spec)
spec.loader.exec_module(limits)

LOGIN = json.dumps({"claudeAiOauth": {"accessToken": "sk-ant-oat-test", "expiresAt": 9_999_999_999_999}})
ANSWER = {
    "five_hour": {"utilization": 49.0, "resets_at": "2026-11-11T18:29:58.733401+00:00"},
    "seven_day": {"utilization": 25.0, "resets_at": "2026-11-13T19:59:59+00:00"},
    "extra_usage": {"is_enabled": True, "utilization": 78.98},
    "limits": [
        {"kind": "session", "percent": 49, "resets_at": "2026-11-11T18:29:58.733401+00:00", "scope": None},
        {"kind": "weekly_all", "percent": 25, "resets_at": "2026-11-13T19:59:59+00:00", "scope": None},
        {"kind": "weekly_scoped", "percent": 8, "resets_at": "2026-11-13T19:59:59+00:00", "scope": {"model": {"display_name": "Fable"}}},
        {"kind": "weekly_scoped", "percent": 0, "resets_at": None, "scope": {"model": {"display_name": "Opus"}}},
        {"kind": "something_new", "percent": 70, "resets_at": None, "scope": None},
    ],
}


def keychain(entries, asked=None):
    def read(service, who):
        if asked is not None:
            asked.append(service)
        return entries.get(service, (44, ""))
    return read


class ClaudeTest(unittest.TestCase):
    def test_reads_every_limit_with_its_reset_and_the_extra_usage(self):
        sent = []
        result = limits.claude(None, keychain({"Claude Code-credentials": (0, LOGIN)}), lambda token: sent.append(token) or (200, json.dumps(ANSWER).encode()), "darwin")
        self.assertEqual(sent, ["sk-ant-oat-test"])
        self.assertEqual(result, {"windows": [
            {"name": "5-hour", "used": 49.0, "resets": 1794421798733, "model": None},
            {"name": "Weekly", "used": 25.0, "resets": 1794599999000, "model": None},
            {"name": "Weekly Fable", "used": 8.0, "resets": 1794599999000, "model": "fable"},
        ], "extra": 79})

    def test_falls_back_to_the_named_buckets(self):
        answer = {"five_hour": ANSWER["five_hour"], "seven_day": ANSWER["seven_day"]}
        self.assertEqual([w["name"] for w in limits.claude_windows(answer)], ["5-hour", "Weekly"])

    def test_a_profile_folder_has_its_own_keychain_entry(self):
        with mock.patch.dict(os.environ, {"HOME": "/Users/me"}):
            self.assertEqual(limits.services("/Users/me/work-claude"), ["Claude Code-credentials-" + __import__("hashlib").sha256(b"/Users/me/work-claude").hexdigest()[:8]])
            self.assertEqual(limits.services("/Users/me/.claude")[1:], ["Claude Code-credentials"])
            self.assertEqual(limits.services(None), ["Claude Code-credentials"])

    def test_says_plainly_why_there_is_no_reading(self):
        never = lambda token: self.fail("no request without a login")
        with tempfile.TemporaryDirectory() as folder:
            self.assertEqual(limits.claude(folder, keychain({}), never, "darwin"), {"error": "Claude Code isn't signed in on this machine.", "missing": True})
            locked = keychain({limits.services(folder)[0]: (36, "")})
            self.assertFalse(limits.claude(folder, locked, never, "darwin")["missing"])
        expired = json.dumps({"claudeAiOauth": {"accessToken": "x", "expiresAt": 1}})
        self.assertIn("expired", limits.claude(None, keychain({"Claude Code-credentials": (0, expired)}), never, "darwin")["error"])
        login = keychain({"Claude Code-credentials": (0, LOGIN)})
        self.assertIn("expired", limits.claude(None, login, lambda token: (401, b""), "darwin")["error"])
        self.assertIn("less often", limits.claude(None, login, lambda token: (429, b""), "darwin")["error"])
        self.assertIn("changed shape", limits.claude(None, login, lambda token: (200, b'{"limits": []}'), "darwin")["error"])
        def offline(token):
            raise OSError("no route to host")
        self.assertEqual(limits.claude(None, login, offline, "darwin"), {"error": "Couldn't reach Anthropic: no route to host"})

    def test_off_macos_the_login_is_in_the_profile_folder(self):
        with tempfile.TemporaryDirectory() as folder:
            Path(folder, ".credentials.json").write_text(LOGIN)
            sent = []
            limits.claude(folder, lambda *a: self.fail("no keychain off macOS"), lambda token: sent.append(token) or (200, json.dumps(ANSWER).encode()), "linux")
            self.assertEqual(sent, ["sk-ant-oat-test"])


def event(timestamp, limit_id="codex", primary=None, secondary=None):
    return json.dumps({"timestamp": timestamp, "type": "event_msg", "payload": {"type": "token_count", "info": None,
                       "rate_limits": {"limit_id": limit_id, "primary": primary, "secondary": secondary}}})


class CodexTest(unittest.TestCase):
    def test_reads_the_newest_report_across_sessions(self):
        with tempfile.TemporaryDirectory() as home:
            day = Path(home, "sessions/2026/11/11")
            day.mkdir(parents=True)
            (day / "old.jsonl").write_text("\n".join([
                event("2026-11-11T10:00:00Z", primary={"used_percent": 80.0, "window_minutes": 300, "resets_at": 1794400000}),
            ]) + "\n")
            (day / "new.jsonl").write_text("\n".join([
                json.dumps({"type": "session_meta", "payload": {"cwd": "/w"}}),
                event("2026-11-11T15:00:00Z", primary={"used_percent": 12.0, "window_minutes": 300, "resets_at": 1794428280},
                      secondary={"used_percent": 3.0, "window_minutes": 10080, "resets_in_seconds": 60}),
                event("2026-11-11T15:01:00Z", limit_id="premium"),
            ]) + "\n")
            os.utime(day / "old.jsonl", (1, 1))
            self.assertEqual(limits.codex(home), {"windows": [
                {"name": "5-hour", "used": 12.0, "resets": 1794428280000, "model": None},
                {"name": "Weekly", "used": 3.0, "resets": 1794409260000, "model": None},
            ], "seen": 1794409200000})

    def test_a_machine_without_codex_reports_is_missing_not_broken(self):
        with tempfile.TemporaryDirectory() as home:
            self.assertEqual(limits.codex(home), {"error": "Codex hasn't reported its limits on this machine yet.", "missing": True})

    def test_window_names(self):
        self.assertEqual([limits.span(m) for m in (300, 10080, 1440, 43200, None)], ["5-hour", "Weekly", "1-day", "30-day", "Limit"])


if __name__ == "__main__":
    unittest.main()
