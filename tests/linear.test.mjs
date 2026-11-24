import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// The mods log what is opened through ./usage.js, which these tests leave out with the other imports.
globalThis.track = (feature, name) => (globalThis.tracked ??= []).push(`${feature}.${name}`);

const contextSource = await readFile(new URL("../mods/skills/model.js", import.meta.url), "utf8");
const context = await import("data:text/javascript," + encodeURIComponent(contextSource));
const modelSource = (await readFile(new URL("../mods/pipeline/procedures.js", import.meta.url), "utf8")) + (await readFile(new URL("../mods/linear/model.js", import.meta.url), "utf8")).replace(/^export \{ contextFor \}.*\n/, "").replace(/^import .*;\n/m, "");
const model = await import("data:text/javascript," + encodeURIComponent(modelSource));
await model.loadProcedures(path => readFile(new URL(`../${path}`, import.meta.url), "utf8"));
const issue = { id: "PRO-31", uuid: "uuid", title: "Capture events", description: "Full **requirements**", url: "https://linear.app/work/issue/PRO-31", status: "Todo", project: "Office", relations: { blockedBy: [{ id: "PRO-30", title: "Setup" }] } };

test("handoff includes full context, blockers and extra instructions", () => {
  const text = model.taskFor(issue, "  Use Python  ");
  for (const value of ["PRO-31", issue.title, issue.url, issue.description, "PRO-30: Setup", "Use Python", "Do not change its Linear status or assignee unless I ask"]) assert.ok(text.includes(value));
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
  ...model, loadProcedures: async () => {}, contextFor: context.contextFor, View: class {}, div: native, svg: native, h_flex: native, v_flex: native,
  Button: { new: native }, Input: { new: native }, TextView: { markdown: native },
  v_virtual_list: (id, count, _height, key, render) => native(id).children(render({ start: 0, end: count })),
  VirtualListScrollHandle: { new: () => ({ scroll_to_item: (...args) => world.scrolls.push(args), release() {} }) },
  Scrollbar: { vertical: native },
  InputState: { new: (options = {}) => {
    let value = options.value ?? ""; const handlers = {};
    return { handlers, value: () => value, set_value: next => { value = next; }, on: (name, fn) => { handlers[name] = fn; }, focus() {}, release() {} };
  } },
  appHome: () => "/app", props: () => ({}), spaces: () => world.spaces, panes: () => world.panes,
  focused: () => world.focus, agents: () => world.agents, theme: () => new Proxy({}, { get: (_, key) => key }),
  readTextFile: async () => "reader", knownAgents: async () => [{ key: "codex", installed: true, name: "Codex", run: ["codex"] }],
  exec: (_cmd, args, options) => {
    world.execs.push({ args, options });
    if (world.respond) return Promise.resolve(world.respond(JSON.parse(args.at(-1))));
    return world.defer ? new Promise(resolve => world.waiters.push(resolve)) : Promise.resolve({ code: 0, stdout: JSON.stringify({ data: { issues: [issue] }, source: "Claude login" }) });
  },
  hc: async args => { world.sends.push(args); return { code: 0 }; },
  LAUNCHES: "linear.launches", PENDING: ["queued", "creating", "starting"],
  shared: key => world.shared.get(key),
  worktrees: async (context, payload) => {
    world.worktrees.push({ context, payload });
    if (world.worktreeError) throw new Error(world.worktreeError);
    return { runId: "batch", base: "a".repeat(40), branch: "main", root: context.cwd, common: "/project/.git", workspaces: payload.tickets.map(ticket => ({ ...ticket, branch: `linear/${ticket.key}` })) };
  },
  queueLaunch: batch => world.shared.set("linear.launches", [...(world.shared.get("linear.launches") ?? []), batch]),
  updateLaunch: (id, apply) => world.shared.set("linear.launches", world.shared.get("linear.launches").map(batch => batch.id === id ? apply(batch) : batch)),
  retryLaunch() {},
  run: (command, args) => { world.calls.push([command, args]); if (command === "tab.new") world.spaces[0].tabs.push({ id: "new", name: args.name }); },
  moveToPaneButton: (kind, state) => { world.moves.push({ kind, state }); return native(); },
  bindMoveCommand: () => {},
};
let source = (await readFile(new URL("../mods/linear/main.js", import.meta.url), "utf8")).replace(/^import .*;\n/gm, "");
source = `const { ${Object.keys(globalThis.__linearNative).join(", ")} } = globalThis.__linearNative;\n` + source + "\n//# sourceURL=linear-panel-test.js";
const { default: Linear } = await import("data:text/javascript," + encodeURIComponent(source));
const cx = { focus_handle: () => ({ focus() {} }), notify() {}, stop_propagation() {}, sleep: async () => {},
  timer: { every() {}, after: (_ms, fn) => world.timers.push(fn) }, spawn: fn => world.tasks.push(fn(cx)), write_to_clipboard() {} };
function setup(Type = Linear, respond = null) {
  Object.assign(world, { spaces: [{ id: "space", active: true, folder: "/project", tabs: [{ id: "tab", active: true }] }],
    panes: [{ pane: "pane", tab: "tab", cwd: "/project", terminal: "t1" }], focus: { pane: "pane" },
    agents: [{ space: "space", address: "t1", status: "idle", program: { name: "Codex" } }],
    tasks: [], execs: [], waiters: [], calls: [], sends: [], timers: [], scrolls: [], defer: false,
    shared: new Map(), worktrees: [], worktreeError: null, respond, moves: [] });
  const view = new Type(); view.script = "reader"; view.init({}, cx); return view;
}
function find(el, id) { return el?.styles?.id?.[0] === id ? el : (el?.nodes ?? []).map(child => find(child, id)).find(Boolean); }

globalThis.__planeNative = {
  Tickets: Linear,
  ...Object.fromEntries(["div", "v_flex", "h_flex", "Input", "InputState", "appHome", "props", "run"].map(key => [key, globalThis.__linearNative[key]])),
  Textarea: { new: native }, TextareaState: globalThis.__linearNative.InputState,
};
let planeSource = (await readFile(new URL("../mods/plane/main.js", import.meta.url), "utf8")).replace(/^import .*;\n/gm, "");
planeSource = `const { ${Object.keys(globalThis.__planeNative).join(", ")} } = globalThis.__planeNative;\n` + planeSource + "\n//# sourceURL=plane-panel-test.js";
const { default: Plane } = await import("data:text/javascript," + encodeURIComponent(planeSource));
const planeProject = { id: "plane-project", name: "Herdr Mods" };
const planeIssue = { ...issue, provider: "plane", uuid: "plane:project:issue", url: "https://plane.example.test/herdr/browse/HMOD-1/" };
const planeResponse = (payload) => ({ code: 0, stdout: JSON.stringify({ source: "Plane", data: payload.op === "connection"
  ? { baseUrl: "https://plane.example.test", workspace: "herdr" }
  : payload.op === "issues" ? { issues: [planeIssue], project: planeProject } : planeIssue }) });

test("Plane uses the shared task panel, local connection and project-specific capture", async () => {
  const view = setup(Plane, planeResponse); await Promise.all(world.tasks);
  assert.equal(view.scope, "all"); assert.equal(view.title, "Tasks");
  assert.equal(view.project.id, planeProject.id);
  assert.ok(find(view.render(cx), "linear-issue-plane:project:issue"));
  assert.equal(world.moves.at(-1).kind, "plane");
  find(view.render(cx), "plane-new-task").handlers.on_click({}, cx);
  view.captureTitle.set_value("Remote capture"); view.captureDescription.set_value("Full requirements");
  view.saveCapture(cx); view.saveCapture(cx); await Promise.all(world.tasks);
  const creates = world.execs.map(call => JSON.parse(call.args.at(-1))).filter(payload => payload.op === "create");
  assert.equal(creates.length, 1);
  assert.equal(creates[0].project, planeProject.id); assert.equal(creates[0].title, "Remote capture");
  assert.equal(creates[0].context.cwd, "/project"); assert.equal(view.capture, false);
  assert.match(model.taskFor(planeIssue), /Work on Plane ticket/);
  assert.match(model.taskFor(planeIssue), /Do not change its Plane status or assignee unless I ask/);
});

test("unconfirmed Plane captures cannot be submitted again", async () => {
  const view = setup(Plane, payload => payload.op === "create"
    ? { code: 1, stdout: JSON.stringify({ error: "Check Plane before trying again", kind: "uncertain" }) } : planeResponse(payload));
  await Promise.all(world.tasks);
  find(view.render(cx), "plane-new-task").handlers.on_click({}, cx);
  view.captureTitle.set_value("Task"); view.saveCapture(cx); await Promise.all(world.tasks);
  view.saveCapture(cx); await Promise.all(world.tasks);
  assert.equal(world.execs.filter(call => JSON.parse(call.args.at(-1)).op === "create").length, 1);
  assert.equal(view.captureUncertain, true); assert.equal(view.capture, true);
  assert.ok(find(view.render(cx), "plane-check-save"));
});

test("Plane capture cannot write into a different working folder after navigation", async () => {
  const view = setup(Plane, planeResponse); await Promise.all(world.tasks);
  find(view.render(cx), "plane-new-task").handlers.on_click({}, cx);
  view.captureTitle.set_value("Task"); view.context = { ...view.context, cwd: "/different" };
  view.saveCapture(cx); await Promise.all(world.tasks);
  assert.equal(world.execs.filter(call => JSON.parse(call.args.at(-1)).op === "create").length, 0);
  assert.match(view.captureError, /working folder changed/);
});

test("an unmapped Plane project offers linking and hides the existing ticket selection", async () => {
  const view = setup(Plane, payload => payload.op === "issues"
    ? { code: 0, stdout: JSON.stringify({ data: { issues: [], needsProject: true } }) } : planeResponse(payload));
  await Promise.all(world.tasks);
  assert.ok(find(view.render(cx), "plane-link-project"));
  assert.equal(view.project, null);
});

test("Plane mapping clears ticket selection and persists the captured repository context", async () => {
  const view = setup(Plane, planeResponse); await Promise.all(world.tasks);
  view.picked.set(planeIssue.uuid, planeIssue); view.selecting = true;
  view.chooseProject({ id: "other-project", name: "Other" }, cx); await Promise.all(world.tasks);
  const mapping = world.execs.map(call => JSON.parse(call.args.at(-1))).find(payload => payload.op === "map");
  assert.equal(mapping.project, "other-project"); assert.equal(mapping.context.cwd, "/project");
  assert.equal(view.picked.size, 0); assert.equal(view.mapping, false);
});

test("a moved Tasks pane resolves the new repository before capturing or launching work", async () => {
  const view = setup(Plane, payload => payload.op === "issues" && payload.context.cwd === "/other-repository"
    ? { code: 0, stdout: JSON.stringify({ data: { issues: [], project: { id: "other", name: "Other repository" } } }) }
    : planeResponse(payload));
  await Promise.all(world.tasks);
  view.embedded = true; view.picked.set(planeIssue.uuid, planeIssue);
  view.capture = true; view.detail = planeIssue;
  world.panes[0].cwd = "/other-repository";
  view.render(cx); await Promise.all(world.tasks);
  const latest = world.execs.map(call => JSON.parse(call.args.at(-1))).filter(payload => payload.op === "issues").at(-1);
  assert.equal(latest.context.cwd, "/other-repository");
  assert.equal(latest.project, undefined);
  assert.equal(view.project.id, "other"); assert.equal(view.capture, false);
  assert.equal(view.detail, null); assert.equal(view.picked.size, 0);
});

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

test("selection uses stable tickets, survives search, and moves to a pane with its state", async () => {
  const view = setup(); await Promise.all(world.tasks);
  find(view.render(cx), "linear-select-tickets").handlers.on_click({}, cx);
  find(view.render(cx), "linear-list").handlers.on_item_click("uuid", cx);
  assert.equal(view.detail, undefined); assert.equal(view.picked.size, 1);
  view.items = [{ ...issue, id: "PRO-32", uuid: "second" }];
  find(view.render(cx), "linear-select-shown").handlers.on_click({}, cx);
  assert.deepEqual([...view.picked.keys()], ["uuid", "second"]);
  assert.equal(view.state().picked.length, 2);
  assert.ok(find(view.render(cx), "linear-review-launch"));
});

test("batch review fetches full tickets and captures the destination before any launch", async () => {
  const view = setup(); await Promise.all(world.tasks);
  view.toggleTicket(issue, cx);
  view.toggleTicket({ ...issue, id: "PRO-32", uuid: "second" }, cx);
  view.read = async payload => ({ ...issue, uuid: payload.id, description: `Full details ${payload.id}`, relations: { blockedBy: [{ id: "PRO-30" }] } });
  view.prepareBatch(cx); await Promise.all(world.tasks);
  assert.equal(world.calls.length, 0); assert.equal(world.sends.length, 0);
  assert.equal(world.worktrees[0].payload.op, "inspect");
  const root = view.render(cx);
  assert.ok(find(root, "linear-batch-launch"));
  world.spaces[0].folder = "/elsewhere"; world.panes[0].cwd = "/elsewhere";
  view.launchBatch(cx); view.launchBatch(cx);
  const launches = world.shared.get("linear.launches");
  assert.equal(launches.length, 1); assert.equal(launches[0].context.cwd, "/project");
  assert.equal(launches[0].rows.length, 2);
  assert.ok(launches[0].rows[0].task.includes("Full details uuid"));
  assert.equal(view.picked.size, 0); assert.equal(world.calls.length, 0);
});

test("repository preflight failure keeps selection and cannot enqueue agents", async () => {
  const view = setup(); await Promise.all(world.tasks);
  view.toggleTicket(issue, cx); world.worktreeError = "Not a Git repository";
  view.prepareBatch(cx); await Promise.all(world.tasks);
  assert.match(view.draft.error, /Not a Git repository/);
  view.launchBatch(cx);
  assert.equal(view.picked.size, 1); assert.equal(world.shared.size, 0); assert.equal(world.calls.length, 0);
});
