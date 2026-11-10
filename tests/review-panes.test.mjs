import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const world = {};
const preferences = new Map();
globalThis.__reviewNative = {
  spaces: () => world.spaces,
  panes: () => world.panes,
  terminals: () => world.terminals,
  focused: () => world.focus,
  setShared: (key, value) => preferences.set(key, value),
  notify: message => world.notices.push(message),
  run: (name, args) => {
    world.calls.push([name, args]);
    if (name === "pane.split") world.panes.push({ pane: "review", mod: args.mod, tab: "tab" });
    if (name === "pane.focus") world.focus.pane = args.pane;
    if (name === "terminal.keep" || name === "terminal.open") {
      world.panes.push({ pane: "shell", terminal: args.terminal ?? "new-shell", tab: "tab" });
    }
    if (name === "pane.close") world.panes = world.panes.filter(p => p.pane !== args.pane);
  },
};
let source = (await readFile(new URL("../mods/tabs-show/review.js", import.meta.url), "utf8")).replace(/^import .*;\n/gm, "");
source = "const { spaces, panes, terminals, focused, setShared, run, notify } = globalThis.__reviewNative;\n" + source;
const { ReviewPanes } = await import("data:text/javascript," + encodeURIComponent(source));

function setup() {
  Object.assign(world, {
    spaces: [{ id: "space", active: true, folder: "/stale", tabs: [{ id: "tab", active: true }] }],
    panes: [{ pane: "agent", terminal: "agent-terminal", tab: "tab", cwd: "/live", program: { agent: true } }],
    terminals: [], focus: { pane: "agent", tab: "tab" }, calls: [], notices: [], tasks: [],
  });
  preferences.clear();
  return new ReviewPanes();
}
const cx = { spawn: fn => world.tasks.push(fn(cx)), sleep: async () => {}, notify() {} };

test("creates two normal panes, starts in the live folder and restores the agent's focus", async () => {
  const view = setup();
  view.open(cx);
  await Promise.all(world.tasks);
  assert.deepEqual(world.calls, [
    ["layout.hide", { id: "panel" }],
    ["pane.split", { pane: "agent", direction: "right", mod: "review-pane", props: { tab: "tab" } }],
    ["pane.focus", { pane: "review" }],
    ["terminal.open", { folder: "/live", place: "down" }],
    ["pane.focus", { pane: "agent" }],
  ]);
  assert.equal(world.panes.length, 3);
  assert.equal(world.notices.length, 0);
});

test("migrates the previous block's shell without restarting it", async () => {
  const view = setup();
  world.terminals.push({ address: "kept", state: "live", labels: { "herdr.mods.panel-terminal": "space" } });
  view.open(cx);
  await Promise.all(world.tasks);
  assert.ok(world.calls.some(([name, args]) => name === "terminal.keep" && args.terminal === "kept" && args.place === "down"));
  assert.ok(!world.calls.some(([name]) => name === "terminal.open"));
});

test("focusing an existing review preserves the side panel and terminal", async () => {
  const view = setup();
  view.open(cx);
  await Promise.all(world.tasks);
  world.calls = [];
  view.open(cx);
  assert.deepEqual(world.calls, [["pane.focus", { pane: "review" }]]);
  assert.equal(world.panes.length, 3);
});

test("repeated clicks during opening do not create extra panes", async () => {
  const view = setup();
  view.open(cx);
  view.open(cx);
  await Promise.all(world.tasks);
  assert.equal(world.calls.filter(([name]) => name === "pane.split").length, 1);
  assert.equal(world.panes.length, 3);
});

test("switching tabs during opening never puts the companion shell in another tab", async () => {
  const view = setup();
  view.open(cx);
  world.focus = { tab: "another-tab", pane: "another-pane" };
  await Promise.all(world.tasks);
  assert.ok(!world.calls.some(([name]) => name === "terminal.open" || name === "terminal.keep"));
  assert.ok(world.calls.some(([name, args]) => name === "pane.close" && args.pane === "review"));
  assert.ok(!world.panes.some(p => p.pane === "review"));
  assert.equal(view.opening.size, 0);
  assert.equal(world.notices.length, 1);
});

