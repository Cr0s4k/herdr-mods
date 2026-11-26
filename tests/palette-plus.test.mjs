import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { STORE, taskJumps } from "../mods/palette-plus/jump.js";
import { STORE as PIPELINES } from "../mods/pipeline/pipeline-model.js";

const world = {};
globalThis.__moreNative = {
  STORE, taskJumps, run: (name, args) => world.calls.push([name, args]),
  spaces: () => world.spaces, panes: () => world.panes ?? [], homeTab: (await import("../mods/space-home/model.js")).homeTab, focused: () => world.focus, agents: () => world.agents, layout: () => world.layout,
  shared: key => world.shared[key], setShared: (key, value) => { world.shared[key] = value; },
  openOverlay: spec => world.overlays.push(spec), togglesSize: () => ({ width: 420, height: 400 }),
};
let source = (await readFile(new URL("../mods/palette-plus/more.js", import.meta.url), "utf8")).replace(/^import .*;\n/gm, "");
source = `const { ${Object.keys(globalThis.__moreNative).join(", ")} } = globalThis.__moreNative;\n` + source;
const { more } = await import("data:text/javascript," + encodeURIComponent(source));

function setup({ panel = null, sidebar = true, tabBar = true } = {}) {
  Object.assign(world, {
    spaces: [{ id: "space", active: true }],
    focus: { space: "space", tab: "tab", pane: "pane", terminal: "t1" },
    agents: [{ address: "t1", pinned: false }],
    shared: {}, overlays: [], calls: [],
    layout: { id: "root", children: [
      { id: "sidebar", hidden: !sidebar, children: [{ type: "block", content: { mod: "spaces-pin" } }] },
      { type: "block", hidden: !tabBar, content: { mod: "tabs-show" } },
      { id: "panel", hidden: !panel, children: [{ id: "panel-body", type: "stack", active: panel ?? "files", children: [
        { id: "files", content: { mod: "files-modal" } }, { id: "show", content: { mod: "show" } }, { id: "brief", content: { mod: "brief" } },
      ] }] },
    ] },
  });
}
const titled = title => more().find(e => e.title === title);

test("every enabled side panel is listed, and features switched off stay out", () => {
  setup();
  world.shared.features = { loops: false };
  const panels = more().filter(e => e.group === "Panel").map(e => e.name);
  assert.deepEqual(panels, ["mod.open", ...["files", "changes", "show", "brief", "skills", "watchers", "plane", "linear"].map(id => `tabs-show.${id}`)]);
  world.shared["workspace.panels"] = ["changes"];
  assert.ok(!more().some(e => e.name === "tabs-show.files"));
});

test("the open panel offers to close and to move into a pane, through its own mod", () => {
  setup({ panel: "brief" });
  assert.equal(titled("Close Brief panel").name, "tabs-show.brief");
  assert.equal(titled("Move Brief panel to a pane").name, "brief.pane");
  assert.equal(titled("Open Show panel").name, "tabs-show.show");
  assert.equal(titled("Move Show panel to a pane"), undefined);
});

test("commands for the tab bar and sidebar are left out when they can't hear them", () => {
  setup({ tabBar: false, sidebar: false });
  assert.ok(!more().some(e => e.name.startsWith("tabs-show.") || e.name.startsWith("spaces-pin.")));
  assert.ok(titled("New space from a project…"));
});

test("Pipeline commands go through the tab bar, and Pipeline handles each of them", async () => {
  setup();
  const pipeline = await readFile(new URL("../mods/pipeline/main.js", import.meta.url), "utf8");
  const drawers = JSON.parse(pipeline.match(/const DRAWERS = (\[.*?\]);/)[1]);
  const handled = new Set([...drawers, ...[...pipeline.matchAll(/command === "([a-z]+)"/g)].map(m => m[1])]);
  const sent = more().filter(e => e.group === "Pipeline" && e.name !== "tabs-show.pipeline");
  assert.ok(sent.length >= 10);
  for (const e of sent) {
    assert.match(e.name, /^tabs-show\.pipeline-/);
    assert.ok(handled.has(e.name.slice("tabs-show.pipeline-".length)), e.name);
  }
});

test("the sidebar's own commands are the ones it listens for", async () => {
  setup();
  const sidebar = await readFile(new URL("../mods/spaces-pin/main.js", import.meta.url), "utf8");
  for (const e of more().filter(e => e.name.startsWith("spaces-pin."))) {
    const command = e.name.slice("spaces-pin.".length);
    assert.ok(sidebar.includes(`command === "${command}"`) || sidebar.includes(`command !== "${command}"`), e.name);
  }
});

