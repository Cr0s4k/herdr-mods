import assert from "node:assert/strict";
import { lstat, readlink } from "node:fs/promises";
import test from "node:test";
import { repoKey, scopeOf, anchorOf, notesOf, counts, saveNote, dropNotes, place, withNotes, rangeOf, linesOf, noteList, countLabel, targets } from "../mods/changes-modal/notes.js";

const rows = [
  { kind: "@", text: "@@ -1,3 +1,3 @@" },
  { kind: " ", number: 1, text: "one" },
  { kind: "-", number: 2, text: "old two" },
  { kind: "+", number: 2, text: "new two" },
  { kind: " ", number: 3, text: "three" },
];
const split = [
  rows[0],
  { left: { kind: " ", number: 1, text: "one" }, right: rows[1] },
  { left: rows[2], right: rows[3] },
  { left: { kind: " ", number: 3, text: "three" }, right: rows[4] },
];
const note = (extra = {}) => ({ scope: "", path: "a.js", side: "new", line: 2, code: "new two", text: "Rename it", ...extra });

test("a row is anchored to the new file, and a removed line to the old one", () => {
  assert.equal(anchorOf(rows[0]), null);
  assert.deepEqual(anchorOf(rows[1]), { side: "new", line: 1, code: "one" });
  assert.deepEqual(anchorOf(rows[2]), { side: "old", line: 2, code: "old two" });
  assert.deepEqual(anchorOf(split[2]), { side: "new", line: 2, code: "new two" });
  assert.deepEqual(anchorOf({ left: rows[2], right: null }), { side: "old", line: 2, code: "old two" });
  assert.equal(anchorOf(undefined), null);
});

test("working changes, a Pipeline task's base and a commit keep separate notes", () => {
  assert.equal(scopeOf(null, null), "");
  assert.equal(scopeOf("abc", null), "abc");
  assert.equal(scopeOf("abc", "def"), "abc..def");
  let store = saveNote({}, "/repo", null, note(), 1000);
  store = saveNote(store, "/repo", null, note({ scope: "abc..def", text: "In the commit" }), 1000);
  assert.equal(notesOf(store, "/repo", null).length, 2);
  assert.deepEqual(notesOf(store, "/repo", null, "", "a.js").map(n => n.text), ["Rename it"]);
  assert.deepEqual(counts(store, "/repo", null, "abc..def"), { "a.js": 1 });
  assert.deepEqual(notesOf(store, "/repo", "mac-mini"), []);
});

test("saving on a line that has a note replaces it, and saving nothing removes it", () => {
  let store = saveNote({}, "/repo", null, note(), 1000);
  store = saveNote(store, "/repo", null, note({ text: "  Better name  " }), 2000);
  assert.deepEqual(notesOf(store, "/repo", null).map(n => [n.text, n.at]), [["Better name", 2000]]);
  store = saveNote(store, "/repo", null, note({ text: " " }), 3000);
  assert.deepEqual(store, {});
});

test("notes nobody sent for a month go, in every repository", () => {
  const day = 86400000;
  let store = saveNote({}, "/old", null, note(), 0);
  store = saveNote(store, "/repo", null, note(), 31 * day);
  assert.deepEqual(Object.keys(store), [repoKey("/repo", null)]);
});

test("sent notes are dropped and the ones written meanwhile stay", () => {
  let store = saveNote({}, "/repo", null, note(), 1000);
  const sent = notesOf(store, "/repo", null);
  store = saveNote(store, "/repo", null, note({ line: 3, code: "three", text: "Later" }), 2000);
  assert.deepEqual(notesOf(dropNotes(store, "/repo", null, sent), "/repo", null).map(n => n.text), ["Later"]);
  assert.deepEqual(dropNotes(store, "/repo", null), {});
});

test("a note follows its line when the diff shifts, stays on an edited line, and is lost when the line leaves the diff", () => {
  assert.deepEqual(place([note()], rows), [3]);
  const shifted = rows.map(r => r.number === undefined ? r : { ...r, number: r.number + 10 });
  assert.deepEqual(place([note()], shifted), [3]);
  const edited = rows.map(r => r.kind === "+" ? { ...r, text: "newer two" } : r);
  assert.deepEqual(place([note()], edited), [3]);
  assert.deepEqual(place([note({ line: 99, code: "nowhere" })], rows), [-1]);
  assert.deepEqual(place([note({ side: "old", code: "old two" }), note()], split), [2, 2]);
  assert.deepEqual(place([note({ side: "old", line: 1, code: "one" })], split), [-1]);
});

test("notes are drawn under their line, lost ones first, and no notes means the same rows", () => {
  assert.equal(withNotes(rows, []), rows);
  const drawn = withNotes(rows, [note(), note({ line: 99, code: "nowhere", text: "Gone" })]);
  assert.deepEqual(drawn.map(r => r.kind === "note" ? `note:${r.note.text}${r.lost ? ":lost" : ""}` : r.kind), ["note:Gone:lost", "@", " ", "-", "+", "note:Rename it", " "]);
});

