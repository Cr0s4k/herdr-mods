import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const modelSource = await readFile(new URL("../mods/skills/model.js", import.meta.url), "utf8");
const model = await import("data:text/javascript," + encodeURIComponent(modelSource));
const { visibleSkills, contextFor } = model;
const install = (agent, origin, extra = {}) => ({ agent, origin, project: origin === "project", enabled: true, path: "/skills/test/SKILL.md", ...extra });
const skill = (name, installations, extra = {}) => ({ id: name, name, description: "Review code", path: `/skills/${name}/SKILL.md`, installations, ...extra });

test("Available here combines applicable origins and excludes disabled or unverified copies", () => {
  const skills = [skill("project", [install("claude", "project")]),
    skill("shared", [install("codex", "personal"), install("claude", "personal")]),
    skill("disabled", [install("claude", "plugin", { enabled: false })]),
    skill("cached", [install("codex", "plugin", { enabled: null })])];
  assert.deepEqual(visibleSkills(skills).map(s => s.name), ["project", "shared"]);
  assert.equal(visibleSkills(skills, { agent: "codex" })[0].installations.length, 1);
  assert.deepEqual(visibleSkills(skills, { scope: "library" }).map(s => s.name), ["shared", "disabled", "cached"]);
});

test("search matches every term across descriptions, plugins and discovery paths", () => {
  const skills = [skill("review", [install("claude", "plugin", { plugin: "security" })])];
  assert.equal(visibleSkills(skills, { query: "SECURITY code" }).length, 1);
  assert.equal(visibleSkills(skills, { query: "skills/test" }).length, 1);
  assert.equal(visibleSkills(skills, { query: "security deploy" }).length, 0);
});

test("grouping follows filtered installation origins without merging same-name files", () => {
  const skills = [skill("review", [install("claude", "project"), install("codex", "personal")]),
    skill("review", [install("claude", "personal")], { id: "other", path: "/other/SKILL.md" })];
  assert.equal(visibleSkills(skills).length, 2);
  assert.equal(visibleSkills(skills)[0].group, "project");
  assert.equal(visibleSkills(skills, { scope: "library" })[0].group, "personal");
});

test("Claude synced provenance determines grouping and source labels", () => {
  const skills = [skill("chrome-browser", [install("claude", "builtin", { sync_source: "anthropic-example" })]),
    skill("report", [install("claude", "plugin", { sync_source: "plugin" })]),
    skill("custom", [install("claude", "synced", { sync_source: "user" })])];
  const visible = visibleSkills(skills, { agent: "claude", scope: "library" });
  assert.deepEqual(visible.map(s => s.group), ["builtin", "plugin", "synced"]);
  assert.equal(model.originLabel(visible[0].installations[0]), "Anthropic · Built-in skills");
  assert.equal(model.originLabel(visible[1].installations[0]), "claude.ai · Plugin skills");
  assert.equal(model.originLabel(visible[2].installations[0]), "claude.ai sync");
});

const spaces = [
  { id: "local", active: true, machine: null, folder: "/stale", tabs: [{ id: "one", active: true }] },
  { id: "remote", machine: "vps", folder: "/srv/stale", tabs: [{ id: "two", active: true }] },
];
const panes = [{ pane: "first", tab: "one", cwd: "/live/one" }, { pane: "second", tab: "one", cwd: "/live/two" },
  { pane: "third", tab: "two", cwd: "/srv/live" }, { pane: "skills", mod: "skills-pane", tab: "two" }];

test("the context follows a terminal's live folder and preserves it while the panel has focus", () => {
  const context = contextFor(spaces, panes, { pane: "second" });
  assert.equal(context.cwd, "/live/two");
  assert.equal(contextFor(spaces, panes, { pane: "mod" }, null, context).cwd, "/live/two");
  assert.equal(contextFor(spaces, panes, { pane: "first" }, null, context).cwd, "/live/one");
});

