import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Run the actual native views against live-data snapshots. Exercise actions
// and async-free render paths that Herdr's initial mod check can't cover.
const world = { spaces: [], panes: [], agents: [], terminals: [], calls: [], order: [], width: 268 };
const preferences = new Map(), sharedState = new Map();
globalThis.localStorage = {
  getItem: k => preferences.get(k) ?? null,
  setItem: (k, v) => preferences.set(k, v),
};
function element() {
  const target = { nodes: [], handlers: {}, styles: {} };
  let el;
  el = new Proxy(target, { get(t, key) {
    if (key in t) return t[key];
    if (key === "child") return child => { t.nodes.push(child); return el; };
    if (key === "children") return children => { t.nodes.push(...children); return el; };
    if (key === "when") return (condition, apply) => condition ? apply(el) : el;
    if (key.startsWith("on_")) return (...args) => { t.handlers[key.slice(3) + (args.length > 1 ? `-${args[0]}` : "")] = args.at(-1); return el; };
    return (...args) => { t.styles[key] = args; return el; };
  } });
  return el;
}
const cx = { notify() {}, stop_propagation() {}, spawn() {}, timer: { every() {} }, focus_handle() { return { focus() {}, is_focused: () => false }; } };
globalThis.__spacesNative = {
  View: class {}, div: element, svg: element, image: element, h_flex: element, v_flex: element,
  ScrollHandle: { new: () => ({ scroll_to_item() {} }) },
  spaces: () => world.spaces, panes: () => world.panes, agents: () => world.agents,
  terminals: () => world.terminals, focused: () => ({ agent: world.agents.find(a => a.focused)?.address }),
  exec: (...args) => world.exec(...args),
  machines: () => [], run: (...args) => world.calls.push(args),
  setAgentOrder: order => { world.order = order; },
  theme: () => new Proxy({}, { get: (_, key) => key }),
  shared: k => sharedState.get(k), setShared: (k, v) => sharedState.set(k, v),
  props: () => world.menu, keys: () => [], closeOverlay: id => world.closed.push(id), openOverlay: options => world.opened.push(options),
  window: () => ({ active: true, platform: "macos" }), layout: () => ({ id: "sidebar", size: { px: world.width } }),
};
let source = (await readFile(new URL("../mods/space-hide/state.js", import.meta.url), "utf8")).replace(/^import .*;\n/gm, "");
source = "const { shared, setShared } = globalThis.__spacesNative;\n" + source;
const hideState = await import("data:text/javascript," + encodeURIComponent(source));
Object.assign(globalThis.__spacesNative, hideState);
source = (await readFile(new URL("../mods/tabs-show/ui.js", import.meta.url), "utf8")).replace(/^import .*;\n/gm, "");
source = "const { exec } = globalThis.__spacesNative;\n" + source;
Object.assign(globalThis.__spacesNative, await import("data:text/javascript," + encodeURIComponent(source)));
source = (await readFile(new URL("../mods/spaces-pin/agent-tree.js", import.meta.url), "utf8"))
  .replace(/^import .*;\n/gm, "");
source = "const { div, image, svg, h_flex, v_flex, agents, terminals, focused, run, setAgentOrder, spin } = globalThis.__spacesNative;\n" + source;
const { AgentTree, branch } = await import("data:text/javascript," + encodeURIComponent(source));
Object.assign(globalThis.__spacesNative, { AgentTree, branch });
const { STORE, LIVE, spaceKey } = await import("../mods/pipeline/pipeline-model.js");
globalThis.__spacesNative.spaceKey = spaceKey;
source = (await readFile(new URL("../mods/spaces-pin/pipeline-row.js", import.meta.url), "utf8")).replace(/^import .*;\n/gm, "");
source = `const { div, svg, h_flex, run, shared, openOverlay, spaceKey } = globalThis.__spacesNative; const STORE = ${JSON.stringify(STORE)};\n` + source;
Object.assign(globalThis.__spacesNative, await import("data:text/javascript," + encodeURIComponent(source)));
source = (await readFile(new URL("../mods/spaces-pin/terminal-row.js", import.meta.url), "utf8")).replace(/^import .*;\n/gm, "");
source = "const { div, svg, h_flex, run } = globalThis.__spacesNative;\n" + source;
Object.assign(globalThis.__spacesNative, await import("data:text/javascript," + encodeURIComponent(source)));
Object.assign(globalThis.__spacesNative, await import("../mods/spaces-pin/tidy.js"));
source = (await readFile(new URL("../mods/spaces-pin/recent.js", import.meta.url), "utf8")).replace(/^import .*;\n/gm, "");
source = "const { div, svg, h_flex } = globalThis.__spacesNative;\n" + source;
const recent = await import("data:text/javascript," + encodeURIComponent(source));
Object.assign(globalThis.__spacesNative, recent, { readTextFile: async () => "script", appHome: () => "/home", knownAgents: async () => world.known ?? [] });
source = (await readFile(new URL("../mods/spaces-pin/main.js", import.meta.url), "utf8"))
  .replace(/^import .*;\n/gm, "");
source = "const { View, div, svg, v_flex, h_flex, ScrollHandle, spaces, machines, panes, run, theme, shared, setShared, window, layout, AgentTree, branch, openOverlay, hiddenSpaces, expireSpaces, ink, watchMotion, nextCommand, spacePipeline, pipelineRow, openPipeline, taskStages, recentHeader, sessionRow, closedSessions, resumeArgs, readTextFile, appHome, knownAgents, spaceTerminals, terminalRow, touch, quietSpaces, TRACES, sessions, exec } = globalThis.__spacesNative;\n" + source;
const { default: Spaces } = await import("data:text/javascript," + encodeURIComponent(source));
const { reduce, forgettable } = await import("../mods/pipeline/pipeline-model.js");
source = (await readFile(new URL("../mods/pipeline-close/main.js", import.meta.url), "utf8")).replace(/^import .*;\n/gm, "");
source = `const { View, div, svg, v_flex, h_flex, run, props, shared, setShared, closeOverlay, theme } = globalThis.__spacesNative; const STORE = ${JSON.stringify(STORE)}, reduce = globalThis.__pipelineReduce, forgettable = globalThis.__pipelineForgettable;\n` + source;
globalThis.__pipelineReduce = reduce; globalThis.__pipelineForgettable = forgettable;
const { default: PipelineClose, closeDetail } = await import("data:text/javascript," + encodeURIComponent(source));
source = (await readFile(new URL("../mods/menu-pin/main.js", import.meta.url), "utf8")).replace(/^import .*;\n/gm, "");
source = "const { View, div, svg, v_flex, h_flex, run, props, shared, setShared, closeOverlay, openOverlay, theme, keys, terminals, spaces, panes } = globalThis.__spacesNative;\n" + source;
const { default: Menu } = await import("data:text/javascript," + encodeURIComponent(source));
globalThis.__spacesNative.Input = { new: element };
globalThis.__spacesNative.InputState = { new: options => ({ text: options.value ?? "", handlers: {},
  on(event, fn) { this.handlers[event] = fn; }, value() { return this.text; }, focus() {} }) };
