import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const modelSource = await readFile(new URL("../mods/pipeline/pipeline-model.js", import.meta.url), "utf8");
const model = await import(`data:text/javascript,${encodeURIComponent(modelSource)}`);
const geometrySource = (await readFile(new URL("../mods/pipeline/geometry.js", import.meta.url), "utf8")).replace(/^import .*;\n/gm, "");
const geometry = await import(`data:text/javascript,${encodeURIComponent(`const ACTIVE = ${JSON.stringify(model.ACTIVE)};\n${geometrySource}`)}`);
const world = { data: {}, storage: new Map(), hc: [], runs: [], planeCalls: [] };
function native() {
  const data = { nodes: [], styles: {}, handlers: {} };
  let element;
  element = new Proxy(data, { get(target, key) {
    if (key in target) return target[key];
    if (key === "child") return value => { target.nodes.push(value); return element; };
    if (key === "children") return values => { target.nodes.push(...values); return element; };
    if (key === "when") return (condition, fn) => condition ? fn(element) : element;
    if (key.startsWith("on_")) return (...values) => { target.handlers[key] = values.at(-1); return element; };
    return (...values) => { target.styles[key] = values; return element; };
  } });
  return element;
}
const path = () => new Proxy({}, { get: (_target, key) => key === "build" ? () => ({}) : () => path() });
globalThis.__pipelineView = {
  TextareaState: { new: () => globalThis.__pipelineView.InputState.new() },
  ...model, ...geometry, View: class {}, div: native, svg: native, h_flex: native, v_flex: native,
  Button: { new: id => native().id(id) }, Input: { new: native }, Textarea: { new: native },
  InputState: { new: () => { let value = ""; const handlers = {}; return { on(name, fn) { handlers[name] = fn; }, emit: (name, cx) => handlers[name]?.({}, cx), focus() {}, release() {}, value: () => value, set_value: next => { value = next; } }; } },
  hc: async args => { world.hc.push(args); return { code: 0, stdout: world.screen ?? "" }; }, run: (name, args) => world.runs.push([name, args]),
  knownAgents: async () => [], exec: async () => ({ code: 0, stdout: "" }), focused: () => ({ space: "sp-project" }),
  trustKeys: screen => /Yes, I trust/.test(screen) ? ["down", "enter"] : null,
  fixRequest: (command, output) => `failed: ${command}\n${output}`,
  openIssue: issue => !["completed", "canceled"].includes(issue.statusType),
  readPlane: async payload => { world.planeCalls.push(payload); return world.planeReply?.(payload) ?? { issues: [] }; },
  PathBuilder: { stroke: path }, window: { paint_path: native },
  shared: key => world.data[key], setShared: (key, value) => { world.data[key] = value; },
  props: () => ({ context: world.context ?? { id: "project", name: "Project" } }), appWindow: () => ({ platform: "linux", active: true }),
  theme: () => new Proxy({}, { get: (_obj, key) => key }),
  settings: () => ({ zoom: 1.1 }),
  localStorage: { getItem: key => world.storage.get(key) ?? null, setItem: (key, value) => world.storage.set(key, value) },
};
const uiSource = (await readFile(new URL("../mods/pipeline/main.js", import.meta.url), "utf8")).replace(/^import .*;\n/gm, "");
const { default: Pipeline } = await import(`data:text/javascript,${encodeURIComponent(`const { ${Object.keys(globalThis.__pipelineView).join(", ")} } = globalThis.__pipelineView;\n${uiSource}`)}`);
const timers = [];
const cx = { notify() {}, spawn() {}, stop_propagation() {}, timer: { after: (_ms, fn) => { timers.push(fn); return { cancel() {} }; } },
  focus_handle: () => ({ focus() {}, release() {}, is_focused: () => true }) };