test("a moved panel stays bound to its original tab and machine", () => {
  const context = contextFor(spaces, panes, { pane: "second" }, "two");
  assert.equal(context.cwd, "/srv/live");
  assert.equal(context.on, "vps");
  assert.equal(context.tab, "two");
});

test("a terminal block with no model pane supplies its live cwd only in its own space", () => {
  const focus = { space: "local", tab: "one", pane: null, terminal: "t1", cwd: "/block/live" };
  assert.equal(contextFor(spaces, panes, focus).cwd, "/block/live");
  assert.equal(contextFor(spaces, panes, focus, "two").cwd, "/srv/live");
});

// Exercise the real UI callbacks and asynchronous refresh boundaries.
const world = {};
function native(id) {
  const target = { nodes: [], styles: id ? { id: [id] } : {}, handlers: {} };
  let el;
  el = new Proxy(target, { get(t, key) {
    if (key in t) return t[key];
    if (key === "child") return child => { t.nodes.push(child); return el; };
    if (key === "children") return children => { t.nodes.push(...children); return el; };
    if (key === "when") return (condition, apply) => condition ? apply(el) : el;
    if (key.startsWith("on_")) return (...args) => { t.handlers[key] = args.at(-1); return el; };
    return (...args) => { t.styles[key] = args; return el; };
  } });
  return el;
}
const preferences = new Map();
globalThis.localStorage = { getItem: key => preferences.get(key) ?? null, setItem: (key, value) => preferences.set(key, value) };
globalThis.__skillsNative = {
  ...model, View: class {}, div: native, svg: native, v_flex: native, h_flex: native,
  Button: { new: native }, Input: { new: native }, TextView: { markdown: (id, text) => native(id).child(text) },
  Editor: { new: native }, EditorState: { new: options => ({ options, release() {} }) },
  InputState: { new: ({ value }) => {
    let text = value;
    const handlers = {};
    return { handlers, value: () => text, set_value: value => { text = value; }, on: (name, fn) => { handlers[name] = fn; }, release() {} };
  } },
  appHome: () => "/app", spaces: () => world.spaces, panes: () => world.panes, focused: () => world.focus,
  props: () => world.props, theme: () => new Proxy({}, { get: (_, key) => key }), settings: () => ({}),
  moveToPaneButton: () => native(),
  bindMoveCommand: () => {},
  exec: (_cmd, args, options) => {
    world.execs.push({ args, options });
    return world.defer ? new Promise(resolve => world.waiters.push(resolve))
      : Promise.resolve({ code: 0, stdout: JSON.stringify({ skills: world.catalog, home: "/home", warnings: [] }) });
  },
  readTextFile: async path => path.endsWith("discover.py") ? "reader" : world.text,
  openOverlay: overlay => world.overlays.push(overlay), closeOverlay: id => world.closed.push(id),
};
let uiSource = (await readFile(new URL("../mods/skills/main.js", import.meta.url), "utf8")).replace(/^import .*;\n/gm, "");
uiSource = `const { ${Object.keys(globalThis.__skillsNative).join(", ")} } = globalThis.__skillsNative;\n` + uiSource;
const { default: Skills } = await import("data:text/javascript," + encodeURIComponent(uiSource));
const cx = { focus_handle: () => ({ focus() {} }), notify() {}, stop_propagation() {},
  timer: { every() {}, after() {} }, spawn: fn => world.tasks.push(fn(cx)),
  write_to_clipboard: text => world.clipboard.push(text) };
function setup() {
  Object.assign(world, {
    spaces: structuredClone(spaces), panes: structuredClone(panes), focus: { pane: "first" }, props: {},
    catalog: [skill("shared", [install("codex", "personal", { command: "$shared" }), install("claude", "personal", { command: "/shared" })]),
      skill("builtin", [install("codex", "builtin", { command: "$builtin" })])],
    text: "---\nname: shared\n---\n# Instructions\nRead these instructions.",
    execs: [], waiters: [], tasks: [], overlays: [], closed: [], clipboard: [], defer: false,
  });
  preferences.clear();
  return new Skills();
}
function find(el, id) {
  return el?.styles?.id?.[0] === id ? el : (el?.nodes ?? []).map(child => find(child, id)).find(Boolean);
}

