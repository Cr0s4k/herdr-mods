import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import test from "node:test";

const world = {};
function element() {
  let el;
  el = new Proxy({ nodes: [], handlers: {}, styles: {} }, { get(t, key) {
    if (key in t) return t[key];
    if (key === "child") return n => { t.nodes.push(n); return el; };
    if (key === "children") return ns => { t.nodes.push(...ns); return el; };
    if (key === "when") return (on, apply) => on ? apply(el) : el;
    if (key.startsWith("on_")) return fn => {
      assert.ok(!world.renderingRows, "Native virtual list rows cannot register event handlers");
      t.handlers[key.slice(3)] = fn; return el;
    };
    return (...args) => { t.styles[key] = args; return el; };
  } });
  return el;
}
const cx = { notify() {}, stop_propagation() {}, focus_handle: () => ({ focus() {} }),
  spawn: fn => world.tasks.push(fn(cx)), sleep: async () => { world.onSleep?.(); } };
globalThis.__spaceNewNative = {
  View: class {}, div: element, svg: element, v_flex: element, h_flex: element,
  Input: { new: element }, InputState: { new: () => ({ text: "", handlers: {},
    on(name, fn) { this.handlers[name] = fn; }, value() { return this.text; }, focus() {} }) },
  VirtualListScrollHandle: { new: () => ({ scroll_to_item: i => world.scroll = i }) },
  Scrollbar: { vertical: element },
  v_virtual_list: (_id, count, _size, _key, render) => {
    world.renderingRows = true;
    try { return element().children(render({ start: 0, end: count })); }
    finally { world.renderingRows = false; }
  },
  home: () => "/home/user", props: () => world.props,
  shared: key => world.shared?.[key], setShared: (key, value) => { (world.shared ??= {})[key] = value; },
  spaces: () => world.spaces, panes: () => world.panes, focused: () => world.focus,
  terminals: () => [], theme: () => new Proxy({}, { get: (_, key) => key }),
  closeOverlay: id => world.closed.push(id), openOverlay: spec => world.opened.push(spec),
  notify: n => world.notices.push(n),
  exec: async (...args) => {
    if (world.realExec) {
      const { stdout, stderr } = await promisify(execFile)(...args);
      return { code: 0, stdout, stderr };
    }
    if (world.listError) return { code: 1, stderr: "missing folder" };
    return { code: 0, stdout: JSON.stringify(world.names) };
  },
  run: (name, args) => {
    world.calls.push([name, args]);
    if (name === "space.new" && args && !world.failCreate) {
      const create = () => {
        world.spaces.forEach(s => s.active = false);
        world.spaces.push({ id: "new", active: true, folder: args.folder, tabs: [{ id: "new-tab", active: true }] });
        world.focus = { space: "new", tab: "new-tab", pane: "left" };
        if (!world.delayTerminal) world.panes.push({ tab: "new-tab", pane: "left", terminal: "shell1", cwd: args.folder });
      };
      if (world.delayCreate) world.pendingCreate = create;
      else create();
    }
    if (name === "pane.split") world.panes.push({ pane: "review", tab: world.focus.tab, mod: args.mod });
    if (name === "pane.focus") world.focus.pane = args.pane;
    if (name === "terminal.open") world.panes.push({ pane: "right-shell", tab: world.focus.tab, terminal: "shell2", cwd: args.folder });
    if (name === "pane.close") world.panes = world.panes.filter(p => p.pane !== args.pane);
  },
};
async function load(path, names) {
  const source = (await readFile(new URL(path, import.meta.url), "utf8")).replace(/^import .*;\n/gm, "");
  return import("data:text/javascript," + encodeURIComponent(`const { ${names} } = globalThis.__spaceNewNative;\n${source}`));
}
const { ReviewPanes } = await load("../mods/tabs-show/review.js", "spaces, panes, terminals, focused, run, notify");
const { listProjects } = await load("../mods/space-new/projects.js", "exec");
Object.assign(globalThis.__spaceNewNative, { ReviewPanes, listProjects });
const { default: Picker } = await load("../mods/space-new/main.js", "View, div, svg, h_flex, v_flex, Input, InputState, v_virtual_list, VirtualListScrollHandle, Scrollbar, home, spaces, panes, focused, run, theme, props, openOverlay, closeOverlay, shared, setShared, listProjects, ReviewPanes");
function setup(projects = true) {
  Object.assign(world, { props: { overlay: "picker", projects }, tasks: [], calls: [], closed: [], opened: [], notices: [],
    spaces: [{ id: "remote", active: true, machine: "other", tabs: [{ id: "old-tab", active: true }] }], panes: [],
    focus: { space: "remote", tab: "old-tab" }, names: ["Zebra", "alpha"], onSleep: null,
    realExec: false, listError: false, failCreate: false, delayTerminal: false, delayCreate: false, pendingCreate: null });
  const picker = new Picker(); picker.init({}, cx); return picker;
}
async function drain() { for (let i = 0; i < world.tasks.length; i++) await world.tasks[i]; }
function find(el, id) { return el?.styles?.id?.[0] === id ? el : (el?.nodes ?? []).map(n => find(n, id)).find(Boolean); }