source = (await readFile(new URL("../mods/space-hide/main.js", import.meta.url), "utf8")).replace(/^import .*;\n/gm, "");
source = "const { View, div, svg, v_flex, h_flex, Input, InputState, props, spaces, theme, closeOverlay, openOverlay, hiddenSpaces, expireSpaces, hideSpace, restoreSpace, localTime, parseLocalTime, hideChoices } = globalThis.__spacesNative;\n" + source;
const { default: SpaceHide } = await import("data:text/javascript," + encodeURIComponent(source));
const program = { name: "Codex", key: "codex", icon: "icons/codex.png", agent: true };
const space = (id, active = false) => ({ id, name: id, folder: `/work/${id}`, active, tabs: [{ id: `${id}-tab`, name: "1", named: false }] });
const agent = (id, sp, status = "idle", extra = {}) => ({ address: id, pane: `${id}-pane`, space: sp, tab: `${sp}-tab`, tab_index: 1,
  title: `Task ${id}`, status, program, pinned: false, focused: false, ...extra });
function setup() {
  preferences.clear(); sharedState.clear();
  Object.assign(world, { spaces: [space("app", true), space("other")], panes: [], agents: [agent("one", "app", "working"), agent("two", "other")],
    terminals: [], calls: [], order: [], width: 268, menu: null, closed: [], opened: [] });
  const view = new Spaces(); view.init({}, cx); return view;
}
function find(el, id) { return el?.styles?.id?.[0] === id ? el : (el?.nodes ?? []).map(n => find(n, id)).find(Boolean); }
function text(el) { return typeof el === "string" ? el : (el?.nodes ?? []).map(text).join(" "); }
function click(root, id) { const el = find(root, id); assert.ok(el, `Missing ${id}`); el.handlers.click({}, cx); }

test("the sidebar plus opens the space choices without starting a terminal", () => {
  const view = setup();
  click(view.render(), "space-new");
  assert.deepEqual(world.calls, []);
  assert.deepEqual(world.opened, [{ mod: "space-new", kind: "popup", width: 300, height: 114 }]);
});

test("one tree places agents inside their owning space and focuses the exact pane", () => {
  const view = setup(), root = view.render();
  assert.ok(find(find(root, "space-tree-app"), "ag-one"));
  assert.equal(find(find(root, "space-tree-app"), "ag-two"), undefined);
  assert.ok(find(find(root, "space-tree-other"), "ag-two"));
  click(root, "ag-two");
  assert.deepEqual(world.calls, [["pane.focus", { pane: "two-pane" }]]);
  assert.deepEqual(world.order, ["one", "two"]);
});

test("space chevrons persist folds without switching focus or losing keyboard navigation", () => {
  const view = setup();
  click(view.render(), "space-fold-app");
  const root = view.render();
  assert.equal(find(root, "ag-one"), undefined);
  assert.ok(find(root, "space-app"));
  assert.deepEqual(world.calls, []);
  assert.deepEqual(world.order, ["one", "two"]);
  const restored = new Spaces(); restored.init({}, cx);
  assert.equal(find(restored.render(), "ag-one"), undefined);
  click(root, "space-fold-app");
  assert.ok(find(view.render(), "ag-one"));
});

test("hidden subagents raise space urgency and the filter reveals their full ancestry", () => {
  const view = setup();
  world.terminals = [{ address: "child", parent: "one", state: "live", status: "error", name: "Approval", program },
    { address: "quiet", parent: "one", state: "live", status: "working", program }];
  let root = view.render();
  assert.equal(find(root, "ag-child"), undefined);
  assert.deepEqual(view.agents.summary(["app"]), { status: "blocked", count: 1, blocked: 1 });
  click(root, "space-fold-app");
  click(view.render(), "spaces-needs-you");
  root = view.render();
  assert.ok(find(root, "ag-one"));
  assert.ok(find(root, "ag-child"));
  assert.equal(find(root, "ag-quiet"), undefined);
  assert.equal(find(root, "space-other"), undefined);
  click(root, "ag-child");
  assert.deepEqual(world.calls, [["terminal.peek", { terminal: "child" }]]);
  click(root, "spaces-needs-you");
  assert.equal(find(view.render(), "ag-one"), undefined);
});

test("statuses appear on agents, space rows stay quiet, and completed subagents do not create unread work", () => {
  const view = setup(); world.agents[0].status = "done";
  world.terminals = [{ address: "child", parent: "one", state: "live", status: "done", program }];
  click(view.render(), "space-fold-app");
  const root = view.render();
  assert.equal(find(root, "ag-one"), undefined);
  assert.equal(view.agents.summary(["app"]).count, 1);
  assert.equal(text(find(root, "space-app")).trim(), "A app");
  click(root, "space-fold-app");
  assert.equal(find(view.render(), "ag-one").styles.accessibility_label[0], "Task one, Done");
  world.agents[0].status = "idle";
  assert.equal(find(view.render(), "ag-one").styles.accessibility_label[0], "Task one, Idle");
  assert.equal(view.agents.summary(["app"]).status, "idle");
});

test("agent pins reorder only their own space and status changes never reorder agents", () => {
  const view = setup();
  world.agents = [agent("one", "app"), agent("three", "app", "working", { pinned: true }), agent("two", "other")];
  let root = view.render();
  assert.deepEqual(world.order, ["three", "one", "two"]);
  click(root, "agent-pin-three");
  assert.deepEqual(world.calls, [["terminal.pin", { terminal: "three", pinned: false }]]);
  world.agents[0].status = "blocked"; view.render();
  assert.deepEqual(world.order, ["three", "one", "two"]);
});

test("kept subagents appear once, in their own space, and cyclic terminal metadata is bounded", () => {
  const view = setup();
  world.agents.push(agent("child", "other", "blocked"));
  world.terminals = [{ address: "child", parent: "one", state: "live", status: "blocked" },
    { address: "cycle", parent: "cycle", state: "live", status: "working" }];
  const root = view.render();
  assert.equal(find(find(root, "space-tree-app"), "ag-child"), undefined);
  assert.ok(find(find(root, "space-tree-other"), "ag-child"));
  assert.equal(view.agents.summary(["app"]).blocked, 0);
  assert.ok(view.agents.descendants("cycle").length <= 1);
});

