import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


SOURCE = Path(__file__).resolve().parents[1] / "mods/linear/worktrees.py"
spec = importlib.util.spec_from_file_location("linear_worktrees", SOURCE)
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class WorktreeTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.home = Path(self.temporary.name)
        self.repo = self.home / "repo with ' spaces"
        self.repo.mkdir()
        self.git("init", "-q")
        self.git("config", "user.name", "Test")
        self.git("config", "user.email", "test@example.invalid")
        self.git("config", "commit.gpgsign", "false")
        (self.repo / "file.txt").write_text("committed\n")
        (self.repo / "app").mkdir()
        (self.repo / "app/main.txt").write_text("nested\n")
        self.git("add", ".")
        self.git("commit", "-qm", "Base")
        self.patcher = patch.object(helper.Path, "home", return_value=self.home)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)
        self.tickets = [{"id": "one", "key": "PRO-31"}, {"id": "two", "key": "PRO-32"}]

    def git(self, *args):
        return subprocess.run(["git", "-C", str(self.repo), *args], check=True, capture_output=True, text=True).stdout.strip()

    def test_tickets_get_distinct_worktrees_and_branches_without_uncommitted_changes(self):
        (self.repo / "file.txt").write_text("uncommitted\n")
        plan = helper.inspect(self.repo, self.tickets)
        self.assertTrue(plan["dirty"])
        workspaces = [helper.create(self.repo, plan, ticket) for ticket in self.tickets]
        self.assertNotEqual(workspaces[0]["root"], workspaces[1]["root"])
        self.assertNotEqual(workspaces[0]["branch"], workspaces[1]["branch"])
        for workspace in workspaces:
            self.assertEqual((Path(workspace["root"]) / "file.txt").read_text(), "committed\n")
            branch = helper.git(workspace["cwd"], "branch", "--show-current")
            self.assertEqual(branch, workspace["branch"])
        (Path(workspaces[0]["root"]) / "file.txt").write_text("first agent\n")
        self.assertEqual((Path(workspaces[1]["root"]) / "file.txt").read_text(), "committed\n")
        self.assertEqual((self.repo / "file.txt").read_text(), "uncommitted\n")

    def test_base_commit_is_pinned_even_when_the_source_moves(self):
        plan = helper.inspect(self.repo, self.tickets)
        (self.repo / "file.txt").write_text("new commit\n")
        self.git("commit", "-qam", "New source head")
        workspace = helper.create(self.repo, plan, self.tickets[0])
        self.assertEqual(helper.git(workspace["root"], "rev-parse", "HEAD"), plan["base"])
        self.assertEqual((Path(workspace["root"]) / "file.txt").read_text(), "committed\n")

    def test_subdirectory_is_preserved_in_agent_working_folder(self):
        plan = helper.inspect(self.repo / "app", self.tickets)
        workspace = helper.create(self.repo / "app", plan, self.tickets[0])
        self.assertEqual(Path(workspace["cwd"]), Path(workspace["root"]) / "app")

    def test_existing_worktree_is_never_overwritten(self):
        plan = helper.inspect(self.repo, self.tickets)
        workspace = helper.create(self.repo, plan, self.tickets[0])
        (Path(workspace["root"]) / "file.txt").write_text("keep these changes\n")
        with self.assertRaisesRegex(ValueError, "already exists"):
            helper.create(self.repo, plan, self.tickets[0])
        self.assertEqual((Path(workspace["root"]) / "file.txt").read_text(), "keep these changes\n")

    def test_non_repository_and_invalid_commit_do_not_create_worktrees(self):
        with self.assertRaises(ValueError):
            helper.inspect(self.home, self.tickets)
        plan = helper.inspect(self.repo, self.tickets)
        plan["base"] = "HEAD; touch unexpected"
        with self.assertRaisesRegex(ValueError, "Invalid base commit"):
            helper.create(self.repo, plan, self.tickets[0])
        self.assertEqual(self.git("worktree", "list", "--porcelain").count("worktree "), 1)

    def test_ticket_keys_cannot_escape_the_worktree_root(self):
        plan = helper.inspect(self.repo, [{"id": "odd", "key": "../../Some ticket;$(echo bad)"}])
        root = Path(plan["workspaces"][0]["root"])
        root.relative_to(self.home / ".herdr/worktrees")
        self.assertNotIn("..", plan["workspaces"][0]["branch"])


if __name__ == "__main__":
    unittest.main()
