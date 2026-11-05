"""Read Claude /goal attachments from local transcripts without running Claude."""

import argparse
from datetime import datetime
import json
import math
import os
from pathlib import Path
import sys


def timestamp(value):
    try:
        return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)
    except (AttributeError, TypeError, ValueError, OverflowError):
        return 0


def metric(value):
    if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0:
        return value
    return None


def read_goal(path):
    goal = None
    # Only top-level session transcripts are scanned, never subagent transcripts.
    # Filter bytes before decoding: tool output and ordinary messages aren't goals.
    with path.open("rb") as stream:
        for line in stream:
            if b'"goal_status"' not in line or not line.endswith(b"\n"):
                continue  # The final line can be incomplete while Claude writes it.
            try:
                row = json.loads(line.lstrip(b"\0"))
            except (ValueError, UnicodeError):
                raise ValueError(f"Could not read a Claude goal in {path.name}. Try refreshing.")
            if not isinstance(row, dict) or row.get("type") != "attachment" or row.get("isSidechain"):
                continue
            attachment = row.get("attachment")
            if not isinstance(attachment, dict) or attachment.get("type") != "goal_status":
                continue
            condition = attachment.get("condition")
            if not isinstance(condition, str) or not condition.strip() or not isinstance(attachment.get("met"), bool):
                raise ValueError("This Claude goal format is not supported. Update the Loops mod.")
            sentinel = attachment.get("sentinel") is True
            met = attachment["met"]
            failed = attachment.get("failed") is True
            # A terminal sentinel only means the goal was removed. It is not a
            # successful evaluation, and must not turn cleared work into success.
            carried_result = sentinel and met and goal and goal["objective"] == condition and goal["status"] in {"complete", "failed"}
            if carried_result:
                continue
            status = "failed" if failed else "cleared" if sentinel and met else "complete" if met else "saved"
            new_goal = goal is None or goal["objective"] != condition or (sentinel and not met)
            if new_goal:
                goal = {
                    "thread_id": path.stem,
                    "objective": condition,
                    "cwd": None,
                    "token_budget": None,
                    "tokens_used": None,
                    "time_used_seconds": None,
                    "iterations": None,
                    "reason": None,
                }
            cwd = row.get("cwd")
            if isinstance(cwd, str) and Path(cwd).is_absolute():
                goal["cwd"] = str(Path(cwd).expanduser().resolve())
            goal["status"] = status
            goal["updated_at_ms"] = timestamp(row.get("timestamp"))
            goal["reason"] = attachment.get("reason") if isinstance(attachment.get("reason"), str) else None
            for key, field in [("tokens_used", "tokens"), ("iterations", "iterations")]:
                if field in attachment:
                    goal[key] = metric(attachment[field])
            if "durationMs" in attachment:
                milliseconds = metric(attachment["durationMs"])
                goal["time_used_seconds"] = milliseconds / 1000 if milliseconds is not None else None
    return goal


def load_goals(root):
    projects = root.expanduser().resolve() / "projects"
    result = {"available": projects.is_dir(), "goals": [], "warning": None}
    if not result["available"]:
        return result
    for path in sorted(projects.glob("*/*.jsonl")):
        try:
            goal = read_goal(path)
        except FileNotFoundError:
            continue  # A session may be cleaned up during a refresh.
        if goal:
            result["goals"].append(goal)
    if any(not goal["cwd"] for goal in result["goals"]):
        result["warning"] = "Some Claude project folders are unavailable. These goals appear under All projects."
    result["goals"].sort(key=lambda goal: (goal["status"] != "saved", -goal["updated_at_ms"]))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--home", type=Path,
                        default=Path(os.environ.get("CLAUDE_CONFIG_DIR", Path.home() / ".claude")))
    args = parser.parse_args()
    try:
        print(json.dumps(load_goals(args.home)))
    except (OSError, ValueError) as error:
        print(json.dumps({"error": f"Could not read Claude goals: {error}"}))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
