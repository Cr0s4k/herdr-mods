import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("spaces_recent", ROOT / "mods/spaces-pin/recent.py")
recent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recent)

CWD = "/Users/me/code/shop"


def lines(*rows):
    return "\n".join(json.dumps(row) for row in rows) + "\n"


class RecentTest(unittest.TestCase):
    def setUp(self):
        self.home = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: __import__("shutil").rmtree(self.home))

    def claude(self, name, text, at):
        folder = self.home / "projects" / "-Users-me-code-shop"
        folder.mkdir(parents=True, exist_ok=True)
        (folder / name).write_text(text)
        os.utime(folder / name, (at, at))

    def test_claude_conversations_take_their_last_title_or_first_typed_message(self):
        self.claude("a.jsonl", lines({"type": "user", "message": {"content": "<system-reminder>skip</system-reminder>"}},
                                     {"type": "user", "message": {"content": [{"type": "text", "text": "Fix   the login\nplease"}]}},
                                     {"type": "ai-title", "aiTitle": "Old title"}, {"type": "ai-title", "aiTitle": "Login fix"}), 200)
        self.claude("b.jsonl", lines({"type": "user", "isSidechain": True, "message": {"content": "helper"}}, {"type": "user", "message": {"content": "Sort the list"}}), 300)
        self.claude("c.jsonl", lines({"type": "mode", "mode": "normal"}), 400)
        found = recent.recent(CWD, 8, self.home, self.home, self.home / "none.db", {})
        self.assertEqual(found, [{"agent": "claude", "id": "b", "title": "Sort the list", "at": 300000, "cwd": CWD}, {"agent": "claude", "id": "a", "title": "Login fix", "at": 200000, "cwd": CWD}])
        self.assertEqual(len(recent.recent(CWD, 1, self.home, self.home, self.home / "none.db", {})), 1)

    def test_codex_and_opencode_conversations_of_the_folder_join_newest_first(self):
        day = self.home / "sessions/2026/11/24"
        day.mkdir(parents=True)
        meta = lambda cwd, key: {"type": "session_meta", "payload": {"id": key, "cwd": cwd}}
        said = lambda text: {"type": "response_item", "payload": {"role": "user", "content": [{"type": "input_text", "text": text}]}}
        (day / "one.jsonl").write_text(lines(meta(CWD, "cx1"), said("<environment_context>x</environment_context>"), said("Add a cache")))
        (day / "two.jsonl").write_text(lines(meta("/elsewhere", "cx2"), said("Not here")))
        os.utime(day / "one.jsonl", (100, 100))
        database = self.home / "opencode.db"
        with sqlite3.connect(database) as connection:
            connection.execute("create table session_v2 (id text, parent_id text, directory text, title text, time_updated integer)")
            connection.executemany("insert into session_v2 values (?, ?, ?, ?, ?)", [("ses_1", None, CWD, "Review PR 12", 500000), ("ses_2", "ses_1", CWD, "A helper", 600000), ("ses_3", None, "/elsewhere", "Other", 700000), ("ses_4", None, "/wt/t-1", "Rebase PR 12", 800000)])
        found = recent.recent(CWD + "/", 8, self.home, self.home, database, {})
        self.assertEqual([(row["agent"], row["id"], row["title"]) for row in found], [("opencode", "ses_1", "Review PR 12"), ("codex", "cx1", "Add a cache")])
        self.assertTrue(all("branch" not in row for row in found))
        (day / "three.jsonl").write_text(lines(meta("/wt/t-1", "cx3"), said("Fix the checks")))
        os.utime(day / "three.jsonl", (900, 900))
        both = recent.recent(CWD, 8, self.home, self.home, database, {"/wt/t-1": "t-1-fix"})
        self.assertEqual([(row["id"], row.get("branch"), row["cwd"]) for row in both[:2]], [("cx3", "t-1-fix", "/wt/t-1"), ("ses_4", "t-1-fix", "/wt/t-1")])

    def test_the_repository_s_other_checkouts_are_found_through_git(self):
        import subprocess
        repo, tree = self.home / "repo", self.home / "tree"
        run = lambda *args: subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True)
        repo.mkdir()
        run("init", "-q", "-b", "main")
        run("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "Base")
        run("worktree", "add", "-q", "-b", "t-1-fix", str(tree))
        self.assertEqual(recent.worktrees(str(repo.resolve())), {str(tree.resolve()): "t-1-fix"})
        self.assertEqual(recent.worktrees(str(self.home / "nowhere")), {})

    def search(self, query, cwd=CWD, **more):
        options = {"home": self.home, "codex_home": self.home, "database": self.home / "none.db", "others": {}, **more}
        return recent.search(cwd, query, **options)

    def test_search_finds_what_was_typed_or_answered_and_skips_tool_output(self):
        user = lambda text: {"type": "user", "message": {"content": text}}
        agent = lambda *parts: {"type": "assistant", "message": {"content": list(parts)}}
        text = lambda words: {"type": "text", "text": words}
        self.claude("a.jsonl", lines(user("Fix the login"), agent({"type": "thinking", "thinking": "the cookie flag"}, text("The   session cookie was missing its Secure flag, so the browser dropped it.")), {"type": "ai-title", "aiTitle": "Login fix"}), 200)
        self.claude("b.jsonl", lines(user("Sort the list"), {"type": "user", "message": {"content": [{"type": "tool_result", "content": [text("cookie cookie secure")]}]}}, agent(text("Sorted."))), 300)
        self.claude("c.jsonl", lines(user("Rename the cookie"), {"type": "assistant", "isSidechain": True, "message": {"content": [text("secure")]}}), 400)
        found = self.search("COOKIE secure")
        self.assertEqual([(row["id"], row["who"], row["snippet"]) for row in found["data"]], [("a", "agent", "The session cookie was missing its Secure flag, so the browser dropped it.")])
        self.assertFalse(found["cut"])
        self.assertEqual([row["id"] for row in self.search("cookie")["data"]], ["c", "a"])
        self.assertEqual(self.search("nowhere")["data"], [])
        self.assertEqual(self.search('say "cookie')["data"], [])

    def test_the_words_may_be_in_different_messages_and_the_excerpt_shows_where(self):
        long = "word " * 40 + "the needle sits here " + "tail " * 40
        self.claude("a.jsonl", lines({"type": "user", "message": {"content": "Find the haystack"}}, {"type": "assistant", "message": {"content": [{"type": "text", "text": long}]}}), 200)
        row = self.search("haystack needle")["data"][0]
        self.assertEqual(row["who"], "you")
        self.assertEqual(row["snippet"], "Find the haystack")
        row = self.search("needle")["data"][0]
        self.assertTrue(row["snippet"].startswith("…") and row["snippet"].endswith("…") and "the needle sits here" in row["snippet"])
        self.assertLessEqual(len(row["snippet"]), 162)

    def test_no_words_lists_the_latest_and_a_removed_folder_is_marked(self):
        here = self.home / "shop"
        here.mkdir()
        folder = self.home / "projects" / recent.re.sub(r"[^A-Za-z0-9]", "-", str(here))
        folder.mkdir(parents=True)
        (folder / "a.jsonl").write_text(lines({"type": "user", "message": {"content": "Still here"}}))
        self.claude("b.jsonl", lines({"type": "user", "cwd": CWD, "message": {"content": "Elsewhere"}}), 300)
        self.assertEqual([(row["title"], row.get("gone")) for row in self.search("", str(here))["data"]], [("Still here", None)])
        everywhere = self.search("", str(here), everywhere=True)["data"]
        self.assertEqual(sorted((row["title"], row.get("gone"), row.get("folder"), row["cwd"]) for row in everywhere), [("Elsewhere", True, "shop", CWD), ("Still here", None, None, str(here))])
        self.assertEqual(len(self.search("", str(here), everywhere=True, limit=1)["data"]), 1)

    def test_search_reads_codex_and_matches_opencode_titles_in_the_repository_s_worktrees(self):
        day = self.home / "sessions/2026/11/24"
        day.mkdir(parents=True)
        meta = lambda cwd, key: {"type": "session_meta", "payload": {"id": key, "cwd": cwd}}
        said = lambda role, words: {"type": "response_item", "payload": {"role": role, "content": [{"type": "input_text", "text": words}]}}
        (day / "one.jsonl").write_text(lines(meta("/wt/t-1", "cx1"), said("user", "Add a cache"), said("assistant", "Cached the price lookups.")))
        (day / "two.jsonl").write_text(lines(meta("/elsewhere", "cx2"), said("user", "Cache the price list")))
        database = self.home / "opencode.db"
        with sqlite3.connect(database) as connection:
            connection.execute("create table session_v2 (id text, parent_id text, directory text, title text, time_updated integer)")
            connection.executemany("insert into session_v2 values (?, ?, ?, ?, ?)", [("ses_1", None, CWD, "Price cache review", 500000), ("ses_2", None, CWD, "Other", 600000), ("ses_3", None, "/elsewhere", "Price of cache", 700000)])
        found = self.search("price cache", database=database, others={"/wt/t-1": "t-1-cache"})["data"]
        self.assertEqual(sorted((row["agent"], row["id"], row.get("branch"), row.get("who")) for row in found), [("codex", "cx1", "t-1-cache", "agent"), ("opencode", "ses_1", None, None)])
        everywhere = self.search("price cache", database=database, everywhere=True)["data"]
        self.assertEqual(sorted(row["id"] for row in everywhere), ["cx1", "cx2", "ses_1", "ses_3"])

    def test_a_conversation_a_running_claude_is_in_carries_its_process(self):
        self.claude("a.jsonl", lines({"type": "user", "message": {"content": "Fix the login"}}), 200)
        self.claude("b.jsonl", lines({"type": "user", "message": {"content": "Sort the list"}}), 300)
        (self.home / "sessions").mkdir()
        (self.home / "sessions/41.json").write_text(json.dumps({"pid": 41, "sessionId": "a"}))
        (self.home / "sessions/42.json").write_text("not json")
        self.assertEqual([(row["id"], row.get("pid")) for row in self.search("")["data"]], [("b", None), ("a", 41)])

    def test_a_search_out_of_time_says_it_stopped_early(self):
        self.claude("a.jsonl", lines({"type": "user", "message": {"content": "Fix the login"}}), 200)
        self.assertEqual(self.search("login", budget=-1), {"data": [], "cut": True})


if __name__ == "__main__":
    unittest.main()
