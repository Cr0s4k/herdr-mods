import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const modelSource = await readFile(new URL("../mods/brief/model.js", import.meta.url), "utf8");
const { observe, entriesFor, unreadFor, receipt } = await import("data:text/javascript," + encodeURIComponent(modelSource));
const agent = (status, extra = {}) => ({ address: "t1", space: "one", app: "codex", status, seq: 1, title: "Fix login", ...extra });

test("baseline, unknown, closed and replaced agents never imply successful work", () => {
  let result = observe({}, [agent("done")], 1);
  assert.equal(result.events.length, 0);
  result = observe(observe({}, [agent("working")], 1).next, [], 2);
  assert.equal(result.events.length, 0);
  result = observe(observe({}, [agent("unknown")], 1).next, [agent("idle")], 2);
  assert.equal(result.events.length, 0);
  result = observe(observe({}, [agent("working")], 1).next, [agent("idle", { app: "claude-code" })], 2);
  assert.equal(result.events.length, 0);
});

test("completion and questions survive focus normalization without duplicate updates", () => {
  let result = observe({}, [agent("working")], 1);
  result = observe(result.next, [agent("done")], 2);
  assert.deepEqual(result.events.map(item => item.kind), ["finished"]);
  assert.match(result.events[0].summary, /finished a turn/);
  result = observe(result.next, [agent("idle")], 3);
  assert.equal(result.events.length, 0);
  result = observe(result.next, [agent("blocked")], 4);
  assert.deepEqual(result.events.map(item => item.kind), ["blocked"]);
  assert.equal(observe(result.next, [agent("blocked")], 5).events.length, 0);
});

test("review receipts isolate spaces and do not consume delayed handoffs", () => {
  const events = [{ id: "seen", space: "one", time: 100 }, { id: "other", space: "two", time: 300 }];
  const reports = [{ id: "late", space: "one", time: 50 }];
  const items = entriesFor("one", events, reports);
  assert.deepEqual(items.map(item => item.id), ["seen", "late"]);
  assert.deepEqual(unreadFor(items, ["seen"]).map(item => item.id), ["late"]);
  assert.notEqual(receipt("one"), receipt("two"));
});

const world = { values: new Map(), spaces: [], agents: [], props: null, calls: [] };
function element() {
  const target = { nodes: [], handlers: {} };
  let el;
  el = new Proxy(target, { get(t, key) {
    if (key in t) return t[key];
    if (key === "child") return child => { t.nodes.push(child); return el; };
    if (key === "children") return children => { t.nodes.push(...children); return el; };
    if (key === "when") return (condition, apply) => condition ? apply(el) : el;
    if (key === "on_click") return callback => { t.handlers.click = callback; return el; };
    return (...args) => { t[key + "Args"] = args; return el; };
  } });
  return el;
}
globalThis.__briefNative = {
  View: class {}, div: element, v_flex: element, h_flex: element,
  Button: { new: id => element().id(id) }, TextView: { markdown: (id, text) => element().id(id).child(text) },
  spaces: () => world.spaces, agents: () => world.agents, props: () => world.props,
  shared: key => world.values.get(key), setShared: (key, value) => world.values.set(key, value),
  run: (...args) => world.calls.push(args), theme: () => new Proxy({}, { get: (_, key) => key }),
  moveToPaneButton: () => element(),
};
const source = (await readFile(new URL("../mods/brief/main.js", import.meta.url), "utf8")).replace(/^import .*;\n/gm, "");
const { default: Brief } = await import("data:text/javascript," + encodeURIComponent(
  modelSource.replaceAll("export ", "") + "\nconst { View, div, TextView, v_flex, h_flex, Button, spaces, agents, props, shared, setShared, run, theme, moveToPaneButton } = globalThis.__briefNative;\n" + source));
const textOf = node => typeof node === "string" ? node : (node?.nodes ?? []).map(textOf).join(" ");
const find = (node, id) => node?.idArgs?.[0] === id ? node : (node?.nodes ?? []).map(child => find(child, id)).find(Boolean);