function setup() {
  world.data = {}; timers.length = 0;
  const view = new Pipeline(); view.init({}, cx); return view;
}
function find(node, id) {
  if (node?.styles?.id?.[0] === `pipeline-${id}`) return node;
  for (const child of node?.nodes ?? []) { const result = find(child, id); if (result) return result; }
}
function text(node) { return typeof node === "string" ? node : (node?.nodes ?? []).map(text).join(" "); }
function findAll(node, prefix, found = []) {
  if (String(node?.styles?.id?.[0] ?? "").startsWith(`pipeline-${prefix}`)) found.push(node);
  for (const child of node?.nodes ?? []) findAll(child, prefix, found);
  return found;
}
function click(view, id) {
  const node = find(view.render(cx), id);
  assert.ok(node, `control ${id} exists`);
  assert.equal(Boolean(node.styles.disabled?.[0]), false, `${id} is enabled`);
  node.handlers.on_click({}, cx);
}
const row = (view, id) => view.state().tasks.find(task => task.id === id);
const press = (view, keystroke) => view.render(cx).handlers.on_key_down({ key: keystroke, keystroke, modifiers: {} }, cx);
function inReview(view, ids) {
  for (const id of ids) { const task = row(view, id); task.status = "review"; task.delivery = "pr"; task.approvals = []; }
}

test("task picker, watch and parallel controls change the shared pipeline", () => {
  const view = setup();
  click(view, "add"); click(view, "row-DEMO-106"); click(view, "add-picked");
  assert.equal(row(view, "DEMO-106").status, "queued");
  click(view, "watch"); click(view, "watch-toggle"); click(view, "arrival");
  assert.equal(row(view, "DEMO-107").source, "Watch · Ready");
  click(view, "parallel"); click(view, "parallel-more");
  assert.equal(view.state().parallel, 4);
});

test("a typed title becomes a queued task and the field clears for the next one", () => {
  const view = setup();
  view.title.set_value("Paginate the orders endpoint");
  click(view, "create");
  const task = view.state().tasks.at(-1);
  assert.deepEqual([task.id, task.status, task.repos], ["NEW-1", "queued", ["api"]]);
  assert.equal(view.title.value(), "");
  assert.equal(find(view.render(cx), "create"), undefined, "Add appears only while typing");
});

test("Add all and Generate keep the example backlog supplied", () => {
  const view = setup();
  click(view, "add"); click(view, "add-all");
  assert.equal(view.state().tasks.filter(task => task.status === "backlog").length, 0);
  click(view, "add"); click(view, "generate");
  assert.equal(view.state().tasks.filter(task => task.status === "queued").length, 14);
});

test("all inspector branches and narrow scenes render through actual view methods", () => {
  const view = setup();
  inReview(view, ["DEMO-101"]); row(view, "DEMO-104").status = "failed"; row(view, "DEMO-105").status = "done";
  for (const width of [340, 780, 1450]) {
    view.size = { width, height: 700 };
    for (const drawer of [null, "picker", "queue", "review", "done", "activity", "settings", "quota", "watch", "task"]) {
      view.drawer = drawer; view.selected = "DEMO-101";
      assert.ok(view.render(cx));
    }
  }
});

test("per-repository approval buttons drive the task into integration", () => {
  const view = setup();
  inReview(view, ["DEMO-101"]);
  view.inspect("DEMO-101", cx);
  click(view, "approve-DEMO-101-contracts");
  assert.equal(row(view, "DEMO-101").status, "review");
  click(view, "approve-DEMO-101-api");
  assert.equal(row(view, "DEMO-101").status, "merging");
  assert.ok(view.render(cx));
});

test("cards approve and retry in one click, and the status bar approves everything", () => {
  const view = setup();
  inReview(view, ["DEMO-101", "DEMO-104"]); row(view, "DEMO-105").status = "failed";
  click(view, "approve-DEMO-101");
  assert.equal(row(view, "DEMO-101").status, "merging");
  click(view, "retry-DEMO-105");
  assert.equal(row(view, "DEMO-105").status, "queued");
  inReview(view, ["DEMO-102"]);
  click(view, "approve-all");
  assert.equal(view.state().tasks.filter(model.needsApproval).length, 0);
  assert.equal(find(view.render(cx), "approve-all"), undefined);
});

test("keyboard shortcuts start, approve, retry and change speed", () => {
  const view = setup();
  press(view, "space");
  assert.equal(view.state().running, true);
  inReview(view, ["DEMO-101"]); row(view, "DEMO-104").status = "failed";
  press(view, "y");
  assert.equal(row(view, "DEMO-101").status, "merging");
  press(view, "r");
  assert.notEqual(row(view, "DEMO-104").status, "failed");
  press(view, "s");
  assert.equal(view.state().speed, 2);
  press(view, "a");
  assert.equal(view.drawer, "picker");
  press(view, "escape");
  assert.equal(view.drawer, null);
});

