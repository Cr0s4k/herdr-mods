import assert from "node:assert/strict";
import { lstat, readFile, readlink } from "node:fs/promises";
import test from "node:test";
import { terms, runs, spaceFor } from "../mods/find-chat/model.js";

test("searched words are marked wherever they appear, whatever their case, the longer one first", () => {
  assert.deepEqual(runs("Usage limits and usage", terms("usage LIMIT")), [
    { text: "Usage", hit: true }, { text: " ", hit: false }, { text: "limit", hit: true }, { text: "s and ", hit: false }, { text: "usage", hit: true }]);
  assert.deepEqual(runs("rebased", ["re", "rebase"]), [{ text: "rebase", hit: true }, { text: "d", hit: false }]);
  assert.deepEqual(runs("plain", []), [{ text: "plain", hit: false }]);
  assert.deepEqual(runs("", ["x"]), []);
});

test("a conversation resumes in the space on its folder, else the one on screen, on the same machine", () => {
  const spaces = [
    { id: "a", folder: "/work/shop", machine: null, active: false }, { id: "b", folder: "/work/site", machine: null, active: true },
    { id: "c", folder: "/work/shop", machine: "mini", active: false },
  ];
  assert.equal(spaceFor(spaces, { cwd: "/work/shop" }, null), "a");
  assert.equal(spaceFor(spaces, { cwd: "/work/shop/wt" }, null), "b");
  assert.equal(spaceFor(spaces, { cwd: "/work/shop" }, "mini"), "c");
  assert.equal(spaceFor(spaces, { cwd: "/else" }, "mini"), "b");
  assert.equal(spaceFor([], { cwd: "/else" }, null), null);
});

test("the popup runs the Recent reader through links, has a shortcut and a key-sorted mod.json", async () => {
  for (const file of ["recent.py", "recent.js"]) {
    const path = new URL(`../mods/find-chat/${file}`, import.meta.url);
    assert.ok((await lstat(path)).isSymbolicLink(), file);
    assert.equal(await readlink(path), `../spaces-pin/${file}`);
  }
  const keys = JSON.parse(await readFile(new URL("../keys.json", import.meta.url), "utf8"));
  assert.equal(keys.global["cmd-shift-f"], "mod.open:find-chat");
  const text = await readFile(new URL("../mods/find-chat/mod.json", import.meta.url), "utf8"), mod = JSON.parse(text);
  assert.equal(mod.overlay.kind, "popup");
  const sorted = value => value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
  assert.equal(text, JSON.stringify(sorted(mod), null, 2) + "\n");
});
