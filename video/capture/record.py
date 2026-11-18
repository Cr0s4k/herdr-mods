#!/usr/bin/env python3
"""Runs a real Pipeline session on a throwaway repository and saves frames of the Herdr window, five a second.

    record.py <out folder> [--model sonnet] [--keep]

Herdr must be open on the main-custom layout. The window shows the throwaway space for the
whole run (a few minutes) and the sidebar is hidden meanwhile, so nothing of the person's own
spaces is in a frame. Writes frames/NNNNN.png, frames.json (file and second of each frame) and
events.json (what happened when). Everything it made is removed at the end unless --keep.

An agent that stops to ask something gets Enter after a few seconds, which accepts the first
option of a permission prompt. That is only safe because the repository is a throwaway.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
APP = Path(os.environ.get("HERDR_APP_HOME", Path.home() / ".config/herdr-app"))
DRIVER = APP / "mods/video-driver"
STORE = "pipeline.prototype.v1"
TASKS = [
    "Format prices as $12.34. Add formatPrice(cents) in src/price.js and cover it in test/price.test.js.",
    "Apply the SAVE10 coupon. Add applyCoupon(cents, code) in src/coupon.js: SAVE10 takes 10% off, any other code changes nothing. Cover it in test/coupon.test.js.",
    "Free shipping from $50. Add shippingCost(cents) in src/shipping.js: free from $50, otherwise $4.99. Cover it in test/shipping.test.js.",
    "Write the README. Say what tiny-shop is and how to run its tests, in README.md.",
]
REVIEW_HOLD = 5
ANSWER_AFTER = 6
LIMIT = 15 * 60


def herdr(*args):
    result = subprocess.run(["herdr-app", *args], capture_output=True, text=True)
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return {"error": (result.stdout + result.stderr).strip()}


def do(command, **args):
    answer = herdr("do", command, json.dumps(args))
    if isinstance(answer, dict) and answer.get("error"):
        raise RuntimeError(f"{command}: {answer['error']}")
    return answer


def saved(key):
    for _ in range(5):
        try:
            return json.loads((APP / "shared.json").read_text()).get(STORE, {}).get(key)
        except (json.JSONDecodeError, FileNotFoundError):
            time.sleep(0.1)
    return None


def drive(key, *actions, gone=False):
    before = json.dumps(saved(key), sort_keys=True)
    (DRIVER / "actions.json").write_text(json.dumps({"key": key, "actions": list(actions)}))
    for _ in range(3):
        do("mod.open", name="video-driver")
        for _ in range(40):
            time.sleep(0.1)
            now = saved(key)
            if (now is None) if gone else (json.dumps(now, sort_keys=True) != before):
                return now
    raise RuntimeError(f"Pipeline did not take {[action['type'] for action in actions]}")


class Camera(threading.Thread):
    def __init__(self, out, space, tab):
        super().__init__(daemon=True)
        self.frames, self.space, self.tab = out / "frames", space, tab
        self.frames.mkdir(parents=True, exist_ok=True)
        self.index, self.started, self.stop = [], time.time(), threading.Event()

    def run(self):
        while not self.stop.is_set():
            began = time.time()
            if len(self.index) % 5 == 0:
                status = herdr("status")
                if status.get("space") != self.space:
                    herdr("do", "space.select", json.dumps({"id": self.space}))
                if status.get("tab") != self.tab:
                    herdr("do", "tab.select", json.dumps({"id": self.tab}))
            name = f"{len(self.index):05d}.png"
            shot = subprocess.run(["herdr-app", "shot", str(self.frames / name)], capture_output=True)
            if shot.returncode == 0 and (self.frames / name).exists():
                self.index.append({"file": name, "t": round(began - self.started, 2)})
            time.sleep(max(0, 0.2 - (time.time() - began)))


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("out", type=Path)
    parser.add_argument("--model", default="sonnet")
    parser.add_argument("--keep", action="store_true", help="leave the space, repository and driver in place")
    args = parser.parse_args()
    out = args.out.resolve()
    if (out / "frames").exists():
        shutil.rmtree(out / "frames")
    out.mkdir(parents=True, exist_ok=True)
    repo = out / "tiny-shop"

    status = herdr("status")
    if status.get("error") or status.get("errors"):
        sys.exit(f"Herdr is not ready: {status.get('error') or status.get('errors')}")
    home = {"space": status.get("space"), "tab": status.get("tab")}

    subprocess.run([str(HERE / "make-repo.sh"), str(repo)], check=True, stdout=subprocess.DEVNULL)
    if DRIVER.exists():
        shutil.rmtree(DRIVER)
    shutil.copytree(HERE / "driver", DRIVER)
    shutil.copy(REPO / "mods/pipeline/pipeline-model.js", DRIVER)
    subprocess.run(["herdr-app", "check", str(DRIVER)], check=True, stdout=subprocess.DEVNULL)

    space = key = camera = None
    events = []
    try:
        before = {row["id"] for row in herdr("ls")["spaces"]}
        do("space.new", name="tiny-shop", folder=str(repo))
        for _ in range(50):
            space = next((row["id"] for row in herdr("ls")["spaces"] if row["id"] not in before), None)
            if space:
                break
            time.sleep(0.1)
        if not space:
            raise RuntimeError("The tiny-shop space did not open")
        ident = json.dumps([None, str(repo), space], separators=(",", ":"))
        key = "live:" + ident
        tab = do("tab.new", space=space, name="Pipeline", mod="pipeline",
                 props={"context": {"id": ident, "cwd": str(repo), "on": None, "name": "tiny-shop", "space": space}})["tab"]
        for _ in range(100):
            if saved(key):
                break
            time.sleep(0.1)
        else:
            raise RuntimeError("Pipeline did not open on the repository")
        do("layout.hide", id="sidebar")

        state = saved(key)
        setup = [{"type": "agent", "key": "claude"}, {"type": "tune", "key": "claude", "model": args.model, "effort": None},
                 {"type": "check", "command": "npm test"}, {"type": "parallel", "value": 3},
                 {"type": "plannerSetup", "on": True, "agent": "claude", "model": "haiku"}, {"type": "setupDone"}]
        if not state.get("autoTrust"):
            setup.append({"type": "autoTrust"})
        drive(key, *setup)

        camera = Camera(out, space, tab)
        camera.start()
        clock = lambda: round(time.time() - camera.started, 2)
        note = lambda kind, **more: (events.append({"t": clock(), "kind": kind, **more}), print(f"{clock():7.1f}s  {kind} {more or ''}", flush=True))

        time.sleep(2.5)
        for text in TASKS:
            drive(key, {"type": "create", "title": text})
            note("added", title=text.split(".")[0])
            time.sleep(1.6)
        time.sleep(1.5)
        drive(key, {"type": "run", "space": space})
        note("started")

        seen, since, answered = {}, {}, {}
        while clock() < LIMIT:
            time.sleep(1)
            state = saved(key) or {}
            tasks = state.get("tasks", [])
            for task in tasks:
                if seen.get(task["id"]) != task["status"]:
                    seen[task["id"]] = task["status"]
                    since[task["id"]] = time.time()
                    note(task["status"], id=task["id"], **({"error": task["error"]} if task.get("error") else {}))
            if tasks and all(task["status"] in ("done", "failed") for task in tasks):
                break
            for task in tasks:
                asked = task["status"] == "input" and task.get("terminal") and time.time() - since[task["id"]] >= ANSWER_AFTER
                if asked and answered.get(task["id"]) != since[task["id"]]:
                    answered[task["id"]] = since[task["id"]]
                    subprocess.run(["hc", "keys", task["terminal"], "enter"], capture_output=True)
                    note("answered", id=task["id"])
            merging = any(task["status"] == "merging" or (task["status"] == "review" and task.get("approvals")) for task in tasks)
            ready = [task for task in tasks if task["status"] == "review" and time.time() - since[task["id"]] >= REVIEW_HOLD]
            if ready and not merging:
                drive(key, {"type": "approve", "id": ready[0]["id"]})
                note("approved", id=ready[0]["id"])
        else:
            note("timeout")
        time.sleep(6)
    finally:
        if camera:
            camera.stop.set()
            camera.join()
            (out / "frames.json").write_text(json.dumps(camera.index))
        (out / "events.json").write_text(json.dumps(events, indent=1))
        herdr("do", "layout.show", json.dumps({"id": "sidebar"}))
        if not args.keep:
            if space:
                herdr("do", "space.close", json.dumps({"id": space, "confirmed": True}))
            if home["space"]:
                herdr("do", "space.select", json.dumps({"id": home["space"]}))
            if home["tab"]:
                herdr("do", "tab.select", json.dumps({"id": home["tab"]}))
            if key and saved(key):
                try:
                    drive(key, {"type": "forget"}, gone=True)
                except RuntimeError as error:
                    print(error, file=sys.stderr)
            listed = subprocess.run(["git", "-C", str(repo), "worktree", "list", "--porcelain"], capture_output=True, text=True).stdout
            for line in listed.splitlines():
                path = line.removeprefix("worktree ")
                if line.startswith("worktree ") and Path(path) != repo and "/.herdr/worktrees/" in path:
                    shutil.rmtree(path, ignore_errors=True)
            shutil.rmtree(repo, ignore_errors=True)
            shutil.rmtree(DRIVER, ignore_errors=True)
    done = sum(1 for event in events if event["kind"] == "done")
    print(f"{len(camera.index) if camera else 0} frames, {done} of {len(TASKS)} tasks merged, in {out}")
    if done < len(TASKS):
        sys.exit(1)


if __name__ == "__main__":
    main()