test("quota limit and reset controls stop and resume dispatch", () => {
  const view = setup();
  click(view, "quota"); click(view, "quota-limit"); click(view, "run");
  assert.equal(model.activeTasks(view.state()).length, 0);
  click(view, "quota-reset");
  assert.equal(model.activeTasks(view.state()).length, 3);
});

test("every queued task remains inspectable and removable when the column overflows", () => {
  const view = setup();
  view.act({ type: "add", ids: ["DEMO-106", "DEMO-107", "DEMO-108"] }, cx);
  assert.equal(view.state().running, false);
  click(view, "queue-more");
  click(view, "row-DEMO-108");
  assert.equal(view.selected, "DEMO-108");
  click(view, "remove-DEMO-108");
  assert.equal(row(view, "DEMO-108").status, "backlog");
});

test("progress bars render the current stage, then run natively to the end of it", () => {
  const view = setup();
  view.act({ type: "run" }, cx);
  const first = findAll(view.render(cx), "bar-DEMO-101-routing");
  assert.equal(first.length, 0, "a task entering the pipeline is a comet, not a card");
  const task = row(view, "DEMO-101"); task.status = "working"; task.since = Date.now() - 4750;
  const before = findAll(view.render(cx), "bar-DEMO-101-working")[0];
  assert.ok(before.styles.w[0] > 60 && before.styles.w[0] < 90, "starts halfway");
  assert.equal(timers.length, 1, "one follow-up render is scheduled");
  const after = findAll(view.render(cx), "bar-DEMO-101-working")[0];
  assert.equal(after.styles.w[0], 144);
  assert.ok(Math.abs(after.styles.transition[1].duration - 4750) < 200);
  view.motion = false;
  const still = findAll(view.render(cx), "bar-DEMO-101-working")[0];
  assert.equal(still.styles.transition, undefined);
});

test("busy dispatch paths carry comet particles only while motion is on", () => {
  const view = setup();
  view.act({ type: "run" }, cx);
  assert.ok(findAll(view.render(cx), "flow-dispatch-0").length >= 6);
  assert.ok(findAll(view.render(cx), "flow-dispatch-0")[0].styles.frames[0].length === 6);
  assert.ok(findAll(view.render(cx), "star-")[0].styles.loop, "the starfield twinkles while work runs");
  view.motion = false;
  assert.equal(findAll(view.render(cx), "flow-").length, 0);
  assert.equal(findAll(view.render(cx), "star-")[0].styles.loop, undefined);
  view.motion = true; view.act({ type: "reset" }, cx);
  assert.equal(findAll(view.render(cx), "star-")[0].styles.loop, undefined, "a paused, idle pipeline stays still");
});

test("the scene keeps slots, queue and review apart at the smallest canvas", () => {
  for (const parallel of [1, 3, 6]) for (const [width, height] of [[600, 300], [940, 420], [1100, 600], [1400, 900]]) {
    const scene = geometry.layoutScene(model.reduce(model.createPipeline({ id: "fit" }, 0), { type: "parallel", value: parallel }, 0), width, height);
    const boxes = [
      ...scene.slots.map(slot => [slot.x - 82, slot.y - 34, slot.x + 82, slot.y + 34]),
      [30, 58, 194, scene.h - 50], [scene.w - 194, 53, scene.w - 30, scene.h - 90],
    ];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i], boxes[j]];
      assert.ok(a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1], `${width}x${height}: boxes ${i} and ${j} overlap`);
    }
    for (const slot of scene.slots) assert.ok(slot.y - 34 >= 0 && slot.y + 34 <= scene.h, "slots stay on the canvas");
  }
});

test("occupied higher slots keep their canvas width after lowering concurrency", () => {
  let state = model.createPipeline({ id: "slots" }, 0);
  for (const action of [{ type: "parallel", value: 6 }, { type: "reviewLimit", value: 10 }, { type: "add", ids: ["DEMO-106", "DEMO-108"] }, { type: "run" }]) state = model.reduce(state, action, 0);
  assert.equal(model.activeTasks(state).length, 5);
  state = model.reduce(state, { type: "parallel", value: 3 }, 0);
  const scene = geometry.layoutScene(state, 620, 600);
  assert.ok(scene.w >= 1180);
  assert.ok(scene.slots[3].x - scene.slots[0].x >= 164);
});

