import assert from "node:assert/strict";
import test from "node:test";
import { suggest, touchUse, owners, ago, IDLE, DAY } from "../mods/space-cleanup/model.js";
import { STORE } from "../mods/pipeline/pipeline-model.js";

const NOW = 10 * DAY;
const claude = { key: "claude", name: "Claude Code", agent: true, shell: false };
const fish = { key: "shell", name: "fish", shell: true, agent: false };
const node = { key: "program", name: "node", shell: false, agent: false };
const tab = (id, extra = {}) => ({ id, name: id, named: false, active: false, changed_at: null, ...extra });
const space = (id, tabs, extra = {}) => ({ id, name: id, active: false, tabs, ...extra });
const term = (pane, tabId, terminal, program, extra = {}) => ({ pane, tab: tabId, terminal, program, cwd: `/work/${terminal}`, branch: "main", title: terminal, ...extra });
const agent = (address, pane, status) => ({ address, pane, status, title: "✳ Fix the login", program: claude });
const born = (address, at) => ({ address, created_ms: at });
const keys = groups => groups.flatMap(g => g.rows.map(row => `${row.pane}:${row.kind}:${row.tick ? "ticked" : "unticked"}`));

test("a shell at its prompt goes after an hour unused, unticked when its tab was named", () => {
  const sp = space("app", [tab("home"), tab("a"), tab("b"), tab("c", { named: true, name: "server" })]);
  const panes = [{ pane: "h", tab: "home", mod: "space-home" }, term("pa", "a", "t1", fish), term("pb", "b", "t2", fish), term("pc", "c", "t3", fish)];
  const used = { t1: NOW - 2 * IDLE, t2: NOW - IDLE / 2, t3: NOW - 3 * IDLE };
  const groups = suggest({ spaces: [sp], panes, agents: [], used, now: NOW });
  assert.deepEqual(keys(groups), ["pc:shell:unticked", "pa:shell:ticked"]);
  assert.equal(groups[0].rows[1].why, "at its prompt for 2h");
  assert.equal(groups[0].rows[0].name, "server");
  assert.equal(groups[0].rows[1].name, "t1");
});

test("an agent goes once idle for an hour; one working, asking, or owned by an unfinished task stays", () => {
  const sp = space("app", [tab("home"), tab("a"), tab("b"), tab("c"), tab("d"), tab("e"), tab("f")]);
  const panes = [{ pane: "h", tab: "home", mod: "space-home" }, ...["a", "b", "c", "d", "e", "f"].map(id => term(`p${id}`, id, `t${id}`, claude, { title: "✳ Fix the login" }))];
  const agents = [agent("ta", "pa", "idle"), agent("tb", "pb", "working"), agent("tc", "pc", "blocked"), agent("td", "pd", "done"), agent("te", "pe", "idle"), agent("tf", "pf", "idle")];
  const pipelines = { "live:app": { live: true, tasks: [
    { id: "T-1", status: "review", terminal: "te" },
    { id: "T-2", status: "done", terminal: "tf" },
  ] } };
  const used = Object.fromEntries(["ta", "tb", "tc", "td", "te"].map(t => [t, NOW - 3 * IDLE]));
  used.tf = NOW;
  const groups = suggest({ spaces: [sp], panes, agents, pipelines, used, now: NOW });
  assert.deepEqual(keys(groups), ["pa:agent:ticked", "pd:agent:unticked", "pf:agent:ticked"]);
  const why = Object.fromEntries(groups[0].rows.map(row => [row.pane, row.why]));
  assert.deepEqual(why, { pa: "idle for 3h", pd: "finished 3h ago, reply not read", pf: "its Pipeline task T-2 is merged" });
  assert.equal(groups[0].rows[0].name, "Fix the login · 2");
});

