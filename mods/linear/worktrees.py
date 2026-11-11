"""Prepare isolated ticket worktrees using only committed repository content."""
import hashlib
import json
from pathlib import Path
import re
import secrets
import subprocess
import sys


def git(cwd, *args, optional=False):
    result = subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True, timeout=25)
    if result.returncode and not optional:
        raise ValueError(result.stderr.strip() or "Git could not prepare this worktree.")
    return result.stdout.strip() if result.returncode == 0 else None


def repository(cwd, provider="linear"):
    if provider not in ("linear", "plane", "pipeline"):
        raise ValueError("Unsupported ticket provider.")
    root = Path(git(cwd, "rev-parse", "--show-toplevel")).resolve()
    common = Path(git(root, "rev-parse", "--path-format=absolute", "--git-common-dir")).resolve()
    relative = Path(cwd).resolve().relative_to(root)
    slug = re.sub(r"[^a-zA-Z0-9._-]+", "-", root.name).strip(".-") or "repo"
    identity = hashlib.sha256(str(common).encode()).hexdigest()[:10]
    return root, common, relative, Path.home() / ".herdr" / "worktrees" / (slug + "-" + identity) / provider


def workspace(base, run_id, ticket, provider="linear"):
    key = re.sub(r"[^a-zA-Z0-9-]+", "-", ticket["key"]).strip("-").lower()[:60]
    if not key or not re.fullmatch(r"[a-f0-9]{12}", run_id):
        raise ValueError("Invalid ticket or launch identifier.")
    leaf = key + "-" + run_id
    # Pipeline branches end up on GitHub, so they carry the plain ticket name; the run id only keeps folders apart.
    branch = key if provider == "pipeline" else provider + "/" + leaf
    return {"id": ticket["id"], "key": ticket["key"], "branch": branch, "root": str(base / leaf)}


def taken(root, branch):
    return any(git(root, "show-ref", "--verify", "--quiet", ref + branch, optional=True) is not None
               for ref in ("refs/heads/", "refs/remotes/origin/"))


def names(item, provider):
    return [item["branch"]] + ([item["branch"] + "-" + str(n) for n in range(2, 10)] if provider == "pipeline" else [])


def inspect(cwd, tickets, provider="linear", remote=False, run_id=None):
    root, common, relative, base = repository(cwd, provider)
    commit = git(root, "rev-parse", "--verify", "HEAD^{commit}")
    branch = git(root, "symbolic-ref", "--short", "HEAD", optional=True)
    # Work that waited for a pull request needs it, and GitHub merged it into origin, not this checkout.
    if remote:
        if not branch:
            raise ValueError("Your project folder is on a detached HEAD. Check out the branch pull requests go into, then retry.")
        if git(root, "fetch", "-q", "origin", branch, optional=True) is None:
            raise ValueError("Could not fetch " + branch + " from origin. Check your connection, then retry.")
        commit = git(root, "rev-parse", "--verify", "FETCH_HEAD^{commit}")
    # A task across several repositories passes the first one's run id, so every branch has the same name.
    run_id = run_id or secrets.token_hex(6)
    workspaces = [workspace(base, run_id, ticket, provider) for ticket in tickets]
    return {"root": str(root), "common": str(common), "relative": str(relative), "base": commit,
            "branch": branch or "detached HEAD",
            "dirty": bool(git(root, "status", "--porcelain")), "runId": run_id,
            "workspaces": workspaces, "provider": provider}


def adoptable(path, common, branches):
    if not path.is_dir():
        return None
    found = git(path, "rev-parse", "--path-format=absolute", "--git-common-dir", optional=True)
    current = git(path, "symbolic-ref", "--short", "HEAD", optional=True)
    return current if found and Path(found).resolve() == common and current in branches else None


def create(cwd, plan, ticket, adopt=False):
    provider = plan.get("provider", "linear")
    root, common, relative, base = repository(cwd, provider)
    if str(root) != plan["root"] or str(common) != plan["common"]:
        raise ValueError("The source repository changed. Review this launch again.")
    commit = plan["base"]
    if not re.fullmatch(r"[a-f0-9]{40}|[a-f0-9]{64}", commit):
        raise ValueError("Invalid base commit. Review this launch again.")
    git(root, "cat-file", "-e", commit + "^{commit}")
    item = workspace(base, plan["runId"], ticket, provider)
    path, candidates = Path(item["root"]), names(item, provider)
    # A start interrupted after this worktree was made retries with the same plan; it takes the worktree as it is.
    adopted = adopt and adoptable(path, common, candidates)
    if adopted:
        folder = path / relative
        if not folder.is_dir():
            raise ValueError("The working folder is missing from the base commit. The new worktree was kept at " + str(path))
        return {**item, "branch": adopted, "cwd": str(folder), "base": git(path, "rev-parse", "HEAD"), "adopted": True, **notes(path, provider)}
    free = next((name for name in candidates if not taken(root, name)), None)
    if path.exists() or not free:
        raise ValueError("This worktree or branch already exists. It was kept; check the previous launch before retrying.")
    item["branch"] = free
    # Every ticket starts at the same reviewed commit, even if the source HEAD later moves.
    path.parent.mkdir(parents=True, exist_ok=True)
    git(root, "worktree", "add", "--no-track", "-b", item["branch"], "--", str(path), commit)
    folder = path / relative
    if not folder.is_dir():
        raise ValueError("The working folder is missing from the base commit. The new worktree was kept at " + str(path))
    return {**item, "cwd": str(folder), **notes(path, provider)}


def notes(path, provider):
    found = provider == "pipeline" and git(path, "rev-parse", "--path-format=absolute", "--git-path", "herdr-pr.md", optional=True)
    return {"prBody": found} if found else {}


def main():
    try:
        payload = json.loads(sys.argv[1])
        if payload["op"] == "inspect":
            result = inspect(payload["cwd"], payload["tickets"], payload.get("provider", "linear"), bool(payload.get("remote")), payload.get("runId"))
        elif payload["op"] == "create":
            result = create(payload["cwd"], payload["plan"], payload["ticket"], bool(payload.get("adopt")))
        else:
            raise ValueError("Unknown worktree operation.")
        print(json.dumps({"data": result}))
        return 0
    except (ValueError, OSError, KeyError, subprocess.TimeoutExpired) as error:
        print(json.dumps({"error": str(error)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