test("painted root bounds are normalized for app zoom before positioning review", () => {
  const view = setup();
  const root = view.render(cx);
  root.handlers.on_size_change({ width: 1100, height: 880 }, cx);
  assert.ok(Math.abs(view.size.width - 1000) < 0.01);
  assert.ok(Math.abs(view.size.height - 800) < 0.01);
});

function asking(view, id = "DEMO-104", slot = 1) {
  const task = row(view, id); task.status = "input"; task.slot = slot; task.held = 0.5; task.since = 0;
}

test("a waiting task shows Needs you, and the card's Answer opens its question", () => {
  const view = setup();
  view.act({ type: "run" }, cx); asking(view);
  const scene = view.render(cx);
  assert.ok(find(scene, "halo-DEMO-104"), "the card pulses for attention");
  assert.equal(findAll(scene, "bar-DEMO-104").length, 0, "progress is paused");
  assert.ok(find(scene, "answer-next"), "the status strip offers the question");
  click(view, "answer-DEMO-104");
  assert.deepEqual([view.drawer, view.selected], ["task", "DEMO-104"]);
  click(view, "choice-DEMO-104-1");
  assert.deepEqual([row(view, "DEMO-104").status, row(view, "DEMO-104").answer], ["working", "Recently viewed products"]);
  assert.equal(find(view.render(cx), "answer-next"), undefined);
});

test("questions can be answered with a number key, a typed reply, or Q to jump between them", () => {
  const view = setup();
  view.act({ type: "run" }, cx); asking(view); asking(view, "DEMO-103", 2);
  press(view, "q");
  assert.equal(view.selected, "DEMO-103");
  press(view, "1");
  assert.equal(row(view, "DEMO-103").answer, "Keep the cart");
  assert.equal(view.selected, "DEMO-104", "the next question opens");
  view.reply.set_value("Show both, home page first");
  click(view, "reply-DEMO-104");
  assert.equal(row(view, "DEMO-104").answer, "Show both, home page first");
  assert.equal(view.reply.value(), "");
  press(view, "1");
  assert.equal(row(view, "DEMO-104").status, "working", "digits do nothing without a question");
});

test("Settings can make the next working task ask a question", () => {
  const view = setup();
  click(view, "settings"); click(view, "ask");
  assert.equal(view.state().askNext, true);
  assert.equal(find(view.render(cx), "ask").styles.disabled[0], true);
});

function setupLive() {
  world.data = {}; timers.length = 0; world.hc = []; world.runs = [];
  world.context = { id: "shop", name: "shop", cwd: "/work/shop", on: null };
  world.storage.set("mode", "live");
  const view = new Pipeline(); view.init({}, cx);
  world.context = null; world.storage.delete("mode");
  view.repo = { root: "/work/shop", branch: "main" };
  view.agentChoices = [{ key: "claude", name: "Claude Code", run: ["claude"], installed: true }, { key: "codex", name: "Codex", run: ["codex"], installed: true }];
  return view;
}
const agentTask = (view, id, patch) => Object.assign(row(view, id), { workspace: { root: `/wt/${id}`, cwd: `/wt/${id}`, branch: `pipeline/${id}`, base: "a".repeat(40), target: "main" },
  terminal: "t9", space: "s9", tab: "tb9", agent: "Claude Code", slot: 0, ...patch });

test("Live keeps its own pipeline beside the simulation, and typed tasks become agent tasks", () => {
  const view = setupLive();
  assert.equal(view.storeKey(), "live:shop");
  assert.ok(world.data["pipeline.prototype.v1"].shop, "the simulation is still there");
  view.title.set_value("Add a dark mode toggle");
  click(view, "create");
  assert.deepEqual([row(view, "T-1").status, row(view, "T-1").repos], ["queued", ["shop"]]);
  const scene = view.render(cx);
  for (const id of ["add", "watch", "quota", "speed", "delivery"]) assert.equal(find(scene, id), undefined, `${id} is simulation only`);
  assert.ok(find(scene, "agent"));
  click(view, "mode-simulation");
  assert.equal(view.state().live, undefined);
  click(view, "mode-live");
  assert.equal(row(view, "T-1").title, "Add a dark mode toggle");
});

test("Live needs a project folder", () => {
  const view = setup();
  assert.equal(find(view.render(cx), "mode-live").styles.disabled[0], true);
});