test("an older refresh cannot overwrite a newer machine's inventory", async () => {
  const view = setup();
  view.script = "reader"; world.defer = true;
  view.refresh(cx);
  world.spaces[0].machine = "vps";
  world.panes[0].cwd = "/srv/changed";
  view.refresh(cx);
  assert.equal(world.execs[1].options.on, "vps");
  world.waiters[1]({ code: 0, stdout: JSON.stringify({ skills: [skill("new", [])], warnings: [], home: "/remote" }) });
  await world.tasks[1];
  world.waiters[0]({ code: 0, stdout: JSON.stringify({ skills: [skill("old", [])], warnings: [], home: "/local" }) });
  await world.tasks[0];
  assert.equal(view.items[0].name, "new");
  assert.equal(view.home, "/remote");
});

test("the real filters and search expose folded results and keep all discovery aliases in the reader", async () => {
  const view = setup();
  view.init({}, cx); await Promise.all(world.tasks);
  let root = view.render(cx);
  assert.ok(find(root, "skill-shared"));
  assert.equal(find(root, "skill-builtin"), undefined);
  find(root, "skills-agent-claude").handlers.on_click({}, cx);
  assert.equal(view.agent, "claude");
  assert.equal(view.visible()[0].installations.length, 1);
  find(view.render(cx), "skill-shared").handlers.on_click({}, cx);
  assert.equal(world.overlays[0].props.skill.installations.length, 2);
  find(view.render(cx), "skills-agent-all").handlers.on_click({}, cx);
  view.search.set_value("builtin"); view.search.handlers.change({}, cx);
  assert.ok(find(view.render(cx), "skill-builtin"));
  view.search.handlers.submit({}, cx);
  assert.equal(world.overlays[1].props.skill.name, "builtin");
});

test("the reader copies invocations locally, displays source, and closes without running a skill", async () => {
  const view = setup(); world.props = { overlay: "reader", skill: world.catalog[0], home: "/home" };
  view.init({}, cx); await Promise.all(world.tasks);
  assert.ok(!view.markdown.includes("name: shared"));
  assert.ok(view.source.options.value.includes("name: shared"));
  let root = view.render(cx);
  find(root, "copy-$shared").handlers.on_click({}, cx);
  find(root, "copy-/shared").handlers.on_click({}, cx);
  assert.deepEqual(world.clipboard, ["$shared", "/shared"]);
  assert.equal(world.execs.length, 0);
  find(root, "skill-source").handlers.on_click({}, cx);
  assert.equal(view.raw, true);
  find(root, "skill-close").handlers.on_click({}, cx);
  assert.deepEqual(world.closed, ["reader"]);
});

test("a disappeared skill reports recovery instead of showing stale instructions", async () => {
  const view = setup(); world.text = null;
  world.props = { overlay: "reader", skill: world.catalog[0] };
  view.init({}, cx); await Promise.all(world.tasks);
  assert.match(view.readerError, /refresh the list/);
  assert.equal(view.text, undefined);
  assert.doesNotThrow(() => view.render(cx));
});

test("keyboard navigation and search-submit follow the displayed group order", async () => {
  const view = setup();
  world.catalog = [skill("alpha-personal", [install("claude", "personal")]), skill("zeta-project", [install("codex", "project")])];
  view.init({}, cx); await Promise.all(world.tasks);
  let root = view.render(cx);
  root.handlers.on_key_down({ key: "enter" }, cx);
  root.handlers.on_key_down({ key: "down" }, cx);
  root = view.render(cx);
  root.handlers.on_key_down({ key: "enter" }, cx);
  assert.deepEqual(world.overlays.map(overlay => overlay.props.skill.name), ["zeta-project", "alpha-personal"]);
  view.search.set_value("review"); view.search.handlers.change({}, cx);
  view.search.handlers.submit({}, cx);
  assert.equal(world.overlays.at(-1).props.skill.name, "zeta-project");
});
