"""Deliver a finished Pipeline task branch (merge it locally and maybe push, or push it and open a pull request), and clean up after it."""
import json
import os
import re
from pathlib import Path
import subprocess
import sys

IMAGES = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
EVIDENCE_BRANCH = "pipeline-evidence"


def git(cwd, *args, optional=False):
    result = subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True, timeout=60)
    if result.returncode and not optional:
        raise ValueError(result.stderr.strip() or result.stdout.strip() or "Git failed.")
    return result.stdout.strip() if result.returncode == 0 else None


def branch_exists(top, branch):
    return git(top, "show-ref", "--verify", "--quiet", "refs/heads/" + branch, optional=True) is not None


UNCOMMITTED = "The task's worktree has uncommitted changes, so its agent may still be working. Ask it to commit them, or commit them anyway."


# The agent may rename its branch to fit the repository's conventions.
def branch_of(worktree, stored):
    current = worktree.is_dir() and git(worktree, "symbolic-ref", "--short", "-q", "HEAD", optional=True)
    return current or stored


def commit_leftovers(worktree, title, allowed):
    if not (worktree.is_dir() and git(worktree, "status", "--porcelain")):
        return
    if not allowed:
        raise ValueError(UNCOMMITTED)
    git(worktree, "add", "-A")
    git(worktree, "commit", "-q", "-m", title)


def prepare(repo, title, allowed=False):
    top = git(repo["root"], "rev-parse", "--show-toplevel")
    worktree = Path(repo["worktree"])
    branch = branch_of(worktree, repo["branch"])
    target = git(top, "symbolic-ref", "--short", "HEAD", optional=True)
    if not target:
        raise ValueError("Your project folder is on a detached HEAD. Check out a branch, then merge again.")
    if not branch_exists(top, branch):
        raise ValueError("The task branch " + branch + " no longer exists.")
    if git(top, "status", "--porcelain", "--untracked-files=no"):
        raise ValueError("Your project folder has uncommitted changes on " + target + ". Commit or stash them, then merge again.")
    commit_leftovers(worktree, title, allowed)
    tip = git(top, "rev-parse", "refs/heads/" + branch)
    changed = tip != repo.get("base")
    already = changed and git(top, "merge-base", "--is-ancestor", tip, "HEAD", optional=True) is not None
    return {"name": repo.get("name"), "top": top, "worktree": worktree, "branch": branch, "target": target, "changed": changed, "already": already}


def rebase(item):
    if item["worktree"].is_dir() and git(item["worktree"], "rebase", "-q", item["target"], optional=True) is None:
        git(item["worktree"], "rebase", "--abort", optional=True)
        raise ValueError("The branch conflicts with " + item["target"] + ". Ask the agent to rebase onto " + item["target"] + " and resolve the conflicts, then merge again.")


def land(item):
    item["from"] = git(item["top"], "rev-parse", "HEAD")
    if git(item["top"], "merge", "-q", "--ff-only", item["branch"], optional=True) is None:
        raise ValueError(item["target"] + " moved in a way the branch can't fast-forward onto. Ask the agent to rebase onto " + item["target"] + ", then merge again.")
    item["to"] = git(item["top"], "rev-parse", "HEAD")


def merge(payload):
    """Merge every repository's branch or none: all are checked and rebased before any fast-forward."""
    repos = payload.get("repos") or [payload]
    several = len(repos) > 1

    def named(item, step):
        try:
            return step(item)
        except ValueError as error:
            raise ValueError((item.get("name") + ": " if several else "") + str(error))

    items = [named(repo, lambda repo: prepare(repo, payload["title"], bool(payload.get("commit")))) for repo in repos]
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
            "merged": merged, "failed": failed, "commit": git(first["top"], "rev-parse", "HEAD"), "already": not pending,
            "landed": [{"name": item["name"], "root": item["top"], "branch": item["target"], "from": item["from"], "to": item["to"]} for item in pending if item.get("to")]}


