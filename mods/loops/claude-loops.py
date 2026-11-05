"""Read saved Claude schedules without starting Claude or changing its files."""

import argparse
from datetime import datetime
import json
import math
import os
from pathlib import Path
import re
import sys
import time


WEEK_MS = 7 * 24 * 60 * 60 * 1000
TOOLS = {"CronCreate", "CronDelete", "CronList", "ScheduleWakeup"}
TERMINAL = {"cancelled", "ended", "expired", "inactive"}


def number(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and 0 <= value < 1e16 and math.isfinite(value) else None


def timestamp(value):
    try:
        return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)
    except (AttributeError, TypeError, ValueError, OverflowError):
        return 0


def folder(value):
    return str(Path(value).resolve()) if isinstance(value, str) and Path(value).is_absolute() else None


def schedule(task, session, cwd, updated, *, dynamic=False):
    if not isinstance(task, dict):
        raise ValueError("Unsupported Claude schedule format. Update the Loops mod.")
    task_id = "wakeup" if dynamic else task.get("id")
    prompt = task.get("prompt")
    cron = None if dynamic else task.get("cron")
    if not isinstance(task_id, str) or not task_id or not isinstance(prompt, str) or not prompt.strip() or (not dynamic and (not isinstance(cron, str) or len(cron.split()) != 5)):
        raise ValueError("Unsupported Claude schedule format. Update the Loops mod.")
    # The default autonomous prompts are runtime sentinels, not display copy.
    objective = "Run the default /loop prompt" if prompt in {"<<autonomous-loop>>", "<<autonomous-loop-dynamic>>"} else prompt
    return {
        "kind": "schedule", "schedule_kind": "dynamic" if dynamic else "cron",
        "thread_id": session if isinstance(session, str) and session else None, "task_id": task_id,
        "record_id": f"{session or cwd}:{task_id}", "objective": objective,
        "cwd": cwd, "status": "saved_schedule", "cron": cron,
        "recurring": task.get("recurring") is True,
        "durable": task.get("durable") is True,
        "permanent": task.get("permanent") is True,
        "created_at_ms": number(task.get("createdAt")),
        "recorded_next_run_ms": number(task.get("scheduledFor") if dynamic else task.get("nextFireAt")),
        "updated_at_ms": updated,
        "reason": "Last recorded schedule; the session may no longer be running.",
        "schedule_reason": task.get("reason") if isinstance(task.get("reason"), str) else None,
        "tokens_used": None, "token_budget": None, "time_used_seconds": None,
    }


def end(item, status, updated, reason):
    item.update(status=status, updated_at_ms=updated, reason=reason)


