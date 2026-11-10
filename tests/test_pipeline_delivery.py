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

    def payload(self, op, **extra):
        return {"op": op, "root": str(self.repo), "worktree": str(self.tree), "branch": self.workspace["branch"],
                "base": self.base, "title": "T-1 Add notes", **extra}

    def agent_commits(self, name="notes.txt", text="notes\n"):
        (self.tree / name).write_text(text)
        self.git(self.tree, "add", ".")
        self.git(self.tree, "commit", "-qm", "Agent work")

    def test_pipeline_worktrees_use_their_own_namespace(self):
        self.assertTrue(self.workspace["branch"].startswith("pipeline/t-1-add-notes-"))
        self.assertEqual(self.tree.parent.name, "pipeline")

    def test_merge_fast_forwards_the_project_branch(self):
        self.agent_commits()
        result = delivery.merge(self.payload("merge"))
        self.assertEqual(result["target"], "main")
        self.assertEqual((self.repo / "notes.txt").read_text(), "notes\n")
        self.assertEqual(self.git(self.repo, "rev-list", "--merges", "--count", "HEAD"), "0")

    def test_uncommitted_agent_work_is_committed_with_the_task_title(self):
        (self.tree / "notes.txt").write_text("left over\n")
        delivery.merge(self.payload("merge"))
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
        (self.tree / "notes.txt").write_text("left over\n")
        result = delivery.publish(self.payload("publish", target="main", body="Details"))
        self.assertEqual(result, {"url": "https://github.com/me/project/pull/12", "number": 12})
        self.assertEqual(self.git(remote, "log", "-1", "--format=%s", self.workspace["branch"]), "T-1 Add notes")
        args = log.read_text()
        self.assertIn("pr create --head " + self.workspace["branch"] + " --base main --title T-1 Add notes --body Details", args)
        self.assertFalse((self.repo / "notes.txt").exists(), "the project folder is never touched")

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

    def test_pull_request_state_comes_from_gh(self):
        self.stub_gh('echo \'{"state":"MERGED"}\'\n')
        self.assertEqual(delivery.pr_state({"root": str(self.repo), "url": "https://github.com/me/project/pull/12"})["state"], "MERGED")

    def test_pull_request_status_says_what_it_waits_for(self):
        reply = {"state": "OPEN", "isDraft": False, "mergeable": "CONFLICTING", "mergeStateStatus": "DIRTY", "reviewDecision": "CHANGES_REQUESTED",
                 "statusCheckRollup": [
                     {"__typename": "CheckRun", "name": "test", "status": "COMPLETED", "conclusion": "FAILURE"},
                     {"__typename": "CheckRun", "name": "lint", "status": "COMPLETED", "conclusion": "SUCCESS"},
                     {"__typename": "CheckRun", "name": "skipped", "status": "COMPLETED", "conclusion": "SKIPPED"},
                     {"__typename": "CheckRun", "name": "build", "status": "IN_PROGRESS", "conclusion": ""},
                     {"__typename": "StatusContext", "context": "ci/legacy", "state": "ERROR"},
                     {"__typename": "StatusContext", "context": "ci/deploy", "state": "PENDING"}]}
        log = self.stub_gh("cat <<'EOF'\n" + json.dumps(reply) + "\nEOF\n")
        result = delivery.pr_state({"root": str(self.repo), "url": "https://github.com/me/project/pull/12"})
        self.assertEqual(result, {"state": "OPEN", "status": {"draft": False, "mergeable": "CONFLICTING", "mergeState": "DIRTY", "review": "CHANGES_REQUESTED",
                                                              "failed": 2, "failing": ["test", "ci/legacy"], "pending": 2, "passed": 2}})
        self.assertIn("statusCheckRollup", log.read_text())

    def test_pull_request_without_reviews_or_checks(self):
        self.stub_gh('echo \'{"state":"OPEN","isDraft":true,"mergeable":"UNKNOWN","mergeStateStatus":"DRAFT","reviewDecision":"","statusCheckRollup":[]}\'\n')
        status = delivery.pr_state({"root": str(self.repo), "url": "https://github.com/me/project/pull/12"})["status"]
        self.assertEqual(status, {"draft": True, "mergeable": "UNKNOWN", "mergeState": "DRAFT", "review": None, "failed": 0, "failing": [], "pending": 0, "passed": 0})

    def second_repository(self):
        repo = self.home / "web"
        repo.mkdir()
        self.git(repo, "init", "-q", "-b", "main")
        for key, value in (("user.name", "Test"), ("user.email", "test@example.invalid"), ("commit.gpgsign", "false")):
            self.git(repo, "config", key, value)
        (repo / "page.txt").write_text("page\n")
        self.git(repo, "add", ".")
        self.git(repo, "commit", "-qm", "Web base")
        run = self.workspace["branch"].rsplit("-", 1)[1]
        plan = worktrees.inspect(repo, [{"id": "T-1", "key": "T-1-add-notes"}], "pipeline", run_id=run)
        workspace = worktrees.create(repo, plan, {"id": "T-1", "key": "T-1-add-notes"})
        self.assertEqual(workspace["branch"], self.workspace["branch"], "every repository gets the same branch name")
        return {"name": "web", "root": str(repo), "worktree": workspace["root"], "branch": workspace["branch"], "base": plan["base"]}

    def both(self, web):
        project = {"name": "project", "root": str(self.repo), "worktree": str(self.tree), "branch": self.workspace["branch"], "base": self.base}
        return {"op": "merge", "title": "T-1 Add notes", "repos": [project, web]}

    def test_merging_several_repositories_lands_each_changed_one(self):
        web = self.second_repository()
        self.agent_commits()
        (Path(web["worktree"]) / "page.txt").write_text("agent page\n")
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
        (Path(web["worktree"]) / "page.txt").write_text("agent page\n")
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

    def test_pull_request_bodies_are_edited_with_gh(self):
        log = self.stub_gh("exit 0\n")
        delivery.pr_edit({"root": str(self.repo), "url": "https://github.com/me/project/pull/12", "body": "Also web #3"})
        self.assertIn("pr edit https://github.com/me/project/pull/12 --body Also web #3", log.read_text())

    def test_command_line_reports_errors_as_json(self):
        run = subprocess.run([sys.executable, str(ROOT / "mods/pipeline/delivery.py"), json.dumps(self.payload("merge"))], capture_output=True, text=True)
        self.assertEqual(run.returncode, 1)
        self.assertIn("no changes", json.loads(run.stdout)["error"])


if __name__ == "__main__":
    unittest.main()