test("the focused agent can be pinned and unpinned", () => {
  setup();
  assert.deepEqual(titled("Pin agent").args, { terminal: "t1", pinned: true });
  world.agents[0].pinned = true;
  assert.deepEqual(titled("Unpin agent").args, { terminal: "t1", pinned: false });
  world.focus.terminal = null;
  assert.ok(!more().some(e => e.name === "terminal.pin"));
});

test("dialogs open centred, and space focus switches both ways", () => {
  setup();
  titled("Hide this space for a while…").do();
  assert.deepEqual(world.overlays[0], { kind: "dialog", mod: "space-hide", width: 330, height: 350, props: { id: "space" } });
  titled("Focus this space").do();
  assert.equal(world.shared["spaces.focus"], "space");
  titled("All spaces").do();
  assert.equal(world.shared["spaces.focus"], null);
});

test("Find file is listed even without the tab bar, and opens the find-file popup", () => {
  setup({ tabBar: false, sidebar: false });
  assert.deepEqual(titled("Find conversation…").args, { name: "find-chat" });
  titled("Clean up worktrees…").do();
  assert.deepEqual(world.overlays.pop(), { kind: "dialog", mod: "worktree-cleanup", width: 860, height: 560 });
  assert.deepEqual(titled("Find file…"), { name: "mod.open", args: { name: "find-file" }, group: "Panel", title: "Find file…", words: "go to file open search fuzzy quick name" });
});

test("unfinished Pipeline tasks are listed by ticket, pull request and branch, and open in their own space", () => {
  setup();
  assert.equal(STORE, PIPELINES);
  world.spaces = [{ id: "space", active: true, folder: "/work/site", machine: null, name: "site" }, { id: "shop", active: false, folder: "/work/shop", machine: null, name: "shop" }];
  world.shared[STORE] = {
    "live:a": { live: true, context: { cwd: "/work/shop", on: null }, tasks: [
      { id: "T-7", title: "Dark mode", status: "pr", ticket: { key: "ENG-42", url: "https://linear.app/acme/issue/ENG-42" }, prs: { shop: { number: 216, url: "https://github.com/me/shop/pull/216" } }, workspaces: { shop: { branch: "T-7-dark-mode" } } },
      { id: "T-8", title: "Merged already", status: "done" }, { id: "T-9", title: "Thrown away", status: "review", discard: true },
      { id: "T-10", title: "Plain", status: "queued" },
    ] },
    "live:b": { live: true, context: { cwd: "/work/closed", on: null }, tasks: [{ id: "T-1", title: "No space open", status: "review" }] },
    demo: { context: {}, tasks: [{ id: "T-1", title: "A simulation", status: "review" }] },
  };
  const jumps = more().filter(e => e.title.startsWith("Go to "));
  assert.deepEqual(jumps.map(e => e.title), ["Go to T-7 (ENG-42, #216): Dark mode", "Go to T-10: Plain"]);
  assert.match(jumps[0].words, /pull request open .*ENG-42 .*pull\/216 T-7-dark-mode shop/);
  assert.deepEqual([jumps[0].group, jumps[0].name, jumps[0].args], ["Pipeline", "tabs-show.pipeline-task-T-7", { space: "shop" }]);
  jumps[0].do();
  assert.deepEqual(world.calls, [["space.select", { id: "shop" }], ["tabs-show.pipeline-task-T-7", undefined]]);
  setup({ tabBar: false });
  world.shared[STORE] = { "live:a": { live: true, context: { cwd: undefined }, space: "space", tasks: [{ id: "T-1", title: "x", status: "review" }] } };
  assert.equal(more().filter(e => e.title.startsWith("Go to ")).length, 0);
});

test("a space with a Home tab offers to go to it", () => {
  setup();
  assert.equal(titled("Go to this space's Home"), undefined);
  world.spaces = [{ id: "space", active: true, tabs: [{ id: "home" }, { id: "tab" }] }];
  world.panes = [{ pane: "home-pane", mod: "space-home", tab: "home" }];
  titled("Go to this space's Home").do();
  assert.deepEqual(world.calls, [["tab.select", { id: "home" }], ["pane.focus", { pane: "home-pane" }]]);
  world.panes = [];
});
