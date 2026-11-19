import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const world = {};
globalThis.__moreNative = {
  spaces: () => world.spaces, focused: () => world.focus, agents: () => world.agents, layout: () => world.layout,
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
    shared: {}, overlays: [],
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
  assert.deepEqual(panels, ["files", "changes", "show", "brief", "skills", "watchers", "plane", "linear"].map(id => `tabs-show.${id}`));
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