test("a running program is offered, unticked, only after a day; a panel after a day, never Home or Pipeline", () => {
  const sp = space("app", [tab("home"), tab("a"), tab("b"), tab("git"), tab("pipe"), tab("show")]);
  const panes = [{ pane: "h", tab: "home", mod: "space-home" }, term("pa", "a", "ta", node), term("pb", "b", "tb", node),
    { pane: "pg", tab: "git", mod: "changes-modal", title: "Git" }, { pane: "pp", tab: "pipe", mod: "pipeline", title: "Pipeline" },
    { pane: "ps", tab: "show", mod: "show-pane", title: "Show" }];
  const used = { ta: NOW - 2 * DAY, tb: NOW - 5 * IDLE, pg: NOW - 2 * DAY, pp: NOW - 9 * DAY, h: NOW - 9 * DAY };
  const groups = suggest({ spaces: [sp], panes, agents: [], used, now: NOW });
  assert.deepEqual(keys(groups), ["pa:program:unticked", "pg:panel:ticked"]);
  assert.equal(groups[0].rows[0].why, "runs node, untouched for 2d");
  assert.equal(groups[0].rows[1].why, "not opened for 2d");
});

test("without a record, a terminal's age and its tab's last change stand in; the focused pane is never offered", () => {
  const sp = space("app", [tab("home"), tab("a"), tab("b", { changed_at: NOW - 60000 }), tab("c")]);
  const panes = [{ pane: "h", tab: "home", mod: "space-home" }, term("pa", "a", "ta", fish), term("pb", "b", "tb", fish), term("pc", "c", "tc", fish)];
  const terminals = [born("ta", NOW - 3 * DAY), born("tb", NOW - 3 * DAY), born("tc", NOW - 3 * DAY)];
  const groups = suggest({ spaces: [sp], panes, agents: [], terminals, focused: "pc", now: NOW });
  assert.deepEqual(keys(groups), ["pa:shell:ticked"]);
  assert.equal(groups[0].rows[0].why, "at its prompt for 3d");
});

test("a space with no Home keeps the tab it used last, so closing never empties it", () => {
  const sp = space("bare", [tab("a"), tab("b")]);
  const panes = [term("pa", "a", "ta", fish), term("pb", "b", "tb", fish), term("pb2", "b", "tb2", fish)];
  const used = { ta: NOW - 5 * IDLE, tb: NOW - 2 * IDLE, tb2: NOW - 4 * IDLE };
  const rows = suggest({ spaces: [sp], panes, agents: [], used, now: NOW })[0].rows;
  assert.deepEqual(rows.map(row => [row.pane, row.hold, row.tick]), [["pa", null, true], ["pb2", "keeps the space open", false], ["pb", "keeps the space open", false]]);
  assert.deepEqual(rows.map(row => row.name), ["ta", "tb2", "tb"]);
  const withHome = suggest({ spaces: [{ ...sp, tabs: [tab("home"), ...sp.tabs] }], panes: [{ pane: "h", tab: "home", mod: "space-home" }, ...panes], agents: [], used, now: NOW })[0].rows;
  assert.ok(withHome.every(row => row.hold === null && row.tick));
  const busy = suggest({ spaces: [sp], panes: [...panes, term("pw", "b", "tw", claude)], agents: [agent("tw", "pw", "working")], used, now: NOW })[0].rows;
  assert.ok(busy.every(row => row.hold === null));
});

test("one space can be asked for alone, and spaces with nothing to close are left out", () => {
  const panes = [term("pa", "a", "ta", fish), term("pb", "b", "tb", fish), { pane: "ha", tab: "home-a", mod: "space-home" }, { pane: "hb", tab: "home-b", mod: "space-home" }];
  const spaces = [space("one", [tab("home-a"), tab("a")]), space("two", [tab("home-b"), tab("b")])];
  const used = { ta: NOW - 2 * IDLE, tb: NOW };
  assert.deepEqual(suggest({ spaces, panes, agents: [], used, now: NOW }).map(g => g.space.id), ["one"]);
  const twins = suggest({ spaces: [space("one", [tab("home-a"), tab("a"), tab("b")])], panes: [...panes, term("pa2", "b", "ta2", fish, { cwd: "/work/ta" })],
    agents: [], used: { ta: NOW - 3 * IDLE, ta2: NOW - 2 * IDLE }, now: NOW })[0].rows;
  assert.deepEqual(twins.map(row => row.name), ["ta · 2", "ta · 3"]);
  const split = suggest({ spaces: [space("one", [tab("home-a"), tab("a")])], panes: [...panes, term("pa2", "a", "ta2", fish, { cwd: "/work/ta" })],
    agents: [], used: { ta: NOW - 3 * IDLE, ta2: NOW - 2 * IDLE }, now: NOW })[0].rows;
  assert.deepEqual(split.map(row => row.name), ["ta · ta", "ta · ta2"]);
  assert.deepEqual(suggest({ spaces, panes, agents: [], used: { ta: 0, tb: 0 }, only: "two", now: NOW }).map(g => g.space.id), []);
  assert.deepEqual(suggest({ spaces, panes, agents: [], used: { ta: NOW - 2 * IDLE, tb: NOW - 2 * IDLE }, only: "two", now: NOW }).map(g => g.space.id), ["two"]);
});