def revert(payload):
    """Undo a merged task with one new commit per repository. Every repository is checked before any is changed."""
    repos, several = payload["repos"], len(payload["repos"]) > 1

    def fail(repo, text):
        raise ValueError((repo["name"] + ": " if several and repo.get("name") else "") + text)

    for repo in repos:
        top, branch = repo["root"], repo["branch"]
        current = git(top, "symbolic-ref", "--short", "HEAD", optional=True)
        if current != branch:
            fail(repo, "Your project folder is on " + (current or "a detached HEAD") + ", and the task merged into " + branch + ". Check out " + branch + ", then revert again.")
        if git(top, "status", "--porcelain", "--untracked-files=no"):
            fail(repo, "Your project folder has uncommitted changes on " + branch + ". Commit or stash them, then revert again.")
        if git(top, "merge-base", "--is-ancestor", repo["to"], "HEAD", optional=True) is None:
            fail(repo, "The task's commits are no longer on " + branch + ", so there is nothing to revert.")
    reverted = []
    for repo in repos:
        top = repo["root"]
        if git(top, "revert", "--no-commit", repo["from"] + ".." + repo["to"], optional=True) is None:
            git(top, "revert", "--abort", optional=True)
            done = (" and ".join(reverted) + " reverted, but ") if reverted else ""
            fail(repo, done + "later work changed the same lines, so Git can't undo the task on its own. Nothing changed here. Revert it by hand: git revert " + repo["from"][:7] + ".." + repo["to"][:7])
        git(top, "commit", "-q", "-m", "Revert " + payload["title"])
        reverted.append(repo.get("name") or top)
    return {"reverted": reverted, "commit": git(repos[0]["root"], "rev-parse", "HEAD")}


def push_error(stderr, remote, branch):
    text = stderr.lower()
    if "non-fast-forward" in text or "fetch first" in text or "[rejected]" in text:
        return remote + " has commits " + branch + " doesn't have. Pull them into " + branch + ", then push again."
    if any(word in text for word in ("authentication failed", "permission denied", "403", "could not read username", "access denied", "not authorized")):
        return remote + " refused the push. Check that you're signed in and allowed to push to it."
    if any(word in text for word in ("could not resolve", "unable to access", "could not read from remote", "connection", "timed out", "network", "does not appear to be a git repository")):
        return "Could not reach " + remote + "."
    return stderr.strip().splitlines()[-1] if stderr.strip() else "Git could not push " + branch + " to " + remote + "."


def push(payload):
    """Push the branch a merge landed on to its upstream, or to origin under the same name. Never forces, never pulls."""
    top = git(payload["root"], "rev-parse", "--show-toplevel")
    branch = payload.get("branch") or git(top, "symbolic-ref", "--short", "HEAD", optional=True)
    if not branch or not branch_exists(top, branch):
        return {"pushed": False, "remote": None, "branch": branch, "error": "There is no branch " + (branch or "checked out") + " to push."}
    remote = git(top, "config", "branch." + branch + ".remote", optional=True)
    ref = git(top, "config", "branch." + branch + ".merge", optional=True) if remote else None
    if remote == "." or not ref:
        remote, ref = None, None
    remote = remote or "origin"
    ref = ref or "refs/heads/" + branch
    result = {"pushed": False, "remote": remote, "branch": branch, "error": None}
    if git(top, "remote", "get-url", remote, optional=True) is None:
        result["error"] = "This repository has no origin remote." if remote == "origin" else branch + "'s upstream remote " + remote + " no longer exists."
        return result
    try:
        pushed = subprocess.run(["git", "-C", top, "push", "--porcelain", remote, "refs/heads/" + branch + ":" + ref],
                                capture_output=True, text=True, timeout=90, env={**os.environ, "GIT_TERMINAL_PROMPT": "0"})
    except subprocess.TimeoutExpired:
        result["error"] = "Could not reach " + remote + "."
        return result
    if pushed.returncode:
        result["error"] = push_error(pushed.stderr + pushed.stdout, remote, branch)
    else:
        result["pushed"] = True
    return result


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
    worktree, title = Path(payload["worktree"]), payload["title"]
    branch = branch_of(worktree, payload["branch"])
    if not branch_exists(top, branch):
        raise ValueError("The task branch " + branch + " no longer exists.")
    if git(top, "remote", "get-url", "origin", optional=True) is None:
        raise ValueError("This repository has no origin remote to push the branch to. Add one, or deliver by merging locally.")
    commit_leftovers(worktree, title, bool(payload.get("commit")))
    if git(top, "rev-parse", "refs/heads/" + branch) == payload.get("base"):
        if payload.get("optional"):
            return {"skipped": True}
        raise ValueError("The agent made no changes to open a pull request for. Send it feedback, or discard the task.")
    git(top, "push", "-q", "-u", "origin", branch + ":" + branch)
    where = worktree if worktree.is_dir() else top
    body = written(worktree) or payload.get("body") or title
    if payload.get("evidence"):
        try:
            body += evidence_section(top, where, worktree, branch)
        except (subprocess.CalledProcessError, ValueError, OSError):
            pass
    created = gh(where, "pr", "create", "--head", branch, "--base", payload["target"], "--title", title, "--body", body)
    found = pull_request(created.stdout)
    if created.returncode and "already exists" in created.stderr:
        found = pull_request(created.stderr) or pull_request(gh(where, "pr", "view", branch, "--json", "url", "--jq", ".url").stdout)
    if not found:
        raise ValueError((created.stderr or created.stdout).strip() or "GitHub didn't return a pull request.")
    return found


