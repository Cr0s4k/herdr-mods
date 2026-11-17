"""Run Pipeline's planner agent read-only, note what it reads as it goes, and hand back its plan."""
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import threading
import time

NAMES = {"claude": "Claude Code", "codex": "Codex", "opencode": "OpenCode"}
LIMIT = 300


def short(text, size=200):
    return " ".join(str(text).split())[:size]


def relative(path, cwd):
    path = str(path or "")
    return os.path.relpath(path, cwd) if cwd and path.startswith(cwd.rstrip("/") + "/") else path


def claude_step(content, cwd):
    kind = content.get("type")
    if kind == "text" and content.get("text", "").strip():
        return "Says: " + short(content["text"])
    if kind != "tool_use" or content.get("name") == "StructuredOutput":
        return None
    name, given = content.get("name"), content.get("input") or {}
    if name == "Read":
        return "Reads " + relative(given.get("file_path"), cwd)
    if name == "Grep":
        where = given.get("path") or given.get("glob")
        return "Searches for “%s”%s" % (given.get("pattern", ""), " in " + relative(where, cwd) if where else "")
    if name == "Glob":
        return "Lists %s%s" % (given.get("pattern", ""), " in " + relative(given.get("path"), cwd) if given.get("path") else "")
    return "%s %s" % (name, short(json.dumps(given), 160))


def codex_command(command):
    match = re.match(r"^\S*sh -lc (.*)$", command or "", re.S)
    if not match:
        return command
    try:
        return shlex.split(match.group(1))[0]
    except ValueError:
        return match.group(1)


def codex_step(event, result):
    item = event.get("item") or {}
    if event.get("type") == "item.completed":
        if item.get("type") == "command_execution":
            return "Runs " + codex_command(item.get("command"))
        if item.get("type") == "reasoning":
            return "Thinks: " + short(item.get("text", ""))
        if item.get("type") == "agent_message" and not item.get("text", "").lstrip().startswith("{"):
            return "Says: " + short(item.get("text", ""))
        if item.get("type") == "web_search":
            return "Searches the web for “%s”" % item.get("query", "")
    elif event.get("type") == "turn.completed":
        usage = event.get("usage") or {}
        result["tokens"] = (usage.get("input_tokens") or 0) + (usage.get("output_tokens") or 0) or None
    elif event.get("type") in ("error", "turn.failed"):
        result["error"] = short((event.get("error") or {}).get("message") or event.get("message") or "Codex stopped with an error.", 300)
    return None


def opencode_step(event, result, cwd):
    part = event.get("part") or {}
    if event.get("type") == "tool_use":
        tool, given = part.get("tool"), (part.get("state") or {}).get("input") or {}
        if tool == "read":
            return "Reads " + relative(given.get("path") or given.get("filePath"), cwd)
        if tool in ("grep", "glob"):
            where = given.get("path")
            return "%s “%s”%s" % ("Searches for" if tool == "grep" else "Lists", given.get("pattern", ""), " in " + relative(where, cwd) if where else "")
        return "%s %s" % (tool, short(json.dumps(given), 160))
    if event.get("type") == "text":
        result["said"] = part.get("text", "")
        if not result["said"].lstrip().startswith(("{", "```")):
            return "Says: " + short(result["said"])
    elif event.get("type") == "step_finish":
        tokens = part.get("tokens") or {}
        cache = tokens.get("cache") or {}
        used = sum(tokens.get(key) or 0 for key in ("input", "output", "reasoning")) + (cache.get("read") or 0) + (cache.get("write") or 0)
        result["tokens"] = (result["tokens"] or 0) + used or None
        if isinstance(part.get("cost"), (int, float)):
            result["cost"] = (result["cost"] or 0) + part["cost"]
    elif event.get("type") == "error":
        error = event.get("error") or {}
        result["error"] = short((error.get("data") or {}).get("message") or error.get("message") or error.get("name") or "OpenCode stopped with an error.", 300)
    return None


def answer(text):
    """The JSON object in a reply that may wrap it in a code fence or a sentence."""
    start, end = text.find("{"), text.rfind("}")
    try:
        found = json.loads(text[start:end + 1]) if 0 <= start < end else None
    except ValueError:
        return None
    return found if isinstance(found, dict) else None


