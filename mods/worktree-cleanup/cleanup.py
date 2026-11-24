"""List a repository's other worktrees with what removing each would lose, and remove the ones asked for without forcing Git."""
import json
import os
import subprocess
import sys


def git(cwd, *args):
    done = subprocess.run(["git", "-C", cwd, *args], capture_output=True, text=True, timeout=30)
    return done.returncode, done.stdout.strip(), done.stderr.strip()


def listed(cwd):
    code, out, error = git(cwd, "worktree", "list", "--porcelain")
    if code:
        raise ValueError(error or "Not a Git repository")
    trees = []
    for line in out.splitlines():
        if line.startswith("worktree "):
            trees.append({"path": line[9:]})
        elif not trees:
            continue
        elif line.startswith("branch "):
            trees[-1]["branch"] = line[7:].replace("refs/heads/", "", 1)
        elif line.startswith("HEAD "):
            trees[-1]["head"] = line[5:]
        elif line.startswith("locked"):
            trees[-1]["locked"] = True
        elif line.startswith("prunable"):
            trees[-1]["gone"] = True
    return trees


def count(cwd, *args):
    code, out, _ = git(cwd, "rev-list", "--count", *args)
    return int(out) if code == 0 and out.isdigit() else None


def merged_prs(cwd):
    """Branches whose pull request GitHub merged, as {branch: (number, the commit it was merged at)}. Empty without gh or GitHub."""
    try:
        done = subprocess.run(["gh", "pr", "list", "--state", "merged", "--limit", "300", "--json", "number,headRefName,headRefOid"],
                              cwd=cwd, capture_output=True, text=True, timeout=20)
        rows = json.loads(done.stdout) if done.returncode == 0 else []
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return {}
    found = {}
    for row in rows if isinstance(rows, list) else []:
        found.setdefault(row.get("headRefName"), (row.get("number"), row.get("headRefOid")))
    return found


def merged_as(tree, prs):
    """The pull request that merged this checkout's branch exactly as it is now: a squash merge leaves its commits out of the base."""
    number, commit = prs.get(tree.get("branch"), (None, None))
    return number if commit and commit == tree.get("head") else None


def preview(cwd):
    """Every checkout but the main one: uncommitted files, commits the main checkout's branch lacks, and commits that exist nowhere else."""
    trees = listed(cwd)
    main, rows = trees[0], []
    target = main.get("branch")
    prs = merged_prs(main["path"]) if any(tree.get("branch") for tree in trees[1:]) else {}
    for tree in trees[1:]:
        path, ref = tree["path"], tree.get("branch") or tree.get("head")
        row = {"path": path, "branch": tree.get("branch"), "locked": bool(tree.get("locked")), "gone": bool(tree.get("gone")) or not os.path.isdir(path)}
        if target and ref:
            row["ahead"] = count(main["path"], "%s..%s" % (target, ref))
            row["only"] = count(main["path"], ref, "--not", "--remotes", target)
        if row.get("ahead") and merged_as(tree, prs):
            row["pr"] = merged_as(tree, prs)
        if not row["gone"]:
            code, out, _ = git(path, "status", "--porcelain")
            row["dirty"] = len(out.splitlines()) if code == 0 else None
        if ref:
            code, out, _ = git(main["path"], "log", "-1", "--format=%ct", ref)
            row["at"] = int(out) * 1000 if code == 0 and out.isdigit() else None
        rows.append(row)
    return {"root": main["path"], "target": target, "rows": rows}


def remove(cwd, paths):
    """Git decides: a checkout with uncommitted or untracked files stays, and a branch goes only when it is merged,
    by Git's own account or as a pull request merged at the very commit the branch is on."""
    trees = listed(cwd)
    main, known, results = trees[0]["path"], {tree["path"]: tree for tree in trees[1:]}, []
    prs = merged_prs(main) if any(known.get(path, {}).get("branch") for path in paths) else {}
    for path in paths:
        tree = known.get(path)
        if not tree:
            results.append({"path": path, "error": "Not a worktree of this repository any more"})
            continue
        if tree.get("gone") or not os.path.isdir(path):
            code, _, error = git(main, "worktree", "prune")
        else:
            code, _, error = git(main, "worktree", "remove", path)
        if code:
            results.append({"path": path, "error": error.replace("fatal: ", "", 1) or "Git refused"})
            continue
        result = {"path": path, "removed": True}
        if tree.get("branch"):
            code, _, error = git(main, "branch", "-D" if merged_as(tree, prs) else "-d", tree["branch"])
            result["branch"] = tree["branch"]
            result["kept"] = bool(code)
        results.append(result)
    return {"results": results}


def main():
    try:
        payload = json.loads(sys.argv[1])
        print(json.dumps(remove(payload["cwd"], payload["remove"]) if "remove" in payload else preview(payload["cwd"])))
        return 0
    except (ValueError, OSError, KeyError, IndexError, subprocess.TimeoutExpired) as error:
        print(json.dumps({"error": str(error)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
