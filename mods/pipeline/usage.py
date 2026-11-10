"""Add up the tokens Claude Code used in a task's worktree, from the transcripts it keeps per folder."""
import json
import os
from pathlib import Path
import re
import sys

FIELDS = {"input_tokens": "read", "cache_creation_input_tokens": "read", "cache_read_input_tokens": "cached", "output_tokens": "written"}


def folder(cwd, home=None):
    base = Path(home or os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude")
    return base / "projects" / re.sub(r"[^A-Za-z0-9]", "-", str(cwd))


def usage(cwd, home=None):
    total, seen = {"read": 0, "cached": 0, "written": 0, "turns": 0}, set()
    files = sorted(folder(cwd, home).glob("*.jsonl"))
    for file in files:
        with open(file, encoding="utf-8", errors="replace") as lines:
            for line in lines:
                if '"usage"' not in line:
                    continue
                try:
                    message = json.loads(line).get("message")
                except ValueError:
                    continue
                if not isinstance(message, dict) or not isinstance(message.get("usage"), dict):
                    continue
                # A reply is written once per content block, each carrying the whole reply's usage.
                if message.get("id") in seen:
                    continue
                seen.add(message.get("id"))
                total["turns"] += 1
                for field, key in FIELDS.items():
                    value = message["usage"].get(field)
                    total[key] += value if isinstance(value, int) else 0
    return total if total["turns"] else None


def main():
    try:
        payload = json.loads(sys.argv[1])
        print(json.dumps({"data": {cwd: usage(cwd, payload.get("home")) for cwd in payload.get("cwds", [])[:20]}}))
        return 0
    except (ValueError, OSError, KeyError) as error:
        print(json.dumps({"error": str(error)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