def claude_result(event, result):
    result["plan"] = event.get("structured_output")
    result["cost"] = event.get("total_cost_usd")
    usage = event.get("usage") or {}
    result["tokens"] = sum(usage.get(key) or 0 for key in ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens")) or None
    if event.get("is_error"):
        result["error"] = short(event.get("result") or "Claude Code stopped with an error.", 300)


def run(payload):
    agent, cwd, watch = payload["agent"], payload.get("cwd") or os.getcwd(), payload.get("watch")
    started = time.time()
    result = {"plan": None, "error": None, "trace": [], "cost": None, "tokens": None, "said": ""}

    def note(text):
        if text:
            result["trace"].append(short(text))
            if watch:
                print("  " + short(text), flush=True)

    with tempfile.TemporaryDirectory() as folder:
        last = Path(folder) / "last.json"
        if agent == "codex":
            schema = Path(folder) / "schema.json"
            schema.write_text(json.dumps(payload["schema"]))
            command = ["codex", "exec", "--json", "--output-schema", str(schema), "-o", str(last), *payload["args"], payload["prompt"]]
        elif agent == "opencode":
            asked = "%s\n\nAnswer with one JSON object and nothing else, matching this JSON Schema:\n%s" % (payload["prompt"], json.dumps(payload["schema"]))
            command = ["opencode", "run", "--format", "json", *payload["args"], asked]
        else:
            command = ["claude", *payload["args"], "--output-format", "stream-json", "--verbose", "--json-schema", json.dumps(payload["schema"]), payload["prompt"]]
        if not shutil.which(command[0]):
            result["error"] = "The planner needs %s, and it isn't installed on that machine." % NAMES[agent]
            return finish(result, started)
        with open(Path(folder) / "stderr", "w+") as errors:
            try:
                process = subprocess.Popen(command, cwd=cwd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=errors, text=True,
                                           env={**os.environ, **(payload.get("env") or {})})
            except OSError as error:
                result["error"] = short("The planner couldn't start: %s" % error, 300)
                return finish(result, started)
            timer = threading.Timer(LIMIT, process.kill)
            timer.start()
            for raw in process.stdout:
                try:
                    event = json.loads(raw)
                except ValueError:
                    continue
                if agent == "codex":
                    note(codex_step(event, result))
                elif agent == "opencode":
                    note(opencode_step(event, result, cwd))
                elif event.get("type") == "assistant":
                    for content in event.get("message", {}).get("content", []):
                        note(claude_step(content, cwd))
                elif event.get("type") == "result":
                    claude_result(event, result)
            process.stdout.close()
            process.wait()
            timer.cancel()
            if agent == "codex" and result["plan"] is None:
                try:
                    result["plan"] = json.loads(last.read_text())
                except (OSError, ValueError):
                    pass
            if agent == "opencode":
                result["plan"] = answer(result["said"])
                if result["plan"] is None and result["said"] and not result["error"]:
                    result["error"] = "OpenCode answered without the JSON it was asked for: " + short(result["said"], 200)
            if process.returncode == -9 and result["plan"] is None:
                result["error"] = "The planner took longer than 5 minutes."
            if result["plan"] is None and not result["error"]:
                errors.seek(0)
                result["error"] = short(errors.read()[-600:], 300) or "%s stopped without a plan." % NAMES[agent]
    return finish(result, started)


def finish(result, started):
    result.pop("said", None)
    result["ms"] = int((time.time() - started) * 1000)
    result["trace"] = result["trace"][-80:]
    return result


def show(result):
    print()
    if result["plan"]:
        print("Its plan, %.0f s:\n\n  %s\n" % (result["ms"] / 1000, result["plan"].get("summary", "")))
        for row in result["plan"].get("tasks", []):
            print("  %s: %s%s" % (row.get("id"), row.get("reason", ""), " Waits for %s." % ", ".join(row["waits"]) if row.get("waits") else ""))
    else:
        print("It gave no plan: %s" % result["error"])
    print("\nPipeline has it. You can close this tab.", flush=True)


def main():
    try:
        payload = json.loads(sys.argv[1])
    except (IndexError, ValueError) as error:
        print(json.dumps({"error": str(error)}))
        return 1
    if not payload.get("watch"):
        print(json.dumps({"data": run(payload)}))
        return 0
    print("Pipeline's planner · %s%s" % (NAMES.get(payload["agent"], payload["agent"]), "".join(" · " + str(part) for part in payload.get("tuning") or [])))
    print("\nWhat it was asked:\n")
    for line in payload.get("prompt", "").splitlines():
        print("  " + line)
    print("\nWhat it does:\n", flush=True)
    result = run(payload)
    out = Path(payload["out"])
    out.mkdir(parents=True, exist_ok=True)
    (out / "result.tmp").write_text(json.dumps(result))
    (out / "result.tmp").rename(out / "result.json")
    show(result)
    return 0


if __name__ == "__main__":
    sys.exit(main())