test("real rows show handoff evidence; marking reviewed preserves history and later arrivals", () => {
  world.props = null;
  world.spaces = [{ id: "one", active: true, name: "Project", tabs: [{ id: "tab" }] }];
  world.values = new Map([["brief.activity", []], ["brief.reports", [{ id: "handoff", space: "one", terminal: "t1", time: 100,
    source: "agent", title: "Ready", summary: "Fixed login", changes: ["Updated callback"], tests: ["42 passed"], questions: ["Ship it?"] }]]]);
  world.agents = [agent("idle")];
  const view = new Brief(); view.init();
  let root = view.render();
  assert.match(textOf(root), /42 passed/);
  assert.match(textOf(root), /Validation · agent reported/);
  find(root, "brief-open-handoff").handlers.click({}, {});
  assert.deepEqual(world.calls.at(-1), ["agent.focus", { terminal: "t1" }]);
  find(root, "brief-reviewed").handlers.click({}, {});
  assert.match(textOf(view.render()), /caught up/);
  world.values.get("brief.reports").push({ id: "delayed", space: "one", time: 50, source: "agent", title: "Earlier report", summary: "Arrived later" });
  root = view.render();
  assert.match(textOf(root), /Arrived later/);
  assert.doesNotMatch(textOf(root), /42 passed/);
  find(root, "brief-history").handlers.click({}, { notify() {} });
  assert.match(textOf(view.render()), /42 passed/);
});

test("a brief pane stays bound to its tab and never focuses a reused terminal in another space", () => {
  world.props = { tab: "original" };
  world.spaces = [{ id: "one", active: false, name: "Original", tabs: [{ id: "original" }] },
    { id: "two", active: true, name: "Elsewhere", tabs: [{ id: "elsewhere" }] }];
  world.values = new Map([["brief.activity", [{ id: "event", space: "one", terminal: "t1", time: 20, title: "Old agent", summary: "Finished", source: "observed" }]]]);
  world.agents = [agent("idle", { space: "two" })];
  const view = new Brief(); view.init();
  assert.equal(view.space().id, "one");
  const root = view.render();
  assert.match(textOf(root), /outcome unverified/);
  assert.equal(find(root, "brief-open-event"), undefined);
});

globalThis.__briefTrackerNative = {
  agents: () => world.agents, appHome: () => "/app",
  exec: async () => world.result,
  shared: key => world.values.get(key), setShared: (key, value) => world.values.set(key, value),
};
const trackerSource = (await readFile(new URL("../mods/brief/tracker.js", import.meta.url), "utf8")).replace(/^import .*;\n/gm, "");
const { BriefTracker } = await import("data:text/javascript," + encodeURIComponent(modelSource.replaceAll("export ", "") +
  "\nconst { agents, appHome, exec, shared, setShared } = globalThis.__briefTrackerNative;\n" + trackerSource));

test("the always-mounted tracker records background events once across redraws", () => {
  world.values = new Map(); world.agents = [agent("working")];
  const tracker = new BriefTracker(); tracker.previous = {};
  tracker.observe();
  world.agents = [agent("done")]; tracker.observe(); tracker.observe();
  assert.equal(world.values.get("brief.activity").length, 1);
  assert.equal(world.values.get("brief.activity")[0].space, "one");
});

test("a broken handoff refresh keeps the last successful reports until recovery", async () => {
  const original = [{ id: "kept", space: "one" }];
  world.values = new Map([["brief.reports", original]]);
  const tracker = new BriefTracker();
  world.result = { code: 0, stdout: "null" };
  await tracker.refresh({ notify() {} });
  assert.deepEqual(world.values.get("brief.reports"), original);
  assert.match(world.values.get("brief.error"), /Previous updates are kept/);
  world.result = { code: 0, stdout: JSON.stringify({ items: [], warning: null }) };
  await tracker.refresh({ notify() {} });
  assert.deepEqual(world.values.get("brief.reports"), []);
  assert.equal(world.values.get("brief.error"), null);
});