test("normal creation keeps the usual defaults; project choice opens a picker without creating a space", () => {
  const picker = setup(false);
  picker.choose(0);
  assert.deepEqual(world.calls, [["space.new", undefined]]);
  world.calls = [];
  picker.choose(1);
  assert.deepEqual(world.calls, []);
  assert.equal(world.opened[0].props.projects, true);
});

test("project selection from a remote space creates two local shells and review, with focus on the left", async () => {
  const picker = setup(); await drain();
  assert.deepEqual(picker.projects.map(p => p.name), ["alpha", "Zebra"]);
  picker.input.text = "ALP";
  assert.equal(picker.filtered().length, 1);
  picker.input.handlers.submit({}, cx);
  picker.input.handlers.submit({}, cx);
  await drain();
  assert.equal(world.calls.filter(([name]) => name === "space.new").length, 1);
  assert.deepEqual(world.calls[0], ["space.new", { folder: "/home/user/Projects/alpha", machine: "" }]);
  assert.equal(world.panes.length, 3);
  assert.equal(world.focus.pane, "left");
  assert.equal(world.panes.find(p => p.pane === "right-shell").cwd, "/home/user/Projects/alpha");
  assert.deepEqual(world.closed, ["picker"]);
  assert.equal(world.notices.length, 0);
});

test("the projects folder can be changed and is remembered", async () => {
  world.shared = {};
  const picker = setup(); await drain();
  assert.equal(picker.label(), "~/Projects");
  find(picker.render(), "projects-folder").handlers.click({}, cx);
  picker.folder.text = " ~/code/ ";
  picker.folder.handlers.submit({}, cx); await drain();
  assert.deepEqual([picker.root, picker.label(), world.shared["projects.root"]], ["/home/user/code", "~/code", "/home/user/code"]);
  assert.equal(picker.projects[0].folder, "/home/user/code/alpha");
  assert.equal(setup().root, "/home/user/code", "the next picker opens on the saved folder");
  picker.setRoot("/srv/work", cx);
  assert.equal(picker.label(), "/srv/work");
  world.shared = {};
});

test("keyboard navigation selects and scrolls projects; an empty search cannot create a space", async () => {
  const picker = setup(); await drain();
  picker.key({ key: "up", modifiers: {} }, cx);
  assert.equal(picker.at, 1);
  assert.equal(world.scroll, 1);
  picker.input.text = "missing";
  picker.input.handlers.change({}, cx);
  picker.input.handlers.submit({}, cx);
  assert.equal(picker.at, 0);
  assert.equal(world.calls.length, 0);
  picker.render();
});

test("creation waits for native snapshots to publish the new space before arranging its panes", async () => {
  const picker = setup(); await drain();
  world.delayCreate = true;
  world.onSleep = () => { world.pendingCreate?.(); world.pendingCreate = null; };
  picker.create(picker.projects[0], cx); await drain();
  assert.equal(world.panes.length, 3);
  assert.equal(world.focus.pane, "left");
  assert.deepEqual(world.closed, ["picker"]);
});

test("clicking a virtual project row opens the path identified when pressed", async () => {
  const picker = setup(); await drain();
  const list = find(picker.render(), "projects-list");
  picker.input.text = "alpha";
  list.handlers.item_click("/home/user/Projects/Zebra", cx);
  await drain();
  assert.equal(world.calls[0][1].folder, "/home/user/Projects/Zebra");
});

test("list failures expose retry and recover; empty lists still render", async () => {
  const picker = setup(); await drain();
  world.listError = true; picker.load(cx); await drain();
  assert.ok(find(picker.render(), "projects-retry"));
  world.listError = false; world.names = [];
  picker.load(cx); await drain();
  assert.equal(picker.error, null);
  assert.deepEqual(picker.projects, []);
  picker.render();
});

test("switching away during shell startup never splits another tab or duplicates the new space", async () => {
  const picker = setup(); await drain();
  world.delayTerminal = true;
  world.onSleep = () => { world.focus.tab = "old-tab"; };
  picker.create(picker.projects[0], cx); await drain();
  assert.equal(picker.created, "new");
  assert.match(picker.error, /Return to the new space/);
  assert.ok(!world.calls.some(([name]) => name === "pane.split"));
  picker.input.handlers.submit({}, cx); await drain();
  assert.equal(world.calls.filter(([name]) => name === "space.new").length, 1);
});

test("real project reader lists only visible directories, including links and literal unusual names", async () => {
  setup(false); world.realExec = true;
  const root = await mkdtemp(`${tmpdir()}/herdr-projects-`);
  try {
    for (const name of ["alpha", "Beta", "quotes ' and $(literal)\nname", ".hidden"]) await mkdir(`${root}/${name}`);
    await writeFile(`${root}/file`, "not a project");
    await symlink(`${root}/alpha`, `${root}/linked`);
    const projects = await listProjects(root);
    assert.deepEqual(projects.map(p => p.name), ["alpha", "Beta", "linked", "quotes ' and $(literal)\nname"]);
    assert.ok(projects.every(p => p.folder.startsWith(`${root}/`)));
  } finally { await rm(root, { recursive: true, force: true }); }
});
