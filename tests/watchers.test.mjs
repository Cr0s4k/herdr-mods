import assert from "node:assert/strict";
import test from "node:test";
import { active, bySpace, unannounced, repoOf, heading, origin, waitingFor, facts, ago, tellTarget } from "../mods/watchers/watchers-model.js";

const pr = (extra = {}) => ({ id: "w1", kind: "pr", until: "review", ref: "https://github.com/acme/site/pull/12", number: 12,
  title: "Add login", cwd: "/work/site", fired: null, ...extra });

test("only finished watchers nobody was told about are announced", () => {
  const items = [pr(), pr({ id: "w2", fired: { title: "PR #12 approved" } }), pr({ id: "w3", fired: { title: "PR #9 merged" } })];
  assert.deepEqual(active(items).map(item => item.id), ["w1"]);
  assert.deepEqual(unannounced(items, ["w3"]).map(item => item.id), ["w2"]);
  assert.deepEqual(unannounced(items, undefined).map(item => item.id), ["w2", "w3"]);
  assert.deepEqual(active(undefined), []);
});

test("a watcher is named after its pull request or its own name", () => {
  assert.equal(heading(pr()), "#12 Add login");
  assert.equal(origin(pr()), "acme/site");
  assert.equal(repoOf("12"), null);
  assert.equal(origin(pr({ ref: "12" })), "site");
  assert.equal(heading({ kind: "command", name: "Deploy is live" }), "Deploy is live");
  assert.equal(waitingFor(pr({ until: "checks" })), "Waiting for its checks to finish");
});

test("the last reading is shown as review and checks lines", () => {
  const state = { review: { state: "required", by: [] }, checks: { passed: 2, failed: [], pending: 1 }, mergeable: "MERGEABLE" };
  assert.deepEqual(facts(pr({ state })), [["Review required", "muted"], ["Checks running, 2 of 3 passed", "working"]]);
  assert.deepEqual(facts(pr({ state: { review: { state: "approved", by: ["ana"] }, checks: { passed: 1, failed: ["lint"], pending: 0 },
    draft: true, mergeable: "CONFLICTING" } })), [["Approved by ana", "ansi2"], ["1 of 2 checks failed: lint", "blocked"],
    ["Draft", "muted"], ["Has conflicts", "blocked"]]);
  assert.deepEqual(facts(pr({ state: { review: { state: "none" }, checks: { passed: 0, failed: [], pending: 0 } } })),
    [["No review yet", "muted"], ["No checks", "muted"]]);
  assert.deepEqual(facts({ kind: "command", state: { code: 7, output: "", errors: "curl: (7) refused" } }),
    [["Exits 7", "muted"], ["curl: (7) refused", "muted"]]);
  assert.deepEqual(facts(pr()), []);
});

test("times read as how long ago", () => {
  const now = 10_000_000;
  assert.equal(ago(null, now), "not yet");
  assert.equal(ago(now - 20_000, now), "just now");
  assert.equal(ago(now - 5 * 60_000, now), "5 min ago");
  assert.equal(ago(now - 3 * 3_600_000, now), "3 h ago");
});

test("watchers sit under the space that holds their folder, the shown space first", () => {
  const spaces = [{ id: "a", name: "herdr-mods", active: true, folder: "/p/herdr-mods", tabs: [{ id: "t1" }] },
    { id: "b", name: "Acme", active: false, folder: "/p/Acme", tabs: [{ id: "t2" }] },
    { id: "c", name: "remote", active: false, folder: "/p/Acme", machine: "vps", tabs: [] }];
  const panes = [{ tab: "t2", cwd: "/worktrees/Acme/task" }];
  const groups = bySpace([pr({ id: "w1", cwd: "/p/Acme" }), pr({ id: "w2", cwd: "/worktrees/Acme/task", fired: { title: "done" } }),
    pr({ id: "w3", cwd: "/p/Acme" }), pr({ id: "w4", cwd: "/p/herdr-mods/mods" }), pr({ id: "w5", cwd: "/elsewhere/site" })], spaces, panes);
  assert.deepEqual(groups.map(group => [group.name, group.current, group.items.map(item => item.id)]),
    [["herdr-mods", true, ["w4"]], ["Acme", false, ["w1", "w3", "w2"]], ["site", false, ["w5"]]]);
  assert.deepEqual(bySpace(undefined, spaces, panes), []);
});

test("a follow-up goes to the focused agent, or the tab's only one, never to a plain terminal", () => {
  const claude = { address: "t1", tab: "a" }, codex = { address: "t2", tab: "a" }, other = { address: "t3", tab: "b" };
  assert.equal(tellTarget([claude, codex, other], { terminal: "t2" }, "a"), codex);
  assert.equal(tellTarget([claude, other], { terminal: "t9" }, "a"), claude);
  assert.equal(tellTarget([claude, other], { terminal: null }, "a"), claude);
  assert.equal(tellTarget([claude, codex], { terminal: "t9" }, "a"), null);
  assert.equal(tellTarget([other], { terminal: "t3" }, "a"), null);
  assert.equal(tellTarget(undefined, null, "a"), null);
});