# The agent writes the description and its summary inside the worktree's Git folder, so they are never committed.
def written(worktree, name="herdr-pr.md"):
    path = worktree.is_dir() and git(worktree, "rev-parse", "--path-format=absolute", "--git-path", name, optional=True)
    try:
        return Path(path).read_text().strip() if path else None
    except OSError:
        return None


def pr_revert(payload):
    opened = gh(payload["root"], "pr", "revert", payload["url"], "--title", "Revert " + payload["title"])
    found = pull_request(opened.stdout) or pull_request(opened.stderr)
    if not found:
        raise ValueError((opened.stderr or opened.stdout).strip() or "GitHub didn't open a revert pull request.")
    return found


# Work that changes no files, such as commenting on pull requests, has nothing to check, merge or open a pull request for.
def changed(payload):
    for repo in payload["repos"]:
        worktree = Path(repo["worktree"])
        if not worktree.is_dir() or not repo.get("base") or git(worktree, "status", "--porcelain") or git(worktree, "rev-parse", "HEAD") != repo["base"]:
            return {"changed": True}
    return {"changed": False}


def summary(payload):
    worktree = Path(payload["worktree"])
    return {"text": (written(worktree, "herdr-summary.md") or "")[:6000], "evidence": evidence(worktree)}


# Before and after screenshots the agent saved beside its summary, and the link to its walkthrough page.
def evidence(worktree):
    path = worktree.is_dir() and git(worktree, "rev-parse", "--path-format=absolute", "--git-path", "herdr-evidence", optional=True)
    folder = Path(path) if path else None
    if not folder or not folder.is_dir():
        return None
    files = sorted(str(file) for file in folder.iterdir() if file.suffix.lower() in IMAGES and file.is_file() and file.stat().st_size <= 5_000_000)[:24]
    try:
        url = (folder / "walkthrough.url").read_text().strip().split()[0]
    except (OSError, IndexError):
        url = None
    return {"files": files, "url": url} if files or url else None


def pairs(files):
    rows = {}
    for file in files:
        name = Path(file).stem
        side = "before" if re.search(r"(^|[-_ ])before([-_ ]|$)", name, re.I) else "after" if re.search(r"(^|[-_ ])after([-_ ]|$)", name, re.I) else "other"
        key = re.sub(r"(^|[-_ ])(before|after)(?=[-_ ]|$)", "", name, flags=re.I).strip("-_ ") or name
        rows.setdefault(key, {})[side] = file
    return rows


