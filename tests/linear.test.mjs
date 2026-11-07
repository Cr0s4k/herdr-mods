import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const contextSource = await readFile(new URL("../mods/skills/model.js", import.meta.url), "utf8");
const context = await import("data:text/javascript," + encodeURIComponent(contextSource));
const modelSource = (await readFile(new URL("../mods/linear/model.js", import.meta.url), "utf8")).replace(/^export \{ contextFor \}.*\n/, "");
const model = await import("data:text/javascript," + encodeURIComponent(modelSource));
const issue = { id: "PRO-31", uuid: "uuid", title: "Capture events", description: "Full **requirements**", url: "https://linear.app/work/issue/PRO-31", status: "Todo", project: "Office", relations: { blockedBy: [{ id: "PRO-30", title: "Setup" }] } };

test("handoff includes full context, blockers and extra instructions", () => {
  const text = model.taskFor(issue, "  Use Python  ");
  for (const value of ["PRO-31", issue.title, issue.url, issue.description, "PRO-30: Setup", "Use Python", "Do not change Linear status or assignee"]) assert.ok(text.includes(value));
});

test("Linear disclosure blocks preserve surrounding Markdown and nested content", () => {
  const blocks = model.descriptionBlocks("## Why\n\nIntro\n\n>>> Details\n\n**Where**\n\n>>> Checks\nRun tests\n>>>\n\nMore\n>>>\n\nEnd");
  assert.equal(blocks[0].kind, "markdown");
  assert.equal(blocks[1].title, "Details");
  assert.equal(blocks[1].blocks[1].title, "Checks");
  assert.match(blocks[1].blocks[0].text, /\*\*Where\*\*/);
  assert.match(blocks[2].text, /End/);
});

test("fenced examples and incomplete disclosure blocks remain ordinary Markdown", () => {
  for (const source of ["```md\n>>> Details\nCode example\n>>>\n```", "~~~md\n>>> Details\nCode\n>>>\n~~~", ">>> Incomplete\nKeep all requirements"]) {
    const blocks = model.descriptionBlocks(source);
    assert.equal(blocks.length, 1); assert.equal(blocks[0].kind, "markdown"); assert.equal(blocks[0].text, source);
  }
});

test("new agent is bound to the chosen space, folder and installed program", () => {
  const destination = { space: "remote/space", cwd: "/srv/app", on: "remote" };
  const agent = { installed: true, run: ["codex"] };
  assert.deepEqual(model.startArgs(issue, agent, destination), { name: "PRO-31", space: "remote/space", folder: "/srv/app", argv: ["codex"], task: model.taskFor(issue) });
  assert.equal(model.startArgs(issue, { ...agent, installed: false }, destination), null);
  assert.equal(model.startArgs(issue, agent, { ...destination, cwd: null }), null);
  assert.deepEqual(model.targetsFor([{ address: "idle", space: "s", status: "idle" }, { address: "busy", space: "s", status: "working" }, { address: "elsewhere", space: "other", status: "idle" }], { space: "s" }).map(a => a.address), ["idle"]);
});