test("named tabs win, path-like titles fall back to the program, and split agents have unique labels", () => {
  const view = setup();
  world.spaces[0].tabs[0] = { id: "app-tab", name: "Review", named: true };
  world.agents = [agent("one", "app"), agent("split", "app"), agent("two", "other", "idle", { title: "/work/other" })];
  view.render();
  assert.equal(view.agents.labels.get("one"), "Review · one");
  assert.equal(view.agents.labels.get("split"), "Review · split");
  assert.equal(view.agents.labels.get("two"), "Codex");
});

test("worktrees fold under the checkout and retain pins and rail access without space status badges", () => {
  const view = setup();
  world.spaces = [space("app", true), space("worktree"), space("other")];
  world.agents = [agent("one", "app"), agent("two", "worktree", "blocked")];
  view.shown.add("worktree");
  view.git = {
    '[null,"/work/app"]': { repo: "repo", name: "app", branch: "main", linked: false },
    '[null,"/work/worktree"]': { repo: "repo", name: "app", branch: "feature", linked: true },
  };
  let root = view.render();
  assert.ok(find(root, "space-worktree"));
  assert.equal(find(root, "ag-two"), undefined); // Worktrees start folded.
  assert.equal(text(find(root, "space-app")).trim(), "A app");
  click(root, "space-fold-worktree");
  assert.ok(find(view.render(), "ag-two"));
  click(view.render(), "space-fold-app");
  root = view.render();
  assert.equal(find(root, "space-worktree"), undefined);
  assert.deepEqual(world.order, ["one", "two"]);
  world.width = 76; root = view.render();
  assert.ok(find(root, "space-worktree"));
  assert.equal(text(find(root, "space-app")).trim(), "1");
  assert.equal(text(find(root, "space-worktree")).trim(), "2");
  assert.ok(find(root, "spaces-expand-sidebar"));
  click(root, "spaces-expand-sidebar");
  assert.deepEqual(world.calls.at(-1), ["layout.resize", { id: "sidebar", px: 268 }]);
});

test("the active space is brought into view at its place among the list's own children", () => {
  const view = setup();
  const scrolled = [];
  view.scroll = { scroll_to_item: i => scrolled.push(i) };
  world.spaces = [space("app"), space("worktree", true), space("other")];
  view.shown.add("worktree");
  view.git = {
    '[null,"/work/app"]': { repo: "repo", name: "app", branch: "main", linked: false },
    '[null,"/work/worktree"]': { repo: "repo", name: "app", branch: "feature", linked: true },
  };
  let root = view.render();
  const list = () => find(root, "spaces-all-list");
  assert.equal(list().styles.track_scroll[0], view.scroll);
  assert.deepEqual(scrolled, [0]); // A worktree is inside its checkout's tree.
  view.render();
  assert.deepEqual(scrolled, [0]);
  sharedState.set("space.pinned", ["other"]);
  root = view.render();
  assert.equal(list().nodes[2], find(root, "space-tree-app"));
  assert.deepEqual(scrolled, [0, 2]); // The pinned space and its line come first.
  world.width = 76; root = view.render();
  assert.ok(find(list().nodes[3], "space-worktree"));
  assert.deepEqual(scrolled, [0, 2, 3]);
});

test("a worktree terminal first in a space keeps the checkout's name and groups its agents under the branch", () => {
  const view = setup();
  const app = { ...space("app", true), name: "t-4-fix-8a32", tabs: [{ id: "pipe-tab", name: "Pipeline" }, { id: "task-tab", name: "T-4", named: true }, { id: "app-tab", name: "3" }] };
  world.spaces = [app];
  world.agents = [agent("task", "app", "working", { tab: "task-tab" }), agent("main", "app")];
  world.panes = [{ pane: "pipe-pane", tab: "pipe-tab", mod: "pipeline" }, { pane: "task-pane", tab: "task-tab", cwd: "/wt/t-4-fix-8a32" }, { pane: "main-pane", tab: "app-tab", cwd: "/work/app" }];
  view.git = {
    '[null,"/wt/t-4-fix-8a32"]': { repo: "repo", name: "app", branch: "t-4-fix", top: "/wt/t-4-fix-8a32", linked: true },
    '[null,"/work/app"]': { repo: "repo", name: "app", branch: "main", top: "/work/app", linked: false },
  };
  let root = view.render();
  assert.deepEqual(world.calls, [["space.rename", { id: "app", name: "app" }]]);
  assert.deepEqual(sharedState.get("space.homes"), { app: "/work/app" });
  Object.assign(app, { name: "app", named: true }); root = view.render();
  assert.equal(text(find(root, "space-app")).trim(), "A app");
  const tree = find(root, "worktree-tree-app-0");
  assert.match(text(tree), /t-4-fix/);
  assert.ok(find(tree, "ag-task"));
  assert.equal(find(tree, "agent-stage-task"), undefined, "an agent no task owns says nothing of Pipeline");
  sharedState.set(STORE, { "live:x": { live: true, tasks: [{ id: "T-4", title: "Fix the login", status: "pr", terminal: "task" }, { id: "T-5", title: "Old", status: "done", terminal: "main" }] } });
  root = view.render();
  assert.equal(text(find(root, "agent-stage-task")), "PR");
  assert.match(find(root, "ag-task").styles.tooltip[0], /Fix the login · .*Pipeline: PR/);
  assert.equal(find(root, "agent-stage-main"), undefined, "a finished task leaves its agent alone");
  sharedState.get(STORE)["live:x"].tasks[0] = { id: "T-4", title: "Fix the login", status: "failed", reason: "checks", terminal: "task" };
  assert.equal(text(find(view.render(), "agent-stage-task")), "Checks failed");
  sharedState.delete(STORE);
  assert.equal(find(tree, "ag-main"), undefined);
  assert.ok(find(find(root, "space-tree-app"), "ag-main"));
  click(root, "worktree-app-0");
  assert.deepEqual(world.calls.at(-1), ["pane.focus", { pane: "task-pane" }]);
  sharedState.set("spaces.focus", "app"); root = view.render();
  assert.match(text(find(root, "spaces-focus-title")), /app/);
  assert.ok(find(find(root, "focus-worktree-tree-app-0"), "focus-ag-task"));
  app.name = "Mine";
  assert.match(text(view.render()), /Mine/);
});

