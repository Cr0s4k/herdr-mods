import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


delivery = load("pipeline_delivery", ROOT / "mods/pipeline/delivery.py")
worktrees = load("pipeline_worktrees", ROOT / "mods/linear/worktrees.py")


class DeliveryTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.home = Path(self.temporary.name)
        self.repo = self.home / "project"
        self.repo.mkdir()
        self.git(self.repo, "init", "-q", "-b", "main")
        for key, value in (("user.name", "Test"), ("user.email", "test@example.invalid"), ("commit.gpgsign", "false")):
            self.git(self.repo, "config", key, value)
        (self.repo / "app.txt").write_text("one\ntwo\nthree\n")
        self.git(self.repo, "add", ".")
        self.git(self.repo, "commit", "-qm", "Base")
        patcher = patch.object(worktrees.Path, "home", return_value=self.home)
        patcher.start()
        self.addCleanup(patcher.stop)
        plan = worktrees.inspect(self.repo, [{"id": "T-1", "key": "T-1-add-notes"}], "pipeline")
        self.workspace = worktrees.create(self.repo, plan, {"id": "T-1", "key": "T-1-add-notes"})
        self.base = plan["base"]
        self.tree = Path(self.workspace["root"])

    def git(self, cwd, *args):
        return subprocess.run(["git", "-C", str(cwd), *args], check=True, capture_output=True, text=True).stdout.strip()

    def git_optional(self, cwd, *args):
        result = subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True)
        return result.stdout.strip() if result.returncode == 0 else None

    def payload(self, op, **extra):
        return {"op": op, "root": str(self.repo), "worktree": str(self.tree), "branch": self.workspace["branch"],
                "base": self.base, "title": "T-1 Add notes", **extra}

    def test_adoption_asks_reads_and_moves_only_the_agents_files(self):
        asked = delivery.adopt_ask({"root": str(self.repo), "task": "T-2"})
        self.assertEqual(delivery.adopt_read({"root": str(self.repo), "task": "T-2"}), {"found": False})
        Path(asked["path"]).write_text(json.dumps({"title": "Notes", "description": "Half done", "files": ["app.txt", "new/notes.txt", "gone.txt", "../outside.txt"]}))
        read = delivery.adopt_read({"root": str(self.repo), "task": "T-2"})
        self.assertEqual((read["title"], read["description"]), ("Notes", "Half done"))
        (self.repo / "app.txt").write_text("one\ntwo\nthree\nfour\n")
        (self.repo / "new").mkdir()
        (self.repo / "new/notes.txt").write_text("notes\n")
        (self.repo / "other.txt").write_text("someone else\n")
        moved = delivery.adopt_move({"root": str(self.repo), "worktree": str(self.tree), "task": "T-2", "files": read["files"]})
        self.assertEqual(sorted(moved["moved"]), ["app.txt", "new/notes.txt"])
        self.assertEqual(moved["skipped"], ["gone.txt"])
        self.assertEqual((self.tree / "app.txt").read_text(), "one\ntwo\nthree\nfour\n")
        self.assertEqual((self.tree / "new/notes.txt").read_text(), "notes\n")
        self.assertEqual(self.git(self.repo, "status", "--porcelain"), "?? other.txt")
        self.assertEqual(self.git(self.repo, "stash", "list"), "")

    def test_adoption_puts_the_files_back_when_they_do_not_apply(self):
        (self.repo / "notes.txt").write_text("mine\n")
        (self.tree / "notes.txt").write_text("already here\n")
        with self.assertRaisesRegex(ValueError, "back in the project folder"):
            delivery.adopt_move({"root": str(self.repo), "worktree": str(self.tree), "task": "T-2", "files": ["notes.txt"]})
        self.assertEqual((self.repo / "notes.txt").read_text(), "mine\n")
        self.assertEqual(self.git(self.repo, "stash", "list"), "")

    def test_adoption_with_nothing_uncommitted_moves_nothing(self):
        self.assertEqual(delivery.adopt_move({"root": str(self.repo), "worktree": str(self.tree), "task": "T-2", "files": ["app.txt"]}), {"moved": [], "skipped": ["app.txt"]})

    def agent_commits(self, name="notes.txt", text="notes\n"):
        (self.tree / name).write_text(text)
        self.git(self.tree, "add", ".")
        self.git(self.tree, "commit", "-qm", "Agent work")

    def test_pipeline_branches_carry_the_plain_ticket_name_and_worktrees_their_own_folder(self):
        self.assertEqual(self.workspace["branch"], "t-1-add-notes")
        self.assertEqual(self.tree.parent.name, "pipeline")
        self.assertTrue(self.tree.name.startswith("t-1-add-notes-"))

    def test_a_taken_branch_name_gets_a_number(self):
        plan = worktrees.inspect(self.repo, [{"id": "T-1", "key": "T-1-add-notes"}], "pipeline")
        again = worktrees.create(self.repo, plan, {"id": "T-1", "key": "T-1-add-notes"})
        self.assertEqual(again["branch"], "t-1-add-notes-2")
        self.with_origin()
        self.git(self.repo, "push", "-q", "origin", "main:t-1-add-notes-3")
        self.git(self.repo, "fetch", "-q", "origin")
        plan = worktrees.inspect(self.repo, [{"id": "T-1", "key": "T-1-add-notes"}], "pipeline")
        self.assertEqual(worktrees.create(self.repo, plan, {"id": "T-1", "key": "T-1-add-notes"})["branch"], "t-1-add-notes-4", "a branch on origin counts as taken")

    def test_the_pull_request_description_file_lives_in_the_worktree_git_folder(self):
        path = Path(self.workspace["prBody"])
        self.assertEqual(path.name, "herdr-pr.md")
        self.assertNotIn(self.tree, path.parents)
        path.write_text("Summary\n")
        self.assertEqual(self.git(self.tree, "status", "--porcelain"), "")
        self.assertEqual(delivery.written(self.tree), "Summary")

    def test_delivery_follows_a_branch_the_agent_renamed(self):
        self.git(self.tree, "branch", "-m", "fix/t-1-add-notes")
        self.agent_commits()
        delivery.merge(self.payload("merge"))
        self.assertEqual((self.repo / "notes.txt").read_text(), "notes\n")
        delivery.remove(self.payload("remove"))
        self.assertEqual(self.git(self.repo, "branch", "--list", "fix/t-1-add-notes"), "")

    def test_merge_fast_forwards_the_project_branch(self):
        self.agent_commits()
        result = delivery.merge(self.payload("merge"))
        self.assertEqual(result["target"], "main")
        self.assertEqual((self.repo / "notes.txt").read_text(), "notes\n")
        self.assertEqual(self.git(self.repo, "rev-list", "--merges", "--count", "HEAD"), "0")

    def test_uncommitted_agent_work_is_refused_unless_committing_is_asked_for(self):
        (self.tree / "notes.txt").write_text("left over\n")
        head = self.git(self.repo, "rev-parse", "HEAD")
        with self.assertRaisesRegex(ValueError, "uncommitted changes, so its agent may still be working"):
            delivery.merge(self.payload("merge"))
        self.assertEqual(self.git(self.repo, "rev-parse", "HEAD"), head)
        self.assertEqual(self.git(self.tree, "status", "--porcelain"), "?? notes.txt", "nothing was committed for the agent")
        delivery.merge(self.payload("merge", commit=True))
        self.assertEqual(self.git(self.repo, "log", "-1", "--format=%s"), "T-1 Add notes")
        self.assertEqual((self.repo / "notes.txt").read_text(), "left over\n")

    def test_work_rebases_onto_commits_made_meanwhile(self):
        self.agent_commits()
        (self.repo / "other.txt").write_text("other\n")
        self.git(self.repo, "add", ".")
        self.git(self.repo, "commit", "-qm", "Meanwhile")
        delivery.merge(self.payload("merge"))
        self.assertEqual(self.git(self.repo, "log", "--format=%s", "-3").splitlines(), ["Agent work", "Meanwhile", "Base"])

    def test_a_dirty_project_folder_is_never_touched(self):
        self.agent_commits()
        (self.repo / "app.txt").write_text("mine\n")
        with self.assertRaisesRegex(ValueError, "uncommitted changes on main"):
            delivery.merge(self.payload("merge"))
        self.assertEqual((self.repo / "app.txt").read_text(), "mine\n")
        self.assertFalse((self.repo / "notes.txt").exists())

    def test_no_changes_is_reported(self):
        with self.assertRaisesRegex(ValueError, "no changes"):
            delivery.merge(self.payload("merge"))

    def test_changed_sees_commits_and_uncommitted_files_but_not_the_git_folder(self):
        repos = lambda: {"repos": [{"worktree": str(self.tree), "base": self.base}]}
        Path(self.workspace["prBody"]).write_text("Summary\n")
        self.assertEqual(delivery.changed(repos()), {"changed": False})
        (self.tree / "notes.txt").write_text("left over\n")
        self.assertEqual(delivery.changed(repos()), {"changed": True})
        self.git(self.tree, "add", ".")
        self.git(self.tree, "commit", "-qm", "Agent work")
        self.assertEqual(delivery.changed(repos()), {"changed": True})
        self.assertEqual(delivery.changed({"repos": [{"worktree": str(self.home / "gone"), "base": self.base}]}), {"changed": True}, "a missing worktree is left to delivery to explain")

    def test_conflicts_leave_both_branches_as_they_were(self):
        self.agent_commits("app.txt", "agent\n")
        tip = self.git(self.repo, "rev-parse", self.workspace["branch"])
        (self.repo / "app.txt").write_text("main\n")
        self.git(self.repo, "commit", "-qam", "Conflicting")
        head = self.git(self.repo, "rev-parse", "HEAD")
        with self.assertRaisesRegex(ValueError, "conflicts with main"):
            delivery.merge(self.payload("merge"))
        self.assertEqual(self.git(self.repo, "rev-parse", self.workspace["branch"]), tip)
        self.assertEqual(self.git(self.repo, "rev-parse", "HEAD"), head)
        self.assertEqual(self.git(self.tree, "status", "--porcelain"), "")

    def landed(self, *commits):
        for name, text in commits or (("notes.txt", "notes\n"),):
            self.agent_commits(name, text)
        landed = delivery.merge(self.payload("merge"))["landed"]
        return {"op": "revert", "title": "T-1 Add notes", "repos": landed}

    def test_a_merge_says_which_commits_it_landed_and_revert_undoes_them_in_one_commit(self):
        before = self.git(self.repo, "rev-parse", "HEAD")
        payload = self.landed(("notes.txt", "notes\n"), ("app.txt", "one\nTWO\nthree\n"))
        self.assertEqual([(repo["branch"], repo["from"]) for repo in payload["repos"]], [("main", before)])
        (self.repo / "later.txt").write_text("later\n")
        self.git(self.repo, "add", ".")
        self.git(self.repo, "commit", "-qm", "Later work")
        delivery.revert(payload)
        self.assertFalse((self.repo / "notes.txt").exists())
        self.assertEqual((self.repo / "app.txt").read_text(), "one\ntwo\nthree\n")
        self.assertEqual((self.repo / "later.txt").read_text(), "later\n")
        self.assertEqual(self.git(self.repo, "log", "-1", "--format=%s"), "Revert T-1 Add notes")
        self.assertEqual(self.git(self.repo, "rev-list", "--count", payload["repos"][0]["to"] + "..HEAD"), "2")

    def test_revert_refuses_a_dirty_folder_another_branch_and_conflicting_later_work(self):
        payload = self.landed(("app.txt", "one\nagent\nthree\n"))
        (self.repo / "app.txt").write_text("dirty\n")
        with self.assertRaisesRegex(ValueError, "uncommitted changes on main"):
            delivery.revert(payload)
        self.git(self.repo, "checkout", "-q", "--", "app.txt")
        self.git(self.repo, "checkout", "-q", "-b", "other")
        with self.assertRaisesRegex(ValueError, "is on other, and the task merged into main"):
            delivery.revert(payload)
        self.git(self.repo, "checkout", "-q", "main")
        (self.repo / "app.txt").write_text("one\nlater\nthree\n")
        self.git(self.repo, "commit", "-qam", "Later work")
        head = self.git(self.repo, "rev-parse", "HEAD")
        with self.assertRaisesRegex(ValueError, "later work changed the same lines"):
            delivery.revert(payload)
        self.assertEqual(self.git(self.repo, "rev-parse", "HEAD"), head)
        self.assertEqual(self.git(self.repo, "status", "--porcelain"), "")

    def test_the_agent_summary_is_read_from_the_worktree_git_folder(self):
        self.assertEqual(delivery.summary({"worktree": str(self.tree)}), {"text": "", "evidence": None})
        Path(self.git(self.tree, "rev-parse", "--path-format=absolute", "--git-path", "herdr-summary.md")).write_text("Added notes.\n\nNot sure about the name.\n")
        self.assertEqual(delivery.summary({"worktree": str(self.tree)})["text"], "Added notes.\n\nNot sure about the name.")
        self.assertEqual(self.git(self.tree, "status", "--porcelain"), "")

    def test_merging_again_after_an_interruption_is_safe(self):
        self.agent_commits()
        delivery.merge(self.payload("merge"))
        self.assertTrue(delivery.merge(self.payload("merge"))["already"])

    def test_remove_after_merge_deletes_the_worktree_and_branch(self):
        self.agent_commits()
        delivery.merge(self.payload("merge"))
        delivery.remove(self.payload("remove"))
        self.assertFalse(self.tree.exists())
        self.assertFalse(self.tree.parent.parent.exists(), "empty worktree folders go too")
        self.assertEqual(self.git(self.repo, "branch", "--list", self.workspace["branch"]), "")
        delivery.remove(self.payload("remove"))

    def test_remove_keeps_folders_that_hold_other_worktrees(self):
        (self.tree.parent / "other").mkdir()
        self.agent_commits()
        delivery.merge(self.payload("merge"))
        delivery.remove(self.payload("remove"))
        self.assertTrue((self.tree.parent / "other").is_dir())

    def test_remove_refuses_unmerged_work_unless_forced(self):
        self.agent_commits()
        with self.assertRaises(ValueError):
            delivery.remove(self.payload("remove"))
        delivery.remove(self.payload("remove", force=True))
        self.assertFalse(self.tree.exists())
        self.assertEqual(self.git(self.repo, "branch", "--list", self.workspace["branch"]), "")

    def stub_gh(self, reply):
        bin_dir = self.home / "bin"
        bin_dir.mkdir(exist_ok=True)
        log = self.home / "gh.log"
        (bin_dir / "gh").write_text("#!/bin/sh\n" + f'printf "%s\\n" "$*" >> "{log}"\n' + reply)
        (bin_dir / "gh").chmod(0o755)
        patcher = patch.dict(os.environ, {"PATH": str(bin_dir) + os.pathsep + os.environ["PATH"]})
        patcher.start()
        self.addCleanup(patcher.stop)
        return log

    def with_origin(self):
        remote = self.home / "origin.git"
        subprocess.run(["git", "init", "-q", "--bare", str(remote)], check=True)
        self.git(self.repo, "remote", "add", "origin", str(remote))
        self.git(self.repo, "push", "-q", "origin", "main")
        return remote

    def test_publish_pushes_the_branch_and_opens_a_pull_request_into_the_start_branch(self):
        remote = self.with_origin()
        log = self.stub_gh('echo "https://github.com/me/project/pull/12"\n')
        self.agent_commits()
        result = delivery.publish(self.payload("publish", target="main", body="Details"))
        self.assertEqual(result, {"url": "https://github.com/me/project/pull/12", "number": 12})
        self.assertEqual(self.git(remote, "log", "-1", "--format=%s", self.workspace["branch"]), "Agent work")
        args = log.read_text()
        self.assertIn("pr create --head " + self.workspace["branch"] + " --base main --title T-1 Add notes --body Details", args)
        self.assertFalse((self.repo / "notes.txt").exists(), "the project folder is never touched")

    def test_publish_uses_the_description_the_agent_wrote_and_refuses_uncommitted_work(self):
        remote = self.with_origin()
        log = self.stub_gh('echo "https://github.com/me/project/pull/12"\n')
        Path(self.workspace["prBody"]).write_text("Sorts absences by date.\n\n- Sorted the list\n")
        (self.tree / "notes.txt").write_text("left over\n")
        with self.assertRaisesRegex(ValueError, "uncommitted changes"):
            delivery.publish(self.payload("publish", target="main", body="Fallback"))
        self.assertIsNone(self.git_optional(remote, "rev-parse", "--verify", "-q", self.workspace["branch"]), "nothing was pushed")
        delivery.publish(self.payload("publish", target="main", body="Fallback", commit=True))
        self.assertEqual(self.git(remote, "log", "-1", "--format=%s", self.workspace["branch"]), "T-1 Add notes")
        self.assertIn("--body Sorts absences by date.\n\n- Sorted the list\n", log.read_text())

    def evidence_folder(self):
        folder = Path(self.git(self.tree, "rev-parse", "--path-format=absolute", "--git-path", "herdr-evidence"))
        folder.mkdir()
        return folder

    def test_screenshots_and_the_walkthrough_link_are_read_from_the_worktree_git_folder(self):
        folder = self.evidence_folder()
        for name in ("01-after-login.png", "01-before-login.png", "notes.txt"):
            (folder / name).write_bytes(b"x")
        (folder / "walkthrough.url").write_text("https://claude.ai/artifact/abc\n")
        found = delivery.summary({"worktree": str(self.tree)})["evidence"]
        self.assertEqual([Path(file).name for file in found["files"]], ["01-after-login.png", "01-before-login.png"])
        self.assertEqual(found["url"], "https://claude.ai/artifact/abc")
        self.assertEqual(self.git(self.tree, "status", "--porcelain"), "", "nothing of it can be committed")
        (folder / "walkthrough.url").write_text("https://app.docstash.ai/d/abc\n")
        self.assertEqual(delivery.summary({"worktree": str(self.tree)})["evidence"]["url"], "https://docstash.ai/d/abc")

    def test_publish_links_the_walkthrough_page_only_when_asked_and_pushes_no_screenshots(self):
        remote = self.with_origin()
        log = self.stub_gh('echo "https://github.com/me/project/pull/12"\n')
        folder = self.evidence_folder()
        (folder / "01-before-login.png").write_bytes(b"x")
        (folder / "walkthrough.url").write_text("https://claude.ai/artifact/abc\n")
        self.agent_commits()
        delivery.publish(self.payload("publish", target="main", body="Details"))
        self.assertNotIn("walkthrough", log.read_text())
        delivery.publish(self.payload("publish", target="main", body="Details", evidence=True))
        self.assertIn("--body Details\n\n[Before and after walkthrough](https://claude.ai/artifact/abc)\n", log.read_text())
        self.assertIsNone(self.git_optional(remote, "rev-parse", "--verify", "-q", "pipeline-evidence"))

    def test_publish_opens_a_draft_when_asked_and_an_ordinary_one_where_drafts_are_refused(self):
        self.with_origin()
        log = self.stub_gh('echo "https://github.com/me/project/pull/12"\n')
        self.agent_commits()
        delivery.publish(self.payload("publish", target="main", body="Details"))
        self.assertNotIn("--draft", log.read_text())
        delivery.publish(self.payload("publish", target="main", body="Details", draft=True))
        self.assertIn("--draft", log.read_text())
        log = self.stub_gh('case "$*" in *--draft*) echo "Draft pull requests are not supported in this repository" >&2; exit 1;; *) echo "https://github.com/me/project/pull/13";; esac\n')
        self.assertEqual(delivery.publish(self.payload("publish", target="main", body="Details", draft=True))["number"], 13)

    def test_an_approved_pull_request_merges_its_checked_commit_the_way_the_repository_allows(self):
        view = '{"state":"OPEN","isDraft":false,"reviewDecision":"APPROVED","headRefOid":"abc123","statusCheckRollup":[{"__typename":"CheckRun","status":"COMPLETED","conclusion":"SUCCESS","name":"test"}]}'
        log = self.stub_gh('case "$1 $2" in "repo view") echo \'{"squashMergeAllowed":false,"mergeCommitAllowed":true,"rebaseMergeAllowed":true}\';; "pr merge") ;; *) echo \'' + view + '\';; esac\n')
        url = "https://github.com/me/project/pull/12"
        self.assertEqual(delivery.pr_merge({"root": str(self.repo), "url": url})["state"], "OPEN")
        self.assertIn("repo view me/project", log.read_text())
        self.assertIn("pr merge " + url + " --merge --match-head-commit abc123", log.read_text())
        self.stub_gh("echo '" + view.replace("APPROVED", "REVIEW_REQUIRED") + "'\n")
        with self.assertRaisesRegex(ValueError, "changed since it was approved"):
            delivery.pr_merge({"root": str(self.repo), "url": url})

    def test_a_pull_request_is_marked_ready_or_draft_again_and_read_back(self):
        log = self.stub_gh('case "$2" in ready) ;; *) echo \'{"state":"OPEN","isDraft":false,"statusCheckRollup":[]}\';; esac\n')
        url = "https://github.com/me/project/pull/12"
        self.assertFalse(delivery.pr_ready({"root": str(self.repo), "url": url})["status"]["draft"])
        self.assertIn("pr ready " + url + "\n", log.read_text())
        delivery.pr_ready({"root": str(self.repo), "url": url, "undo": True})
        self.assertIn("pr ready " + url + " --undo", log.read_text())
        self.stub_gh('echo "no permission" >&2; exit 1\n')
        with self.assertRaisesRegex(ValueError, "no permission"):
            delivery.pr_ready({"root": str(self.repo), "url": url})

    def test_publishing_again_reuses_the_open_pull_request(self):
        self.with_origin()
        self.stub_gh('echo "a pull request for branch already exists:" >&2\necho "https://github.com/me/project/pull/7" >&2\nexit 1\n')
        self.agent_commits()
        self.assertEqual(delivery.publish(self.payload("publish", target="main"))["number"], 7)

    def test_publish_explains_a_missing_remote_or_gh(self):
        self.agent_commits()
        with self.assertRaisesRegex(ValueError, "no origin remote"):
            delivery.publish(self.payload("publish", target="main"))
        self.with_origin()
        only_git = self.home / "only-git"
        only_git.mkdir()
        (only_git / "git").symlink_to(shutil.which("git"))
        with patch.dict(os.environ, {"PATH": str(only_git)}):
            with self.assertRaisesRegex(ValueError, "GitHub CLI"):
                delivery.publish(self.payload("publish", target="main"))

    def merged(self):
        self.agent_commits()
        return delivery.merge(self.payload("merge"))

    def test_push_after_a_merge_lands_the_branch_on_origin(self):
        remote = self.with_origin()
        result = self.merged()
        pushed = delivery.push({"root": str(self.repo), "branch": result["target"]})
        self.assertEqual(pushed, {"pushed": True, "remote": "origin", "branch": "main", "error": None})
        self.assertEqual(self.git(remote, "rev-parse", "main"), self.git(self.repo, "rev-parse", "main"))

    def test_push_goes_to_the_branch_upstream(self):
        remote = self.with_origin()
        self.git(self.repo, "remote", "add", "fork", str(remote))
        self.git(self.repo, "branch", "--set-upstream-to", "origin/main")
        self.git(self.repo, "config", "branch.main.remote", "fork")
        self.git(self.repo, "config", "branch.main.merge", "refs/heads/trunk")
        self.merged()
        self.assertEqual(delivery.push({"root": str(self.repo), "branch": "main"})["remote"], "fork")
        self.assertEqual(self.git(remote, "rev-parse", "trunk"), self.git(self.repo, "rev-parse", "main"))

    def test_push_never_forces_past_commits_on_origin_and_keeps_the_merge(self):
        remote = self.with_origin()
        other = self.home / "other"
        subprocess.run(["git", "clone", "-q", str(remote), str(other)], check=True)
        for key, value in (("user.name", "Test"), ("user.email", "test@example.invalid"), ("commit.gpgsign", "false")):
            self.git(other, "config", key, value)
        (other / "theirs.txt").write_text("theirs\n")
        self.git(other, "add", ".")
        self.git(other, "commit", "-qm", "Theirs")
        self.git(other, "push", "-q", "origin", "main")
        theirs = self.git(remote, "rev-parse", "main")
        self.merged()
        head = self.git(self.repo, "rev-parse", "HEAD")
        pushed = delivery.push({"root": str(self.repo), "branch": "main"})
        self.assertFalse(pushed["pushed"])
        self.assertIn("origin has commits main doesn't have", pushed["error"])
        self.assertEqual(self.git(remote, "rev-parse", "main"), theirs, "origin is left as it was")
        self.assertEqual(self.git(self.repo, "rev-parse", "HEAD"), head, "the local merge stays")
        self.assertEqual((self.repo / "notes.txt").read_text(), "notes\n")

    def test_push_explains_a_missing_origin_or_upstream_remote(self):
        self.merged()
        head = self.git(self.repo, "rev-parse", "HEAD")
        pushed = delivery.push({"root": str(self.repo), "branch": "main"})
        self.assertEqual(pushed, {"pushed": False, "remote": "origin", "branch": "main", "error": "This repository has no origin remote."})
        self.git(self.repo, "config", "branch.main.remote", "gone")
        self.git(self.repo, "config", "branch.main.merge", "refs/heads/main")
        self.assertEqual(delivery.push({"root": str(self.repo), "branch": "main"})["error"], "main's upstream remote gone no longer exists.")
        self.assertEqual(self.git(self.repo, "rev-parse", "HEAD"), head)

    def test_push_says_when_origin_cannot_be_reached(self):
        self.git(self.repo, "remote", "add", "origin", str(self.home / "missing.git"))
        self.merged()
        pushed = delivery.push({"root": str(self.repo), "branch": "main"})
        self.assertEqual([pushed["pushed"], pushed["error"]], [False, "Could not reach origin."])

    def test_pushing_again_after_a_failure_sends_everything_merged_since(self):
        remote = self.home / "origin.git"
        self.git(self.repo, "remote", "add", "origin", str(remote))
        self.merged()
        self.assertFalse(delivery.push({"root": str(self.repo), "branch": "main"})["pushed"])
        subprocess.run(["git", "init", "-q", "--bare", str(remote)], check=True)
        (self.repo / "later.txt").write_text("later\n")
        self.git(self.repo, "add", ".")
        self.git(self.repo, "commit", "-qm", "Later")
        self.assertTrue(delivery.push({"root": str(self.repo), "branch": "main"})["pushed"])
        self.assertEqual(self.git(remote, "log", "--format=%s", "main").splitlines(), ["Later", "Agent work", "Base"])

    def test_pull_request_state_comes_from_gh(self):
        self.stub_gh('echo \'{"state":"MERGED"}\'\n')
        self.assertEqual(delivery.pr_state({"root": str(self.repo), "url": "https://github.com/me/project/pull/12"})["state"], "MERGED")

    def test_pull_request_status_says_what_it_waits_for(self):
        reply = {"state": "OPEN", "isDraft": False, "mergeable": "CONFLICTING", "mergeStateStatus": "DIRTY", "reviewDecision": "CHANGES_REQUESTED", "author": {"login": "me"},
                 "reviews": [{"state": "CHANGES_REQUESTED", "author": {"login": "ana"}}, {"state": "COMMENTED", "author": {"login": "bot"}},
                             {"state": "COMMENTED", "author": {"login": "me"}}, {"state": "APPROVED", "author": {"login": "li"}}],
                 "statusCheckRollup": [
                     {"__typename": "CheckRun", "name": "test", "status": "COMPLETED", "conclusion": "FAILURE"},
                     {"__typename": "CheckRun", "name": "lint", "status": "COMPLETED", "conclusion": "SUCCESS"},
                     {"__typename": "CheckRun", "name": "skipped", "status": "COMPLETED", "conclusion": "SKIPPED"},
                     {"__typename": "CheckRun", "name": "build", "status": "IN_PROGRESS", "conclusion": ""},
                     {"__typename": "StatusContext", "context": "ci/legacy", "state": "ERROR"},
                     {"__typename": "StatusContext", "context": "ci/deploy", "state": "PENDING"}]}
        log = self.stub_gh("cat <<'EOF'\n" + json.dumps(reply) + "\nEOF\n")
        result = delivery.pr_state({"root": str(self.repo), "url": "https://github.com/me/project/pull/12"})
        self.assertEqual(result, {"state": "OPEN", "status": {"draft": False, "mergeable": "CONFLICTING", "mergeState": "DIRTY", "review": "CHANGES_REQUESTED", "comments": 2,
                                                              "failed": 2, "failing": ["test", "ci/legacy"], "pending": 2, "passed": 2}})
        self.assertIn("statusCheckRollup", log.read_text())

    def test_pull_request_without_reviews_or_checks(self):
        self.stub_gh('echo \'{"state":"OPEN","isDraft":true,"mergeable":"UNKNOWN","mergeStateStatus":"DRAFT","reviewDecision":"","statusCheckRollup":[]}\'\n')
        status = delivery.pr_state({"root": str(self.repo), "url": "https://github.com/me/project/pull/12"})["status"]
        self.assertEqual(status, {"draft": True, "mergeable": "UNKNOWN", "mergeState": "DRAFT", "review": None, "comments": 0, "failed": 0, "failing": [], "pending": 0, "passed": 0})

    def test_many_pull_requests_are_read_in_one_query_per_host(self):
        node = {"state": "OPEN", "isDraft": False, "mergeable": "MERGEABLE", "mergeStateStatus": "BLOCKED", "reviewDecision": "REVIEW_REQUIRED", "author": {"login": "me"},
                "reviews": {"nodes": [{"state": "COMMENTED", "author": {"login": "ana"}}]},
                "commits": {"nodes": [{"commit": {"statusCheckRollup": {"contexts": {"nodes": [{"__typename": "CheckRun", "name": "test", "status": "COMPLETED", "conclusion": "FAILURE"}]}}}}]}}
        reply = {"data": {"r0": {"pullRequest": node}, "r1": {"pullRequest": {**node, "state": "MERGED", "commits": {"nodes": []}}}, "r2": None},
                 "errors": [{"message": "Could not resolve to a Repository"}]}
        log = self.stub_gh("cat <<'EOF'\n" + json.dumps(reply) + "\nEOF\nexit 1\n")
        urls = ["https://github.com/me/shop/pull/12", "https://github.com/me/api/pull/3", "https://github.com/me/gone/pull/1", "https://github.com/me/shop/pull/12"]
        states = delivery.pr_states({"root": str(self.repo), "urls": urls})["states"]
        self.assertEqual(states, {"https://github.com/me/shop/pull/12": {"state": "OPEN", "status": {"draft": False, "mergeable": "MERGEABLE", "mergeState": "BLOCKED", "review": "REVIEW_REQUIRED", "comments": 1, "failed": 1, "failing": ["test"], "pending": 0, "passed": 0}},
                                  "https://github.com/me/api/pull/3": {"state": "MERGED", "status": {"draft": False, "mergeable": "MERGEABLE", "mergeState": "BLOCKED", "review": "REVIEW_REQUIRED", "comments": 1, "failed": 0, "failing": [], "pending": 0, "passed": 0}}})
        calls = log.read_text()
        self.assertEqual(calls.count("api graphql --hostname github.com"), 1)
        self.assertIn("n1=api", calls)

    def test_many_pull_requests_fail_together_when_github_gives_nothing(self):
        self.stub_gh('echo "HTTP 401: Bad credentials" >&2; exit 1\n')
        with self.assertRaisesRegex(ValueError, "Bad credentials"):
            delivery.pr_states({"root": str(self.repo), "urls": ["https://github.com/me/shop/pull/12"]})

    def found(self, state, head):
        self.stub_gh("cat <<'EOF'\n" + json.dumps({"url": "https://github.com/me/project/pull/7", "number": 7, "state": state, "headRefOid": head}) + "\nEOF\n")
        return delivery.pr_find(self.payload("pr_find"))["found"]

    def test_a_pull_request_opened_by_hand_is_found_once_the_branch_was_pushed(self):
        self.with_origin()
        self.agent_commits()
        head = self.git(self.tree, "rev-parse", "HEAD")
        log = self.home / "gh.log"
        self.assertIsNone(self.found("OPEN", head), "a branch that was never pushed has no pull request")
        self.assertFalse(log.exists(), "so GitHub isn't asked")
        self.git(self.tree, "push", "-q", "-u", "origin", self.workspace["branch"])
        self.assertEqual(self.found("OPEN", head), {"url": "https://github.com/me/project/pull/7", "number": 7, "merged": False})
        self.assertIn("pr view " + self.workspace["branch"], log.read_text())
        self.assertTrue(self.found("MERGED", head)["merged"])
        self.assertIsNone(self.found("CLOSED", head))

    def test_a_pull_request_from_an_older_branch_of_the_same_name_is_not_found(self):
        self.with_origin()
        self.agent_commits()
        self.git(self.tree, "push", "-q", "-u", "origin", self.workspace["branch"])
        self.assertIsNone(self.found("MERGED", self.base), "its head was already in the branch the task started from")
        self.assertIsNone(self.found("MERGED", "f" * 40), "its head isn't in this branch at all")

    def test_a_converted_conversation_that_added_nothing_follows_the_pull_request_of_the_branch_it_came_from(self):
        self.with_origin()
        log = self.home / "gh.log"

        def found(state="OPEN", head=self.base, **extra):
            self.stub_gh("cat <<'EOF'\n" + json.dumps({"url": "https://github.com/me/project/pull/7", "number": 7, "state": state, "headRefOid": head}) + "\nEOF\n")
            return delivery.pr_find(self.payload("pr_find", **extra))["found"]

        self.assertIsNone(found(), "only a converted conversation passes the branch it came from")
        self.assertFalse(log.exists())
        self.assertEqual(found(target="main"), {"url": "https://github.com/me/project/pull/7", "number": 7, "merged": False, "from": "main"})
        self.assertIn("pr view main", log.read_text())
        self.assertIsNone(found("MERGED", target="main"), "an older merged one of that branch isn't this work")
        self.assertIsNone(found(head="f" * 40, target="main"), "its head doesn't hold the commit the task started from")
        self.assertIsNone(found(target="never-pushed"))
        (self.tree / "draft.txt").write_text("draft\n")
        self.assertIsNone(found(target="main"), "uncommitted work is the task's own")
        (self.tree / "draft.txt").unlink()
        self.agent_commits()
        self.assertIsNone(found(target="main"), "its own commits need their own pull request")

    def second_repository(self):
        repo = self.home / "web"
        repo.mkdir()
        self.git(repo, "init", "-q", "-b", "main")
        for key, value in (("user.name", "Test"), ("user.email", "test@example.invalid"), ("commit.gpgsign", "false")):
            self.git(repo, "config", key, value)
        (repo / "page.txt").write_text("page\n")
        self.git(repo, "add", ".")
        self.git(repo, "commit", "-qm", "Web base")
        run = self.tree.name.rsplit("-", 1)[1]
        plan = worktrees.inspect(repo, [{"id": "T-1", "key": "T-1-add-notes"}], "pipeline", run_id=run)
        workspace = worktrees.create(repo, plan, {"id": "T-1", "key": "T-1-add-notes"})
        self.assertEqual(workspace["branch"], self.workspace["branch"], "every repository gets the same branch name")
        return {"name": "web", "root": str(repo), "worktree": workspace["root"], "branch": workspace["branch"], "base": plan["base"]}

    def both(self, web):
        project = {"name": "project", "root": str(self.repo), "worktree": str(self.tree), "branch": self.workspace["branch"], "base": self.base}
        return {"op": "merge", "title": "T-1 Add notes", "repos": [project, web]}

    def web_commits(self, web, text="agent page\n"):
        (Path(web["worktree"]) / "page.txt").write_text(text)
        self.git(web["worktree"], "commit", "-qam", "Agent page")

    def test_merging_several_repositories_lands_each_changed_one(self):
        web = self.second_repository()
        self.agent_commits()
        self.web_commits(web)
        result = delivery.merge(self.both(web))
        self.assertEqual([result["merged"], result["failed"], result["targets"]], [["project", "web"], None, {"project": "main", "web": "main"}])
        self.assertEqual((self.repo / "notes.txt").read_text(), "notes\n")
        self.assertEqual((Path(web["root"]) / "page.txt").read_text(), "agent page\n")

    def test_a_repository_the_agent_left_alone_is_skipped(self):
        web = self.second_repository()
        self.agent_commits()
        result = delivery.merge(self.both(web))
        self.assertEqual(result["merged"], ["project"])
        with self.assertRaisesRegex(ValueError, "no changes"):
            delivery.merge({**self.both(web), "repos": [self.both(web)["repos"][1]]})

    def test_a_conflict_in_one_repository_lands_none(self):
        web = self.second_repository()
        self.agent_commits()
        (Path(web["worktree"]) / "page.txt").write_text("agent\n")
        self.git(web["worktree"], "commit", "-qam", "Agent page")
        (Path(web["root"]) / "page.txt").write_text("main\n")
        self.git(web["root"], "commit", "-qam", "Conflicting")
        head = self.git(self.repo, "rev-parse", "HEAD")
        with self.assertRaisesRegex(ValueError, "^web: The branch conflicts with main"):
            delivery.merge(self.both(web))
        self.assertEqual(self.git(self.repo, "rev-parse", "HEAD"), head, "the project repository did not merge either")
        with self.assertRaisesRegex(ValueError, "^web: Your project folder has uncommitted changes"):
            (Path(web["root"]) / "page.txt").write_text("dirty\n")
            delivery.merge(self.both(web))

    def test_a_fast_forward_that_fails_after_others_landed_says_which_merged(self):
        web = self.second_repository()
        self.agent_commits()
        self.web_commits(web)
        real = delivery.land

        def land(item):
            if item["name"] == "web":
                raise ValueError("main moved in a way the branch can't fast-forward onto.")
            real(item)
        with patch.object(delivery, "land", land):
            result = delivery.merge(self.both(web))
        self.assertEqual([result["merged"], result["failed"]["name"]], [["project"], "web"])
        self.assertEqual((self.repo / "notes.txt").read_text(), "notes\n")
        again = delivery.merge(self.both(web))
        self.assertEqual([again["merged"], again["failed"]], [["project", "web"], None], "merging again finishes the rest without merging twice")

    def test_publish_skips_an_unchanged_repository_when_asked(self):
        self.with_origin()
        self.assertEqual(delivery.publish(self.payload("publish", target="main", optional=True)), {"skipped": True})

    def test_linking_other_pull_requests_keeps_the_description_and_replaces_an_older_note(self):
        log = self.stub_gh('[ "$2" = view ] && printf "Summary\\n\\nThis change spans 2 repositories. Old\\n"\nexit 0\n')
        delivery.pr_edit({"root": str(self.repo), "url": "https://github.com/me/project/pull/12", "note": "3 repositories. New"})
        self.assertIn("pr edit https://github.com/me/project/pull/12 --body Summary\n\nThis change spans 3 repositories. New\n", log.read_text())

    def test_command_line_reports_errors_as_json(self):
        run = subprocess.run([sys.executable, str(ROOT / "mods/pipeline/delivery.py"), json.dumps(self.payload("merge"))], capture_output=True, text=True)
        self.assertEqual(run.returncode, 1)
        self.assertIn("no changes", json.loads(run.stdout)["error"])


if __name__ == "__main__":
    unittest.main()