const world = {};
function native(id) {
  const data = { nodes: [], styles: typeof id === "string" ? { id: [id] } : {}, handlers: {} };
  let el;
  el = new Proxy(data, { get(t, key) {
    if (key in t) return t[key];
    if (key === "child") return child => { t.nodes.push(child); return el; };
    if (key === "children") return children => { t.nodes.push(...children); return el; };
    if (key === "when") return (condition, apply) => condition ? apply(el) : el;
    if (key.startsWith("on_")) return (...args) => { t.handlers[key] = args.at(-1); return el; };
    return (...args) => { t.styles[key] = args; return el; };
  } });
  return el;
}
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.__linearNative = {
  ...model, contextFor: context.contextFor, View: class {}, div: native, svg: native, h_flex: native, v_flex: native,
  Button: { new: native }, Input: { new: native }, TextView: { markdown: native },
  v_virtual_list: (id, count, _height, key, render) => native(id).children(render({ start: 0, end: count })),
  VirtualListScrollHandle: { new: () => ({ scroll_to_item: (...args) => world.scrolls.push(args), release() {} }) },
  Scrollbar: { vertical: native },
  InputState: { new: (options = {}) => {
    let value = options.value ?? ""; const handlers = {};
    return { handlers, value: () => value, set_value: next => { value = next; }, on: (name, fn) => { handlers[name] = fn; }, release() {} };
  } },
  appHome: () => "/app", props: () => ({}), spaces: () => world.spaces, panes: () => world.panes,
  focused: () => world.focus, agents: () => world.agents, theme: () => new Proxy({}, { get: (_, key) => key }),
  readTextFile: async () => "reader", knownAgents: async () => [{ key: "codex", installed: true, name: "Codex", run: ["codex"] }],
  exec: (_cmd, args, options) => {
    world.execs.push({ args, options });
    return world.defer ? new Promise(resolve => world.waiters.push(resolve)) : Promise.resolve({ code: 0, stdout: JSON.stringify({ data: { issues: [issue] }, source: "Claude login" }) });
  },
  hc: async args => { world.sends.push(args); return { code: 0 }; },
  run: (command, args) => { world.calls.push([command, args]); if (command === "tab.new") world.spaces[0].tabs.push({ id: "new", name: args.name }); },
  moveToPaneButton: () => native(),
};
let source = (await readFile(new URL("../mods/linear/main.js", import.meta.url), "utf8")).replace(/^import .*;\n/gm, "");
source = `const { ${Object.keys(globalThis.__linearNative).join(", ")} } = globalThis.__linearNative;\n` + source;
const { default: Linear } = await import("data:text/javascript," + encodeURIComponent(source));
const cx = { focus_handle: () => ({ focus() {} }), notify() {}, stop_propagation() {}, sleep: async () => {},
  timer: { every() {}, after: (_ms, fn) => world.timers.push(fn) }, spawn: fn => world.tasks.push(fn(cx)), write_to_clipboard() {} };
function setup() {
  Object.assign(world, { spaces: [{ id: "space", active: true, folder: "/project", tabs: [{ id: "tab", active: true }] }],
    panes: [{ pane: "pane", tab: "tab", cwd: "/project", terminal: "t1" }], focus: { pane: "pane" },
    agents: [{ space: "space", address: "t1", status: "idle", program: { name: "Codex" } }],
    tasks: [], execs: [], waiters: [], calls: [], sends: [], timers: [], scrolls: [], defer: false });
  const view = new Linear(); view.script = "reader"; view.init({}, cx); return view;
}
function find(el, id) { return el?.styles?.id?.[0] === id ? el : (el?.nodes ?? []).map(child => find(child, id)).find(Boolean); }

test("ticket details start collapsed, toggle both ways, and handoff keeps the full source", async () => {
  const view = setup(); await Promise.all(world.tasks);
  const description = "Intro\n\n>>> Details\nSecret body requirements\n>>>";
  view.detail = { ...issue, description };
  const id = "linear-description-uuid-details-2";
  let root = view.renderDetail(globalThis.__linearNative.theme());
  assert.equal(find(root, id).styles.accessibility_label[0], "Expand Details");
  assert.equal(find(root, "linear-description-uuid-text-3-0"), undefined);
  find(root, id).handlers.on_click({}, cx);
  root = view.renderDetail(globalThis.__linearNative.theme());
  assert.equal(find(root, id).styles.accessibility_label[0], "Collapse Details");
  assert.ok(find(root, "linear-description-uuid-text-3-0"));
  find(root, id).handlers.on_click({}, cx);
  assert.equal(find(view.renderDetail(globalThis.__linearNative.theme()), "linear-description-uuid-text-3-0"), undefined);
  assert.ok(model.taskFor(view.detail).includes(description));
});

test("live list renders and account requests stay local for a remote destination", async () => {
  const view = setup(); await Promise.all(world.tasks);
  assert.ok(find(view.render(cx), "linear-issue-uuid"));
  world.spaces[0].machine = "vps";
  view.refresh(cx, true); await Promise.all(world.tasks);
  assert.ok(world.execs.every(call => call.options === undefined));
});

