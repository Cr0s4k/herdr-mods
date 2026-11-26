import assert from "node:assert/strict";
import test from "node:test";
import { homeTab, upkeep, sections, summary, stage } from "../mods/space-home/model.js";

const program = { name: "Claude Code", key: "claude", agent: true };
const space = { id: "app", name: "app", folder: "/work/app", active: true, tabs: [
  { id: "home", name: "Home", named: true }, { id: "one", name: "2", named: false }, { id: "two", name: "fix login", named: true },
  { id: "shell", name: "4", named: false }, { id: "pipe", name: "Pipeline", named: true }, { id: "notes", name: "Notes", named: true }] };
const panes = [
  { pane: "home-pane", mod: "space-home", tab: "home", title: "Home" },
  { pane: "one-pane", terminal: "t1", tab: "one", title: "✳ Rename the export", cwd: "/work/app", branch: "main", program },
  { pane: "two-pane", terminal: "t2", tab: "two", title: "~/work/app", cwd: "/work/app-wt", branch: "fix-login", program },
  { pane: "shell-pane", terminal: "t3", tab: "shell", title: "fish", cwd: "/work/app/web", program: { name: "node", shell: false } },
  { pane: "pipe-pane", mod: "pipeline", tab: "pipe", title: "Pipeline" },
  { pane: "notes-pane", mod: "files-pane", tab: "notes", title: "Files" },
  { pane: "far-pane", terminal: "t9", tab: "far", title: "elsewhere", cwd: "/work/far", program },
];
const agent = (address, tab, status) => ({ address, pane: `${tab}-pane`, space: "app", tab, status, title: panes.find(p => p.tab === tab).title, program });
const agents = [agent("t1", "one", "working"), agent("t2", "two", "blocked"), { ...agent("t9", "far", "blocked"), space: "far" }];
const task = (id, status, extra = {}) => ({ id, title: `Task ${id}`, status, discard: false, terminal: null, ...extra });

test("Home is found by its pane, whatever the tab is called", () => {
  assert.deepEqual(homeTab(space, panes), { ...space.tabs[0], pane: "home-pane" });
  assert.equal(homeTab({ ...space, tabs: space.tabs.slice(1) }, panes), null);
  assert.equal(homeTab(undefined, panes), null);
});

test("a space whose panes aren't known yet is left alone, and extra Homes are closed", () => {
  const bare = { id: "new", tabs: [{ id: "t" }] };
  assert.deepEqual(upkeep([bare], []), []);
  assert.deepEqual(upkeep([{ id: "empty", tabs: [] }], []), []);
  const twice = { id: "s", tabs: [{ id: "a" }, { id: "b" }, { id: "c" }] };
  const ps = [{ pane: "pa", mod: "space-home", tab: "a" }, { pane: "pb", terminal: "x", tab: "b" }, { pane: "pc", mod: "space-home", tab: "c" }];
  assert.deepEqual(upkeep([twice], ps), [["tab.close", { id: "c", confirmed: true }]]);
});

test("a refused command is asked again only after a while", () => {
  const bare = { id: "new", tabs: [{ id: "t" }] }, ps = [{ pane: "p", terminal: "x", tab: "t" }], asked = {};
  assert.equal(upkeep([bare], ps, { asked, now: 1000 }).length, 1);
  assert.equal(upkeep([bare], ps, { asked, now: 2000 }).length, 0);
  assert.equal(upkeep([bare], ps, { asked, now: 5000 }).length, 1);
});

test("what needs you comes first, then agents, Pipeline, terminals and other tabs, and recent conversations", () => {
  const pipeline = { pane: panes[4], key: "k", state: { running: true, tasks: [
    task("T-1", "done"), task("T-2", "queued"), task("T-3", "review"), task("T-4", "input", { terminal: "t2" }),
    task("T-5", "failed", { reason: "checks" }), task("T-6", "working", { terminal: "t1" }), task("T-7", "review", { discard: true })] } };
  const terminals = [{ p: panes[3], tab: space.tabs[3], index: 4, running: "node", label: "web" }];
  const parts = sections({ space, panes, agents, terminals, pipeline, sessions: [{ id: "s1", title: "Earlier", agent: "claude", at: 1 }],
    briefs: [{ space: "app", terminal: "t2", time: 1, title: "Old" }, { space: "app", terminal: "t2", time: 2, title: "Login fixed" }, { space: "far", terminal: "t1", time: 9, title: "Not here" }] });
  assert.deepEqual(parts.map(section => [section.id, section.rows.map(row => row.key)]), [
    ["needs", ["agent:t2", "task:T-5", "task:T-3"]],
    ["agents", ["agent:t1"]],
    ["pipeline", ["pipeline", "task:T-2"]],
    ["terminals", ["term:shell-pane", "pane:notes-pane"]],
    ["recent", ["session:s1"]],
  ]);
  const [asking] = parts[0].rows, [working] = parts[1].rows;
  assert.deepEqual([asking.name, asking.detail, asking.stage, asking.branch], ["fix login", "Task T-4", "Needs you", "fix-login"]);
  assert.deepEqual([working.name, working.detail, working.stage], ["Rename the export", "Task T-6", "Working"]);
  assert.equal(parts[3].rows[1].name, "Notes");
  assert.equal(summary(parts), "3 need you · 1 working");
  assert.equal(stage(task("T", "failed")), "Stopped");
});

test("an agent with no Pipeline task says its last brief, and an empty space lists nothing", () => {
  const parts = sections({ space, panes, agents, briefs: [{ space: "app", terminal: "t1", time: 2, title: "Export renamed" }] });
  assert.equal(parts.find(section => section.id === "agents").rows[0].detail, "Export renamed");
  assert.deepEqual(sections({ space: { ...space, tabs: [space.tabs[0]] }, panes, agents: [] }), []);
  assert.equal(summary([]), "");
});