test("the agent setting picks which program each task starts", () => {
  const view = setupLive();
  click(view, "agent"); click(view, "agent-codex");
  assert.deepEqual(view.state().agent, { key: "codex", name: "Codex", run: ["codex"] });
  assert.ok(find(view.render(cx), "agent").nodes.includes("Codex"));
});

test("queued live task details are saved when the field loses focus", () => {
  const view = setupLive();
  view.act({ type: "create", title: "Add a dark mode toggle" }, cx);
  view.inspect("T-1", cx);
  view.details.set_value("Follow the system preference first.");
  view.details.emit("blur", cx);
  assert.equal(row(view, "T-1").description, "Follow the system preference first.");
});

test("a finished agent merges from its card; failures retry and discards ask twice", () => {
  const view = setupLive();
  for (const title of ["A", "B", "C"]) view.act({ type: "create", title }, cx);
  agentTask(view, "T-1", { status: "review", slot: null });
  agentTask(view, "T-2", { status: "failed", slot: null, error: "Its terminal closed." });
  agentTask(view, "T-3", { status: "working", slot: 1 });
  assert.ok(find(view.render(cx), "approve-T-1").nodes.includes("Merge"));
  click(view, "approve-T-1");
  assert.equal(row(view, "T-1").status, "merging");
  click(view, "retry-T-2");
  assert.equal(row(view, "T-2").status, "queued");
  view.inspect("T-3", cx);
  click(view, "discard-T-3");
  assert.equal(row(view, "T-3").discard, false);
  click(view, "discard-T-3");
  assert.equal(row(view, "T-3").discard, true);
});

test("a waiting agent's Answer opens its terminal, and messages are typed into it", async () => {
  const view = setupLive();
  view.act({ type: "create", title: "A" }, cx);
  agentTask(view, "T-1", { status: "input" });
  click(view, "answer-T-1");
  assert.deepEqual(world.runs, [["space.select", { id: "s9" }], ["tab.select", { id: "tb9" }], ["pane.focus", { terminal: "t9" }]]);
  view.inspect("T-1", cx);
  view.message.set_value("Use the home page");
  const spawned = [];
  view.send(row(view, "T-1"), { ...cx, spawn: fn => spawned.push(fn) });
  assert.equal(view.message.value(), "");
  await spawned[0](cx);
  assert.deepEqual(world.hc.at(-1), ["send", "--force", "t9", "Use the home page"]);
  assert.equal(view.sent.ok, true);
});

test("every live task state renders in the scene and the inspector, and example keys do nothing", () => {
  const view = setupLive();
  const statuses = ["queued", "routing", "working", "input", "review", "merging", "failed", "done"];
  statuses.forEach((status, i) => { view.act({ type: "create", title: `Task ${i}` }, cx); agentTask(view, `T-${i + 1}`, { status, slot: ["routing", "working", "input"].includes(status) ? i : null }); });
  for (let i = 1; i <= statuses.length; i++) { view.inspect(`T-${i}`, cx); assert.ok(view.render(cx)); }
  view.open(null, cx);
  press(view, "a");
  assert.equal(view.drawer, null);
  assert.equal(findAll(view.render(cx), "bar-").length, 0, "real work has no simulated progress bars");
});

test("Start records the space it was pressed in, and Trust answers the prompt from the card", async () => {
  const view = setupLive();
  view.act({ type: "create", title: "A" }, cx);
  press(view, "space");
  assert.equal(view.state().space, "sp-project");
  agentTask(view, "T-1", { status: "input", reason: "trust" });
  const scene = view.render(cx);
  assert.equal(find(scene, "answer-T-1"), undefined);
  const spawned = [];
  world.hc = [];
  world.screen = "❯ No, exit\n  Yes, I trust this folder";
  try {
    view.trust(row(view, "T-1"), { ...cx, spawn: fn => spawned.push(fn) });
    await spawned[0](cx);
  } finally { world.screen = null; }
  assert.ok(find(scene, "trust-T-1"));
  assert.deepEqual(world.hc.at(-1), ["keys", "t9", "down", "enter"]);
  assert.deepEqual([row(view, "T-1").status, row(view, "T-1").reason], ["working", null]);
  click(view, "settings"); click(view, "auto-trust");
  assert.equal(view.state().autoTrust, true);
});

