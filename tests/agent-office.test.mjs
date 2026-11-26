import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const world = { files: {}, shared: {}, calls: [], writes: [] };
globalThis.__officeNative = {
  home: () => "/home/me",
  appHome: () => "/home/me/.config/herdr-app",
  shared: key => world.shared[key],
  readTextFile: async path => world.files[path] ?? null,
  writeTextFile: async (path, text, expected) => {
    if ((world.files[path] ?? null) !== expected) throw new Error("stale");
    world.writes.push(path);
    world.files[path] = text;
    return null;
  },
  exec: async (command, args, options) => {
    world.calls.push({ command, args, options });
    return world.result ?? { code: 0, stdout: "", stderr: "" };
  },
};
let source = (await readFile(new URL("../mods/agent-office/office.js", import.meta.url), "utf8")).replace(/^import .*;\n/gm, "");
source = `const { ${Object.keys(globalThis.__officeNative).join(", ")} } = globalThis.__officeNative;\n` + source;
const office = await import("data:text/javascript," + encodeURIComponent(source));

const HOOK = "/home/me/.claude/settings.json";
const STATE = "/home/me/.config/herdr-app/agent-office";

function reset(files = {}) {
  Object.assign(world, { files: { ...files }, shared: {}, calls: [], writes: [], result: null });
}

test("the office page is where the hook sends events, without /events", () => {
  assert.equal(office.pageFor("https://office.example.com/events"), "https://office.example.com/");
  assert.equal(office.pageFor(" https://office.example.com "), "https://office.example.com/");
  assert.equal(office.pageFor("http://localhost:4748/events/"), "http://localhost:4748/");
  assert.equal(office.pageFor("https://example.com/team/events"), "https://example.com/team/");
  for (const bad of ["", "office.example.com/events", "ftp://x/events", null, 4, undefined]) assert.equal(office.pageFor(bad), null);
});

test("addresses must be web addresses, and show by host", () => {
  assert.ok(office.valid("https://office.example.com/?key=abc"));
  assert.ok(!office.valid("office.example.com"));
  assert.ok(!office.valid(null));
  assert.equal(office.hostOf("https://office.example.com/?key=abc"), "office.example.com");
});

test("the address is yours first, then where Claude Code's office hook sends events", async () => {
  reset({ [HOOK]: JSON.stringify({ env: { OFFICE_URL: "https://hook.example.com/events", OFFICE_TOKEN: "secret" } }) });
  assert.deepEqual(await office.findAddress(), { url: "https://hook.example.com/", from: "hook" });
  world.shared.agentOffice = { url: "https://mine.example.com/?key=k" };
  assert.deepEqual(await office.findAddress(), { url: "https://mine.example.com/?key=k", from: "you" });
  assert.deepEqual(await office.findAddress("not an address"), { url: "https://hook.example.com/", from: "hook" });
});

test("no office is found without a hook or an address, and a broken settings file is skipped", async () => {
  reset();
  assert.equal(await office.findAddress(), null);
  reset({ [HOOK]: "{not json" });
  assert.equal(await office.findAddress(), null);
  reset({ [HOOK]: JSON.stringify({ env: { OFFICE_PRIVATE_URL: "http://localhost:4748/events" } }) });
  assert.equal(await office.findAddress(), null);
});

test("a request names the page, its size in whole pixels and how often to draw it", () => {
  const sent = JSON.parse(office.want({ url: "https://o/", width: 1540.4, height: 879.6, shot: 193.6, every: office.SLOW, at: 5 }));
  assert.deepEqual(sent, { at: 5, url: "https://o/", width: 1540, height: 880, shot: 194, every: 2500, signin: 0, reload: 0 });
});

test("the viewer counts as running while its status is fresh", () => {
  assert.ok(office.alive({ at: 1000 }, 5000));
  assert.ok(!office.alive({ at: 1000 }, 12000));
  assert.ok(!office.alive(null, 0));
});

test("launching passes the folder, the Swift source and the request to the shell", async () => {
  reset();
  assert.equal(await office.launch("mini", "{}"), null);
  const [call] = world.calls;
  assert.equal(call.command, "sh");
  assert.deepEqual(call.args.slice(2), ["sh", STATE, "/home/me/.config/herdr-app/mods/agent-office/view.swift", "mini", "{}"]);
  assert.match(call.args[1], /swiftc -O/);
  assert.match(call.args[1], /nohup/);
});

test("a failed build says what Swift reported", async () => {
  reset({ [`${STATE}/build.log`]: "view.swift:3:1: error: cannot find 'x' in scope\n" });
  world.result = { code: 3, stdout: "", stderr: "" };
  assert.match(await office.launch("modal", "{}"), /did not build.*error: cannot find 'x'/);
  world.result = { code: 1, stdout: "", stderr: "mkdir: denied" };
  assert.equal(await office.launch("modal", "{}"), "mkdir: denied");
});

test("each copy rewrites its own request file over what is there", async () => {
  reset();
  await office.post("modal", "one");
  await office.post("modal", "two");
  assert.equal(world.files[`${STATE}/want-modal.json`], "two");
  assert.deepEqual(world.writes, [`${STATE}/want-modal.json`, `${STATE}/want-modal.json`]);
  assert.equal(office.frameFile("1.png"), "agent-office/frames/1.png");
});
