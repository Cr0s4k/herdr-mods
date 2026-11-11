"""How full the Claude and Codex usage limits are on this machine.

Claude's come from Anthropic's usage endpoint, asked with Claude Code's own login. The login is read from the one
keychain entry Claude Code writes (or its credentials file off macOS), kept in memory and sent only to that endpoint.
Codex's come from the newest rate-limit report in its session files, so no request is made for them.
"""
from datetime import datetime
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import ssl
import subprocess
import sys
import time
import unicodedata

SERVICE = "Claude Code-credentials"
SECURITY = "/usr/bin/security"
HOST, PATH = "api.anthropic.com", "/api/oauth/usage"
ACCOUNT_OK = re.compile(r"^[A-Za-z0-9._-]+$")
CLAUDE_KINDS = {"session": "5-hour", "weekly_all": "Weekly"}


def percent(value):
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) and 0 <= value <= 100 else None


def stamp(value):
    if not isinstance(value, str) or len(value) > 40:
        return None
    try:
        return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)
    except ValueError:
        return None


def window(name, used, resets, model=None):
    return {"name": name, "used": used, "resets": resets, "model": model}


def profile():
    path = os.environ.get("CLAUDE_CONFIG_DIR")
    return os.path.expanduser(path).rstrip("/") if path else None


def services(folder):
    if not folder:
        return [SERVICE]
    path = unicodedata.normalize("NFC", folder)
    names = [f"{SERVICE}-{hashlib.sha256(path.encode()).hexdigest()[:8]}"]
    return names + [SERVICE] if path == os.path.expanduser("~/.claude") else names


def account():
    name = os.environ.get("USER") or ""
    if not name:
        try:
            import pwd
            name = pwd.getpwuid(os.getuid()).pw_name
        except (ImportError, KeyError):
            name = ""
    return name if ACCOUNT_OK.match(name) else "claude-code-user"


def keychain(service, who):
    try:
        found = subprocess.run([SECURITY, "find-generic-password", "-a", who, "-s", service, "-w"],
                               stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=10)
    except subprocess.TimeoutExpired:
        return 36, ""
    except OSError:
        return 1, ""
    return found.returncode, found.stdout.decode("utf-8", "replace").strip()


def login_from(text):
    try:
        oauth = json.loads(text)["claudeAiOauth"]
    except (ValueError, TypeError, KeyError):
        return None
    token = oauth.get("accessToken") if isinstance(oauth, dict) else None
    if not isinstance(token, str) or not token:
        return None
    expires = oauth.get("expiresAt")
    return {"token": token, "expired": isinstance(expires, (int, float)) and expires < time.time() * 1000}


class Unread(Exception):
    def __init__(self, message, missing=False):
        super().__init__(message)
        self.missing = missing


def claude_login(folder=None, read=keychain, platform=sys.platform):
    if platform == "darwin" and os.path.exists(SECURITY):
        who = account()
        for service in services(folder):
            code, value = read(service, who)
            if code == 44:
                continue
            if code != 0:
                raise Unread("The keychain is locked or refused to share Claude Code's login.")
            login = login_from(value)
            if login:
                return login
    try:
        login = login_from(Path(folder or os.path.expanduser("~/.claude"), ".credentials.json").read_text())
    except OSError:
        login = None
    if not login:
        raise Unread("Claude Code isn't signed in on this machine.", missing=True)
    return login


def fetch(token):
    connection = http.client.HTTPSConnection(HOST, timeout=10, context=ssl.create_default_context())
    try:
        connection.request("GET", PATH, headers={"Authorization": f"Bearer {token}", "anthropic-beta": "oauth-2025-04-20", "User-Agent": "herdr-pipeline"})
        answer = connection.getresponse()
        return answer.status, answer.read(1_000_000)
    finally:
        connection.close()


