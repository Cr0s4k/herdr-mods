import assert from "node:assert/strict";
import test from "node:test";
import { Motions, target, viewTop, changeStarts, lineStarts, lineAt } from "../mods/files-modal/vim.js";

const key = (k, extra = {}) => ({ key: k.toLowerCase(), key_char: k.length === 1 ? k : undefined, modifiers: {}, ...extra });
const ctrl = (k) => ({ key: k, modifiers: { control: true } });
const typing = (vim, keys) => keys.map((k) => vim.read(typeof k === "string" ? key(k) : k));

test("a count before j or k repeats it, and digits alone only wait", () => {
  const vim = new Motions();
  assert.deepEqual(typing(vim, ["1", "0", "j"]), [true, true, { motion: "down", count: 10 }]);
  assert.equal(vim.typed, "");
  assert.deepEqual(vim.read(key("k")), { motion: "up", count: 0 });
});

test("gg, G, ]c and [c take two keys or a shifted one, and keep the count", () => {
  const vim = new Motions();
  assert.deepEqual(typing(vim, ["g", "g"]), [true, { motion: "first", count: 0 }]);
  assert.deepEqual(typing(vim, ["4", "2", "G"]), [true, true, { motion: "last", count: 42 }]);
  assert.deepEqual(typing(vim, ["2", "]", "c"]), [true, true, { motion: "nextChange", count: 2 }]);
  assert.deepEqual(typing(vim, ["[", "c"]), [true, { motion: "prevChange", count: 0 }]);
});

test("ctrl-d, ctrl-u, ctrl-f, ctrl-b and the page keys scroll", () => {
  const vim = new Motions();
  assert.deepEqual(vim.read(ctrl("d")), { motion: "halfDown", count: 0 });
  assert.deepEqual(vim.read(ctrl("u")), { motion: "halfUp", count: 0 });
  assert.deepEqual(vim.read(ctrl("f")), { motion: "pageDown", count: 0 });
  assert.deepEqual(vim.read(ctrl("b")), { motion: "pageUp", count: 0 });
  assert.deepEqual(vim.read({ key: "pagedown", modifiers: {} }), { motion: "pageDown", count: 0 });
});

test("other keys pass through and drop what was typed; Escape only cancels a pending count", () => {
  const vim = new Motions();
  assert.equal(vim.read(key("0")), null);
  assert.equal(vim.read(key("s")), null);
  assert.equal(vim.read({ key: "down", modifiers: {} }), null);
  assert.deepEqual(typing(vim, ["5", "s"]), [true, null]);
  assert.equal(vim.typed, "");
  assert.deepEqual(typing(vim, ["g", "x", "j"]), [true, null, { motion: "down", count: 0 }]);
  assert.deepEqual(typing(vim, ["3", { key: "escape", modifiers: {} }]), [true, true]);
  assert.equal(vim.read({ key: "escape", modifiers: {} }), null);
  assert.equal(vim.read({ key: "j", key_char: "j", modifiers: { platform: true } }), null);
});

test("a symbol typed with Option, as on non-US keyboards, still counts", () => {
  const vim = new Motions();
  assert.deepEqual(typing(vim, [key("]", { key: "+", modifiers: { alt: true } }), "c"]), [true, { motion: "nextChange", count: 0 }]);
});

test("targets stay inside the file", () => {
  assert.equal(target("down", 10, 5, 100, 30), 15);
  assert.equal(target("down", 0, 99, 100, 30), 99);
  assert.equal(target("up", 3, 1, 100, 30), 0);
  assert.equal(target("halfDown", 0, 0, 100, 30), 15);
  assert.equal(target("halfDown", 4, 0, 100, 30), 4);
  assert.equal(target("pageDown", 2, 0, 100, 30), 56);
  assert.equal(target("first", 0, 50, 100, 30), 0);
  assert.equal(target("first", 7, 50, 100, 30), 6);
  assert.equal(target("last", 0, 0, 100, 30), 99);
  assert.equal(target("last", 500, 0, 100, 30), 99);
  assert.equal(target("down", 1, 0, 0, 30), 0);
});

test("]c and [c jump between runs of changed rows", () => {
  const starts = changeStarts([false, true, true, false, true, false, false, true]);
  assert.deepEqual(starts, [1, 4, 7]);
  assert.equal(target("nextChange", 0, 0, 8, 30, starts), 1);
  assert.equal(target("nextChange", 0, 1, 8, 30, starts), 4);
  assert.equal(target("nextChange", 5, 0, 8, 30, starts), 7);
  assert.equal(target("nextChange", 0, 7, 8, 30, starts), 7);
  assert.equal(target("prevChange", 0, 5, 8, 30, starts), 4);
  assert.equal(target("prevChange", 2, 7, 8, 30, starts), 1);
  assert.equal(target("prevChange", 0, 1, 8, 30, starts), 1);
});

test("the view follows the cursor like Vim", () => {
  assert.equal(viewTop("down", 10, 11, 0, 30, 200), 0, "moves on screen don't scroll");
  assert.equal(viewTop("down", 26, 27, 0, 30, 200), 1, "three rows stay below the cursor");
  assert.equal(viewTop("down", 29, 30, 0, 30, 200, 0), 1, "without them the cursor sits at the edge");
  assert.equal(viewTop("up", 4, 3, 1, 30, 200), 0);
  assert.equal(viewTop("halfDown", 0, 15, 0, 30, 200), 15, "ctrl-d scrolls as far as the cursor moves");
  assert.equal(viewTop("halfUp", 20, 5, 15, 30, 200), 0);
  assert.equal(viewTop("halfDown", 180, 195, 170, 30, 200), 170, "the view stops at the end");
  assert.equal(viewTop("last", 0, 199, 0, 30, 200), 170, "a long jump centres, as far as the end allows");
  assert.equal(viewTop("down", 10, 110, 0, 30, 200), 95);
  assert.equal(viewTop("down", 0, 3, 0, 30, 10), 0, "a short file never scrolls");
});

test("lines are found by their offset", () => {
  const starts = lineStarts("ab\n\ncd\n");
  assert.deepEqual(starts, [0, 3, 4, 7]);
  assert.equal(lineAt(starts, 0), 0);
  assert.equal(lineAt(starts, 2), 0);
  assert.equal(lineAt(starts, 3), 1);
  assert.equal(lineAt(starts, 5), 2);
  assert.equal(lineAt(starts, 7), 3);
});