test("a space keeps the name and folder it first has outside home, whatever its terminals cd to", () => {
  const view = setup();
  const app = { ...space("app", true), name: "~", folder: "/home/me" };
  world.spaces = [app]; world.agents = [];
  world.panes = [{ pane: "p", tab: "app-tab", cwd: "/home/me" }];
  view.git = { '[null,"/home/me"]': null, '[null,"/work/app/src"]': { repo: "app-repo", name: "app", branch: "main", top: "/work/app", linked: false },
    '[null,"/work/app"]': { repo: "app-repo", name: "app", branch: "main", top: "/work/app", linked: false },
    '[null,"/work/else"]': { repo: "else-repo", name: "else", branch: "dev", top: "/work/else", linked: false } };
  view.render();
  assert.deepEqual(world.calls, []); assert.equal(sharedState.get("space.homes"), undefined);
  world.panes[0].cwd = "/work/app/src"; app.name = "app"; view.render();
  assert.deepEqual(world.calls, [["space.rename", { id: "app", name: "app" }]]);
  assert.deepEqual(sharedState.get("space.homes"), { app: "/work/app" });
  view.render(); assert.equal(world.calls.length, 1);
  app.named = true; world.panes[0].cwd = "/work/else";
  const root = view.render();
  assert.equal(world.calls.length, 1);
  assert.deepEqual(sharedState.get("space.homes"), { app: "/work/app" });
  assert.match(text(find(root, "space-app")), /app/); assert.doesNotMatch(text(find(root, "space-app")), /else|dev/);
  Object.assign(app, { name: "else", named: false }); view.render(); view.render();
  assert.deepEqual(world.calls.at(-1), ["space.rename", { id: "app", name: "else" }]);
  assert.deepEqual(sharedState.get("space.homes"), { app: "/work/else" });
});

test("the attention filter gives a way back when the last blocked agent becomes idle", () => {
  const view = setup(); world.agents[0].status = "blocked";
  click(view.render(), "spaces-needs-you");
  assert.ok(find(view.render(), "ag-one"));
  world.agents[0].status = "idle";
  const root = view.render();
  assert.match(text(root), /No agents need you/);
  click(root, "spaces-show-all");
  assert.ok(find(view.render(), "space-other"));
});

test("the attention filter reveals folded remote machines without saving new folds", () => {
  const view = setup();
  world.spaces.push({ ...space("vps/app"), machine: "vps" });
  world.agents.push(agent("vps/remote", "vps/app", "blocked"));
  view.shown.add("vps/app");
  view.machines = [{ name: "vps", state: "connected" }];
  view.folded.add("vps");
  let root = view.render();
  assert.ok(find(root, "machine-vps"));
  assert.equal(find(root, "ag-vps/remote"), undefined);
  click(root, "spaces-needs-you");
  root = view.render();
  assert.ok(find(root, "ag-vps/remote"));
  click(root, "ag-vps/remote");
  assert.deepEqual(world.calls, [["pane.focus", { pane: "vps/remote-pane" }]]);
  click(root, "spaces-needs-you");
  assert.equal(find(view.render(), "ag-vps/remote"), undefined);
  assert.ok(view.folded.has("vps"));
});

test("the hover focus button selects its own space without dragging or changing pins", () => {
  const view = setup();
  sharedState.set("space.pinned", ["app"]);
  let root = view.render();
  assert.equal(find(root, "space-focus-other"), undefined);
  find(root, "space-other").handlers.hover(true, cx);
  root = view.render();
  const button = find(root, "space-focus-other");
  assert.ok(button);
  let stops = 0;
  const actionCx = { ...cx, stop_propagation() { stops++; } };
  button.handlers["mouse_down-left"]({}, actionCx);
  button.handlers["mouse_up-left"]({}, actionCx);
  assert.equal(stops, 2);
  assert.deepEqual(world.calls, []);
  button.handlers.click({}, actionCx);
  assert.equal(stops, 3);
  assert.equal(sharedState.get("spaces.focus"), "other");
  assert.deepEqual(world.calls, [["space.select", { id: "other" }]]);
  assert.deepEqual(sharedState.get("space.pinned"), ["app"]);
  assert.equal(view.pressed, null);
  assert.ok(find(view.render(), "spaces-focus-view"));
});

test("the menu focuses the right-clicked space, selects it, and offers a way back", () => {
  setup();
  world.menu = { tab: "space", target: { id: "other" }, overlay: "popup" };
  const menu = new Menu(); menu.init({}, cx);
  assert.match(text(menu.render(cx)), /Focus this space/);
  menu.choose(3, cx);
  assert.equal(sharedState.get("spaces.focus"), "other");
  assert.deepEqual(world.calls, [["space.select", { id: "other" }]]);
  assert.deepEqual(world.closed, ["popup"]);
  assert.match(text(menu.render(cx)), /Show all spaces/);
  menu.choose(3, cx);
  assert.equal(sharedState.get("spaces.focus"), null);
  assert.equal(world.calls.length, 1);
});

test("a stale focus menu never selects an unrelated space", () => {
  setup();
  world.menu = { tab: "space", target: { id: "gone" }, overlay: "popup" };
  const menu = new Menu(); menu.init({}, cx); menu.choose(3, cx);
  assert.equal(sharedState.has("spaces.focus"), false);
  assert.deepEqual(world.calls, []);
});

test("focus shows only that space's agents while keeping the original list mounted for scroll restoration", () => {
  const view = setup();
  click(view.render(), "space-fold-app");
  view.attention = true;
  const savedFolds = preferences.get("spaces.expanded");
  const before = find(view.render(), "spaces-all-list");
  sharedState.set("spaces.focus", "app");
  const root = view.render(), focus = find(root, "spaces-focus-view");
  assert.ok(find(root, "spaces-all-view").styles.invisible);
  assert.equal(find(root, "spaces-all-list").styles.id[0], before.styles.id[0]);
  assert.ok(find(focus, "focus-ag-one")); // Focus ignores the full tree's folds and filter.
  assert.equal(find(focus, "focus-ag-two"), undefined);
  assert.equal(find(focus, "space-app"), undefined);
  assert.equal(text(find(focus, "spaces-focus-title")).trim(), "A app");
  click(focus, "focus-ag-one");
  assert.deepEqual(world.calls, [["pane.focus", { pane: "one-pane" }]]);
  click(root, "spaces-unfocus");
  const restored = view.render();
  assert.equal(find(restored, "spaces-focus-view"), undefined);
  assert.equal(find(restored, "spaces-all-view").styles.invisible, undefined);
  assert.equal(preferences.get("spaces.expanded"), savedFolds);
  assert.equal(view.attention, true);
});

test("focus stays on its chosen space when agents finish or another space becomes active", () => {
  const view = setup(); sharedState.set("spaces.focus", "app");
  world.agents[0].status = "done";
  world.spaces[0].active = false; world.spaces[1].active = true;
  const root = view.render(), focus = find(root, "spaces-focus-view");
  assert.equal(sharedState.get("spaces.focus"), "app");
  assert.equal(find(focus, "focus-ag-one").styles.accessibility_label[0], "Task one, Done");
  click(focus, "spaces-focus-title");
  assert.deepEqual(world.calls, [["space.select", { id: "app" }]]);
});

