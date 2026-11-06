import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const world = {};
function native() {
  const data = { nodes: [], styles: {}, handlers: {} };
  let el;
  el = new Proxy(data, { get(target, key) {
    if (key in target) return target[key];
    if (key === "child") return child => { target.nodes.push(child); return el; };
    if (key === "when") return (condition, apply) => condition ? apply(el) : el;
    if (key.startsWith("on_")) return (...args) => { target.handlers[key] = args.at(-1); return el; };
    return (...args) => { target.styles[key] = args; return el; };
  } });
  return el;
}
globalThis.__panelNative = {
  div: native, svg: native,
  spaces: () => world.spaces, panes: () => world.panes, focused: () => world.focus,
  props: () => world.props,
  run: (command, args) => {
    world.calls.push([command, args]);
    if (command === "pane.split" && !world.defer) {
      world.panes.push({ pane: "created", mod: args.mod, tab: "tab" });
    }
  },
  notify: message => world.notices.push(message),
};
let source = (await readFile(new URL("../mods/tabs-show/panel-actions.js", import.meta.url), "utf8")).replace(/^import .*;\n/gm, "");
source = "const { div, svg, spaces, panes, focused, props, run, notify } = globalThis.__panelNative;\n" + source;
const { moveToPane, moveToPaneButton } = await import("data:text/javascript," + encodeURIComponent(source));
const cx = { spawn: fn => world.tasks.push(fn(cx)), notify() {},
  sleep: async () => { if (world.switchTab) world.focus = { tab: "other-tab", pane: "other" }; } };
function setup() {
  Object.assign(world, {
    spaces: [{ active: true, tabs: [{ id: "tab", active: true }] }],
    panes: [{ pane: "agent", terminal: "terminal", tab: "tab", program: { agent: true } }],
    focus: { tab: "tab", pane: "agent" }, props: null,
    calls: [], tasks: [], notices: [], defer: false, switchTab: false,
  });
}

test("each side panel opens its native pane with its current state and creates no shell", async () => {
  for (const [kind, mod, state] of [
    ["files", "files-pane", { folders: ["src"], root: "/project", on: null }],
    ["changes", "review-pane", { message: "Draft message" }],
    ["show", "show-pane", { all: true }],
    ["loops", "loops-pane", { all: true, completed: true, showCodex: false, showClaude: true }],
  ]) {
    setup();
    moveToPane(kind, state, cx);
    await Promise.all(world.tasks);
    assert.deepEqual(world.calls, [
      ["pane.split", { pane: "agent", direction: "right", mod, props: { tab: "tab", panelState: state } }],
      ["pane.focus", { pane: "created" }],
      ["layout.hide", { id: "panel" }],
    ]);
    assert.equal(world.notices.length, 0);
  }
});

test("an existing pane is focused without duplicating it or replacing its state", () => {
  setup();
  world.panes.push({ pane: "existing", mod: "files-pane", tab: "tab" });
  moveToPane("files", { folders: ["src"] }, cx);
  assert.deepEqual(world.calls, [["pane.focus", { pane: "existing" }], ["layout.hide", { id: "panel" }]]);
  assert.equal(world.tasks.length, 0);
});

test("a pane in another tab is not mistaken for the target", async () => {
  setup();
  world.panes.push({ pane: "other", mod: "show-pane", tab: "other-tab" });
  moveToPane("show", {}, cx);
  await Promise.all(world.tasks);
  assert.equal(world.calls[0][0], "pane.split");
  assert.equal(world.calls[1][1].pane, "created");
});

test("repeated activation during opening creates only one pane", async () => {
  setup();
  moveToPane("loops", {}, cx);
  moveToPane("loops", {}, cx);
  await Promise.all(world.tasks);
  assert.equal(world.calls.filter(([command]) => command === "pane.split").length, 1);
});

test("failed opening keeps the original side panel available", async () => {
  setup(); world.defer = true;
  moveToPane("files", {}, cx);
  await Promise.all(world.tasks);
  assert.ok(!world.calls.some(([command]) => command === "layout.hide"));
  assert.equal(world.notices.length, 1);
  assert.match(world.notices[0].body, /side panel is still available/);
});

test("switching tabs during opening does not hide or focus another tab's views", async () => {
  setup(); world.defer = true; world.switchTab = true;
  moveToPane("show", {}, cx);
  await Promise.all(world.tasks);
  assert.deepEqual(world.calls.map(([command]) => command), ["pane.split"]);
  assert.equal(world.notices.length, 0);
});

test("dialogs and a missing active tab cannot create a pane", () => {
  setup(); world.props = { overlay: "dialog" };
  moveToPane("changes", {}, cx);
  world.props = null; world.spaces = [];
  moveToPane("changes", {}, cx);
  assert.deepEqual(world.calls, []);
});

test("the compact header control identifies its action and the existing destination", () => {
  setup();
  let button = moveToPaneButton("show", { all: true }, {});
  assert.equal(button.styles.tooltip[0], "Move to pane");
  assert.equal(button.styles.accessibility_label[0], "Move Show to pane");
  world.panes.push({ pane: "existing", mod: "show-pane", tab: "tab" });
  button = moveToPaneButton("show", {}, {});
  assert.match(button.styles.tooltip[0], /existing Show pane/);
  button.handlers.on_click({}, cx);
  assert.equal(world.calls[0][1].pane, "existing");
});

// The real Changes initializer clears draft text when its context first loads.
// A moved draft must be restored after that reset, and cleared on a later repo change.
globalThis.__changesNative = {
  ...globalThis.__panelNative, View: class {}, iconsReady: Promise.resolve(),
  InputState: { new: () => {
    let value = "";
    return { on() {}, value: () => value, set_value: next => { value = next; } };
  } },
};
source = (await readFile(new URL("../mods/changes-modal/main.js", import.meta.url), "utf8")).replace(/^import .*;\n/gm, "");
source = "const { View, InputState, iconsReady, spaces, panes, focused, props } = globalThis.__changesNative;\n" + source;
const { default: Changes } = await import("data:text/javascript," + encodeURIComponent(source));

test("moving Changes preserves the draft after the initial context reset", () => {
  setup();
  world.spaces[0].machine = null;
  world.panes[0].cwd = "/project";
  world.props = { panelState: { message: "Keep this draft", context: JSON.stringify({ cwd: "/project", on: null }) } };
  const view = new Changes();
  const initCx = { spawn() {}, timer: { every() {} }, focus_handle: () => ({ focus() {} }) };
  view.init({}, initCx);
  assert.equal(view.message, "Keep this draft");
  assert.equal(view.input.value(), "Keep this draft");
  world.panes[0].cwd = "/different-repository";
  view.loading = false;
  view.refresh(initCx);
  assert.equal(view.message, "");
  assert.equal(view.input.value(), "");
});

test("a moved draft is not carried into a different initial folder", () => {
  setup();
  world.panes[0].cwd = "/different-repository";
  world.props = { panelState: { message: "Keep this draft", context: JSON.stringify({ cwd: "/project", on: null }) } };
  const view = new Changes();
  view.init({}, { spawn() {}, timer: { every() {} }, focus_handle: () => ({ focus() {} }) });
  assert.equal(view.message, "");
});
