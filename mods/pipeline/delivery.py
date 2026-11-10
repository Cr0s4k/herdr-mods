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


def prepare(repo, title):
    top = git(repo["root"], "rev-parse", "--show-toplevel")
    worktree, branch = Path(repo["worktree"]), repo["branch"]
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
    changed = tip != repo.get("base")
    already = changed and git(top, "merge-base", "--is-ancestor", tip, "HEAD", optional=True) is not None
    return {"name": repo.get("name"), "top": top, "worktree": worktree, "branch": branch, "target": target, "changed": changed, "already": already}


def rebase(item):
    if item["worktree"].is_dir() and git(item["worktree"], "rebase", "-q", item["target"], optional=True) is None:
        git(item["worktree"], "rebase", "--abort", optional=True)
        raise ValueError("The branch conflicts with " + item["target"] + ". Ask the agent to rebase onto " + item["target"] + " and resolve the conflicts, then merge again.")


def land(item):
    if git(item["top"], "merge", "-q", "--ff-only", item["branch"], optional=True) is None:
        raise ValueError(item["target"] + " moved in a way the branch can't fast-forward onto. Ask the agent to rebase onto " + item["target"] + ", then merge again.")


def merge(payload):
    """Merge every repository's branch or none: all are checked and rebased before any fast-forward."""
    repos = payload.get("repos") or [payload]
    several = len(repos) > 1

    def named(item, step):
        try:
            return step(item)
        except ValueError as error:
            raise ValueError((item.get("name") + ": " if several else "") + str(error))

    items = [named(repo, lambda repo: prepare(repo, payload["title"])) for repo in repos]
    if not any(item["changed"] for item in items):
        raise ValueError("The agent made no changes to merge. Send it feedback, or discard the task.")
    pending = [item for item in items if item["changed"] and not item["already"]]
    for item in pending:
        named(item, rebase)
    merged = [item["name"] for item in items if item["already"]]
    failed = None
    for item in pending:
        try:
            land(item)
            merged.append(item["name"])
        except ValueError as error:
            if not several:
                raise
            failed = {"name": item["name"], "error": str(error)}
            break
    first = items[0]
    return {"target": first["target"], "targets": {item["name"]: item["target"] for item in items if item["changed"]},
            "merged": merged, "failed": failed, "commit": git(first["top"], "rev-parse", "HEAD"), "already": not pending}


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
        if payload.get("optional"):
            return {"skipped": True}
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


def pr_edit(payload):
    edited = gh(payload["root"], "pr", "edit", payload["url"], "--body", payload["body"])
    if edited.returncode:
        raise ValueError(edited.stderr.strip() or "GitHub didn't update the pull request.")
    return {"edited": True}


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
        operations = {"merge": merge, "remove": remove, "publish": publish, "pr_state": pr_state, "pr_edit": pr_edit}
        if payload.get("op") not in operations:
            raise ValueError("Unknown delivery operation.")
        print(json.dumps({"data": operations[payload["op"]](payload)}))
        return 0
    except (ValueError, OSError, KeyError, subprocess.TimeoutExpired) as error:
        print(json.dumps({"error": str(error)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