test("the back button counts attention only in other spaces, including their subagents", () => {
  const view = setup(); sharedState.set("spaces.focus", "app");
  world.agents[0].status = "blocked"; world.agents[1].status = "blocked";
  world.terminals = [{ address: "child", parent: "two", state: "live", status: "error", program }];
  let root = view.render();
  assert.equal(text(find(root, "spaces-focus-elsewhere")), "2 elsewhere");
  world.agents[1].status = "idle"; world.terminals = [];
  root = view.render();
  assert.equal(find(root, "spaces-focus-elsewhere"), undefined);
  assert.ok(find(root, "spaces-unfocus"));
});

test("focused subagents and pins keep their actions and use distinct element identities", () => {
  const view = setup(); sharedState.set("spaces.focus", "app"); world.agents[0].pinned = true;
  world.terminals = [{ address: "child", parent: "one", state: "live", status: "working", program }];
  let root = view.render();
  click(root, "focus-agent-fold-one");
  root = view.render();
  assert.ok(find(find(root, "spaces-focus-view"), "focus-ag-child"));
  assert.ok(find(find(root, "spaces-all-view"), "ag-child"));
  click(root, "focus-ag-child"); click(root, "focus-agent-pin-one");
  assert.deepEqual(world.calls, [["terminal.peek", { terminal: "child" }], ["terminal.pin", { terminal: "one", pinned: false }]]);
});

test("empty and narrow focused views keep an accessible way back", () => {
  const view = setup(); sharedState.set("spaces.focus", "app"); world.agents = [];
  let root = view.render();
  assert.match(text(find(root, "spaces-focus-view")), /No agents in this space/);
  world.width = 76; world.agents = [agent("one", "app")];
  root = view.render();
  assert.ok(find(root, "spaces-focus-expand-sidebar"));
  assert.equal(text(find(root, "focus-ag-one")).trim(), ""); // Icon and status, with the full name in its tooltip.
  assert.match(find(root, "focus-ag-one").styles.tooltip[0], /Task one/);
  click(root, "spaces-unfocus");
  assert.equal(find(view.render(), "spaces-focus-view"), undefined);
});

test("closing the focused space returns to all spaces without selecting another target", () => {
  const view = setup(); sharedState.set("spaces.focus", "app");
  world.spaces = [world.spaces[1]];
  const root = view.render();
  assert.equal(find(root, "spaces-focus-view"), undefined);
  assert.equal(sharedState.get("spaces.focus"), null);
  assert.ok(find(root, "space-other"));
  assert.deepEqual(world.calls, []);
});

test("hover hide precedes the pin and opens choices without selecting, dragging or changing pins", () => {
  const view = setup(); sharedState.set("space.pinned", ["app"]);
  find(view.render(), "space-app").handlers.hover(true, cx);
  const row = find(view.render(), "space-app"), button = find(row, "space-hide-app");
  const ids = row.nodes[0].nodes.map(n => n.styles?.id?.[0]);
  assert.ok(ids.indexOf("space-hide-app") < ids.indexOf("space-pin-app"));
  let stopped = 0;
  const actionCx = { ...cx, stop_propagation() { stopped++; } };
  button.handlers["mouse_down-left"]({}, actionCx); button.handlers["mouse_up-left"]({}, actionCx);
  button.handlers.click({}, actionCx);
  assert.equal(stopped, 3); assert.equal(view.pressed, null);
  assert.deepEqual(world.calls, []);
  assert.deepEqual(sharedState.get("space.pinned"), ["app"]);
  assert.deepEqual(world.opened[0].props, { id: "app" });
});

test("the right-click menu offers hide before pin and rejects a stale target", () => {
  setup(); world.menu = { tab: "space", target: { id: "other" }, overlay: "popup" };
  const menu = new Menu(); menu.init({}, cx);
  assert.match(text(menu.render(cx)).replace(/\s+/g, " "), /Rename Hide space until… Pin to top/);
  menu.choose(1, cx);
  assert.deepEqual(world.opened[0].props, { id: "other" });
  assert.deepEqual(world.calls, []);
  world.opened = []; world.menu.target.id = "gone"; menu.choose(1, cx);
  assert.deepEqual(world.opened, []);
});

test("hiding persists across sidebar reloads, excludes attention, and leaves pin and model order intact", () => {
  let view = setup(); world.agents[1].status = "blocked";
  sharedState.set("space.pinned", ["app"]); sharedState.set("spaces.focus", "app");
  hideState.hideSpace("app", Date.now() + 60000); hideState.hideSpace("other", Date.now() + 60000);
  assert.equal(sharedState.get("spaces.focus"), null);
  view = new Spaces(); view.init({}, cx);
  let root = view.render();
  assert.equal(find(root, "space-app"), undefined); assert.equal(find(root, "ag-two"), undefined);
  assert.equal(text(find(root, "spaces-hidden")).trim(), "Hidden spaces 2");
  click(root, "spaces-needs-you"); root = view.render();
  assert.match(text(root), /No agents need you/);
  assert.deepEqual(world.order, []); assert.deepEqual(world.calls, []);
  assert.deepEqual(sharedState.get("space.pinned"), ["app"]);
  click(root, "spaces-hidden"); assert.deepEqual(world.opened[0].props, { list: true });
  world.width = 76; assert.ok(find(view.render(), "spaces-hidden"));
  world.width = 268; hideState.restoreSpace("app"); click(view.render(), "spaces-needs-you");
  assert.ok(find(view.render(), "space-app"));
});

test("the existing timer expires deadlines and returns spaces without a user action", () => {
  const view = setup(); let timer;
  const timerCx = { ...cx, timer: { every(ms, fn) { if (ms === 250) timer = fn; } } };
  view.init({}, timerCx);
  const now = Date.now(); sharedState.set("spaces.hidden", { app: now + 5000 });
  assert.equal(find(view.render(), "space-app"), undefined);
  const original = Date.now;
  try { Date.now = () => now + 5000; timer(cx); }
  finally { Date.now = original; }
  assert.deepEqual(sharedState.get("spaces.hidden"), {});
  assert.ok(find(view.render(), "space-app"));
});

test("hidden checkout roots promote visible worktrees and hidden children leave their checkout visible", () => {
  const view = setup(); world.spaces = [{ ...space("app", true), named: true }, { ...space("worktree"), named: true }];
  world.agents = [agent("one", "app"), agent("two", "worktree")]; view.shown.add("worktree");
  view.git = { '[null,"/work/app"]': { repo: "repo", name: "app", branch: "main", linked: false },
    '[null,"/work/worktree"]': { repo: "repo", name: "app", branch: "feature", linked: true } };
  hideState.hideSpace("app", Date.now() + 60000);
  let root = view.render(); assert.ok(find(root, "space-worktree")); assert.ok(find(root, "ag-two"));
  assert.equal(find(root, "space-app"), undefined);
  hideState.restoreSpace("app"); hideState.hideSpace("worktree", Date.now() + 60000);
  root = view.render(); assert.ok(find(root, "space-app")); assert.equal(find(root, "space-worktree"), undefined);
  assert.deepEqual(world.calls, []);
});

