#!/usr/bin/env python3
"""Films the other mods on a throwaway repository and saves frames of the Herdr window, five a second.

    record-mods.py <out folder> [--keep]

Same rules as record.py: Herdr open on main-custom, the window shows a throwaway tiny-shop space
for about a minute with the sidebar hidden. Scenes, in order: Show (a screenshot is posted,
marked up, then fixed), Changes (the panel, then a diff in the dialog), Files (the panel, then a
file in the dialog), Since you left (a handoff with a question) and a watcher firing its toast.
Writes frames/NNNNN.png, frames.json and events.json. Everything it made is removed at the end
unless --keep; the side panel goes back to how it was.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

from record import APP, DRIVER, HERE, REPO, Camera, do, herdr, loud_toasts, quiet_toasts

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
BIN = Path.home() / ".local/bin"
FILES = {
    "src/price.js": 'export function formatPrice(cents) {\n  return `$${(cents / 100).toFixed(2)}`;\n}\n',
    "src/coupon.js": 'export function applyCoupon(cents, code) {\n  return code === "SAVE10" ? Math.round(cents * 0.9) : cents;\n}\n',
    "src/shipping.js": "export function shippingCost(cents) {\n  return cents >= 5000 ? 0 : 499;\n}\n",
    "test/price.test.js": 'import assert from "node:assert/strict";\nimport test from "node:test";\nimport { formatPrice } from "../src/price.js";\n\ntest("prices read as dollars", () => {\n  assert.equal(formatPrice(1234), "$12.34");\n});\n',
    "test/coupon.test.js": 'import assert from "node:assert/strict";\nimport test from "node:test";\nimport { applyCoupon } from "../src/coupon.js";\n\ntest("SAVE10 takes 10% off", () => {\n  assert.equal(applyCoupon(1000, "SAVE10"), 900);\n  assert.equal(applyCoupon(1000, "OTHER"), 1000);\n});\n',
    "test/shipping.test.js": 'import assert from "node:assert/strict";\nimport test from "node:test";\nimport { shippingCost } from "../src/shipping.js";\n\ntest("shipping is free from $50", () => {\n  assert.equal(shippingCost(5000), 0);\n  assert.equal(shippingCost(4999), 499);\n});\n',
    "README.md": "# tiny-shop\n\nA tiny cart library: totals, coupons, shipping and price formatting.\n\n```sh\nnpm test\n```\n",
}
CHECKOUT = {
    "src/cart.js": 'import { applyCoupon } from "./coupon.js";\nimport { shippingCost } from "./shipping.js";\n\nexport function total(items) {\n  return items.reduce((sum, item) => sum + item.cents * item.quantity, 0);\n}\n\nexport function checkout(items, code) {\n  const subtotal = applyCoupon(total(items), code);\n  return subtotal + shippingCost(subtotal);\n}\n',
    "test/cart.test.js": 'import assert from "node:assert/strict";\nimport test from "node:test";\nimport { checkout, total } from "../src/cart.js";\n\nconst cart = [{ cents: 1200, quantity: 2 }, { cents: 950, quantity: 1 }, { cents: 300, quantity: 1 }];\n\ntest("total adds up every line", () => {\n  assert.equal(total([{ cents: 250, quantity: 2 }, { cents: 100, quantity: 1 }]), 600);\n});\n\ntest("checkout applies the coupon, then shipping", () => {\n  assert.equal(checkout(cart, "SAVE10"), 3784);\n});\n',
}
MARKS = {"shapes": [
    {"t": "ellipse", "c": "#e5484d", "w": 5, "pts": [[1012, 326], [1132, 394]]},
    {"t": "text", "c": "#e5484d", "size": 26, "text": "should be $37.84", "pts": [[852, 494]]},
], "note": "The total breaks once the coupon applies."}


def make_repo(repo):
    subprocess.run([str(HERE / "make-repo.sh"), str(repo)], check=True, stdout=subprocess.DEVNULL)
    git = lambda *args: subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True)
    for message, paths in [("Format prices", ["src/price.js", "test/price.test.js"]), ("Apply the SAVE10 coupon", ["src/coupon.js", "test/coupon.test.js"]),
                           ("Free shipping from $50", ["src/shipping.js", "test/shipping.test.js"]), ("Write the README", ["README.md"])]:
        for path in paths:
            (repo / path).write_text(FILES[path])
        git("add", "-A")
        git("commit", "-qm", message)
    for path, text in CHECKOUT.items():
        (repo / path).write_text(text)


def shoot(out):
    for state in ("bug", "fixed"):
        subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
                        "--window-size=1200,620", f"--user-data-dir={out / 'chrome'}", f"--screenshot={out / f'cart-{state}.png'}",
                        f"file://{HERE / 'cart.html'}?{state}"], check=True, capture_output=True)
    shutil.rmtree(out / "chrome", ignore_errors=True)


def open_driver(*actions, until):
    (DRIVER / "actions.json").write_text(json.dumps({"key": None, "actions": list(actions)}))
    for _ in range(3):
        do("mod.open", name="video-driver")
        for _ in range(40):
            time.sleep(0.1)
            if until():
                return
    raise RuntimeError(f"The driver did not take {[action['type'] for action in actions]}")


def overlays():
    return herdr("status").get("overlays") or []


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("out", type=Path)
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
    if status.get("overlays"):
        sys.exit("Close Herdr's open dialogs first.")
    home = {"space": status.get("space"), "tab": status.get("tab")}

    make_repo(repo)
    shoot(out)
    if DRIVER.exists():
        shutil.rmtree(DRIVER)
    shutil.copytree(HERE / "driver", DRIVER)
    shutil.copy(REPO / "mods/pipeline/pipeline-model.js", DRIVER)
    subprocess.run(["herdr-app", "check", str(DRIVER)], check=True, stdout=subprocess.DEVNULL)
    open_driver({"type": "panel"}, until=lambda: (DRIVER / "panel.json").exists())
    panel = json.loads((DRIVER / "panel.json").read_text())

    env = {**os.environ, "PATH": f"{BIN}:{os.environ['PATH']}"}
    space = camera = watcher = layout = None
    shown = []
    events = []
    try:
        layout = quiet_toasts()
        before = {row["id"] for row in herdr("ls")["spaces"]}
        do("space.new", name="tiny-shop", folder=str(repo))
        for _ in range(50):
            space = next((row for row in herdr("ls")["spaces"] if row["id"] not in before), None)
            if space:
                break
            time.sleep(0.1)
        if not space:
            raise RuntimeError("The tiny-shop space did not open")
        for _ in range(50):
            space = next(row for row in herdr("ls")["spaces"] if row["id"] == space["id"])
            if space["tabs"] and space["tabs"][0]["terminals"]:
                break
            time.sleep(0.1)
        else:
            raise RuntimeError("The tiny-shop space has no terminal")
        tab = space["tabs"][0]["id"]
        terminal = space["tabs"][0]["terminals"][0]["terminal"]
        env["HC_TERMINAL_ID"] = terminal
        subprocess.run(["herdr-brief", "post", "--terminal", terminal, "--cwd", str(repo),
                        "--title", "Checkout adds up", "--summary", "checkout() applies the coupon, then shipping, and the cart shows $37.84.",
                        "--change", "src/cart.js gains checkout(); the cart test covers it.",
                        "--test", "npm test passes.",
                        "--question", "Should SAVE10 also take 10% off shipping?"], cwd=repo, env=env, capture_output=True, check=True)
        do("layout.hide", id="sidebar")
        do("layout.hide", id="panel")
        subprocess.run(["hc", "send", terminal, "clear && npm test 2>&1 | tail -n 8"], capture_output=True)
        time.sleep(3)

        camera = Camera(out, space["id"], tab)
        camera.start()
        clock = lambda: round(time.time() - camera.started, 2)
        note = lambda kind: (events.append({"t": clock(), "kind": kind}), print(f"{clock():7.1f}s  {kind}", flush=True))
        cli = lambda *argv: json.loads(subprocess.run(argv, cwd=repo, env=env, capture_output=True, text=True, check=True).stdout)
        panel_to = lambda child: (do("layout.select", stack="panel-body", child=child), do("layout.show", id="panel"))

        time.sleep(1.2)
        panel_to("show")
        note("show")
        time.sleep(1.6)
        posted = cli("herdr-show", str(out / "cart-bug.png"), "--title", "Cart page", "--name", "cart.png")["id"]
        shown.append(posted)
        note("show-posted")
        time.sleep(2.2)
        spec = out / "marks.json"
        spec.write_text(json.dumps({"parent": posted, **MARKS}))
        shown.append(cli("herdr-show", "mark", str(spec))["id"])
        note("show-marked")
        time.sleep(2.2)
        shown.append(cli("herdr-show", str(out / "cart-fixed.png"), "--fixes", shown[-1])["id"])
        note("show-fixed")
        time.sleep(2.2)

        panel_to("changes")
        note("changes")
        time.sleep(2.2)
        files = []
        for line in subprocess.run(["git", "-C", str(repo), "diff", "HEAD", "--numstat"], capture_output=True, text=True).stdout.splitlines():
            add, gone, path = line.split("\t")
            files.append({"path": path, "status": "M", "fresh": False, "add": int(add), "del": int(gone), "binary": False})
        open_driver({"type": "overlay", "mod": "changes-modal", "props": {"root": str(repo), "on": None, "hasHead": True, "files": files, "index": 0}},
                    until=lambda: len(overlays()) > 0)
        note("changes-dialog")
        time.sleep(3.2)
        do("overlay.close")
        note("changes-closed")

        panel_to("files")
        note("files")
        time.sleep(2.2)
        listed = sorted(subprocess.run(["git", "-C", str(repo), "ls-files"], capture_output=True, text=True).stdout.split())
        open_driver({"type": "overlay", "mod": "files-modal", "props": {"root": str(repo), "on": None, "files": listed,
                                                                         "index": listed.index("src/cart.js"), "marks": {}}},
                    until=lambda: len(overlays()) > 0)
        note("files-dialog")
        time.sleep(3.2)
        do("overlay.close")
        note("files-closed")

        panel_to("brief")
        note("brief")
        time.sleep(4.2)

        do("layout.hide", id="panel")
        note("watch")
        (repo / "src/cart.js").write_text(CHECKOUT["src/cart.js"].replace("total(items), code", "total(items)"))
        watcher = cli("herdr-watch", "command", "--name", "tiny-shop tests pass", "--every", "15", "--", "npm", "test")["added"]["id"]
        (repo / "src/cart.js").write_text(CHECKOUT["src/cart.js"])
        for _ in range(90):
            time.sleep(0.5)
            mine = next((item for item in cli("herdr-watch", "list")["items"] if item["id"] == watcher), None)
            if mine and mine.get("fired"):
                note("watch-fired")
                break
        else:
            note("watch-timeout")
        time.sleep(4.5)
        note("end")
    finally:
        if camera:
            camera.stop.set()
            camera.join()
            (out / "frames.json").write_text(json.dumps(camera.index))
        (out / "events.json").write_text(json.dumps(events, indent=1))
        loud_toasts(layout)
        if overlays():
            herdr("do", "overlay.close", "{}")
        herdr("do", "layout.show", json.dumps({"id": "sidebar"}))
        if panel.get("active"):
            herdr("do", "layout.select", json.dumps({"stack": "panel-body", "child": panel["active"]}))
        herdr("do", "layout.hide" if panel.get("hidden") else "layout.show", json.dumps({"id": "panel"}))
        if not args.keep:
            if watcher:
                subprocess.run(["herdr-watch", "remove", watcher], env=env, capture_output=True)
            for item in shown:
                for path in [APP / "show/items" / f"{item}.json", *(APP / "show/img").glob(f"{item}.*")]:
                    path.unlink(missing_ok=True)
            for path in (APP / "brief/items").glob("*.json"):
                try:
                    if json.loads(path.read_text()).get("cwd") == str(repo):
                        path.unlink()
                except (OSError, ValueError):
                    pass
            if space:
                herdr("do", "space.close", json.dumps({"id": space["id"], "confirmed": True}))
            if home["space"]:
                herdr("do", "space.select", json.dumps({"id": home["space"]}))
            if home["tab"]:
                herdr("do", "tab.select", json.dumps({"id": home["tab"]}))
            shutil.rmtree(repo, ignore_errors=True)
            shutil.rmtree(DRIVER, ignore_errors=True)
    kinds = [event["kind"] for event in events]
    print(f"{len(camera.index) if camera else 0} frames, {len(kinds)} events, in {out}")
    if "watch-fired" not in kinds:
        sys.exit(1)


if __name__ == "__main__":
    main()
