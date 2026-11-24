"""List the latest Claude Code, Codex and OpenCode conversations held in a folder, newest first, so a closed one can be resumed.
With a query, find the ones where those words were typed or answered, in that folder or anywhere."""
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
import time

CHUNK = 256_000
BUDGET = 8
FILES = 600


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
            found.append({"agent": "claude", "id": file.stem, "title": title, "at": int(file.stat().st_mtime * 1000), "cwd": cwd})
    return found


def codex_session(file, folders):
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
                if folders is not None and payload.get("cwd") not in folders:
                    return None
            elif row.get("type") == "response_item" and payload.get("role") == "user":
                text = typed(payload.get("content"))
                if text and not text.lstrip().startswith("<"):
                    title = clip(text)
                    break
    return {"agent": "codex", "id": meta["id"], "title": title, "at": int(file.stat().st_mtime * 1000), "cwd": meta["cwd"]} if meta and meta.get("id") and title else None


def codex(folders, limit, home=None):
    base = Path(home or os.environ.get("CODEX_HOME") or Path.home() / ".codex")
    files = sorted((base / "sessions").glob("*/*/*/*.jsonl"), key=lambda file: file.stat().st_mtime, reverse=True)
    found = []
    for file in files[:400]:
        if len(found) >= limit:
            break
        session = codex_session(file, folders)
        if session:
            found.append(session)
    return found