test("use is what is on screen with Herdr in front, and agents working or asking anywhere, noted once a minute", () => {
  const spaces = [space("app", [tab("a", { active: true }), tab("b")], { active: true }), space("other", [tab("c", { active: true })])];
  const panes = [term("pa", "a", "ta", fish), { pane: "pg", tab: "a", mod: "changes-modal" }, term("pb", "b", "tb", fish), term("pc", "c", "tc", claude, { status: "working" })];
  const used = touchUse({}, spaces, panes, NOW, true);
  assert.deepEqual(used, { ta: NOW, pg: NOW, tc: NOW });
  assert.equal(touchUse(used, spaces, panes, NOW + 30000, true), used);
  assert.deepEqual(touchUse(used, spaces, panes, NOW + 60000, true), { ta: NOW + 60000, pg: NOW + 60000, tc: NOW + 60000 });
  assert.deepEqual(touchUse({}, spaces, panes, NOW, false), { tc: NOW });
  const many = Object.fromEntries(Array.from({ length: 401 }, (_, i) => [`gone${i}`, 1]));
  assert.deepEqual(touchUse({ ...many, tb: 5 }, spaces, panes, NOW, false), { tb: 5, tc: NOW });
});

test("only live Pipelines own terminals, an unfinished task's over a merged one's", () => {
  assert.equal(STORE, "pipeline.prototype.v1");
  const found = owners({
    "live:a": { live: true, tasks: [{ id: "T-1", status: "done", terminal: "t1" }, { id: "T-2", status: "working", terminal: "t1" }, { id: "T-3", status: "pr", adopt: { terminal: "t2" } },
      { id: "T-4", status: "working", terminal: "t3", discard: true }] },
    demo: { tasks: [{ id: "T-9", status: "review", terminal: "t4" }] },
  });
  assert.deepEqual(Object.fromEntries(found), { t1: { id: "T-2", done: false }, t2: { id: "T-3", done: false } });
  assert.deepEqual([ago(59 * 60000), ago(90 * 60000), ago(36 * 3600000)], ["59m", "2h", "2d"]);
});

