"""List the latest Claude Code, Codex and OpenCode conversations held in a folder, newest first, so a closed one can be resumed."""
import json
import os
from pathlib import Path
import re
import sqlite3
import sys

CHUNK = 256_000


def clip(text):
    line = " ".join(str(text or "").split())
    return line[:120]


def typed(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return next((part.get("text") for part in content if isinstance(part, dict) and isinstance(part.get("text"), str)), None)
    return None


def rows(text):
    for line in text.splitlines():
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if isinstance(row, dict):
            yield row


def claude_title(file):
    size = file.stat().st_size
    with open(file, "rb") as handle:
        head = handle.read(CHUNK).decode("utf-8", "replace")
        handle.seek(max(0, size - CHUNK))
        tail = handle.read().decode("utf-8", "replace")
    title = None
    for row in rows(tail):
        if row.get("type") == "ai-title" and row.get("aiTitle"):
            title = row["aiTitle"]
    if title:
        return clip(title)
    for row in rows(head):
        if row.get("type") != "user" or row.get("isSidechain"):
            continue
        text = typed((row.get("message") or {}).get("content"))
        if text and not text.lstrip().startswith("<"):
            return clip(text.lstrip("❯\xa0 "))
    return None


def claude(cwd, limit, home=None):
    base = Path(home or os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude")
    folder = base / "projects" / re.sub(r"[^A-Za-z0-9]", "-", str(cwd))
    files = sorted(folder.glob("*.jsonl"), key=lambda file: file.stat().st_mtime, reverse=True) if folder.is_dir() else []
    found = []
    for file in files:
        if len(found) >= limit:
            break
        title = claude_title(file)
        if title:
            found.append({"agent": "claude", "id": file.stem, "title": title, "at": int(file.stat().st_mtime * 1000)})
    return found


def codex_session(file, cwd):
    with open(file, encoding="utf-8", errors="replace") as lines:
        meta, title = None, None
        for index, line in enumerate(lines):
            if index > 200:
                break
            try:
                row = json.loads(line)
            except ValueError:
                continue
            payload = row.get("payload") if isinstance(row, dict) else None
            if not isinstance(payload, dict):
                continue
            if row.get("type") == "session_meta":
                meta = payload
                if payload.get("cwd") != cwd:
                    return None
            elif row.get("type") == "response_item" and payload.get("role") == "user":
                text = typed(payload.get("content"))
                if text and not text.lstrip().startswith("<"):
                    title = clip(text)
                    break
    return {"agent": "codex", "id": meta["id"], "title": title, "at": int(file.stat().st_mtime * 1000)} if meta and meta.get("id") and title else None


def codex(cwd, limit, home=None):
    base = Path(home or os.environ.get("CODEX_HOME") or Path.home() / ".codex")
    files = sorted((base / "sessions").glob("*/*/*/*.jsonl"), key=lambda file: file.stat().st_mtime, reverse=True)
    found = []
    for file in files[:400]:
        if len(found) >= limit:
            break
        session = codex_session(file, cwd)
        if session:
            found.append(session)
    return found


def opencode(cwd, limit, database=None):
    path = Path(database or Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local/share") / "opencode/opencode.db")
    if not path.is_file():
        return []
    try:
        with sqlite3.connect("file:%s?mode=ro" % path, uri=True, timeout=2) as connection:
            found = connection.execute(
                "select id, title, time_updated from session_v2 where directory in (?, ?) and parent_id is null order by time_updated desc limit ?",
                (cwd.rstrip("/"), os.path.realpath(cwd), limit)).fetchall()
    except sqlite3.Error:
        return []
    return [{"agent": "opencode", "id": key, "title": clip(title) or "Untitled", "at": int(at or 0)} for key, title, at in found]


def recent(cwd, limit=8, home=None, codex_home=None, database=None):
    cwd = str(cwd).rstrip("/") or "/"
    found = claude(cwd, limit, home) + codex(cwd, limit, codex_home) + opencode(cwd, limit, database)
    return sorted(found, key=lambda session: session["at"], reverse=True)


def main():
    try:
        payload = json.loads(sys.argv[1])
        print(json.dumps({"data": recent(payload["cwd"], int(payload.get("limit") or 8))}))
        return 0
    except (ValueError, OSError, KeyError) as error:
        print(json.dumps({"error": str(error)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