def read_session(path):
    tasks, pending = {}, {}
    cwd = None
    with path.open("rb") as stream:
        for line in stream:
            # Ordinary conversation and tool output never establish schedules.
            relevant = b'"session_cron_carry"' in line or any(name.encode() in line for name in TOOLS)
            relevant = relevant or any(call_id.encode() in line for call_id in pending)
            if not relevant and (cwd is not None or b'"cwd"' not in line):
                continue
            if not line.endswith(b"\n"):
                continue  # The writer may not have finished the last line yet.
            try:
                row = json.loads(line.lstrip(b"\0"))
            except (ValueError, UnicodeError):
                if relevant:
                    raise ValueError(f"Could not read Claude schedules in {path.name}. Try refreshing.")
                continue
            if not isinstance(row, dict) or row.get("isSidechain"):
                continue
            cwd = folder(row.get("cwd")) or cwd
            updated = timestamp(row.get("timestamp"))
            attachment = row.get("attachment")
            if row.get("type") == "attachment" and isinstance(attachment, dict) and attachment.get("type") == "session_cron_carry":
                carried = attachment.get("tasks")
                other = attachment.get("otherArmed", [])
                ended = attachment.get("ended", [])
                if not isinstance(carried, list) or not isinstance(other, list) or not isinstance(ended, list) or any(not isinstance(i, str) for i in ended):
                    raise ValueError("Unsupported Claude schedule snapshot. Update the Loops mod.")
                snapshot = {}
                for task in carried + other:
                    item = schedule(task, path.stem, cwd, updated)
                    snapshot[item["task_id"]] = item
                if attachment.get("wakeup") is not None:
                    item = schedule(attachment["wakeup"], path.stem, cwd, updated, dynamic=True)
                    snapshot["wakeup"] = item
                for task_id, item in tasks.items():
                    if (task_id in ended or task_id not in snapshot) and item["status"] not in TERMINAL:
                        end(item, "ended", updated, "No longer present in the saved scheduler snapshot; outcome not recorded.")
                for task_id, item in snapshot.items():
                    if task_id in ended:
                        end(item, "ended", updated, "The saved scheduler marks this task as ended; outcome not recorded.")
                    tasks[task_id] = item
                continue
            message = row.get("message")
            content = message.get("content", []) if isinstance(message, dict) else []
            if not isinstance(content, list):
                continue
            for block in content:
                if not isinstance(block, dict):
                    continue
                if row.get("type") == "assistant" and block.get("type") == "tool_use" and block.get("name") in TOOLS:
                    if isinstance(block.get("id"), str) and isinstance(block.get("input"), dict):
                        pending[block["id"]] = (block["name"], block["input"], updated)
                elif row.get("type") == "user" and block.get("type") == "tool_result":
                    call = pending.pop(block.get("tool_use_id"), None)
                    if call is None or block.get("is_error"):
                        continue
                    name, args, called_at = call
                    data = row.get("toolUseResult")
                    if isinstance(data, dict) and isinstance(data.get("data"), dict):
                        data = data["data"]
                    if not isinstance(data, dict):
                        # Older transcripts retain just the canonical result text.
                        text = block.get("content", "")
                        match = re.match(r"Scheduled (?:recurring job|one-shot task) ([\w-]+) ", text) if isinstance(text, str) else None
                        if name == "CronCreate" and match:
                            data = {"id": match[1], "durable": "Persisted to .claude/scheduled_tasks.json" in text}
                        elif name == "CronDelete" and isinstance(text, str) and text == f"Cancelled job {args.get('id')}.":
                            data = {"id": args.get("id")}
                        elif name == "ScheduleWakeup" and isinstance(text, str) and text.startswith("Loop stopped"):
                            data = {"stopped": True}
                        else:
                            raise ValueError("Claude scheduler results are missing structured data. Update the Loops mod.")
                    if name == "CronCreate":
                        item = schedule({**args, **data, "createdAt": called_at,
                                         "recurring": args.get("recurring", True)}, path.stem, cwd, updated)
                        tasks[item["task_id"]] = item
                    elif name == "CronDelete":
                        task_id = data.get("id")
                        if not isinstance(task_id, str):
                            raise ValueError("Unsupported Claude cancellation result. Update the Loops mod.")
                        if task_id in tasks:
                            end(tasks[task_id], "cancelled", updated, "Cancellation confirmed by Claude's scheduler.")
                        elif tasks.get("wakeup", {}).get("scheduler_task_id") == task_id:
                            end(tasks["wakeup"], "cancelled", updated, "Cancellation confirmed by Claude's scheduler.")
                    elif name == "CronList":
                        jobs = data.get("jobs")
                        if not isinstance(jobs, list):
                            raise ValueError("Unsupported Claude schedule list. Update the Loops mod.")
                        seen = set()
                        for job in jobs:
                            item = schedule(job, path.stem, cwd, updated)
                            wakeup = tasks.get("wakeup")
                            if wakeup and item["recorded_next_run_ms"] is not None and item["recorded_next_run_ms"] == wakeup["recorded_next_run_ms"] and item["objective"] == wakeup["objective"]:
                                # CronList also exposes the pending dynamic wakeup,
                                # under an internal scheduler ID. Keep one row.
                                wakeup.update(scheduler_task_id=item["task_id"], updated_at_ms=updated)
                                seen.add("wakeup")
                                continue
                            old = tasks.get(item["task_id"])
                            if old:
                                item["created_at_ms"] = old["created_at_ms"]
                                item["durable"] = old["durable"]
                                item["permanent"] = old["permanent"]
                            tasks[item["task_id"]] = item
                            seen.add(item["task_id"])
                        for task_id, item in tasks.items():
                            if task_id not in seen and item["status"] not in TERMINAL:
                                end(item, "ended", updated, "No longer present in Claude's recorded task list; outcome not recorded.")
                    elif name == "ScheduleWakeup":
                        if data.get("stopped") is True:
                            if "wakeup" in tasks:
                                end(tasks["wakeup"], "cancelled", updated, "Claude confirmed that the dynamic loop stopped.")
                        elif number(data.get("scheduledFor")) == 0:
                            if "wakeup" in tasks:
                                end(tasks["wakeup"], "expired", updated, "Claude's scheduler ended the dynamic loop at its maximum duration.")
                        else:
                            tasks["wakeup"] = schedule({**args, **data}, path.stem, cwd, updated, dynamic=True)
    return list(tasks.values()), cwd