const world = { spaces: [], panes: [], agents: [], terminals: [], shared: {}, props: {}, calls: [], closed: [], focused: null };
function element() {
  const target = { nodes: [], handlers: {}, styles: {} };
  let el;
  el = new Proxy(target, { get(t, k) {
    if (k in t) return t[k];
    if (k === "child") return child => { t.nodes.push(child); return el; };
    if (k === "children") return children => { t.nodes.push(...children); return el; };
    if (k === "when") return (condition, apply) => condition ? apply(el) : el;
    if (k.startsWith("on_")) return (...args) => { t.handlers[k.slice(3)] = args.at(-1); return el; };
    return (...args) => { t.styles[k] = args; return el; };
  } });
  return el;
}
const cx = { notify() {}, stop_propagation() {}, timer: { after() {} }, focus_handle: () => ({ focus() {} }) };
globalThis.__cleanup = {
  View: class {}, div: element, svg: element, image: element, h_flex: element, v_flex: element, ScrollHandle: { new: () => ({ scroll_to_item() {} }) },
  spaces: () => world.spaces, panes: () => world.panes, agents: () => world.agents, terminals: () => world.terminals,
  focused: () => world.focused, shared: k => world.shared[k], theme: () => new Proxy({}, { get: (_, k) => k }), props: () => world.props,
  run: (...args) => world.calls.push(args), closeOverlay: id => world.closed.push(id), checking: () => false, home: () => "/home/me",
  track() {}, ink: () => "ink", STORE, ...(await import("../mods/space-cleanup/model.js")),
};
const { readFile } = await import("node:fs/promises");
const source = (await readFile(new URL("../mods/space-cleanup/main.js", import.meta.url), "utf8")).replace(/^import .*;\n/gm, "");
const { default: Cleanup } = await import("data:text/javascript," + encodeURIComponent(
  "const { View, div, svg, image, h_flex, v_flex, ScrollHandle, spaces, panes, agents, terminals, focused, shared, theme, props, run, closeOverlay, checking, home, track, ink, STORE, USED, suggest } = globalThis.__cleanup;\n" + source));
const find = (el, id) => el?.styles?.id?.[0] === id ? el : (el?.nodes ?? []).map(n => find(n, id)).find(Boolean);
const text = el => typeof el === "string" ? el : (el?.nodes ?? []).map(text).join(" ");
const click = (root, id) => { const el = find(root, id); assert.ok(el, `Missing ${id}`); el.handlers.click({}, cx); };

function open(props = {}) {
  const now = Date.now();
  Object.assign(world, { props: { overlay: "ov", ...props }, calls: [], closed: [], focused: null,
    spaces: [space("app", [tab("home"), tab("a"), tab("b")]), space("bare", [tab("c")])],
    panes: [{ pane: "h", tab: "home", mod: "space-home" }, term("pa", "a", "ta", fish), term("pb", "b", "tb", claude), term("pc", "c", "tc", fish)],
    agents: [agent("tb", "pb", "done")], terminals: [],
    shared: { "cleanup.used": { ta: now - 2 * IDLE, tb: now - 2 * IDLE, tc: now - 2 * IDLE } } });
  const view = new Cleanup(); view.init({}, cx); return view;
}

test("the dialog ticks the safe suggestions, asks once, then closes their panes and keeps the spaces", () => {
  const view = open();
  let root = view.render();
  assert.match(text(root), /Clean up spaces/);
  assert.ok(find(root, "sc-space-app") && find(root, "sc-space-bare"));
  assert.deepEqual([...view.ticked], ["app:pa"]);
  assert.match(text(find(root, "sc-bare:pc")), /keeps the space open/);
  click(root, "sc-bare:pc");
  assert.deepEqual([...view.ticked], ["app:pa"]);
  click(root, "sc-app:pb");
  root = view.render();
  assert.match(text(find(root, "sc-confirm")), /Close 2 items/);
  click(root, "sc-confirm");
  assert.deepEqual(world.calls, []);
  root = view.render();
  assert.match(text(root), /conversation stays under Recent/);
  click(root, "sc-confirm");
  assert.deepEqual(world.calls, [["pane.close", { pane: "pa" }], ["pane.close", { pane: "pb" }]]);
  world.panes = world.panes.filter(p => p.pane !== "pa" && p.pane !== "pb");
  root = view.render();
  assert.match(text(root), /Closed 2 items/);
  assert.equal(find(root, "sc-app:pa"), undefined);
});

test("a space's own cleanup lists only it, a row's arrow goes there, and an empty one says why", () => {
  let view = open({ space: "app" });
  let root = view.render();
  assert.match(text(root), /Clean up app/);
  assert.equal(find(root, "sc-space-bare"), undefined);
  click(root, "sc-go-app:pa");
  assert.deepEqual(world.calls, [["pane.focus", { pane: "pa" }]]);
  assert.deepEqual(world.closed, ["ov"]);
  view = open();
  world.shared = { "cleanup.used": {} };
  world.terminals = [];
  root = view.render();
  assert.ok(find(root, "sc-empty"));
});
