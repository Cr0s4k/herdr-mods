"""Merge a finished Pipeline task branch into the project's current branch, and clean up after it."""
import json
from pathlib import Path
import subprocess
import sys


def git(cwd, *args, optional=False):
    result = subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True, timeout=60)
    if result.returncode and not optional:
        raise ValueError(result.stderr.strip() or result.stdout.strip() or "Git failed.")
    return result.stdout.strip() if result.returncode == 0 else None


def branch_exists(top, branch):
    return git(top, "show-ref", "--verify", "--quiet", "refs/heads/" + branch, optional=True) is not None


def merge(payload):
    top = git(payload["root"], "rev-parse", "--show-toplevel")
    worktree, branch, title = Path(payload["worktree"]), payload["branch"], payload["title"]
    target = git(top, "symbolic-ref", "--short", "HEAD", optional=True)
    if not target:
        raise ValueError("Your project folder is on a detached HEAD. Check out a branch, then merge again.")
    if not branch_exists(top, branch):
        raise ValueError("The task branch " + branch + " no longer exists.")
    if git(top, "status", "--porcelain", "--untracked-files=no"):
        raise ValueError("Your project folder has uncommitted changes on " + target + ". Commit or stash them, then merge again.")
    if worktree.is_dir() and git(worktree, "status", "--porcelain"):
        git(worktree, "add", "-A")
        git(worktree, "commit", "-q", "-m", title)
    tip = git(top, "rev-parse", "refs/heads/" + branch)
    if tip == payload.get("base"):
        raise ValueError("The agent made no changes to merge. Send it feedback, or discard the task.")
    if git(top, "merge-base", "--is-ancestor", tip, "HEAD", optional=True) is not None:
        return {"target": target, "commit": git(top, "rev-parse", "HEAD"), "already": True}
    if worktree.is_dir() and git(worktree, "rebase", "-q", target, optional=True) is None:
        git(worktree, "rebase", "--abort", optional=True)
        raise ValueError("The branch conflicts with " + target + ". Ask the agent to rebase onto " + target + " and resolve the conflicts, then merge again.")
    if git(top, "merge", "-q", "--ff-only", branch, optional=True) is None:
        raise ValueError(target + " moved in a way the branch can't fast-forward onto. Ask the agent to rebase onto " + target + ", then merge again.")
    return {"target": target, "commit": git(top, "rev-parse", "HEAD"), "already": False}


def remove(payload):
    top = git(payload["root"], "rev-parse", "--show-toplevel")
    worktree, branch, force = Path(payload["worktree"]), payload["branch"], bool(payload.get("force"))
    if worktree.exists():
        git(top, "worktree", "remove", *(["--force"] if force else []), str(worktree))
    git(top, "worktree", "prune", optional=True)
    for folder in (worktree.parent, worktree.parent.parent):
        try:
            folder.rmdir()
        except OSError:
            break
    if branch_exists(top, branch):
        git(top, "branch", "-D" if force else "-d", branch)
    return {"removed": True}


def main():
    try:
        payload = json.loads(sys.argv[1])
        operations = {"merge": merge, "remove": remove}
        if payload.get("op") not in operations:
            raise ValueError("Unknown delivery operation.")
        print(json.dumps({"data": operations[payload["op"]](payload)}))
        return 0
    except (ValueError, OSError, KeyError, subprocess.TimeoutExpired) as error:
        print(json.dumps({"error": str(error)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