def load_schedules(root, projects=(), now_ms=None):
    now_ms = int(time.time() * 1000) if now_ms is None else now_ms
    root = root.expanduser().resolve()
    items, folders = [], {folder(str(p)) for p in projects}
    transcripts = root / "projects"
    for path in sorted(transcripts.glob("*/*.jsonl")):
        try:
            tasks, cwd = read_session(path)
        except FileNotFoundError:
            continue
        items.extend(tasks)
        if cwd:
            folders.add(cwd)
    # Project files are authoritative for durable tasks. Never scan arbitrary trees:
    # visit known project folders and their parents, once each.
    paths = set()
    for cwd in folders - {None}:
        project = Path(cwd)
        paths.update(p / ".claude" / "scheduled_tasks.json" for p in (project, *project.parents))
    durable = {}
    for path in sorted(paths):
        try:
            data = json.loads(path.read_text())
        except FileNotFoundError:
            continue
        except (ValueError, UnicodeError):
            raise ValueError(f"Could not read {path}. Try refreshing.")
        if not isinstance(data, dict) or not isinstance(data.get("tasks"), list):
            raise ValueError(f"Unsupported Claude schedule file: {path}")
        cwd = str(path.parent.parent)
        for task in data["tasks"]:
            item = schedule(task, task.get("createdBySessionId") if isinstance(task, dict) else None,
                            cwd, int(path.stat().st_mtime * 1000))
            item["durable"] = True
            item["record_id"] = f"{cwd}:{item['task_id']}"
            created_in = folder(task.get("createdInProject"))
            if created_in and created_in != cwd:
                end(item, "inactive", item["updated_at_ms"], f"This copied schedule belongs to {created_in}; it does not run in this folder.")
            durable[(cwd, item["task_id"])] = item
    for item in items:
        if item["durable"]:
            if (item["cwd"], item["task_id"]) in durable:
                continue
            if item["status"] not in TERMINAL:
                end(item, "ended", item["updated_at_ms"], "No longer present in the project schedule file; outcome not recorded.")
        durable[(item["record_id"], item["task_id"])] = item
    for item in durable.values():
        created = item["created_at_ms"]
        if item["status"] not in TERMINAL and item["recurring"] and not item["permanent"] and created is not None:
            item["expires_at_ms"] = created + WEEK_MS
            if now_ms >= item["expires_at_ms"]:
                end(item, "expired", item["updated_at_ms"], "The saved schedule is past Claude's seven-day lifetime; Claude may fire it one final time before removal.")
        if item["status"] == "saved_schedule" and item["recorded_next_run_ms"] is not None and item["recorded_next_run_ms"] < now_ms:
            item["status"] = "schedule_due"
            item["reason"] = "The last recorded run time has passed; execution and the current schedule are not confirmed."
    goals = sorted(durable.values(), key=lambda item: (item["status"] in TERMINAL, -item["updated_at_ms"]))
    return {"available": transcripts.is_dir() or bool(durable), "goals": goals,
            "warning": "Some Claude schedule folders are unavailable. These entries appear under All projects." if any(not item["cwd"] for item in goals) else None}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--home", type=Path, default=Path(os.environ.get("CLAUDE_CONFIG_DIR", Path.home() / ".claude")))
    parser.add_argument("--project", type=Path, action="append", default=[])
    args = parser.parse_args()
    try:
        print(json.dumps(load_schedules(args.home, args.project)))
    except (OSError, ValueError) as error:
        print(json.dumps({"error": f"Could not read Claude schedules: {error}"}))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
