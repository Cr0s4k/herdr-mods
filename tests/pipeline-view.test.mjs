import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const modelSource = await readFile(new URL("../mods/pipeline/pipeline-model.js", import.meta.url), "utf8");
const model = await import(`data:text/javascript,${encodeURIComponent(modelSource)}`);
const geometrySource = (await readFile(new URL("../mods/pipeline/geometry.js", import.meta.url), "utf8")).replace(/^import .*;\n/gm, "");
const geometry = await import(`data:text/javascript,${encodeURIComponent(`const ACTIVE = ${JSON.stringify(model.ACTIVE)};\n${geometrySource}`)}`);
const world = { data: {}, storage: new Map() };
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
  ...model, ...geometry, View: class {}, div: native, svg: native, h_flex: native, v_flex: native,
  Button: { new: id => native().id(id) }, Input: { new: native },
  InputState: { new: () => { let value = ""; return { on() {}, focus() {}, release() {}, value: () => value, set_value: next => { value = next; } }; } },
  PathBuilder: { stroke: path }, window: { paint_path: native },
  shared: key => world.data[key], setShared: (key, value) => { world.data[key] = value; },
  props: () => ({ context: { id: "project", name: "Project" } }), appWindow: () => ({ platform: "linux", active: true }),
  theme: () => new Proxy({}, { get: (_obj, key) => key }),
  settings: () => ({ zoom: 1.1 }),
  localStorage: { getItem: key => world.storage.get(key) ?? null, setItem: (key, value) => world.storage.set(key, value) },
};
const uiSource = (await readFile(new URL("../mods/pipeline/main.js", import.meta.url), "utf8")).replace(/^import .*;\n/gm, "");
const { default: Pipeline } = await import(`data:text/javascript,${encodeURIComponent(`const { ${Object.keys(globalThis.__pipelineView).join(", ")} } = globalThis.__pipelineView;\n${uiSource}`)}`);
const cx = { notify() {}, spawn() {}, focus_handle: () => ({ focus() {}, release() {}, is_focused: () => true }) };
function setup() {
  world.data = {};
  const view = new Pipeline(); view.init({}, cx); return view;
}
function find(node, id) {
  if (node?.styles?.id?.[0] === `pipeline-${id}`) return node;
  for (const child of node?.nodes ?? []) { const result = find(child, id); if (result) return result; }
}
function click(view, id) {
  const node = find(view.render(cx), id);
  assert.ok(node, `control ${id} exists`);
  assert.equal(Boolean(node.styles.disabled?.[0]), false, `${id} is enabled`);
  node.handlers.on_click({}, cx);
}

test("task picker, watch and parallel controls change the shared pipeline", () => {
  const view = setup();
  click(view, "add"); click(view, "row-DEMO-106"); click(view, "add-picked");
  assert.equal(view.state().tasks.find(task => task.id === "DEMO-106").status, "queued");
  click(view, "watch"); click(view, "watch-toggle"); click(view, "arrival");
  assert.equal(view.state().tasks.find(task => task.id === "DEMO-107").source, "Watch · Ready");
  click(view, "parallel"); click(view, "parallel-more");
  assert.equal(view.state().parallel, 4);
});

test("all inspector branches and narrow scenes render through actual view methods", () => {
  const view = setup();
  for (const width of [340, 780, 1450]) {
    view.size = { width, height: 700 };
    for (const drawer of [null, "picker", "queue", "settings", "quota", "watch", "history", "task"]) {
      view.drawer = drawer; view.selected = "DEMO-101";
      assert.ok(view.render(cx));
    }
  }
});

test("per-repository approval buttons drive the task into integration", () => {
  const view = setup();
  let state = view.state();
  const task = state.tasks.find(task => task.id === "DEMO-101"); task.status = "review"; task.delivery = "pr";
  view.inspect(task.id, cx);
  click(view, "approve-DEMO-101-contracts");
  assert.equal(view.state().tasks[0].status, "review");
  click(view, "approve-DEMO-101-api");
  assert.equal(view.state().tasks[0].status, "merging");
  assert.ok(view.render(cx));
});

test("quota limit and reset controls stop and resume dispatch", () => {
  const view = setup();
  click(view, "quota"); click(view, "quota-limit"); click(view, "run");
  assert.equal(model.activeTasks(view.state()).length, 0);
  click(view, "quota-reset");
  assert.equal(model.activeTasks(view.state()).length, 3);
});

test("every queued task remains inspectable and removable when more than five are paused", () => {
  const view = setup();
  view.act({ type: "add", ids: ["DEMO-106", "DEMO-107", "DEMO-108"] }, cx);
  assert.equal(view.state().running, false);
  click(view, "queue-more");
  click(view, "row-DEMO-108");
  assert.equal(view.selected, "DEMO-108");
  click(view, "remove-DEMO-108");
  assert.equal(view.state().tasks.find(task => task.id === "DEMO-108").status, "backlog");
});

test("occupied higher slots keep their canvas width after lowering concurrency", () => {
  let state = model.createPipeline({ id: "slots" }, 0);
  for (const action of [{ type: "parallel", value: 6 }, { type: "reviewLimit", value: 10 }, { type: "add", ids: ["DEMO-106", "DEMO-108"] }, { type: "run" }]) state = model.reduce(state, action, 0);
  assert.equal(model.activeTasks(state).length, 5);
  state = model.reduce(state, { type: "parallel", value: 3 }, 0);
  const scene = geometry.layoutScene(state, 620, 600);
  assert.ok(scene.w >= 1200);
  assert.ok(scene.slots[3].x - scene.slots[0].x >= 164);
});

test("painted root bounds are normalized for app zoom before positioning review", () => {
  const view = setup();
  const root = view.render(cx);
  root.handlers.on_size_change({ width: 1100, height: 880 }, cx);
  assert.ok(Math.abs(view.size.width - 1000) < 0.01);
  assert.ok(Math.abs(view.size.height - 800) < 0.01);
});
