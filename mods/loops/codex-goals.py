"""Read local Codex goals. No Codex process is started and no goal is changed."""

import argparse
from contextlib import closing
import json
import os
from pathlib import Path
import sqlite3
import sys


def database(root, name):
    """Use the newest schema version, never fall back to an older snapshot."""
    candidates = [
        (int(p.stem[len(name) + 1:]), p)
        for p in root.glob(f"{name}_*.sqlite")
        if p.stem[len(name) + 1:].isdigit() and p.is_file()
    ]
    return max(candidates, default=(0, None))[1]


def read_rows(path, table, required, thread_ids=None):
    with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=2)) as conn:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA query_only = ON")
        columns = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
        if not required <= columns:
            raise ValueError("This Codex goal format is not supported. Update the Loops mod.")
        if thread_ids is not None:
            # Use the primary-key index instead of loading every saved session.
            rows = []
            for thread_id in thread_ids:
                rows.extend(dict(r) for r in conn.execute(
                    "SELECT id, cwd FROM threads WHERE id = ?", (thread_id,)))
            return rows
        return [dict(r) for r in conn.execute(f"SELECT * FROM {table}")]


def load_goals(root):
    root = root.expanduser().resolve()
    path = database(root, "goals")
    result = {"available": path is not None, "goals": [], "warning": None}
    if path is None:
        return result

    goals = read_rows(path, "thread_goals", {"thread_id", "objective", "status"})
    if not goals:
        return result
    state = database(root, "state")
    threads = {}
    try:
        if state is None:
            raise ValueError("Missing session database")
        threads = {r["id"]: r for r in read_rows(
            state, "threads", {"id", "cwd"}, [g["thread_id"] for g in goals])}
    except (OSError, sqlite3.Error, ValueError):
        result["warning"] = "Session details are unavailable. Goals are still shown under All projects."

    for goal in goals:
        thread = threads.get(goal["thread_id"], {})
        cwd = thread.get("cwd")
        result["goals"].append({
            "thread_id": goal["thread_id"],
            "objective": goal["objective"],
            "status": goal["status"],
            "token_budget": goal.get("token_budget"),
            "tokens_used": goal.get("tokens_used", 0),
            "time_used_seconds": goal.get("time_used_seconds", 0),
            "updated_at_ms": goal.get("updated_at_ms", 0),
            "cwd": str(Path(cwd).expanduser().resolve()) if cwd else None,
        })
    if any(not g["cwd"] for g in result["goals"]):
        result["warning"] = "Session details are unavailable. Goals are still shown under All projects."
    priority = {"blocked": 0, "usage_limited": 1, "budget_limited": 1,
                "active": 2, "paused": 3, "complete": 4}
    result["goals"].sort(key=lambda g: (priority.get(g["status"], 2), -g["updated_at_ms"]))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--home", type=Path,
                        default=Path(os.environ.get("CODEX_HOME", Path.home() / ".codex")))
    args = parser.parse_args()
    try:
        print(json.dumps(load_goals(args.home)))
    except (OSError, sqlite3.Error, ValueError) as error:
        print(json.dumps({"error": f"Could not read Codex goals: {error}"}))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