def opencode(folders, limit, database=None, terms=()):
    path = Path(database or Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local/share") / "opencode/opencode.db")
    if not path.is_file():
        return []
    names = None if folders is None else {name: folder for folder in folders for name in (folder, os.path.realpath(folder))}
    where = ["parent_id is null", *(["directory in (%s)" % ",".join("?" * len(names))] if names is not None else []), *["lower(title) like ?" for _ in terms]]
    try:
        with sqlite3.connect("file:%s?mode=ro" % path, uri=True, timeout=2) as connection:
            found = connection.execute(
                "select id, title, time_updated, directory from session_v2 where %s order by time_updated desc limit ?" % " and ".join(where),
                (*(names or ()), *("%" + term + "%" for term in terms), limit)).fetchall()
    except sqlite3.Error:
        return []
    return [{"agent": "opencode", "id": key, "title": clip(title) or "Untitled", "at": int(at or 0), "cwd": names[directory] if names else directory} for key, title, at, directory in found if directory]


def said(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(part["text"] for part in content if isinstance(part, dict) and isinstance(part.get("text"), str))
    return ""


def excerpt(text, terms, width=160):
    """One line of the text around the first of the words found in it."""
    flat = " ".join(text.split())
    low = flat.lower()
    hits = [at for at in (low.find(term) for term in terms) if at >= 0]
    if not hits:
        return None
    start = max(0, min(hits) - 50)
    return ("…" if start else "") + flat[start:start + width] + ("…" if start + width < len(flat) else "")


def found_in(messages, terms):
    """Every word has to appear somewhere in the conversation; the excerpt comes from the message holding most of them."""
    left, best, most = set(terms), None, 0
    for who, text in messages:
        low = text.lower()
        here = [term for term in terms if term in low]
        left.difference_update(here)
        if len(here) > most:
            best, most = {"who": who, "snippet": excerpt(text, here)}, len(here)
    return best if best and not left else None


def scan(file, terms, read):
    """The match in one transcript, or None. The raw bytes are checked first: most files don't hold the words at all,
    and most lines of the ones that do are tool output."""
    try:
        data = file.read_bytes()
    except OSError:
        return None
    low, plain = data.lower(), [term.encode() for term in terms if '"' not in term and "\\" not in term]
    if any(term not in low for term in plain):
        return None
    if len(plain) < len(terms):
        lines = data.split(b"\n")
    else:
        lines, at, nexts = [], 0, {term: low.find(term) for term in plain}
        while nexts:
            hit = min(nexts.values())
            start, end = low.rfind(b"\n", 0, hit) + 1, low.find(b"\n", hit)
            end = len(data) if end < 0 else end
            lines.append(data[start:end])
            at = end + 1
            for term in [term for term, seen in nexts.items() if seen < at]:
                nexts[term] = low.find(term, at)
                if nexts[term] < 0:
                    del nexts[term]
    kept = [line for line in lines if b'"text"' in line or b'"content":"' in line or b'"content": "' in line]
    return found_in(read(rows(b"\n".join(kept).decode("utf-8", "replace"))), terms)


def claude_messages(found):
    for row in found:
        if row.get("type") not in ("user", "assistant") or row.get("isSidechain"):
            continue
        text = said((row.get("message") or {}).get("content"))
        if text and not text.lstrip().startswith("<"):
            yield ("you" if row["type"] == "user" else "agent"), text


def codex_messages(found):
    for row in found:
        payload = row.get("payload")
        if row.get("type") != "response_item" or not isinstance(payload, dict) or payload.get("role") not in ("user", "assistant"):
            continue
        text = said(payload.get("content"))
        if text and not text.lstrip().startswith("<"):
            yield ("you" if payload["role"] == "user" else "agent"), text


def claude_cwd(file):
    with open(file, "rb") as handle:
        head = handle.read(CHUNK).decode("utf-8", "replace")
    return next((row["cwd"] for row in rows(head) if isinstance(row.get("cwd"), str)), None)


def newest(files, limit=FILES):
    def changed(file):
        try:
            return file.stat().st_mtime
        except OSError:
            return 0
    return sorted(files, key=changed, reverse=True)[:limit]


def search(cwd, query, everywhere=False, limit=40, home=None, codex_home=None, database=None, others=None, budget=BUDGET):
    """Conversations whose typed or answered text holds every word of the query, newest first. No words: the latest ones."""
    cwd = str(cwd).rstrip("/") or "/"
    terms = [term for term in query.lower().split() if term]
    others = worktrees(cwd) if others is None else others
    folders = [cwd, *others]
    stop, cut, found = time.monotonic() + budget, False, []

    base = Path(home or os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude") / "projects"
    slugs = {re.sub(r"[^A-Za-z0-9]", "-", folder): folder for folder in folders}
    kept = [folder for folder in (base.iterdir() if base.is_dir() else []) if folder.is_dir() and (everywhere or folder.name in slugs)]
    claude_files = newest(file for folder in kept for file in folder.glob("*.jsonl"))
    codex_files = newest((Path(codex_home or os.environ.get("CODEX_HOME") or Path.home() / ".codex") / "sessions").glob("*/*/*/*.jsonl"), 400)

    for agent, files in (("claude", claude_files), ("codex", codex_files)):
        count = 0
        for file in files:
            if count >= limit:
                break
            if time.monotonic() > stop:
                cut = True
                break
            try:
                match = scan(file, terms, claude_messages if agent == "claude" else codex_messages) if terms else {}
                if match is None:
                    continue
                if agent == "claude":
                    title, folder = claude_title(file), slugs.get(file.parent.name) or claude_cwd(file)
                    session = {"agent": "claude", "id": file.stem, "title": title, "at": int(file.stat().st_mtime * 1000), "cwd": folder} if title and folder else None
                else:
                    session = codex_session(file, None if everywhere else folders)
            except OSError:
                continue
            if session:
                found.append({**session, **match})
                count += 1

    for session in opencode(None if everywhere else folders, limit, database, terms):
        found.append(session)

    for session in found:
        if session["cwd"] in others:
            session["branch"] = others[session["cwd"]] or Path(session["cwd"]).name
        elif session["cwd"] != cwd:
            session["folder"] = Path(session["cwd"]).name
        if not os.path.isdir(session["cwd"]):
            session["gone"] = True
    return {"data": sorted(found, key=lambda session: session["at"], reverse=True)[:limit], "cut": cut}


def worktrees(cwd):
    """The repository's other checkouts that still exist, as {folder: branch}: a conversation held in one can be resumed there."""
    try:
        listed = subprocess.run(["git", "-C", cwd, "worktree", "list", "--porcelain"], capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        return {}
    found, folder = {}, None
    for line in listed.stdout.splitlines() if listed.returncode == 0 else []:
        if line.startswith("worktree "):
            folder = line[9:].rstrip("/")
            if folder != cwd and os.path.isdir(folder):
                found[folder] = None
            else:
                folder = None
        elif line.startswith("branch ") and folder:
            found[folder] = line[7:].replace("refs/heads/", "", 1)
    return found


def recent(cwd, limit=8, home=None, codex_home=None, database=None, others=None):
    cwd = str(cwd).rstrip("/") or "/"
    others = worktrees(cwd) if others is None else others
    folders = [cwd, *others]
    found = [session for folder in folders for session in claude(folder, limit, home)] + codex(folders, limit, codex_home) + opencode(folders, limit * 2, database)
    for session in found:
        branch = others.get(session["cwd"])
        if session["cwd"] != cwd:
            session["branch"] = branch or Path(session["cwd"]).name
    return sorted(found, key=lambda session: session["at"], reverse=True)[:limit * 3]


def main():
    try:
        payload = json.loads(sys.argv[1])
        if "query" in payload:
            print(json.dumps(search(payload["cwd"], payload["query"], bool(payload.get("everywhere")), int(payload.get("limit") or 40))))
            return 0
        print(json.dumps({"data": recent(payload["cwd"], int(payload.get("limit") or 8))}))
        return 0
    except (ValueError, OSError, KeyError) as error:
        print(json.dumps({"error": str(error)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
