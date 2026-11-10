"""Deliver a finished Pipeline task branch (merge it locally, or push it and open a pull request), and clean up after it."""
import json
import re
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


def gh(cwd, *args):
    try:
        result = subprocess.run(["gh", *args], cwd=str(cwd), capture_output=True, text=True, timeout=60)
    except FileNotFoundError:
        raise ValueError("The GitHub CLI (gh) isn't installed here. Install it and run gh auth login, or deliver by merging locally.")
    return result


def pull_request(text):
    match = re.search(r"https://\S+/pull/(\d+)", text or "")
    return {"url": match.group(0), "number": int(match.group(1))} if match else None


def publish(payload):
    top = git(payload["root"], "rev-parse", "--show-toplevel")
    worktree, branch, title = Path(payload["worktree"]), payload["branch"], payload["title"]
    if not branch_exists(top, branch):
        raise ValueError("The task branch " + branch + " no longer exists.")
    if git(top, "remote", "get-url", "origin", optional=True) is None:
        raise ValueError("This repository has no origin remote to push the branch to. Add one, or deliver by merging locally.")
    if worktree.is_dir() and git(worktree, "status", "--porcelain"):
        git(worktree, "add", "-A")
        git(worktree, "commit", "-q", "-m", title)
    if git(top, "rev-parse", "refs/heads/" + branch) == payload.get("base"):
        raise ValueError("The agent made no changes to open a pull request for. Send it feedback, or discard the task.")
    git(top, "push", "-q", "-u", "origin", branch + ":" + branch)
    where = worktree if worktree.is_dir() else top
    created = gh(where, "pr", "create", "--head", branch, "--base", payload["target"], "--title", title, "--body", payload.get("body") or title)
    found = pull_request(created.stdout)
    if created.returncode and "already exists" in created.stderr:
        found = pull_request(created.stderr) or pull_request(gh(where, "pr", "view", branch, "--json", "url", "--jq", ".url").stdout)
    if not found:
        raise ValueError((created.stderr or created.stdout).strip() or "GitHub didn't return a pull request.")
    return found


FAILED = {"FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"}
WAITING = {"PENDING", "EXPECTED"}


def checks(rollup):
    failing, pending, passed = [], 0, 0
    for check in rollup or []:
        if check.get("__typename") == "StatusContext":
            result = check.get("state")
            done = result not in WAITING
        else:
            result = check.get("conclusion")
            done = check.get("status") == "COMPLETED"
        if not done:
            pending += 1
        elif result in FAILED:
            failing.append(check.get("name") or check.get("context") or "check")
        else:
            passed += 1
    return {"failed": len(failing), "failing": failing[:5], "pending": pending, "passed": passed}


def pr_state(payload):
    fields = "state,isDraft,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup"
    viewed = gh(payload["root"], "pr", "view", payload["url"], "--json", fields)
    if viewed.returncode:
        raise ValueError(viewed.stderr.strip() or "GitHub didn't answer about the pull request.")
    pr = json.loads(viewed.stdout)
    status = {"draft": bool(pr.get("isDraft")), "mergeable": pr.get("mergeable") or "UNKNOWN",
              "mergeState": pr.get("mergeStateStatus") or "UNKNOWN", "review": pr.get("reviewDecision") or None,
              **checks(pr.get("statusCheckRollup"))}
    return {"state": pr.get("state", "OPEN"), "status": status}


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
        operations = {"merge": merge, "remove": remove, "publish": publish, "pr_state": pr_state}
        if payload.get("op") not in operations:
            raise ValueError("Unknown delivery operation.")
        print(json.dumps({"data": operations[payload["op"]](payload)}))
        return 0
    except (ValueError, OSError, KeyError, subprocess.TimeoutExpired) as error:
        print(json.dumps({"error": str(error)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