test("search immediately invalidates stale results before debounce", async () => {
  const view = setup(); await Promise.all(world.tasks);
  world.defer = true; view.refresh(cx);
  view.search.set_value("new query"); view.search.handlers.change({}, cx);
  world.waiters[0]({ code: 0, stdout: JSON.stringify({ data: { issues: [{ ...issue, title: "Stale" }] } }) });
  await Promise.all(world.tasks);
  assert.deepEqual(view.items, []);
  world.timers.at(-1)(cx);
  assert.equal(JSON.parse(world.execs.at(-1).args.at(-1)).query, "new query");
  world.waiters[1]({ code: 0, stdout: JSON.stringify({ data: { issues: [issue] } }) });
  await Promise.all(world.tasks);
  assert.equal(view.items[0].title, issue.title);
});

test("failed refresh keeps loaded results and shows an error", async () => {
  const view = setup(); await Promise.all(world.tasks);
  world.defer = true; view.refresh(cx);
  world.waiters[0]({ code: 1, stdout: JSON.stringify({ error: "Offline" }) });
  await Promise.all(world.tasks);
  assert.equal(view.items.length, 1); assert.equal(view.error, "Offline");
});

test("assignment revalidates idle status and folder before sending", async () => {
  const view = setup(); await Promise.all(world.tasks);
  view.detail = issue; view.destination = { space: "space", cwd: "/project" }; view.target = { kind: "existing", key: "t1" };
  world.agents[0].status = "working";
  view.send(cx); await Promise.all(world.tasks);
  assert.equal(world.sends.length, 0); assert.match(view.sendError, /no longer idle/);
  world.agents[0].status = "idle"; world.panes[0].cwd = "/wrong";
  view.send(cx); await Promise.all(world.tasks); assert.equal(world.sends.length, 0);
  world.panes[0].cwd = "/project";
  view.send(cx); view.send(cx); await Promise.all(world.tasks);
  assert.equal(world.sends.length, 1);
  assert.deepEqual(world.sends[0].slice(-2), ["--if", "idle"]);
});

test("starting a ticket creates exactly one tab in its captured destination", async () => {
  const view = setup(); await Promise.all(world.tasks);
  view.detail = issue; view.prepare(cx); await Promise.all(world.tasks);
  world.focus = { pane: "another" };
  view.send(cx); view.send(cx); await Promise.all(world.tasks);
  assert.equal(world.calls.length, 1);
  assert.equal(world.calls[0][1].space, "space"); assert.equal(world.calls[0][1].folder, "/project");
  assert.equal(view.sent.tab, "new");
});

test("closed tickets are hidden until Include done is selected", async () => {
  const view = setup(); await Promise.all(world.tasks);
  view.items.push({ ...issue, id: "PRO-32", uuid: "closed", statusType: "completed" });
  assert.equal(view.visible().length, 1);
  find(view.render(cx), "linear-include-done").handlers.on_click({}, cx);
  assert.equal(view.visible().length, 2);
});

test("arrow navigation visibly selects and scrolls to the ticket Enter opens", async () => {
  const view = setup(); await Promise.all(world.tasks);
  view.items = Array.from({ length: 30 }, (_, index) => ({ ...issue, id: `PRO-${index}`, uuid: `uuid-${index}` }));
  for (let i = 0; i < 25; i++) view.render(cx).handlers.on_key_down({ key: "down" }, cx);
  const row = find(view.render(cx), "linear-issue-uuid-25");
  assert.equal(row.styles.aria_selected[0], true);
  assert.equal(row.styles.bg[0], "selected");
  assert.deepEqual(world.scrolls.at(-1), [25, "center"]);
  view.render(cx).handlers.on_key_down({ key: "enter" }, cx);
  assert.equal(view.detail.uuid, "uuid-25");
  await Promise.all(world.tasks);
});