test("the Plane drawer watches a state and queues picked tickets, skipping ones already in Pipeline", async () => {
  const view = setupLive();
  const ticket = (n, extra = {}) => ({ uuid: `plane:p:${n}`, identifier: `HMOD-${n}`, title: `Ticket ${n}`, description: "", status: "Todo", statusType: "unstarted", priority: { name: "High" }, url: "https://plane.test/", ...extra });
  world.planeCalls = [];
  world.planeReply = payload => payload.op === "states" ? { states: [{ id: "todo", name: "Todo", group: "unstarted" }, { id: "done", name: "Done", group: "completed" }] }
    : { issues: [ticket(1), ticket(2), ticket(3, { statusType: "completed" })], project: { name: "Herdr Mods" } };
  const spawned = [];
  view.open("plane", { ...cx, spawn: fn => spawned.push(fn) });
  await spawned[0](cx);
  assert.deepEqual(world.planeCalls.map(call => [call.op, call.context.cwd]), [["issues", "/work/shop"], ["states", "/work/shop"]]);
  let scene = view.render(cx);
  assert.ok(find(scene, "plane-HMOD-1") && find(scene, "plane-HMOD-2"));
  assert.equal(find(scene, "plane-HMOD-3"), undefined, "finished tickets are left out");
  assert.equal(find(scene, "watch-done"), undefined);
  click(view, "watch-todo");
  assert.deepEqual(view.state().watchPlane, { id: "todo", name: "Todo" });
  click(view, "plane-HMOD-1"); click(view, "plane-HMOD-2");
  click(view, "plane-queue");
  assert.deepEqual(view.state().tasks.map(task => task.id), ["HMOD-1", "HMOD-2"]);
  assert.equal(view.drawer, null);
  view.drawer = "plane";
  assert.equal(find(view.render(cx), "plane-HMOD-1").styles.disabled[0], true);
  view.inspect("HMOD-1", cx);
  assert.ok(find(view.render(cx), "plane-link-HMOD-1"));
  world.planeReply = null;
});

test("an unlinked repository points to the Tasks panel", async () => {
  const view = setupLive();
  world.planeReply = () => ({ issues: [], needsProject: true });
  const spawned = [];
  view.open("plane", { ...cx, spawn: fn => spawned.push(fn) });
  await spawned[0](cx);
  click(view, "open-tasks");
  assert.deepEqual(world.runs.at(-1), ["tabs-show.plane", undefined]);
  world.planeReply = null;
});

test("the check command is set in Live settings, from a suggestion or typed", () => {
  const view = setupLive();
  view.checkSuggestions = ["npm test"];
  click(view, "agent");
  click(view, "check-use-npm test");
  assert.deepEqual(view.state().check, { command: "npm test", fix: true });
  view.checkInput.set_value("node --test tests/*.test.mjs");
  view.checkInput.emit("submit", cx);
  assert.equal(view.state().check.command, "node --test tests/*.test.mjs");
  click(view, "check-fix");
  assert.equal(view.state().check.fix, false);
  view.checkInput.set_value("");
  view.checkInput.emit("blur", cx);
  assert.equal(view.state().check, null);
});

test("failed checks offer Fix on the card and the full choice in the inspector", async () => {
  const view = setupLive();
  view.act({ type: "check", command: "npm test" }, cx);
  view.act({ type: "create", title: "A" }, cx);
  agentTask(view, "T-1", { status: "failed", reason: "checks", slot: null, checkOutput: "FAIL one", checked: "failed" });
  let scene = view.render(cx);
  assert.equal(find(scene, "retry-T-1"), undefined);
  assert.ok(find(scene, "fix-T-1"));
  const spawned = [];
  view.fix(row(view, "T-1"), { ...cx, spawn: fn => spawned.push(fn) });
  await spawned[0](cx);
  assert.deepEqual(world.hc.at(-1), ["send", "t9", "failed: npm test\nFAIL one"]);
  assert.deepEqual([row(view, "T-1").status, row(view, "T-1").slot], ["working", 0]);
  agentTask(view, "T-1", { status: "failed", reason: "checks", slot: null });
  view.inspect("T-1", cx);
  click(view, "review-anyway-T-1");
  assert.equal(row(view, "T-1").status, "review");
  assert.match(text(find(view.render(cx), "card-T-1")), /Checks failing/);
  click(view, "recheck-T-1");
  assert.equal(row(view, "T-1").status, "testing");
  assert.match(text(find(view.render(cx), "card-T-1")), /Running checks/);
});
