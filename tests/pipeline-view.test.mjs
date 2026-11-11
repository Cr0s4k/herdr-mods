import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const modelSource = await readFile(new URL("../mods/pipeline/pipeline-model.js", import.meta.url), "utf8");
const model = await import(`data:text/javascript,${encodeURIComponent(modelSource)}`);
const geometrySource = (await readFile(new URL("../mods/pipeline/geometry.js", import.meta.url), "utf8")).replace(/^import .*;\n/gm, "");
globalThis.__pipelineGeometry = { ACTIVE: model.ACTIVE, queueOrder: model.queueOrder };
const geometry = await import(`data:text/javascript,${encodeURIComponent(`const { ACTIVE, queueOrder } = globalThis.__pipelineGeometry;\n${geometrySource}`)}`);
const liveSource = (await readFile(new URL("../mods/pipeline/pipeline-live.js", import.meta.url), "utf8"));
globalThis.__pipelineViewModel = model;
const live = await import(`data:text/javascript,${encodeURIComponent(`const {${liveSource.match(/^import \{([^}]*)\} from "\.\/pipeline-model\.js";/m)[1]}} = globalThis.__pipelineViewModel;\n${liveSource.replace(/^import .*;\n/gm, "")}`)}`);
const world = { data: {}, storage: new Map(), hc: [], runs: [], planeCalls: [], overlays: [] };
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
  Button: { new: id => native().id(id) }, Input: { new: native }, Textarea: { new: native }, Switch: { new: id => native().id(id) },
  InputState: { new: () => { let value = ""; const handlers = {}; return { on(name, fn) { handlers[name] = fn; }, emit: (name, cx) => handlers[name]?.({}, cx), focus() {}, release() {}, value: () => value, set_value: next => { value = next; } }; } },
  hc: async args => { world.hc.push(args); return { code: 0, stdout: world.screen ?? "" }; }, run: (name, args) => world.runs.push([name, args]),
  knownAgents: async () => [], exec: async (...args) => world.exec?.(...args) ?? { code: 0, stdout: "" }, focused: () => ({ space: "sp-project" }),
  trustKeys: screen => /Yes, I trust/.test(screen) ? ["down", "enter"] : null,
  fixRequest: (command, output) => `failed: ${command}\n${output}`,
  rebaseRequest: (target, error) => `rebase onto ${target}: ${error}`, commitRequest: () => "commit what you left", changedFiles: live.changedFiles,
  openOverlay: spec => { world.overlays.push(spec); return "ov1"; },
  readTickets: async (provider, payload) => { world.planeCalls.push({ provider, ...payload }); return world.planeReply?.(payload, provider) ?? { issues: [] }; },
  fullTickets: async (provider, issues) => { world.fullCalls = [...(world.fullCalls ?? []), [provider, issues.map(issue => issue.identifier)]];
    return provider === "linear" ? issues.map(issue => ({ ...issue, description: `Full ${issue.identifier}` })) : issues; },
  PathBuilder: { stroke: path }, window: { paint_path: native },
  shared: key => world.data[key], setShared: (key, value) => { world.data[key] = value; },
  props: () => ({ context: world.context ?? { id: "project", name: "Project" } }), appWindow: () => ({ platform: "linux", active: true }),
  theme: () => new Proxy({}, { get: (_obj, key) => key }),
  settings: () => ({ zoom: 1.1 }), appHome: () => "/app",
  localStorage: { getItem: key => world.storage.get(key) ?? null, setItem: (key, value) => world.storage.set(key, value) },
};
const uiSource = (await readFile(new URL("../mods/pipeline/main.js", import.meta.url), "utf8")).replace(/^import .*;\n/gm, "");
const { default: Pipeline } = await import(`data:text/javascript,${encodeURIComponent(`const { ${Object.keys(globalThis.__pipelineView).join(", ")} } = globalThis.__pipelineView;\n${uiSource}`)}`);
const timers = [];
const cx = { notify() {}, spawn() {}, stop_propagation() {}, timer: { after: (_ms, fn) => { timers.push(fn); return { cancel() {} }; }, every: () => ({ cancel() {} }) },
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
async function settle(view, id) {
  const spawned = [], spawning = { ...cx, spawn: fn => spawned.push(fn) };
  const node = find(view.render(cx), id);
  assert.ok(node, `control ${id} exists`);
  assert.equal(Boolean(node.styles.disabled?.[0]), false, `${id} is enabled`);
  node.handlers.on_click({}, spawning);
  while (spawned.length) await spawned.shift()(spawning);
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

test("the settings drawer turns animation off with a switch", () => {
  const view = setup();
  view.open("settings", cx);
  const toggle = find(view.render(cx), "motion-setting");
  assert.equal(toggle.styles.checked[0], true);
  assert.match(text(toggle), /Animation/);
  toggle.handlers.on_change(false, cx);
  assert.equal(view.motion, false);
  assert.equal(world.storage.get("motion"), "false");
  assert.equal(find(view.render(cx), "motion-setting").styles.checked[0], false);
  view.reducedMotion = true; view.motion = true;
  const locked = find(view.render(cx), "motion-setting");
  assert.equal(locked.styles.disabled[0], true);
  assert.equal(locked.styles.checked[0], false);
  assert.match(text(locked), /Reduce Motion/);
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

test("open pull requests sit in their own section below review, inside the review column", () => {
  const live = model.createLive({ id: "prs", cwd: "/r" }, 0);
  for (const [width, height] of [[940, 420], [1100, 600], [1400, 900]]) for (const [reviews, prs] of [[0, 1], [1, 1], [4, 4], [0, 8], [8, 1]]) {
    const tasks = [...Array.from({ length: reviews }, (_, i) => ({ id: `R-${i}`, status: "review" })), ...Array.from({ length: prs }, (_, i) => ({ id: `P-${i}`, status: "pr" }))]
      .map(task => ({ ...task, title: task.id, repos: ["r"], approvals: [], depends: [], slot: null }));
    const scene = geometry.layoutScene({ ...live, tasks }, width, height);
    const cards = scene.nodes.filter(node => node.kind === "review");
    assert.ok(scene.prShown.length >= 1, `${width}x${height} ${reviews}/${prs}: a PR is always on the canvas`);
    if (reviews) assert.ok(scene.reviewShown.length >= 1, "review keeps a card");
    for (const node of cards) assert.ok(node.y - 39 >= 53 && node.y + 39 <= scene.h - 90 && node.x === scene.w - 112, `${node.task.id} stays in the column`);
    const lastReview = Math.max(0, ...cards.filter(node => node.task.status === "review").map(node => node.y + 39));
    assert.ok(scene.prTop >= lastReview, "the PR header follows review");
    for (const node of cards.filter(node => node.task.status === "pr")) assert.ok(node.y - 39 >= scene.prTop + 24, "PR cards sit under their header");
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
  world.storage.delete("mode");
  const view = new Pipeline(); view.init({}, cx);
  world.context = null;
  view.repo = { root: "/work/shop", branch: "main" };
  view.agentChoices = [{ key: "claude", name: "Claude Code", run: ["claude"], installed: true }, { key: "codex", name: "Codex", run: ["codex"], installed: true }];
  return view;
}
const agentTask = (view, id, patch) => Object.assign(row(view, id), { workspaces: { shop: { root: `/wt/${id}`, cwd: `/wt/${id}`, branch: `pipeline/${id}`, base: "a".repeat(40), target: "main", source: "/work/shop" } },
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

test("a project folder opens in Live unless this copy switched to the simulation", () => {
  assert.equal(setupLive().mode, "live");
  world.storage.set("mode", "simulation");
  world.context = { id: "shop", name: "shop", cwd: "/work/shop", on: null };
  const view = new Pipeline(); view.init({}, cx);
  world.context = null; world.storage.delete("mode");
  assert.equal(view.mode, "simulation");
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

test("a queued live task lists its ticket blockers, picks tasks to wait for, and can start anyway", () => {
  const view = setupLive();
  view.act({ type: "create", title: "Schema" }, cx);
  view.act({ type: "addTickets", provider: "linear", issues: [{ uuid: "u-5", identifier: "PRO-5", title: "Endpoint", status: "Todo",
    blockers: [{ key: "PRO-9", title: "Auth tokens for every service in the platform", closed: false, url: "https://linear.test/PRO-9" }] }] }, cx);
  view.inspect("PRO-5", cx);
  let scene = view.render(cx);
  assert.match(text(find(scene, "blocker-PRO-5-0")), /PRO-9 · Open in Linear · Auth tokens for every service in …/);
  assert.match(text(scene), /Waiting for PRO-9 to close in Linear/);
  click(view, "wait-PRO-5-T-1");
  assert.deepEqual(row(view, "PRO-5").depends, ["T-1"]);
  view.inspect("T-1", cx);
  assert.equal(find(view.render(cx), "wait-T-1-PRO-5").styles.disabled[0], true, "waiting for each other is refused");
  view.inspect("PRO-5", cx);
  click(view, "unblock-PRO-5");
  assert.equal(row(view, "PRO-5").unblocked, true);
  click(view, "reblock-PRO-5");
  assert.equal(row(view, "PRO-5").unblocked, false);
  assert.match(text(view.render(cx)), /Waiting for T-1 to merge and PRO-9 to close in Linear/);
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
  assert.deepEqual(view.state().watching.plane, { id: "todo", name: "Todo" });
  click(view, "plane-HMOD-1"); click(view, "plane-HMOD-2");
  await settle(view, "plane-queue");
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

test("Live settings choose a model and effort per agent, and the agent button shows them", () => {
  const view = setupLive();
  view.agentChoices = [{ key: "claude", name: "Claude Code", run: ["claude"], installed: true }, { key: "codex", name: "Codex", run: ["codex"], installed: true }];
  click(view, "agent");
  click(view, "model-opus"); click(view, "effort-high");
  assert.equal(text(find(view.render(cx), "agent")).trim(), "Claude Code · opus · high effort");
  view.codexModels = [{ slug: "gpt-sol", name: "GPT-Sol", efforts: ["low", "high", "ultra"] }, { slug: "gpt-luna", name: "GPT-Luna", efforts: ["low", "max"] }];
  click(view, "agent-codex");
  assert.ok(find(view.render(cx), "model-gpt-luna") && find(view.render(cx), "effort-ultra") && !find(view.render(cx), "model-opus"));
  click(view, "model-gpt-sol"); click(view, "effort-ultra");
  assert.ok(!find(view.render(cx), "effort-max"), "a picked Codex model shows only its own levels");
  click(view, "model-gpt-luna");
  assert.deepEqual(view.state().tuning.codex, { model: "gpt-luna", effort: null }, "an effort the new model lacks resets to default");
  view.modelInput.set_value("gpt-5");
  view.modelInput.emit("submit", cx);
  assert.deepEqual(view.state().tuning, { claude: { model: "opus", effort: "high" }, codex: { model: "gpt-5", effort: null } });
  click(view, "agent-claude");
  assert.equal(view.modelInput.value(), "opus");
  click(view, "model-default");
  assert.equal(text(find(view.render(cx), "agent")).trim(), "Claude Code · high effort");
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

test("pull request delivery changes the approve wording and links the open PR", () => {
  const view = setupLive();
  click(view, "agent"); click(view, "deliver-pr");
  assert.equal(view.state().delivery, "pr");
  view.act({ type: "create", title: "A" }, cx);
  view.act({ type: "create", title: "B" }, cx);
  agentTask(view, "T-1", { status: "review", slot: null });
  agentTask(view, "T-2", { status: "pr", slot: null, prs: { shop: { url: "https://github.com/me/shop/pull/12", number: 12 } } });
  const scene = view.render(cx);
  assert.ok(find(scene, "approve-T-1").nodes.includes("Open PR"));
  assert.ok(find(scene, "approve-all").nodes.includes("Open 1 PR"));
  assert.match(text(find(scene, "card-T-2")), /PR #12 open/);
  assert.ok(find(scene, "pr-T-2"));
  assert.match(text(find(scene, "pr-list")), /Pull requests · 1/);
  assert.ok(find(scene, "node-T-2").styles.top[0] > find(scene, "node-T-1").styles.top[0], "the open PR sits below review");
  assert.match(text(find(scene, "status")), /Opens pull requests into main/);
  view.inspect("T-2", cx);
  assert.ok(find(view.render(cx), "pr-link-T-2"));
  assert.match(text(find(view.render(cx), "inspector")), /Asking GitHub what it waits for/);
  view.act({ type: "prStatus", id: "T-2", repo: "shop", url: "https://github.com/me/shop/pull/12",
    status: { draft: false, mergeable: "MERGEABLE", mergeState: "BLOCKED", review: "REVIEW_REQUIRED", failed: 1, failing: ["test"], pending: 0, passed: 2 } }, cx);
  const waiting = view.render(cx);
  assert.match(text(find(waiting, "card-T-2")), /Checks failing · 1/);
  assert.match(text(find(waiting, "pr-checks-T-2")), /1 failing: test/);
  assert.match(text(find(waiting, "pr-review-T-2")), /Required, not given yet/);
  assert.match(text(find(waiting, "pr-merge-T-2")), /Blocked until branch rules are met/);
  click(view, "pr-list");
  assert.equal(view.drawer, "prs");
  assert.ok(find(view.render(cx), "row-T-2"));
  assert.equal(find(view.render(cx), "row-T-1"), undefined, "tasks waiting for you stay in Review");
  view.inspect("T-2", cx);
  assert.equal(find(view.render(cx), "discard-T-2"), undefined, "an open PR is closed on GitHub, not discarded");
  click(view, "approve-T-1");
  assert.match(text(find(view.render(cx), "card-T-1")), /Opening PR/);
  view.open("settings", cx);
  click(view, "auto-pr");
  assert.equal(view.state().autoPr, true);
  click(view, "deliver-merge");
  assert.equal(find(view.render(cx), "auto-pr"), undefined, "only pull requests open on their own");
  click(view, "auto-merge");
  assert.equal(view.state().autoMerge, true);
  assert.match(text(find(view.render(cx), "auto-merge")), /Merging automatically/);
});

test("the Schedule drawer saves, rejects and clears daily times", () => {
  const view = setup();
  click(view, "schedule");
  assert.equal(view.drawer, "schedule");
  view.times.start.set_value("10pm"); view.times.start.emit("submit", cx);
  assert.deepEqual(view.state().schedule, { start: "22:00", pause: null });
  assert.equal(view.times.start.value(), "22:00");
  assert.ok(find(view.render(cx), "schedule").nodes.includes("22:00"), "the clock beside Start shows the next start");
  click(view, "run");
  assert.match(find(view.render(cx), "schedule").styles.tooltip[0], /Pauses intake|Schedule:/, "while running the clock shows the next pause, if any");
  click(view, "run");
  view.times.pause.set_value("whenever"); view.times.pause.emit("blur", cx);
  assert.match(text(find(view.render(cx), "inspector")), /Use a time like/);
  view.times.pause.set_value("22:00"); view.times.pause.emit("submit", cx);
  assert.match(text(find(view.render(cx), "inspector")), /need different times/);
  view.times.pause.set_value("6:30"); view.times.pause.emit("submit", cx);
  assert.deepEqual(view.state().schedule, { start: "22:00", pause: "06:30" });
  assert.match(text(find(view.render(cx), "inspector")), /Next: starts (today|tomorrow) at 22:00/);
  click(view, "schedule-start-clear");
  assert.deepEqual(view.state().schedule, { start: null, pause: "06:30" });
  click(view, "schedule-pause-clear");
  assert.equal(view.state().schedule, null);
  assert.equal(text(find(view.render(cx), "schedule")).trim(), "", "with nothing scheduled the clock has no time beside it");
});

test("the Linear drawer filters by scope and project, watches only narrowed states, and queues full tickets", async () => {
  const view = setupLive();
  world.storage.delete("linear:shop");
  const ticket = (n, extra = {}) => ({ uuid: `u-${n}`, identifier: `PRO-${n}`, title: `Ticket ${n}`, status: "Todo", statusType: "unstarted", priority: { name: "Urgent" }, team: "Product", url: `https://linear.test/PRO-${n}`, ...extra });
  world.planeCalls = []; world.fullCalls = [];
  world.planeReply = (payload, provider) => provider !== "linear" ? { issues: [] } : payload.op === "states"
    ? { states: [{ id: "Todo", name: "Todo", type: "unstarted" }, { id: "Done", name: "Done", type: "completed" }] }
    : payload.op === "projects" ? { projects: [{ id: "p1", name: "Herdr" }] }
    : { issues: [ticket(1), ticket(2, { statusType: "canceled" })] };
  const spawned = [], spawning = { ...cx, spawn: fn => spawned.push(fn) };
  const drain = async () => { while (spawned.length) await spawned.shift()(spawning); };
  press(view, "l");
  assert.equal(view.drawer, "linear");
  view.open(null, cx); view.open("linear", spawning); await drain();
  assert.deepEqual(world.planeCalls.filter(call => call.provider === "linear").map(call => [call.op, call.scope ?? call.teams?.join()]), [["issues", "mine"], ["states", "Product"]]);
  assert.equal(world.planeCalls.find(call => call.provider === "linear").open, true);
  let scene = view.render(cx);
  assert.ok(find(scene, "linear-PRO-1"));
  assert.equal(find(scene, "linear-PRO-2"), undefined, "closed tickets are left out");
  assert.equal(find(scene, "watch-Done"), undefined);
  await settle(view, "linear-scope-all");
  assert.equal(world.planeCalls.filter(call => call.op === "issues").at(-1).scope, "all");
  assert.equal(find(view.render(cx), "watch-Todo").styles.disabled[0], true, "a workspace-wide watch is not offered");
  await settle(view, "linear-project");
  await settle(view, "linear-project-p1");
  assert.equal(world.planeCalls.filter(call => call.op === "issues").at(-1).project, "p1");
  assert.deepEqual(JSON.parse(world.storage.get("linear:shop")), { scope: "all", team: null, project: { id: "p1", name: "Herdr" } });
  click(view, "watch-Todo");
  assert.deepEqual(view.state().watching.linear, { id: "Todo", name: "Todo", filter: { scope: "all", project: { id: "p1", name: "Herdr" }, label: "All tickets · Herdr" } });
  assert.match(view.state().events[0].message, /Watching Linear for tickets in Todo · All tickets · Herdr/);
  click(view, "linear-PRO-1");
  await settle(view, "linear-queue");
  assert.deepEqual(world.fullCalls.at(-1), ["linear", ["PRO-1"]]);
  const task = row(view, "PRO-1");
  assert.deepEqual([task.description, task.priority, task.source, task.ticket.provider], ["Full PRO-1", 4, "Linear", "linear"]);
  view.inspect("PRO-1", cx);
  assert.ok(find(view.render(cx), "linear-link-PRO-1"));
  world.planeReply = null;
});

test("a team filters tickets and projects on Linear, persists, and narrows watched states even without tickets", async () => {
  world.storage.delete("linear:shop");
  const view = setupLive();
  world.planeCalls = [];
  world.planeReply = payload => payload.op === "teams" ? { teams: [{ id: "T-ACME", uuid: "acme-id", name: "Acme" }] }
    : payload.op === "states" ? { states: [{ id: "Todo", name: "Todo", type: "unstarted" }] }
    : payload.op === "projects" ? { projects: [] } : { issues: [] };
  view.drawer = "linear";
  view.linearFilter = { scope: "all", team: null, project: { id: "old-project", name: "Other" } };
  view.ticketSearch.set_value("old search");
  await settle(view, "linear-team");
  view.teamSearch.set_value("Acme");
  const spawned = [], spawning = { ...cx, spawn: fn => spawned.push(fn) };
  view.teamSearch.emit("submit", spawning);
  while (spawned.length) await spawned.shift()(spawning);
  assert.deepEqual(world.planeCalls.at(-1), { provider: "linear", op: "teams", query: "Acme" });
  await settle(view, "linear-team-T-ACME");
  assert.deepEqual(world.planeCalls.slice(-2), [
    { provider: "linear", op: "issues", open: true, scope: "all", team: "acme-id" },
    { provider: "linear", op: "states", teams: ["acme-id"] },
  ]);
  const saved = { scope: "all", team: { id: "acme-id", name: "Acme" }, project: null };
  assert.deepEqual(JSON.parse(world.storage.get("linear:shop")), saved);
  assert.equal(view.ticketSearch.value(), "");
  assert.match(text(view.render(cx)), /Team · Acme/);
  click(view, "watch-Todo");
  assert.deepEqual(view.state().watching.linear.filter, { ...saved, label: "All tickets · Acme" });
  assert.deepEqual(setupLive().linearFilter, saved, "the team survives reopening Pipeline");
  await settle(view, "linear-project");
  assert.deepEqual(world.planeCalls.at(-1), { provider: "linear", op: "projects", team: "acme-id" });
  click(view, "linear-project-back");
  await settle(view, "linear-team-clear");
  assert.equal(world.planeCalls.filter(call => call.op === "issues").at(-1).team, undefined);
  assert.equal(view.linearFilter.team, null);
  world.planeReply = null;
  world.storage.delete("linear:shop");
});

test("a missing Linear connection points to the Linear panel", async () => {
  const view = setupLive();
  world.planeReply = (_payload, provider) => { if (provider === "linear") throw Object.assign(new Error("Connect Linear to browse your tickets."), { kind: "auth" }); return { issues: [] }; };
  const spawned = [];
  view.open("linear", { ...cx, spawn: fn => spawned.push(fn) });
  await spawned[0](cx);
  click(view, "open-linear");
  assert.deepEqual(world.runs.at(-1), ["tabs-show.linear", undefined]);
  world.planeReply = null;
});

test("Live settings choose ticket updates per tracker from its states, off by default", async () => {
  const view = setupLive();
  view.act({ type: "addTickets", provider: "linear", issues: [{ uuid: "u-1", identifier: "PRO-1", title: "T", team: "Core" }] }, cx);
  world.planeCalls = [];
  world.planeReply = (payload, provider) => provider === "plane" ? { states: [{ id: "doing", name: "In Progress", group: "started" }, { id: "done", name: "Done", group: "completed" }] }
    : { states: [{ id: "In Review", name: "In Review", type: "started" }] };
  const spawned = [], spawning = { ...cx, spawn: fn => spawned.push(fn) };
  view.open("settings", spawning);
  while (spawned.length) await spawned.shift()(spawning);
  assert.deepEqual(world.planeCalls.map(call => [call.provider, call.op, call.context?.cwd ?? call.teams.join()]), [["plane", "states", "/work/shop"], ["linear", "states", "Core"]]);
  let scene = view.render(cx);
  assert.match(text(scene), /Ticket updates/);
  for (const provider of ["plane", "linear"]) for (const kind of ["start", "merge"]) assert.equal(find(scene, `update-${provider}-${kind}-none`).styles.bg[0], "selected", "Don't change is the default");
  assert.equal(find(scene, "update-plane-link").styles.checked[0], false);
  click(view, "update-plane-start-doing");
  click(view, "update-plane-merge-done");
  find(view.render(cx), "update-linear-link").handlers.on_change(true, cx);
  click(view, "update-linear-merge-In Review");
  assert.deepEqual(view.state().ticketUpdates, { plane: { start: { id: "doing", name: "In Progress" }, merge: { id: "done", name: "Done" }, link: false },
    linear: { start: null, merge: { id: "In Review", name: "In Review" }, link: true } });
  scene = view.render(cx);
  assert.equal(find(scene, "update-plane-start-doing").styles.bg[0], "selected");
  assert.equal(find(scene, "update-linear-link").styles.checked[0], true);
  view.updateStates.plane = { loading: false, states: [], error: "Connect Plane with its instance URL, workspace slug and API key." };
  scene = view.render(cx);
  assert.ok(find(scene, "update-plane-start-doing"), "a saved state stays visible when states can't be read");
  assert.match(text(scene), /Connect Plane with its instance URL/);
  click(view, "update-plane-start-none");
  assert.equal(view.state().ticketUpdates.plane.start, null);
  world.planeReply = null;
});

test("a ticket task's inspector shows its last update, or the failure with Try again", () => {
  const view = setupLive();
  view.act({ type: "addTickets", provider: "linear", issues: [{ uuid: "u-1", identifier: "PRO-1", title: "T", team: "Core", url: "https://linear.test/PRO-1" }] }, cx);
  view.act({ type: "ticketUpdates", provider: "linear", start: { id: "In Progress", name: "In Progress" } }, cx);
  view.act({ type: "run" }, cx);
  view.act({ type: "launched", id: "PRO-1", space: "s9", tab: "tb9", terminal: "t9", agent: "Claude Code" }, cx);
  view.inspect("PRO-1", cx);
  assert.match(text(view.render(cx)), /Updating Linear…/);
  const n = () => row(view, "PRO-1").ticket.pending[0].n;
  view.act({ type: "ticketUpdated", id: "PRO-1", n: n(), ok: false, error: "Pipeline needs write access to Linear. Connect a key with Write permission.", errorKind: "write_access" }, cx);
  let scene = view.render(cx);
  assert.equal(row(view, "PRO-1").status, "working", "a failed update leaves the task alone");
  assert.match(text(scene), /Couldn't move it to In Progress: Pipeline needs write access to Linear/);
  assert.match(text(scene), /couldn't update Linear/, "the task history records it");
  click(view, "linear-connect-PRO-1");
  assert.deepEqual(world.runs.at(-1), ["tab.new", { name: "Connect Linear", argv: ["python3", "/app/mods/linear/herdr-linear", "--home", "/app", "connect"], space: "sp-project" }]);
  click(view, "ticket-retry-PRO-1");
  assert.deepEqual(row(view, "PRO-1").ticket.failed, []);
  view.act({ type: "ticketUpdated", id: "PRO-1", n: n(), ok: true, changed: true }, cx);
  scene = view.render(cx);
  assert.equal(find(scene, "ticket-retry-PRO-1"), undefined);
  assert.match(text(scene), /Moved to In Progress in Linear/);
  assert.match(text(scene), /Linear PRO-1 · In Progress/);
});

test("a newer save shows an explanation instead of the scene and is not overwritten", () => {
  world.data = { [model.STORE]: { project: { ...model.createPipeline({ id: "project", name: "Project" }, 0), version: model.VERSION + 1 } } };
  const saved = world.data[model.STORE].project;
  const view = new Pipeline(); view.init({}, cx);
  assert.equal(world.data[model.STORE].project, saved);
  assert.match(text(view.render(cx)), /saved by a newer Pipeline/);
});

test("Live settings add repositories by path on the project's machine, refuse duplicates, and remove them", async () => {
  const view = setupLive();
  const tops = { "~/code/api": "/home/me/code/api", "../web/src": "/work/web", "/work/shop/app": "/work/shop", "/nowhere": 3, "/tmp": 128 };
  const asked = [];
  world.exec = (command, args, options) => {
    if (command !== "sh" || args[0] !== "-c") return null;
    asked.push([args[3], options.cwd]);
    const top = tops[args[3]];
    return typeof top === "number" ? { code: top, stdout: "", stderr: "" } : { code: 0, stdout: `${top}\n` };
  };
  const add = async path => { view.repoInput.set_value(path); await settle(view, "repository-add"); };
  try {
    click(view, "settings");
    let scene = view.render(cx);
    assert.match(text(find(scene, "repository-shop")), /shop · project.*\/work\/shop/);
    assert.equal(find(scene, "repository-remove-shop"), undefined, "the project repository can't be removed");
    assert.equal(find(scene, "repository-add").styles.disabled[0], true, "Add needs a path");
    await add("~/code/api");
    await add("../web/src");
    assert.deepEqual(view.state().repositories.map(repo => [repo.name, repo.path]), [["shop", "/work/shop"], ["api", "/home/me/code/api"], ["web", "/work/web"]]);
    assert.deepEqual(asked.slice(0, 2), [["~/code/api", "/work/shop"], ["../web/src", "/work/shop"]], "paths are checked from the project folder");
    assert.equal(view.repoInput.value(), "");
    await add("/work/shop/app");
    assert.match(view.repoError, /\/work\/shop is already one of the repositories/);
    assert.equal(view.repoInput.value(), "/work/shop/app", "a refused path stays to be corrected");
    await add("/nowhere");
    assert.match(view.repoError, /There's no folder at \/nowhere on this computer/);
    await add("/tmp");
    assert.match(text(find(view.render(cx), "inspector")), /\/tmp isn't in a Git repository/);
    assert.equal(view.state().repositories.length, 3);
    click(view, "repository-remove-web");
    assert.deepEqual(view.state().repositories.map(repo => repo.name), ["shop", "api"]);
  } finally { world.exec = null; }
});

test("a queued task picks its repositories as chips, and cards name them only when there's more than one", () => {
  const view = setupLive();
  view.act({ type: "create", title: "A" }, cx);
  view.inspect("T-1", cx);
  assert.equal(find(view.render(cx), "repo-T-1-shop"), undefined, "no chips with only the project repository");
  assert.equal(text(find(view.render(cx), "card-T-1")).includes("shop"), false);
  view.act({ type: "addRepository", path: "/work/api" }, cx);
  let scene = view.render(cx);
  assert.equal(find(scene, "repo-T-1-shop").styles.disabled[0], true, "a task keeps at least one repository");
  click(view, "repo-T-1-api");
  assert.deepEqual(row(view, "T-1").repos, ["shop", "api"]);
  scene = view.render(cx);
  assert.match(text(find(scene, "card-T-1")), /shop \+ api/);
  click(view, "repo-T-1-shop");
  assert.deepEqual(row(view, "T-1").repos, ["api"]);
  click(view, "repo-T-1-shop");
  agentTask(view, "T-1", { status: "review", slot: null, workspaces: {
    shop: { root: "/wt/shop/T-1", cwd: "/wt/shop/T-1", branch: "pipeline/T-1", base: "a".repeat(40), target: "main", source: "/work/shop" },
    api: { root: "/wt/api/T-1", cwd: "/wt/api/T-1", branch: "pipeline/T-1", base: "b".repeat(40), target: "main", source: "/work/api" } } });
  view.peek = { key: `T-1:review:t9:/wt/shop/T-1,/wt/api/T-1`, task: "T-1", screen: [], diff: [
    { name: "shop", root: "/wt/shop/T-1", base: "a".repeat(40), files: [{ path: "src/a.js", status: "M", fresh: false, add: 1, del: 1 }] }, { name: "api", root: "/wt/api/T-1", base: "b".repeat(40), files: [] }] };
  scene = view.render(cx);
  const inspector = text(find(scene, "inspector"));
  assert.match(inspector, /Repositories: shop \+ api/);
  assert.match(inspector, /Changes · shop .*1 file .*M a\.js src \+1 −1/);
  click(view, "file-T-1-shop-0");
  assert.deepEqual(world.overlays.at(-1).props, { root: "/wt/shop/T-1", on: null, hasHead: true, base: "a".repeat(40), index: 0,
    files: [{ path: "src/a.js", status: "M", fresh: false, add: 1, del: 1 }] }, "a file opens the changes dialog on the task's worktree, against its start commit");
  assert.equal(find(scene, "diff-T-1-api"), undefined, "nothing to read where the agent changed nothing");
  assert.match(inspector, /Changes · api .*No changes in api\. It is left out of the merge\./);
  assert.match(inspector, /Branch pipeline\/T-1 in each repository .*shop · \/wt\/shop\/T-1 .*api · \/wt\/api\/T-1/);
  assert.ok(find(scene, "merge-T-1").nodes.includes("Merge into main in all 2"));
  assert.match(find(scene, "approve-T-1").styles.tooltip[0], /in shop, api, all or none/);
  click(view, "merge-T-1");
  assert.equal(row(view, "T-1").status, "merging");
});

test("a task across repositories shows a checklist per pull request and its most pressing need on the card", () => {
  const view = setupLive();
  click(view, "agent"); click(view, "deliver-pr");
  view.act({ type: "addRepository", path: "/work/api" }, cx);
  view.act({ type: "create", title: "A" }, cx);
  view.act({ type: "repos", id: "T-1", repo: "api" }, cx);
  const ws = name => ({ root: `/wt/${name}`, cwd: `/wt/${name}`, branch: "pipeline/T-1", base: "a".repeat(40), target: "main", source: `/work/${name}` });
  agentTask(view, "T-1", { status: "pr", slot: null, workspaces: { shop: ws("shop"), api: ws("api") },
    prs: { shop: { url: "https://github.com/me/shop/pull/12", number: 12, merged: true }, api: { url: "https://github.com/me/api/pull/13", number: 13 } } });
  view.act({ type: "prStatus", id: "T-1", repo: "api", url: "https://github.com/me/api/pull/13",
    status: { draft: false, mergeable: "CONFLICTING", mergeState: "DIRTY", review: null, failed: 0, failing: [], pending: 0, passed: 1 } }, cx);
  let scene = view.render(cx);
  assert.match(text(find(scene, "card-T-1")), /api · Conflicts with main/);
  assert.ok(find(scene, "pr-T-1").nodes.includes("2 PRs"));
  view.inspect("T-1", cx);
  scene = view.render(cx);
  const inspector = text(find(scene, "inspector"));
  assert.match(inspector, /shop · Pull request #12 · Merged/);
  assert.match(inspector, /api · Pull request #13 · Conflicts with main/);
  assert.match(text(find(scene, "pr-merge-T-1-api")), /Conflicts with main/);
  assert.equal(find(scene, "pr-merge-T-1-shop"), undefined, "a merged PR needs nothing");
  assert.ok(find(scene, "pr-link-T-1-shop") && find(scene, "pr-link-T-1-api"));
});

test("arrow keys walk the tasks in the order the scene shows them, and Start first reorders the queue", () => {
  const view = setupLive();
  for (const title of ["One", "Two", "Three"]) view.act({ type: "create", title }, cx);
  const press = keystroke => view.key({ key: keystroke, keystroke }, cx);
  press("down");
  assert.deepEqual([view.drawer, view.selected], ["task", "T-1"]);
  press("down"); press("j");
  assert.equal(view.selected, "T-3");
  press("down");
  assert.equal(view.selected, "T-1", "past the last task it wraps to the first");
  press("up");
  assert.equal(view.selected, "T-3");
  assert.match(text(find(view.render(cx), "first-T-3")), /Start first/);
  click(view, "first-T-3");
  const scene = view.render(cx);
  assert.match(text(find(scene, "first-T-3")), /Starts first/);
  assert.match(text(find(scene, "card-T-3")), /Queued · starts first/);
  const top = id => find(scene, `node-${id}`).styles.top[0];
  assert.ok(top("T-3") < top("T-1") && top("T-1") < top("T-2"), "the queue is drawn in the order it starts");
  press("escape"); press("down");
  assert.equal(view.selected, "T-3", "and walked in that order");
});

test("a queued task can start with its own model and effort", () => {
  const view = setupLive();
  view.act({ type: "create", title: "Docs" }, cx);
  view.inspect("T-1", cx);
  assert.match(text(find(view.render(cx), "inspector")), /Starts Claude Code with its own default model and effort/);
  click(view, "task-model-haiku-T-1");
  click(view, "task-effort-low-T-1");
  assert.deepEqual(row(view, "T-1").tune, { model: "haiku", effort: "low" });
  assert.match(text(find(view.render(cx), "inspector")), /Starts Claude Code with haiku · low effort/);
  click(view, "task-model-same-T-1");
  assert.deepEqual(row(view, "T-1").tune, { model: null, effort: "low" });
});

test("a merge refused for conflicts offers to send its agent to rebase", async () => {
  const view = setupLive();
  view.act({ type: "create", title: "A" }, cx);
  agentTask(view, "T-1", { status: "review", slot: null, error: "The branch conflicts with main. Ask the agent to rebase onto main and resolve the conflicts, then merge again." });
  view.inspect("T-1", cx);
  const tint = id => find(view.render(cx), id).styles.bg[0];
  assert.notEqual(tint("merge-T-1"), tint("resolve-T-1"), "merging again would only be refused again, so rebasing is the main action");
  assert.equal(tint("approve-T-1"), tint("merge-T-1"));
  world.hc = [];
  await settle(view, "resolve-T-1");
  assert.deepEqual(world.hc.at(-1).slice(0, 2), ["send", "t9"]);
  assert.match(world.hc.at(-1)[2], /rebase onto main: The branch conflicts with main/);
  assert.equal(row(view, "T-1").error, null);
  assert.equal(find(view.render(cx), "resolve-T-1"), undefined);
  assert.equal(tint("merge-T-1"), tint("approve-T-1"));
  agentTask(view, "T-1", { status: "review", slot: null, error: "Your project folder has uncommitted changes on main. Commit or stash them, then merge again." });
  assert.equal(find(view.render(cx), "resolve-T-1"), undefined, "an agent can't fix your own uncommitted changes");
});

test("work the agent left uncommitted offers to ask it to commit, or to commit it anyway", async () => {
  const view = setupLive();
  view.act({ type: "create", title: "A" }, cx);
  agentTask(view, "T-1", { status: "review", slot: null, error: "The task's worktree has uncommitted changes, so its agent may still be working. Ask it to commit them, or commit them anyway." });
  view.inspect("T-1", cx);
  const tint = id => find(view.render(cx), id).styles.bg[0];
  assert.notEqual(tint("merge-T-1"), tint("ask-commit-T-1"), "approving again would only be refused again");
  world.hc = [];
  await settle(view, "ask-commit-T-1");
  assert.deepEqual(world.hc.at(-1), ["send", "t9", "commit what you left"]);
  assert.equal(row(view, "T-1").error, null);
  assert.equal(find(view.render(cx), "commit-anyway-T-1"), undefined);
  agentTask(view, "T-1", { status: "review", slot: null, error: "The task's worktree has uncommitted changes, so its agent may still be working. Ask it to commit them, or commit them anyway." });
  click(view, "commit-anyway-T-1");
  assert.deepEqual([row(view, "T-1").commit, row(view, "T-1").error], [true, null]);
});

test("a narrow Pipeline keeps Start in reach, and wide windows give cards room for titles", () => {
  const view = setup();
  view.size = { width: 460, height: 800 };
  let scene = view.render(cx);
  assert.deepEqual(find(scene, "run").nodes.filter(node => typeof node === "string"), ["Start"]);
  assert.equal(find(scene, "speed"), undefined);
  view.size = { width: 1600, height: 900 };
  scene = view.render(cx);
  assert.deepEqual(find(scene, "run").nodes.filter(node => typeof node === "string"), ["Start pipeline"]);
  assert.equal(find(scene, "node-DEMO-101").styles.w[0], 212);
  view.size = { width: 1200, height: 800 };
  assert.equal(find(view.render(cx), "node-DEMO-101").styles.w[0], 164);
});

test("in Live the centre says what waits for you and takes you there", () => {
  const view = setupLive();
  for (const title of ["A", "B"]) view.act({ type: "create", title }, cx);
  assert.match(text(find(view.render(cx), "sun")), /Agents/);
  agentTask(view, "T-1", { status: "review", slot: null });
  assert.match(text(find(view.render(cx), "sun")), /1 to review/);
  click(view, "sun");
  assert.equal(view.drawer, "review");
  agentTask(view, "T-2", { status: "input" });
  const sun = find(view.render(cx), "sun");
  assert.match(text(sun), /1 needs you/);
  assert.equal(sun.styles.border_color[0], "blocked");
  click(view, "sun");
  assert.deepEqual([view.drawer, view.selected], ["task", "T-2"]);
  assert.equal(find(setup().render(cx), "sun"), undefined, "the simulation keeps its planner");
});

test("a stalled agent, its tokens and its own history show on the card and in the inspector", () => {
  const view = setupLive();
  view.act({ type: "create", title: "A" }, cx);
  agentTask(view, "T-1", { status: "working", worked: true, at: Date.now() - 20 * 60000, stalled: Date.now() - 12 * 60000,
    usage: { written: 3400, read: 120000, cached: 2000000, turns: 1 }, log: ["T-1 is working.", "T-1 joined the queue."] });
  view.inspect("T-1", cx);
  const scene = view.render(cx);
  assert.match(text(find(scene, "card-T-1")), /No output for 12 min/);
  const inspector = text(find(scene, "inspector"));
  assert.match(inspector, /shown nothing new for 12 min/);
  assert.match(inspector, /Claude Code used 3\.4k tokens written · 120k read · 2\.0M from cache, over 1 reply\./);
  assert.match(inspector, /Task history T-1 is working\. T-1 joined the queue\./);
});

test("a wide Pipeline has one bar of controls and one status bar; a narrower one gives the controls their own row", () => {
  const view = setup();
  view.size = { width: 1500, height: 800 };
  let scene = view.render(cx);
  assert.equal(find(scene, "controls"), undefined);
  assert.ok(find(scene, "add") && find(scene, "run"), "the intake controls sit in the top bar");
  assert.equal(find(scene, "scene").styles.h[0], 800 - 50 - 36);
  assert.match(text(find(scene, "status")), /Paused .*5 queued .*Start the pipeline to watch your first tasks enter/);
  click(view, "activity");
  assert.equal(view.drawer, "activity");
  click(view, "settings");
  assert.match(text(find(view.render(cx), "inspector")), /Keys Space start or pause/);
  view.size = { width: 1200, height: 800 };
  scene = view.render(cx);
  assert.ok(find(find(scene, "controls"), "add"));
  assert.equal(find(scene, "scene").styles.h[0], 800 - 50 - 46 - 36);
});

test("after a rebase a task's changes start where it now leaves its target branch, not at its old start commit", async () => {
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const fork = uiSource.match(/^const FORK = '(.*)';$/m)[1];
  const root = mkdtempSync(`${tmpdir()}/pipeline-fork-`);
  const git = (...args) => execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], { encoding: "utf8" }).trim();
  const commit = (file, text) => { writeFileSync(`${root}/${file}`, text); git("add", "-A"); git("commit", "-qm", file); return git("rev-parse", "HEAD"); };
  const forkOf = (base, target) => execFileSync("sh", ["-c", fork, "sh", root, base, target], { encoding: "utf8" }).trim();
  try {
    git("init", "-q", "-b", "main");
    const start = commit("a.txt", "a");
    git("checkout", "-q", "-b", "task");
    commit("task.txt", "task");
    assert.equal(forkOf(start, "main"), start, "an untouched branch starts at its start commit");
    git("checkout", "-q", "main");
    const moved = commit("other.txt", "another task's work");
    git("checkout", "-q", "task");
    assert.equal(forkOf(start, "main"), start, "main moving on changes nothing");
    git("rebase", "-q", "main");
    assert.equal(forkOf(start, "main"), moved, "rebased, the other task's work is no longer shown as this one's");
    assert.equal(forkOf(start, "gone"), start, "a missing target falls back to the start commit");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the planner is switched on in Settings and shows its plan, its reasons and its state", () => {
  const view = setupLive();
  for (const title of ["A", "B"]) view.act({ type: "create", title }, cx);
  click(view, "settings");
  find(view.render(cx), "planner").handlers.on_change(true, cx);
  assert.equal(view.state().planner.on, true);
  click(view, "planner-model-sonnet");
  assert.equal(view.state().planner.model, "sonnet");
  let scene = view.render(cx);
  assert.match(text(find(scene, "plan")), /The plan · planning…/);
  assert.match(text(find(scene, "sun")), /Planning/);
  const key = globalThis.__pipelineView.planKey(view.state());
  view.act({ type: "planning", key }, cx);
  view.act({ type: "planned", key, summary: "B before A.", order: ["T-2", "T-1"], waits: { "T-1": ["T-2"] }, reasons: { "T-1": "It reuses B's helper." } }, cx);
  scene = view.render(cx);
  assert.match(text(find(scene, "plan")), /The plan · by Claude Code · sonnet .*B before A\./);
  assert.match(text(find(scene, "card-T-1")), /Needs T-2/);
  view.inspect("T-1", cx);
  assert.match(text(find(view.render(cx), "plan-reason-T-1")), /Planner: It reuses B's helper\. Waits for T-2\./);
  click(view, "plan-open");
  click(view, "planner-again");
  assert.equal(view.state().planning, null);
});

test("the planner's settings offer Claude Code or Codex when both are installed, with their own models and efforts", () => {
  const view = setupLive();
  view.codexModels = [{ slug: "gpt-5", name: "GPT-5", efforts: ["low", "high"] }];
  click(view, "settings");
  find(view.render(cx), "planner").handlers.on_change(true, cx);
  let inspector = find(view.render(cx), "inspector");
  assert.match(text(find(inspector, "planner")), /Claude Code reads the queue, ticket blockers and the repository/);
  assert.ok(find(inspector, "planner-model-fable") && find(inspector, "planner-effort-max"));
  click(view, "planner-agent-codex");
  inspector = find(view.render(cx), "inspector");
  assert.match(text(find(inspector, "planner")), /Codex reads the queue/);
  assert.equal(find(inspector, "planner-model-fable"), undefined);
  click(view, "planner-model-gpt-5");
  click(view, "planner-effort-low");
  assert.deepEqual(view.state().planner, { on: true, agent: "codex", model: "gpt-5", effort: "low" });
  view.agentChoices = [{ key: "aider", name: "Aider", run: ["aider"], installed: true }];
  view.act({ type: "plannerSetup", on: false }, cx);
  assert.equal(find(view.render(cx), "planner").styles.disabled[0], true, "without either, it can't be turned on");
});

test("the Planner view keeps the last plan: who planned, its order and reasons, what it read and what it was asked", () => {
  const view = setupLive();
  for (const title of ["A", "B"]) view.act({ type: "create", title }, cx);
  view.act({ type: "plannerSetup", on: true, model: "sonnet", effort: "low" }, cx);
  const key = globalThis.__pipelineView.planKey(view.state());
  view.act({ type: "planning", key, prompt: "You plan the work queue.\nQueued tasks:" }, cx);
  assert.match(text(find(view.render(cx), "sun")), /Planning/);
  click(view, "sun");
  assert.equal(view.drawer, "planner");
  assert.match(text(find(view.render(cx), "inspector")), /Planning since under a minute ago…/);
  view.act({ type: "planned", key, summary: "B before A.", order: ["T-2", "T-1"], waits: { "T-1": ["T-2"] }, reasons: { "T-1": "It reuses B's helper." },
    trace: ["Reads src/b.js", "Searches for “helper”"], ms: 8600, cost: 0.0029, tokens: 35000 }, cx);
  view.act({ type: "run" }, cx);
  let inspector = text(find(view.render(cx), "inspector"));
  assert.match(inspector, /Planned under a minute ago Claude Code · sonnet · low effort · took 9 s · 35k tokens · \$0\.0029/);
  assert.match(inspector, /B before A\. Its order 1\. T-2 .* B .*2\. T-1 .* A It reuses B's helper\. Waits for T-2/);
  assert.match(inspector, /What it read and did Reads src\/b\.js Searches for “helper”/);
  assert.equal(inspector.includes("Queued tasks:"), false);
  click(view, "planner-prompt");
  assert.match(text(find(view.render(cx), "inspector")), /You plan the work queue\. Queued tasks:/);
  click(view, "planner-watch");
  assert.equal(view.state().planner.watch, true);
  assert.match(text(find(view.render(cx), "planner-watch")), /Next plan opens in a tab/);
  click(view, "planned-T-1");
  assert.deepEqual([view.drawer, view.selected], ["task", "T-1"]);
  click(view, "plan-open");
  assert.equal(view.drawer, "planner");
});

test("the map shows the plan as one clickable line, and the Plan pane has all of it", () => {
  const view = setup();
  let card = find(view.render(cx), "plan-open");
  assert.match(text(card), /The plan .*Ready\. Start the pipeline/);
  const line = card.nodes[0].nodes.at(-1);
  assert.ok(line.styles.truncate && text(line).startsWith("Ready."), "one line on the map");
  click(view, "plan-open");
  assert.equal(view.drawer, "planner");
  assert.match(text(find(view.render(cx), "inspector")), /^Plan .*Right now Ready\. Start the pipeline and the planner picks independent work first\.$/);
  click(view, "plan-open");
  assert.equal(view.drawer, null, "clicking it again closes the pane");
  const live = setupLive();
  live.act({ type: "create", title: "A" }, cx);
  click(live, "plan-open");
  assert.match(text(find(live.render(cx), "inspector")), /Right now .*The planner agent is off: tasks start by Start first, then priority, then arrival\./);
});
