"""Read local OpenCode goals. No OpenCode process is started and no goal is changed."""

import argparse
from contextlib import closing
import json
import os
from pathlib import Path
import sqlite3
import sys

# OpenCode keeps a session's goal under its goal plugin's name, written as UTF-16 hex.
PREFIX = "plugin:%s:session:" % "opencode.goal".encode("utf-16-be").hex()


def load_goals(path):
    result = {"available": path.is_file(), "goals": [], "warning": None}
    if not result["available"]:
        return result
    with closing(sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=2)) as conn:
        conn.execute("PRAGMA query_only = ON")
        saved = conn.execute("SELECT key, value FROM kv WHERE key LIKE ?", (PREFIX + "%",)).fetchall()
        folders = dict(conn.execute("SELECT id, directory FROM session_v2")) if saved else {}
    for key, value in saved:
        try:
            goal = json.loads(value)
        except ValueError:
            continue
        session = key[len(PREFIX):]
        if not isinstance(goal, dict) or not isinstance(goal.get("objective"), str) or session not in folders:
            continue
        status = goal.get("status")
        result["goals"].append({
            "thread_id": session,
            "objective": goal["objective"],
            "status": status if status in ("active", "paused", "complete") else "paused",
            "reason": goal.get("reason") if isinstance(goal.get("reason"), str) else None,
            "token_budget": None,
            "tokens_used": None,
            "time_used_seconds": None,
            "iterations": goal.get("rounds") if isinstance(goal.get("rounds"), int) else None,
            "updated_at_ms": goal.get("updatedAt") if isinstance(goal.get("updatedAt"), int) else 0,
            "cwd": folders[session],
        })
    priority = {"active": 0, "paused": 1, "complete": 2}
    result["goals"].sort(key=lambda g: (priority[g["status"]], -g["updated_at_ms"]))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local/share") / "opencode/opencode.db")
    args = parser.parse_args()
    try:
        print(json.dumps(load_goals(args.db)))
    except (OSError, sqlite3.Error, ValueError) as error:
        print(json.dumps({"error": f"Could not read OpenCode goals: {error}"}))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
