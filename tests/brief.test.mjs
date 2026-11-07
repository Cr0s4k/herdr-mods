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

test("finishing a turn is quiet; requests for input are recorded once", () => {
  let result = observe({}, [agent("working")], 1);
  result = observe(result.next, [agent("done")], 2);
  assert.equal(result.events.length, 0);
  result = observe(result.next, [agent("idle")], 3);
  assert.equal(result.events.length, 0);
  result = observe(result.next, [agent("blocked")], 4);
  assert.deepEqual(result.events.map(item => item.kind), ["blocked"]);
  assert.equal(observe(result.next, [agent("blocked")], 5).events.length, 0);
});

test("routine legacy activity stays in history and does not inflate unread counts", () => {
  const events = [{ id: "turn", space: "one", time: 3, kind: "finished" },
    { id: "reply", space: "one", time: 4, kind: "blocked" }];
  const reports = [{ id: "push", space: "one", time: 2, source: "agent", title: "Login committed and pushed",
    summary: "Pushed abc1234 to origin/main. Working tree is clean.", tests: ["42 tests passed"] },
    { id: "result", space: "one", time: 1, source: "agent", title: "Login fixed", summary: "Sign-in works again." }];
  assert.deepEqual(entriesFor("one", events, reports).map(item => item.id), ["reply", "result"]);
  assert.equal(unreadFor(entriesFor("one", events, reports), []).length, 2);
  assert.deepEqual(entriesFor("one", events, reports, true).map(item => item.id), ["reply", "turn", "push", "result"]);
  for (const extra of [{ questions: ["Deploy this?"] }, { tests: ["Push failed"] }, { summary: "Push rejected by the remote." },
    { title: "Committed locally; push failed" }, { changes: ["Deployment is blocked"] }, { caveats: ["Requires a restart"] }]) {
    assert.equal(entriesFor("one", [], [{ ...reports[0], ...extra }]).length, 1);
  }
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

test("read more reveals changes only; caveats and questions stay visible", () => {
  world.props = null;
  world.spaces = [{ id: "one", active: true, name: "Project", tabs: [{ id: "tab" }] }];
  world.values = new Map([["brief.activity", []], ["brief.reports", [{ id: "handoff", space: "one", terminal: "t1", time: 100,
    source: "agent", title: "Ready", summary: "Fixed login", changes: ["Returns you to your original page"],
    tests: ["42 passed"], questions: ["Ship it?"], caveats: ["Safari has not been checked"] }]]]);
  world.agents = [agent("idle")];
  const view = new Brief(); view.init();
  let root = view.render();
  assert.doesNotMatch(textOf(root), /42 passed/);
  assert.doesNotMatch(textOf(root), /Returns you to your original page/);
  assert.match(textOf(root), /Safari has not been checked/);
  assert.match(textOf(root), /Ship it\?/);
  find(root, "brief-more-handoff").handlers.click({}, { notify() {} });
  root = view.render();
  assert.doesNotMatch(textOf(root), /42 passed|Show checks/);
  assert.match(textOf(root), /Returns you to your original page/);
  find(root, "brief-more-handoff").handlers.click({}, { notify() {} });
  root = view.render();
  assert.doesNotMatch(textOf(root), /42 passed/);
  assert.doesNotMatch(textOf(root), /Returns you to your original page/);
  assert.match(textOf(root), /Safari has not been checked/);
  assert.match(textOf(root), /Ship it\?/);
  find(root, "brief-open-handoff").handlers.click({}, {});
  assert.deepEqual(world.calls.at(-1), ["agent.focus", { terminal: "t1" }]);
  find(root, "brief-reviewed").handlers.click({}, {});
  assert.match(textOf(view.render()), /caught up/);
  world.values.get("brief.reports").push({ id: "delayed", space: "one", time: 50, source: "agent", title: "Earlier report", summary: "Arrived later" });
  root = view.render();
  assert.match(textOf(root), /Arrived later/);
  assert.doesNotMatch(textOf(root), /42 passed/);
  find(root, "brief-history").handlers.click({}, { notify() {} });
  find(view.render(), "brief-more-handoff").handlers.click({}, { notify() {} });
  assert.match(textOf(view.render()), /Returns you to your original page/);
  assert.doesNotMatch(textOf(view.render()), /42 passed/);
});

test("change-only briefs expand independently; test-only briefs have no disclosure", () => {
  world.props = null;
  world.spaces = [{ id: "one", active: true, name: "Project", tabs: [] }];
  world.values = new Map([["brief.reports", [
    { id: "changes", space: "one", time: 100, source: "agent", title: "New sidebar", summary: "Choose what to show.", changes: ["Hide quiet spaces"] },
    { id: "first", space: "one", time: 90, source: "agent", title: "First fix", summary: "Ready", changes: ["First change"], tests: ["First check passed"] },
    { id: "second", space: "one", time: 80, source: "agent", title: "Second fix", summary: "Ready", tests: ["Second check passed"] },
  ]]]);
  const view = new Brief(); view.init();
  let root = view.render();
  assert.doesNotMatch(textOf(root), /Hide quiet spaces/);
  assert.ok(find(root, "brief-more-changes"));
  assert.equal(find(root, "brief-more-second"), undefined);
  find(root, "brief-more-first").handlers.click({}, { notify() {} });
  root = view.render();
  assert.match(textOf(root), /First change/);
  assert.doesNotMatch(textOf(root), /Hide quiet spaces|First check passed|Second check passed|Show checks/);
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
  assert.match(textOf(root), /Finished/);
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

test("the always-mounted tracker skips completed turns and records requests once across redraws", () => {
  world.values = new Map(); world.agents = [agent("working")];
  const tracker = new BriefTracker(); tracker.previous = {};
  tracker.observe();
  world.agents = [agent("done")]; tracker.observe(); tracker.observe();
  assert.equal(world.values.has("brief.activity"), false);
  world.agents = [agent("blocked")]; tracker.observe(); tracker.observe();
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