def claude_windows(answer):
    windows = []
    for item in answer.get("limits") if isinstance(answer.get("limits"), list) else []:
        if not isinstance(item, dict) or percent(item.get("percent")) is None:
            continue
        used, resets, kind = percent(item["percent"]), stamp(item.get("resets_at")), item.get("kind")
        if used == 0 and resets is None:
            continue
        scope = item.get("scope") if isinstance(item.get("scope"), dict) else {}
        model = (scope.get("model") or {}).get("display_name") if isinstance(scope.get("model"), dict) else None
        if kind in CLAUDE_KINDS and not model:
            windows.append(window(CLAUDE_KINDS[kind], used, resets))
        elif kind == "weekly_scoped" and isinstance(model, str) and model.strip():
            windows.append(window(f"Weekly {model.strip()}", used, resets, model.strip().lower()))
    if windows:
        return windows
    for key, name in (("five_hour", "5-hour"), ("seven_day", "Weekly")):
        bucket = answer.get(key)
        if isinstance(bucket, dict) and percent(bucket.get("utilization")) is not None:
            windows.append(window(name, percent(bucket["utilization"]), stamp(bucket.get("resets_at"))))
    return windows


def claude(folder=None, read=keychain, ask=fetch, platform=sys.platform):
    try:
        login = claude_login(folder, read, platform)
        if login["expired"]:
            return {"error": "Claude Code's login has expired. Open Claude Code once and it renews it."}
        code, body = ask(login["token"])
    except Unread as error:
        return {"error": str(error), "missing": error.missing}
    except (OSError, http.client.HTTPException) as error:
        return {"error": f"Couldn't reach Anthropic: {error}"}
    if code in (401, 403):
        return {"error": "Claude Code's login has expired. Open Claude Code once and it renews it."}
    if code == 429:
        return {"error": "Anthropic asked to be asked less often. Pipeline tries again in five minutes."}
    if code != 200:
        return {"error": f"Anthropic answered {code}."}
    try:
        answer = json.loads(body)
    except ValueError:
        answer = None
    windows = claude_windows(answer) if isinstance(answer, dict) else []
    if not windows:
        return {"error": "Anthropic's usage answer changed shape, so Pipeline can't read it."}
    extra = answer.get("extra_usage") if isinstance(answer.get("extra_usage"), dict) else {}
    spent = percent(extra.get("utilization")) if extra.get("is_enabled") is True else None
    return {"windows": windows, **({"extra": round(spent)} if spent is not None else {})}


def span(minutes):
    if not isinstance(minutes, int) or minutes <= 0:
        return "Limit"
    if minutes == 10080:
        return "Weekly"
    return f"{minutes // 60}-hour" if minutes % 1440 else f"{minutes // 1440}-day"


def codex(home=None, newest=12):
    base = Path(home or os.environ.get("CODEX_HOME") or os.path.expanduser("~/.codex"), "sessions")
    try:
        files = sorted(base.glob("*/*/*/*.jsonl"), key=lambda file: file.stat().st_mtime, reverse=True)[:newest]
    except OSError:
        files = []
    best = None
    for file in files:
        try:
            lines = file.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue
        for line in reversed(lines):
            if '"rate_limits"' not in line:
                continue
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            limits = (entry.get("payload") or {}).get("rate_limits") if isinstance(entry, dict) else None
            seen = stamp(entry.get("timestamp"))
            if not isinstance(limits, dict) or limits.get("limit_id") not in (None, "codex") or seen is None:
                continue
            if not any(isinstance(limits.get(key), dict) for key in ("primary", "secondary")):
                continue
            if not best or seen > best[0]:
                best = (seen, limits)
            break
    if not best:
        return {"error": "Codex hasn't reported its limits on this machine yet.", "missing": True}
    seen, limits = best
    windows = []
    for key in ("primary", "secondary"):
        row = limits.get(key)
        if not isinstance(row, dict) or percent(row.get("used_percent")) is None:
            continue
        resets = row.get("resets_at")
        if isinstance(resets, (int, float)) and not isinstance(resets, bool):
            resets = int(resets * 1000)
        elif isinstance(row.get("resets_in_seconds"), (int, float)):
            resets = seen + int(row["resets_in_seconds"] * 1000)
        else:
            resets = None
        windows.append(window(span(row.get("window_minutes")), percent(row["used_percent"]), resets))
    return {"windows": windows, "seen": seen} if windows else {"error": "Codex's last report had no limits in it.", "missing": True}


def main():
    try:
        payload = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
    except ValueError:
        payload = {}
    print(json.dumps({"data": {"claude": claude(profile()), "codex": codex(payload.get("codex"))}}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