test("preset picker hides the requested space and the hidden list restores early", () => {
  const view = setup(); world.menu = { id: "other", overlay: "hide" };
  const picker = new SpaceHide(); picker.init({}, cx);
  const start = Date.now(); click(picker.render(), "space-hide-choice-0");
  assert.ok(sharedState.get("spaces.hidden").other >= start + 30 * 60000);
  assert.equal(find(view.render(), "space-other"), undefined); assert.deepEqual(world.closed, ["hide"]);
  world.menu = { list: true, overlay: "hidden" };
  const list = new SpaceHide(); list.init({}, cx); click(list.render(), "hidden-space-other");
  assert.ok(find(view.render(), "space-other")); assert.match(text(list.render()), /No hidden spaces/);
  assert.deepEqual(world.calls, []);
});

test("custom deadlines reject invalid, normalized and past times and accept a future local time", () => {
  setup(); world.menu = { id: "other", custom: true, overlay: "custom" };
  const picker = new SpaceHide(); picker.init({}, cx);
  for (const invalid of ["bad", "2027-02-30 12:00", "2027-01-01 24:00", "2020-01-01 12:00"]) {
    picker.input.text = invalid; picker.submit(cx);
    assert.match(picker.error, /Enter a future/); assert.equal(sharedState.has("spaces.hidden"), false);
  }
  picker.input.text = hideState.localTime(Date.now() + 3600000); picker.submit(cx);
  assert.equal(sharedState.get("spaces.hidden").other, hideState.parseLocalTime(picker.input.text));
  assert.deepEqual(world.closed, ["custom"]);
});

test("deadline parsing and tomorrow preserve local calendar time and stale pickers cannot hide another space", () => {
  setup(); const now = new Date(2026, 10, 7, 23, 30).getTime();
  assert.equal(hideState.hideChoices(now)[3][1], new Date(2026, 10, 8, 9).getTime());
  assert.equal(hideState.parseLocalTime("2028-02-29 08:05"), new Date(2028, 1, 29, 8, 5).getTime());
  sharedState.set("spaces.hidden", { expired: now - 1, text: "9999999999999", other: now + 1000 });
  assert.deepEqual(hideState.hiddenSpaces(now), { other: now + 1000 });
  world.menu = { id: "gone", overlay: "hide" }; const picker = new SpaceHide(); picker.init({}, cx); picker.choose(0, cx);
  assert.match(picker.error, /no longer available/); assert.deepEqual(world.calls, []);
});

test("the shipped custom layout mounts a single list and keeps the agent panel out", async () => {
  const layout = JSON.parse(await readFile(new URL("../layouts/main-custom.json", import.meta.url), "utf8"));
  const mods = [];
  const walk = n => { if (n.content?.mod) mods.push(n.content.mod); (n.children ?? []).forEach(walk); };
  walk(layout);
  assert.equal(mods.filter(m => m === "spaces-pin").length, 1);
  assert.equal(mods.includes("agents"), false);
});

test("the sidebar walks spaces and agents with the keyboard", () => {
  const view = setup();
  view.keyboard = true;
  view.render();
  const key = (k) => view.key({ key: k, modifiers: {} }, cx);
  world.calls = [];
  key("down");
  assert.equal(view.cursor, "space:app");
  key("down");
  assert.equal(view.cursor, "agent:one");
  key("enter");
  assert.deepEqual(world.calls, [["pane.focus", { pane: "one-pane" }]]);
  key("left");
  assert.equal(view.cursor, "space:app");
  key("end");
  assert.equal(view.cursor, "recent:other", "the Recent row closes each space's list");
  key("enter");
  assert.ok(view.recentOpen.has("other"));
  key("enter");
  assert.ok(!view.recentOpen.has("other"));
  key("up");
  assert.equal(view.cursor, "agent:two");
  key("up");
  world.calls = [];
  key("enter");
  assert.deepEqual(world.calls, [["space.select", { id: "other" }]]);
  key("p");
  assert.deepEqual(sharedState.get("space.pinned"), ["other"]);
  view.render();
  assert.equal(view.nav[0].key, "space:other");
  key("escape");
  assert.equal(view.keyboard, false);
  assert.deepEqual(world.calls.at(-1), ["pane.go", { direction: "right" }]);
});

test("a space lists its pipeline once it is in use, a still dot while started, and opens it there", () => {
  const view = setup(), key = LIVE + JSON.stringify([null, "/work/app"]);
  const context = { id: JSON.stringify([null, "/work/app"]), cwd: "/work/app", on: null, name: "app" };
  const live = (running, tasks) => sharedState.set(STORE, { [key]: { live: true, context, running, tasks } });
  live(false, [{ status: "done" }]);
  assert.equal(find(view.render(), "pipeline-app"), undefined);
  live(false, [{ status: "queued" }, { status: "review" }]);
  let row = find(view.render(), "pipeline-app");
  assert.ok(find(find(view.render(), "space-tree-app"), "pipeline-app"));
  assert.equal(find(view.render(), "pipeline-other"), undefined);
  assert.equal(row.styles.tooltip[0], "Pipeline · Not started · 1 queued · 1 to review");
  assert.equal(row.nodes.at(-1).styles.spin, undefined);
  live(true, [{ status: "working" }]);
  row = find(view.render(), "pipeline-app");
  assert.equal(row.styles.tooltip[0], "Pipeline · Started · 1 working");
  assert.equal(row.nodes.at(-1).styles.spin, undefined);
  assert.ok(row.nodes.at(-1).styles.bg);
  row.handlers.click({}, cx);
  assert.deepEqual(world.calls, [["space.select", { id: "app" }], ["tab.new", { space: "app", name: "Pipeline", mod: "pipeline", props: { context: { ...context, space: "app" } } }]]);
  world.calls = [];
  world.panes = [{ pane: "pipe", mod: "pipeline", tab: "other-tab", terminal: null, cwd: null }];
  click(view.render(), "pipeline-other");
  assert.deepEqual(world.calls, [["space.select", { id: "other" }], ["tab.select", { id: "other-tab" }], ["pane.focus", { pane: "pipe" }]]);
  click(view.render(), "spaces-needs-you");
  assert.equal(find(view.render(), "pipeline-app"), undefined);
});

