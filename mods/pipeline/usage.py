"""Add up the tokens Claude Code, Codex and OpenCode used in a task's worktree, from the transcripts they keep."""
import json
import os
from pathlib import Path
import re
import sqlite3
import sys

FIELDS = {"input_tokens": "read", "cache_creation_input_tokens": "read", "cache_read_input_tokens": "cached", "output_tokens": "written"}


def folder(cwd, home=None):
    base = Path(home or os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude")
    return base / "projects" / re.sub(r"[^A-Za-z0-9]", "-", str(cwd))


def codex_files(codex=None):
    base = Path(codex or os.environ.get("CODEX_HOME") or Path.home() / ".codex")
    return sorted((base / "sessions").glob("*/*/*/*.jsonl"))


def codex_cwd(file):
    with open(file, encoding="utf-8", errors="replace") as lines:
        try:
            meta = json.loads(lines.readline())
        except ValueError:
            return None
    payload = meta.get("payload") if isinstance(meta, dict) and meta.get("type") == "session_meta" else None
    return payload.get("cwd") if isinstance(payload, dict) else None


def codex_usage(cwd, total, codex=None):
    for file in codex_files(codex):
        here = codex_cwd(file)
        if not isinstance(here, str) or (here != cwd and not here.startswith(cwd.rstrip("/") + "/")):
            continue
        last, before = None, None
        with open(file, encoding="utf-8", errors="replace") as lines:
            for line in lines:
                if '"token_count"' not in line:
                    continue
                try:
                    info = json.loads(line).get("payload", {}).get("info") or {}
                except (ValueError, AttributeError):
                    continue
                counts = info.get("total_token_usage")
                if not isinstance(counts, dict) or counts == before:
                    continue
                before = last = counts
                total["turns"] += 1
        if last:
            number = lambda key: last.get(key) if isinstance(last.get(key), int) else 0
            total["cached"] += number("cached_input_tokens")
            total["read"] += max(0, number("input_tokens") - number("cached_input_tokens"))
            total["written"] += number("output_tokens")


def opencode_usage(cwd, total, database=None):
    """OpenCode keeps a running total per session in its database, its helpers' sessions included."""
    path = Path(database or Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local/share") / "opencode/opencode.db")
    if not path.is_file():
        return
    folders = {cwd.rstrip("/"), os.path.realpath(cwd)}
    try:
        with sqlite3.connect("file:%s?mode=ro" % path, uri=True, timeout=2) as connection:
            rows = connection.execute(
                "select directory, tokens_input, tokens_cache_write, tokens_cache_read, tokens_output, tokens_reasoning, "
                "(select count(*) from session_message where session_id = session_v2.id and type = 'assistant') from session_v2").fetchall()
    except sqlite3.Error:
        return
    for directory, fresh, stored, cached, written, thought, turns in rows:
        if not turns or not any(directory == folder or str(directory).startswith(folder + "/") for folder in folders):
            continue
        total["read"] += (fresh or 0) + (stored or 0)
        total["cached"] += cached or 0
        total["written"] += (written or 0) + (thought or 0)
        total["turns"] += turns


def usage(cwd, home=None, codex=None, opencode=None):
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
    codex_usage(str(cwd), total, codex)
    opencode_usage(str(cwd), total, opencode)
    return total if total["turns"] else None


def main():
    try:
        payload = json.loads(sys.argv[1])
        print(json.dumps({"data": {cwd: usage(cwd, payload.get("home"), payload.get("codex"), payload.get("opencode")) for cwd in payload.get("cwds", [])[:20]}}))
        return 0
    except (ValueError, OSError, KeyError) as error:
        print(json.dumps({"error": str(error)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