# GitHub has no command to upload an image into a description, so the screenshots go to a branch of their own and are embedded by commit.
def evidence_section(top, where, worktree, branch):
    found = evidence(worktree)
    if not found or not found["files"]:
        return ""
    slug = gh(where, "repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner").stdout.strip()
    if not slug:
        return ""
    names, lines = {}, []
    for index, file in enumerate(found["files"]):
        blob = git(top, "hash-object", "-w", file)
        names[file] = "%02d-%s" % (index + 1, re.sub(r"[^A-Za-z0-9._-]+", "-", Path(file).name))
        lines.append("100644 blob %s\t%s" % (blob, names[file]))
    tree = subprocess.run(["git", "-C", str(top), "mktree"], input="\n".join(lines) + "\n", text=True, capture_output=True, check=True).stdout.strip()
    for _ in range(2):
        fetched = subprocess.run(["git", "-C", str(top), "fetch", "-q", "origin", EVIDENCE_BRANCH], capture_output=True, text=True)
        parent = git(top, "rev-parse", "FETCH_HEAD") if fetched.returncode == 0 else None
        commit = git(top, "commit-tree", tree, *(["-p", parent] if parent else []), "-m", "Screenshots for " + branch)
        pushed = subprocess.run(["git", "-C", str(top), "push", "-q", "origin", commit + ":refs/heads/" + EVIDENCE_BRANCH], capture_output=True, text=True)
        if pushed.returncode == 0:
            break
    else:
        return ""
    link = lambda file: "![%s](https://github.com/%s/blob/%s/%s?raw=true)" % (Path(file).stem, slug, commit, names[file])
    rows, table, loose = pairs(found["files"]), [], []
    for key, row in rows.items():
        if "before" in row and "after" in row:
            table.append("| %s | %s |" % (link(row["before"]), link(row["after"])))
        else:
            loose.extend(link(file) for file in row.values())
    text = "\n\n## Before and after\n"
    if table:
        text += "\n| Before | After |\n| --- | --- |\n" + "\n".join(table) + "\n"
    if loose:
        text += "\n" + "\n\n".join(loose) + "\n"
    return text


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


# A pull request someone opened by hand on the task's branch. An older one from a branch that had the same name doesn't count.
def pr_find(payload):
    worktree = Path(payload["worktree"])
    if not worktree.is_dir():
        return {"found": None}
    branch = branch_of(worktree, payload["branch"])
    pushed = git(worktree, "config", "branch." + branch + ".remote", optional=True) or git(worktree, "for-each-ref", "refs/remotes/*/" + branch)
    if not pushed:
        return {"found": None}
    viewed = gh(worktree, "pr", "view", branch, "--json", "url,number,state,headRefOid")
    if viewed.returncode:
        return {"found": None}
    pr, base = json.loads(viewed.stdout), payload.get("base")
    head = pr.get("headRefOid") or ""
    ours = bool(head) and git(worktree, "merge-base", "--is-ancestor", head, "HEAD", optional=True) is not None
    old = ours and bool(base) and git(worktree, "merge-base", "--is-ancestor", head, base, optional=True) is not None
    if pr.get("state") not in ("OPEN", "MERGED") or not ours or old:
        return {"found": None}
    return {"found": {"url": pr["url"], "number": pr["number"], "merged": pr["state"] == "MERGED"}}


SPANS = "\n\nThis change spans "


def pr_edit(payload):
    viewed = gh(payload["root"], "pr", "view", payload["url"], "--json", "body", "--jq", ".body")
    if viewed.returncode:
        raise ValueError(viewed.stderr.strip() or "GitHub didn't answer about the pull request.")
    body = viewed.stdout.rstrip("\n").split(SPANS)[0] + SPANS + payload["note"]
    edited = gh(payload["root"], "pr", "edit", payload["url"], "--body", body)
    if edited.returncode:
        raise ValueError(edited.stderr.strip() or "GitHub didn't update the pull request.")
    return {"edited": True}


def remove(payload):
    top = git(payload["root"], "rev-parse", "--show-toplevel")
    worktree, force = Path(payload["worktree"]), bool(payload.get("force"))
    branch = branch_of(worktree, payload["branch"])
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


def adopt_file(payload):
    top = git(payload["root"], "rev-parse", "--show-toplevel")
    if not re.fullmatch(r"[A-Za-z0-9-]{1,40}", payload["task"]):
        raise ValueError("Invalid task id.")
    folder = Path(git(top, "rev-parse", "--path-format=absolute", "--git-common-dir"))
    return top, folder / ("herdr-adopt-" + payload["task"] + ".json")


def adopt_ask(payload):
    top, path = adopt_file(payload)
    path.unlink(missing_ok=True)
    return {"path": str(path), "root": top}