test("two spaces in one folder each have their own pipeline; an older shared one stays with the space that started it", () => {
  const view = setup(), all = {};
  world.panes = [{ pane: "o", mod: null, tab: "other-tab", terminal: null, cwd: "/work/app" }];
  const own = (space, running) => all[LIVE + JSON.stringify([null, "/work/app", space])] = { live: true, running, tasks: [{ status: "queued" }], context: { id: JSON.stringify([null, "/work/app", space]), cwd: "/work/app", on: null, name: "app", space } };
  own("app", true); own("other", false);
  sharedState.set(STORE, all);
  assert.match(find(view.render(), "pipeline-app").styles.tooltip[0], /Started/);
  assert.match(find(view.render(), "pipeline-other").styles.tooltip[0], /Not started/);
  const older = { live: true, running: true, space: "app", tasks: [], context: { id: JSON.stringify([null, "/work/app"]), cwd: "/work/app", on: null, name: "app" } };
  sharedState.set(STORE, { [LIVE + JSON.stringify([null, "/work/app"])]: older });
  assert.ok(find(view.render(), "pipeline-app"));
  assert.equal(find(view.render(), "pipeline-other"), undefined);
});

test("closing a space's pipeline asks first, then stops it, discards its work and closes its tab", () => {
  const view = setup(), key = LIVE + JSON.stringify([null, "/work/app"]);
  const context = { id: JSON.stringify([null, "/work/app"]), cwd: "/work/app", on: null, name: "app" };
  sharedState.set(STORE, { [key]: { live: true, version: 5, context, running: true, schedule: null, events: [], tasks: [
    { id: "T-1", status: "working", depends: [], workspaces: { app: {} }, discard: false },
    { id: "T-2", status: "queued", depends: [], workspaces: null, discard: false },
    { id: "T-3", status: "pr", depends: [], workspaces: { app: {} }, discard: false }] } });
  world.panes = [{ pane: "pipe", mod: "pipeline", tab: "app-tab", terminal: null, cwd: null }];
  assert.equal(find(view.render(), "pipeline-close-app"), undefined);
  find(view.render(), "pipeline-app").handlers.hover(true, cx);
  click(view.render(), "pipeline-close-app");
  assert.equal(world.calls.length, 0);
  assert.deepEqual(world.opened.map(o => [o.mod, o.kind, o.props]), [["pipeline-close", "dialog", { space: "app", key, tab: "app-tab" }]]);
  assert.deepEqual(closeDetail(sharedState.get(STORE)[key]), ["Stops the pipeline, so no new task starts.",
    "Stops 1 agent and deletes its worktrees and branches. Unmerged work is lost.", "Removes 1 queued task.",
    "Leaves 1 task that is merging or waiting on a pull request."]);
  world.menu = { ...world.opened[0].props, overlay: "o1" };
  const dialog = new PipelineClose(); dialog.init({}, cx);
  click(dialog.render(), "no");
  assert.deepEqual(world.closed, ["o1"]);
  assert.equal(sharedState.get(STORE)[key].running, true);
  click(dialog.render(), "yes");
  const state = sharedState.get(STORE)[key];
  assert.equal(state.running, false);
  assert.deepEqual(state.tasks.map(task => [task.id, task.discard]), [["T-1", true], ["T-3", false]]);
  assert.deepEqual(world.calls, [["tab.close", { id: "app-tab", confirmed: true }]]);
  world.panes = [];
  assert.ok(find(view.render(), "pipeline-app"), "an open pull request keeps it listed");
  state.tasks = state.tasks.filter(task => task.id !== "T-3");
  assert.equal(find(view.render(), "pipeline-app"), undefined);
});

test("terminals that aren't agents are listed under their space and focus their pane", () => {
  const view = setup();
  const shell = { name: "zsh", key: "shell", icon: null, shell: true, agent: false };
  const pane = (id, extra = {}) => ({ pane: id, terminal: `t-${id}`, tab: "app-tab", title: "", cwd: "/work/app", program: shell, focused: false, ...extra });
  world.panes = [pane("one-pane", { program }), pane("sh"), pane("dev", { cwd: "/work/app/web", program: { ...shell, name: "node", key: "program", shell: false } }),
    pane("sh2"), { pane: "files", terminal: null, mod: "files", tab: "app-tab", title: "Files", focused: false }];
  let root = view.render();
  const tree = find(root, "space-tree-app");
  assert.equal(find(tree, "term-one-pane"), undefined);
  assert.equal(find(tree, "term-files"), undefined);
  assert.match(text(find(tree, "term-sh")), /app · t-sh/);
  assert.match(text(find(tree, "term-sh2")), /app · t-sh2/);
  assert.match(text(find(tree, "term-dev")), /web +node/);
  assert.equal(find(find(root, "space-tree-other"), "term-sh"), undefined);
  click(root, "term-dev");
  assert.deepEqual(world.calls, [["pane.focus", { pane: "dev" }]]);
  assert.deepEqual(world.order, ["one", "two"]);
  click(root, "spaces-needs-you");
  assert.equal(find(view.render(), "term-sh"), undefined);
  click(view.render(), "spaces-needs-you");
  sharedState.set("features", { terminals: false });
  assert.equal(find(view.render(), "term-sh"), undefined);
});

test("use is recorded for the shown space and working agents, not for a space left alone", () => {
  const view = setup();
  world.spaces = [space("app", true), space("other"), space("busy")];
  world.panes = [{ pane: "b", tab: "busy-tab", terminal: "t1", status: "working" }];
  const start = Date.now();
  view.used = { app: start - 7200000, other: start - 7200000, busy: start - 7200000 };
  view.checkNew(cx);
  assert.ok(view.used.app >= start);
  assert.ok(view.used.busy >= start);
  assert.equal(view.used.other, start - 7200000);
  assert.deepEqual(JSON.parse(preferences.get("spaces.lastUsed")), view.used);
  const restored = new Spaces(); restored.init({}, cx);
  assert.deepEqual(restored.used, view.used);
});