test("picked lines make one note on the side of the cursor's row, drawn under the last of them", () => {
  const more = [...rows.slice(0, 4), { kind: "+", number: 3, text: "  new three" }, { kind: " ", number: 4, text: "four" }, { kind: "@", text: "@@ -9 +10 @@" }, { kind: " ", number: 10, text: "ten" }];
  assert.deepEqual(rangeOf(more.slice(3, 6), more[5]), { side: "new", line: 2, code: "new two", to: 4, quote: ["new two", "  new three", "four"] });
  assert.deepEqual(rangeOf(more.slice(2, 4), more[2]), { side: "old", line: 2, code: "old two" });
  assert.deepEqual(rangeOf([split[1], split[2]], split[2]), { side: "new", line: 1, code: "one", to: 2, quote: ["one", "new two"] });
  assert.equal(rangeOf([more[0]], more[0]), null);
  const ranged = note({ to: 4, quote: ["new two", "  new three", "four"] });
  assert.deepEqual(withNotes(more, [ranged]).map(r => r.kind), ["@", " ", "-", "+", "+", " ", "note", "@", " "]);
  assert.deepEqual(withNotes(more, [note({ to: 99 })]).map(r => r.kind), ["@", " ", "-", "+", "+", " ", "note", "@", " "]);
  assert.equal(linesOf(ranged), "2-4");
  assert.equal(linesOf(note()), "2");
});

test("a note of several lines takes a row each, and a long one is folded", () => {
  const drawn = withNotes(rows, [note({ text: "First\nSecond" })]).filter(r => r.kind === "note");
  assert.deepEqual(drawn.map(r => [r.part, r.text]), [[0, "First"], [1, "Second"]]);
  const long = withNotes(rows, [note({ text: Array.from({ length: 12 }, (_, i) => `l${i}`).join("\n") })]).filter(r => r.kind === "note");
  assert.equal(long.length, 8);
  assert.equal(long[7].text, "… 5 more lines");
  assert.equal(saveNote({}, "/repo", null, note({ text: "\n a\n\nb \n" }), 1)[repoKey("/repo", null)][0].text, "a\n\nb");
});

test("the message quotes every picked line and keeps a note's own lines", () => {
  assert.equal(noteList([note({ to: 4, quote: ["new two", "  new three", "four"], text: "Split this.\n\nKeep the name." }), note({ side: "old", line: 5, to: 30, code: "a", quote: ["a", "", "b"], text: "Why?" })]), [
    "1. a.js:2-4\n   > new two\n   >   new three\n   > four\n   Split this.\n\n   Keep the name.",
    "2. a.js:5-30 (removed lines, numbered as before the change)\n   > a\n   >\n   > b\n   > …\n   Why?",
  ].join("\n\n"));
});

test("the message lists notes by file and line, quotes the line and says when it was removed or in a commit", () => {
  const text = noteList([
    note({ path: "b.js", line: 1, code: "  x  ", text: "Second" }),
    note({ side: "old", line: 7, code: "gone()", text: "Why?" }),
    note({ scope: "abc..0123456789abcdef", line: 3, code: " ", text: "No quote" }),
  ]);
  assert.equal(text, [
    "1. a.js:3 (in commit 012345678)\n   No quote",
    "2. a.js:7 (a removed line, numbered as before the change)\n   > gone()\n   Why?",
    "3. b.js:1\n   > x\n   Second",
  ].join("\n\n"));
  assert.equal(countLabel(1), "1 note");
  assert.equal(countLabel(3), "3 notes");
});

test("notes go to an agent in that checkout on that machine: the focused one, else the latest to act", () => {
  const agents = [
    { address: "t1", seq: 5 }, { address: "t2", seq: 9 }, { address: "t3", seq: 20 }, { address: "mini/t4", seq: 30 }, { address: "t5", seq: 40 },
  ];
  const panes = [
    { terminal: "t1", cwd: "/repo" }, { terminal: "t2", cwd: "/repo/packages/web" }, { terminal: "t3", cwd: "/repository" },
    { terminal: "mini/t4", cwd: "/repo" }, { terminal: "t5", cwd: null },
  ];
  assert.deepEqual(targets(agents, panes, "/repo", null).map(a => a.address), ["t2", "t1"]);
  assert.deepEqual(targets(agents, panes, "/repo", null, "t1").map(a => a.address), ["t1", "t2"]);
  assert.deepEqual(targets(agents, panes, "/repo", "mini").map(a => a.address), ["mini/t4"]);
  assert.deepEqual(targets(agents, panes, "/elsewhere", null), []);
});

test("the review pane runs the same notes and procedures modules through links", async () => {
  for (const [file, to] of [["review-pane/notes.js", "../changes-modal/notes.js"], ["review-pane/procedures.js", "../pipeline/procedures.js"], ["changes-modal/procedures.js", "../pipeline/procedures.js"]]) {
    const path = new URL(`../mods/${file}`, import.meta.url);
    assert.ok((await lstat(path)).isSymbolicLink(), file);
    assert.equal(await readlink(path), to);
  }
});