def adopt_read(payload):
    _, path = adopt_file(payload)
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError):
        return {"found": False}
    if not isinstance(data, dict):
        return {"found": False}
    files = [name for name in data.get("files") or [] if isinstance(name, str) and name.strip()] if isinstance(data.get("files"), list) else []
    return {"found": True, "title": str(data.get("title") or "")[:300], "description": str(data.get("description") or "")[:4000], "files": files[:500]}


def uncommitted(top):
    listed = subprocess.run(["git", "-C", str(top), "status", "--porcelain=v1", "-z", "--untracked-files=all"], capture_output=True, text=True, timeout=60)
    if listed.returncode:
        raise ValueError(listed.stderr.strip() or "Git failed.")
    entries, paths = listed.stdout.split("\0"), []
    while entries:
        entry = entries.pop(0)
        if len(entry) < 4:
            continue
        paths.append(entry[3:])
        if entry[0] in "RC" and entries:
            paths.append(entries.pop(0))
    return paths


def stash_index(top, commit):
    listed = (git(top, "stash", "list", "--format=%H") or "").split()
    return "stash@{" + str(listed.index(commit)) + "}" if commit in listed else None


# The agent's uncommitted files leave the project folder as one stash, which is applied in the task's worktree.
# Whatever goes wrong, they are put back where they were.
def adopt_move(payload):
    top, worktree = Path(git(payload["root"], "rev-parse", "--show-toplevel")).resolve(), Path(payload["worktree"])
    if git(top, "rev-parse", "HEAD") != git(worktree, "rev-parse", "HEAD"):
        raise ValueError("The project folder moved to another commit while the worktree was made. Retry.")
    wanted = []
    for name in payload.get("files") or []:
        path = Path(name)
        path = (path if path.is_absolute() else top / path).resolve()
        if path != top and top in path.parents:
            wanted.append(path.relative_to(top).as_posix())
    dirty = uncommitted(top)
    moving = [path for path in dirty if any(path == name or path.startswith(name + "/") for name in wanted)]
    skipped = [name for name in wanted if not any(path == name or path.startswith(name + "/") for path in dirty)]
    if not moving:
        return {"moved": [], "skipped": skipped}
    before = git(top, "rev-parse", "-q", "--verify", "refs/stash", optional=True)
    git(top, "stash", "push", "-q", "--include-untracked", "-m", "herdr-pipeline " + payload["task"], "--", *moving)
    commit = git(top, "rev-parse", "-q", "--verify", "refs/stash", optional=True)
    if not commit or commit == before:
        raise ValueError("Git saved nothing to move. The files are still in the project folder.")
    try:
        git(worktree, "stash", "apply", "-q", commit)
    except (ValueError, subprocess.TimeoutExpired) as error:
        git(worktree, "reset", "-q", "--hard", optional=True)
        git(worktree, "clean", "-fdq", optional=True)
        back = stash_index(top, commit)
        if back and git(top, "stash", "pop", "-q", back, optional=True) is not None:
            raise ValueError("The changes didn't apply in the new worktree, so they are back in the project folder: " + str(error))
        raise ValueError("The changes didn't apply in the new worktree. They are saved as the stash \"herdr-pipeline " + payload["task"] + "\" in the project folder: " + str(error))
    saved = stash_index(top, commit)
    if saved:
        git(top, "stash", "drop", "-q", saved, optional=True)
    return {"moved": moving, "skipped": skipped}


def main():
    try:
        payload = json.loads(sys.argv[1])
        operations = {"merge": merge, "push": push, "remove": remove, "publish": publish, "pr_state": pr_state, "pr_find": pr_find, "pr_edit": pr_edit, "revert": revert, "pr_revert": pr_revert, "summary": summary, "changed": changed,
                      "adopt_ask": adopt_ask, "adopt_read": adopt_read, "adopt_move": adopt_move}
        if payload.get("op") not in operations:
            raise ValueError("Unknown delivery operation.")
        print(json.dumps({"data": operations[payload["op"]](payload)}))
        return 0
    except (ValueError, OSError, KeyError, subprocess.TimeoutExpired) as error:
        print(json.dumps({"error": str(error)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