test("tidy puts the most recently used spaces first, pinned ones within the pins, and folds those unused for an hour", () => {
  const view = setup();
  world.spaces = [space("old"), space("pinned"), space("kept"), space("app", true), space("stale"), space("recent")];
  world.agents = [agent("one", "old"), agent("two", "recent"), agent("three", "pinned")];
  sharedState.set("space.pinned", ["pinned", "kept"]);
  for (const w of world.spaces) view.shown.add(w.id);
  view.render();
  world.calls = [];
  world.spaces = [space("pinned"), space("kept"), space("old"), space("app", true), space("stale"), space("recent")];
  const now = Date.now(), long = now - 2 * 3600000;
  view.used = { old: long, pinned: long, kept: now, app: long, stale: long - 1000, recent: now - 600000 };
  click(view.render(), "spaces-tidy");
  assert.deepEqual(world.calls, [["space.move", { id: "kept", index: 1 }], ["space.move", { id: "app", index: 3 }], ["space.move", { id: "recent", index: 4 }]]);
  assert.deepEqual(view.ordered().map(r => r.w.id), ["kept", "pinned", "app", "recent", "old", "stale"]);
  let root = view.render();
  assert.equal(find(root, "ag-one"), undefined);
  assert.equal(find(root, "ag-three"), undefined);
  assert.ok(find(root, "ag-two"));
  assert.equal(world.calls.length, 3);
  world.spaces = [space("kept"), space("pinned"), space("app", true), space("recent"), space("old"), space("stale")];
  view.render();
  assert.equal(view.tidying, null);
  world.calls = [];
  click(view.render(), "spaces-tidy");
  assert.deepEqual(world.calls, []);
});

test("a space first seen takes its last use from its folder, and one made while running counts as in use", async () => {
  const view = setup(), jobs = [], asked = [];
  const running = { ...cx, spawn: fn => jobs.push(fn(cx)) };
  world.exec = async (cmd, args) => { asked.push([cmd, args.slice(3)]); return { code: 0, stdout: "1700000000\n" }; };
  view.git = { [JSON.stringify([null, "/work/app"])]: null, [JSON.stringify([null, "/work/other"])]: null };
  view.used = { app: 5 };
  view.seed(world.spaces, [], running);
  await Promise.all(jobs);
  assert.deepEqual(asked, [["sh", ["/work/other", "-work-other"]]]);
  assert.deepEqual(view.used, { app: 5, other: 1700000000000 });
  world.spaces = [...world.spaces, space("made")];
  view.git[JSON.stringify([null, "/work/made"])] = null;
  view.born.made = Date.now();
  view.seed(world.spaces, [], running);
  assert.equal(asked.length, 1);
  assert.ok(view.used.made >= view.born.made);
});

test("a space lists its folder's closed conversations under Recent and resumes one in a new tab", async () => {
  const view = setup();
  assert.deepEqual([recent.ago(0, 59 * 60000), recent.ago(0, 3 * 3600000), recent.ago(0, 49 * 3600000)], ["59m", "3h", "2d"]);
  const sessions = [{ agent: "claude", id: "c2", title: "Fix the login", at: Date.now() - 120000 }, { agent: "opencode", id: "o1", title: "Review PR 12", at: Date.now() - 7200000 },
    { agent: "claude", id: "c1", title: "Older work", at: Date.now() - 3 * 86400000 }];
  assert.deepEqual(recent.closedSessions(sessions, [{ program: { key: "claude" } }]).map(row => row.id), ["o1", "c1"], "an open agent's own conversation is left out");
  const elsewhere = [{ agent: "claude", id: "w1", cwd: "/wt/t-1" }, { agent: "claude", id: "m1", cwd: "/work/app" }];
  assert.deepEqual(recent.closedSessions(elsewhere, [{ program: { key: "claude" }, cwd: "/wt/t-1" }]).map(row => row.id), ["m1"], "only in the folder that agent is in");
  assert.deepEqual(recent.resumeArgs({ run: ["claude", "--yolo"] }, sessions[0]), ["claude", "--yolo", "--resume", "c2"]);
  assert.deepEqual(recent.resumeArgs({ run: ["codex"] }, { agent: "codex", id: "x" }), ["codex", "resume", "x"]);
  assert.deepEqual(recent.resumeArgs({ run: ["opencode"] }, { agent: "opencode", id: "ses_1" }), ["opencode", "--session", "ses_1"]);
  let root = view.render();
  assert.ok(find(root, "recent-app"));
  assert.equal(find(root, "session-o1"), undefined, "folded until asked");
  const jobs = [], spawning = { ...cx, spawn: fn => jobs.push(fn(spawning)) };
  world.exec = async (command, args) => { world.read = [command, JSON.parse(args[2])]; return { stdout: JSON.stringify({ data: sessions }) }; };
  world.known = [{ key: "opencode", icon: "icons/opencode.png", tint: false, run: ["opencode"], installed: true }];
  find(root, "recent-app").handlers.click({}, spawning);
  await Promise.all(jobs);
  assert.equal(world.read[0], "python3");
  assert.equal(world.read[1].cwd, view.folder(world.spaces.find(s => s.id === "app")).cwd);
  root = view.render();
  assert.match(text(find(root, "session-o1")), /Review PR 12.*2h/);
  assert.deepEqual(find(root, "session-o1").nodes[0].styles.w, [14], "each conversation carries its agent's icon");
  assert.equal(find(root, "session-c1").nodes.length, 2, "an agent Herdr doesn't know has none");
  world.known = [{ key: "opencode", run: ["opencode"], installed: true }];
  world.calls = []; jobs.length = 0;
  find(root, "session-o1").handlers.click({}, spawning);
  await Promise.all(jobs);
  assert.deepEqual(world.calls, [["tab.new", { space: "app", folder: world.read[1].cwd, argv: ["opencode", "--session", "ses_1".replace("ses_1", "o1")], name: "Review PR 12" }]]);
  assert.equal(find(view.render(), "session-o1"), undefined, "a resumed conversation is an agent now");
  view.recent.app.rows = [];
  assert.match(text(find(view.render(), "recent-empty-app")), /No closed conversations here/);
  sharedState.set("features", { recent: false });
  assert.equal(find(view.render(), "recent-app"), undefined);
  sharedState.delete("features");
  localStorage.setItem("spaces.recent", "[]");
});

test("a conversation held in one of the repository's worktrees is marked and resumed in that worktree", async () => {
  const view = setup();
  const jobs = [], spawning = { ...cx, spawn: fn => jobs.push(fn(spawning)) };
  world.exec = async () => ({ stdout: JSON.stringify({ data: [{ agent: "claude", id: "w1", title: "Rebase PR 12", at: Date.now() - 60000, cwd: "/wt/t-1", branch: "t-1-fix" }] }) });
  world.known = [{ key: "claude", run: ["claude"], installed: true }];
  find(view.render(), "recent-app").handlers.click({}, spawning);
  await Promise.all(jobs);
  const row = find(view.render(), "session-w1");
  assert.ok(find(row, "session-branch-mark-w1"));
  assert.match(row.styles.tooltip[0], /in the worktree of t-1-fix/);
  world.calls = []; jobs.length = 0;
  row.handlers.click({}, spawning);
  await Promise.all(jobs);
  assert.deepEqual(world.calls, [["tab.new", { space: "app", folder: "/wt/t-1", argv: ["claude", "--resume", "w1"], name: "Rebase PR 12" }]]);
  localStorage.setItem("spaces.recent", "[]");
});
