import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("worktree_cleanup", ROOT / "mods/worktree-cleanup/cleanup.py")
cleanup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cleanup)


class CleanupTest(unittest.TestCase):
    def setUp(self):
        self.home = Path(tempfile.mkdtemp()).resolve()
        self.addCleanup(lambda: __import__("shutil").rmtree(self.home))
        self.repo = self.home / "repo"
        self.repo.mkdir()
        self.git(self.repo, "init", "-q", "-b", "main")
        self.commit(self.repo, "base.txt")

    def git(self, cwd, *args):
        return subprocess.run(["git", "-C", str(cwd), "-c", "user.name=t", "-c", "user.email=t@t.invalid", *args], check=True, capture_output=True, text=True).stdout.strip()

    def commit(self, cwd, name):
        (Path(cwd) / name).write_text(name)
        self.git(cwd, "add", "-A")
        self.git(cwd, "commit", "-q", "-m", name)

    def tree(self, name):
        path = self.home / name
        self.git(self.repo, "worktree", "add", "-q", "-b", name, str(path))
        return path

    def rows(self):
        return {Path(row["path"]).name: row for row in cleanup.preview(str(self.repo))["rows"]}

    def test_each_checkout_says_what_removing_it_would_lose(self):
        merged, ahead, dirty = self.tree("merged"), self.tree("ahead"), self.tree("dirty")
        self.commit(ahead, "more.txt")
        (dirty / "scratch.txt").write_text("x")
        (dirty / "base.txt").write_text("changed")
        found = cleanup.preview(str(merged))
        self.assertEqual((found["root"], found["target"]), (str(self.repo), "main"))
        rows = self.rows()
        self.assertEqual({name: (row["branch"], row["ahead"], row["only"], row["dirty"], row["gone"], row["locked"]) for name, row in rows.items()},
                         {"merged": ("merged", 0, 0, 0, False, False), "ahead": ("ahead", 1, 1, 0, False, False), "dirty": ("dirty", 0, 0, 2, False, False)})
        self.assertTrue(all(row["at"] > 0 for row in rows.values()))

    def test_pushed_commits_are_not_counted_as_only_here_and_a_missing_folder_or_lock_is_seen(self):
        remote = self.home / "remote.git"
        subprocess.run(["git", "init", "-q", "--bare", str(remote)], check=True)
        self.git(self.repo, "remote", "add", "origin", str(remote))
        pushed, gone, locked = self.tree("pushed"), self.tree("gone"), self.tree("locked")
        self.commit(pushed, "more.txt")
        self.git(pushed, "push", "-q", "-u", "origin", "pushed")
        __import__("shutil").rmtree(gone)
        self.git(self.repo, "worktree", "lock", str(locked))
        rows = self.rows()
        self.assertEqual((rows["pushed"]["ahead"], rows["pushed"]["only"]), (1, 0))
        self.assertTrue(rows["gone"]["gone"])
        self.assertNotIn("dirty", rows["gone"])
        self.assertTrue(rows["locked"]["locked"])

    def test_removing_deletes_merged_branches_keeps_unmerged_ones_and_never_forces(self):
        merged, ahead, dirty, gone = self.tree("merged"), self.tree("ahead"), self.tree("dirty"), self.tree("gone")
        self.commit(ahead, "more.txt")
        (dirty / "scratch.txt").write_text("x")
        __import__("shutil").rmtree(gone)
        done = cleanup.remove(str(self.repo), [str(merged), str(ahead), str(dirty), str(gone), str(self.repo), "/nowhere"])["results"]
        by = {Path(row["path"]).name: row for row in done}
        self.assertEqual(by["merged"], {"path": str(merged), "removed": True, "branch": "merged", "kept": False})
        self.assertEqual((by["ahead"]["removed"], by["ahead"]["kept"]), (True, True))
        self.assertIn("modified or untracked", by["dirty"]["error"])
        self.assertTrue(by["gone"]["removed"])
        self.assertEqual(by["repo"]["error"], "Not a worktree of this repository any more")
        self.assertEqual(by["nowhere"]["error"], "Not a worktree of this repository any more")
        self.assertFalse(merged.exists() or ahead.exists())
        self.assertTrue((dirty / "scratch.txt").exists() and self.repo.exists())
        self.assertEqual(sorted(self.git(self.repo, "branch", "--format=%(refname:short)").split()), ["ahead", "dirty", "main"])
        self.assertEqual(list(self.rows()), ["dirty"])

    def test_outside_a_repository_it_says_so(self):
        with self.assertRaises(ValueError):
            cleanup.preview(str(self.home))


if __name__ == "__main__":
    unittest.main()