// Exercise the real tab-bar controls too: Files must never start the review workflow.
function element() {
  const target = { nodes: [], styles: {}, handlers: {} };
  let el;
  el = new Proxy(target, { get(t, key) {
    if (key in t) return t[key];
    if (key === "child") return child => { t.nodes.push(child); return el; };
    if (key === "children") return children => { t.nodes.push(...children); return el; };
    if (key === "when") return (condition, apply) => condition ? apply(el) : el;
    if (key.startsWith("on_")) return (...args) => { t.handlers[key.slice(3)] = args.at(-1); return el; };
    return (...args) => { t.styles[key] = args; return el; };
  } });
  return el;
}
Object.assign(globalThis.__reviewNative, {
  View: class {}, div: element, svg: element, image: element, h_flex: element, ReviewPanes,
  Button: { new: id => element().id(id) },
  GitHubRepo: class { constructor() { this.opening = false; } }, repositoryContext: () => ({ cwd: null }),
  shared: key => preferences.get(key),
  layout: () => world.layout,
  window: () => ({ platform: "macos" }), settings: () => ({ zoom: 1 }),
  theme: () => new Proxy({}, { get: (_, key) => key }),
  BriefTracker: class { start() {} observe() {} },
  LaunchTracker: class { start() {} },
  PipelineTracker: class { start() {} }, PIPELINES: "pipeline.prototype.v1",
  ACTIVITY: "brief.activity", REPORTS: "brief.reports", entriesFor: () => [], unreadFor: () => [], receipt: id => `brief.read.${id}`,
});
globalThis.localStorage = { getItem: key => preferences.get(key) ?? null, setItem: (key, value) => preferences.set(key, value) };
source = (await readFile(new URL("../mods/tabs-show/main.js", import.meta.url), "utf8")).replace(/^import .*;\n/gm, "");
source = "const { View, div, svg, image, h_flex, Button, spaces, panes, focused, run, theme, window, shared, layout, settings, ReviewPanes, GitHubRepo, repositoryContext, BriefTracker, LaunchTracker, PipelineTracker, PIPELINES, ACTIVITY, REPORTS, entriesFor, unreadFor, receipt } = globalThis.__reviewNative;\n" + source;
const { default: Tabs } = await import("data:text/javascript," + encodeURIComponent(source));
function setupTabs() {
  setup();
  world.layout = { id: "root", children: [{ id: "panel", hidden: true, children: [{ id: "panel-body", active: "files" }] }] };
  const tabs = new Tabs();
  tabs.init({}, { spawn() {} });
  return tabs;
}
function find(el, id) {
  return el?.styles?.id?.[0] === id ? el : (el?.nodes ?? []).map(child => find(child, id)).find(Boolean);
}
function text(el) { return typeof el === "string" ? el : (el?.nodes ?? []).map(text).join(" "); }

test("Files, Changes, Show, Loops, Brief, Skills and Tasks toggle side panels without creating panes", () => {
  const tabs = setupTabs(), root = tabs.render();
  for (const id of ["files", "changes", "show", "loops", "brief", "skills", "plane"]) {
    world.calls = [];
    find(root, `panel-${id}`).handlers.click({}, cx);
    assert.deepEqual(world.calls, [
      ["layout.select", { stack: "panel-body", child: id }],
      ["layout.show", { id: "panel" }],
    ]);
  }
  world.layout.children[0].hidden = false;
  world.calls = [];
  find(tabs.render(), "panel-files").handlers.click({}, cx);
  assert.deepEqual(world.calls, [["layout.hide", { id: "panel" }]]);
  assert.equal(world.tasks.length, 0);
});

test("the normal Changes side panel can close and restore per space independently of review panes", () => {
  const tabs = setupTabs();
  world.layout.children[0].hidden = false;
  world.layout.children[0].children[0].active = "changes";
  world.panes.push({ pane: "review", mod: "review-pane", tab: "tab" });
  let root = tabs.render();
  assert.equal(find(root, "panel-changes").styles.bg[0], "selected");
  assert.match(text(find(root, "review-changes")), /Focus changes/);
  world.calls = [];
  find(root, "panel-changes").handlers.click({}, cx);
  assert.deepEqual(world.calls, [["layout.hide", { id: "panel" }]]);
  assert.equal(world.panes.length, 2);

  // The remembered Changes panel remains a valid choice when returning to a space.
  world.layout.children[0].hidden = true;
  tabs.space = "another-space";
  world.calls = [];
  root = tabs.render();
  assert.deepEqual(world.calls, [
    ["layout.select", { stack: "panel-body", child: "changes" }],
    ["layout.show", { id: "panel" }],
  ]);
});

test("Changes is a distinct action that explains the terminal before opening", async () => {
  const tabs = setupTabs(), root = tabs.render(), button = find(root, "review-changes");
  assert.match(find(root, "panel-changes").styles.tooltip[0], /Changes side panel/);
  assert.match(text(button), /Changes \+ terminal/);
  assert.match(button.styles.tooltip[0], /terminal underneath in this tab/);
  button.handlers.click({}, cx);
  assert.match(text(find(tabs.render(), "review-changes")), /Opening/);
  await Promise.all(world.tasks);
  assert.match(text(find(tabs.render(), "review-changes")), /Focus changes/);
  assert.equal(world.panes.length, 3);
});

test("Pipeline opens as a mod-only tab and focuses an existing view without duplicating it", () => {
  const tabs = setupTabs();
  find(tabs.render(), "open-pipeline").handlers.click({}, cx);
  assert.equal(world.calls.at(-1)[0], "tab.new");
  assert.equal(world.calls.at(-1)[1].mod, "pipeline");
  assert.equal(world.calls.at(-1)[1].props.context.cwd, "/stale");
  assert.ok(!world.calls.at(-1)[1].argv);
  world.spaces[0].tabs.push({ id: "pipeline-tab", active: false });
  world.panes.push({ pane: "pipeline-pane", mod: "pipeline", tab: "pipeline-tab" });
  world.calls = [];
  find(tabs.render(), "open-pipeline").handlers.click({}, cx);
  assert.deepEqual(world.calls, [["tab.select", { id: "pipeline-tab" }], ["pane.focus", { pane: "pipeline-pane" }]]);
});

test("the Pipeline button counts simulated tasks waiting for an answer", () => {
  const tabs = setupTabs();
  assert.doesNotMatch(text(find(tabs.render(), "open-pipeline")), /Needs you/);
  preferences.set("pipeline.prototype.v1", {
    a: { tasks: [{ id: "A", status: "input" }, { id: "B", status: "working" }] },
    b: { tasks: [{ id: "C", status: "input" }] },
  });
  try { assert.match(text(find(tabs.render(), "open-pipeline")), /Needs you 2/); }
  finally { preferences.delete("pipeline.prototype.v1"); }
});
