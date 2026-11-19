import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import test from "node:test";
import { prepare, rank, score, terms, highlights } from "../mods/find-file/match.js";

const paths = (entries, query, limit) => rank(prepare(entries), query, () => 0, limit).top.map(m => m.path);

test("a match in the file name beats one in a folder", () => {
  assert.deepEqual(paths(["main/notes.txt", "src/main.js"], "main"), ["src/main.js", "main/notes.txt"]);
});

test("word starts beat letters in the middle of a word", () => {
  assert.deepEqual(paths(["fabric.js", "foo_bar.js"], "fb"), ["foo_bar.js", "fabric.js"]);
  assert.deepEqual(paths(["lib/getaway.js", "lib/getAnswer.js"], "ga"), ["lib/getAnswer.js", "lib/getaway.js"]);
});

test("every space-separated term has to match, anywhere in the path", () => {
  const entries = ["mods/files-modal/main.js", "mods/files-pane/main.js", "mods/files-modal/icons.js"];
  assert.deepEqual(paths(entries, "modal main"), ["mods/files-modal/main.js", "mods/files-modal/icons.js"]);
  assert.deepEqual(paths(entries, "MAIN Pane"), ["mods/files-pane/main.js"]);
  assert.deepEqual(paths(entries, "zz"), []);
  assert.deepEqual(terms("  a   b "), ["a", "b"]);
});

test("an exact file name comes first, then shorter paths on a tie", () => {
  assert.deepEqual(paths(["src/readme-old.md", "README.md", "docs/README.md"], "readme"), ["README.md", "docs/README.md", "src/readme-old.md"]);
});

test("boost lifts recently opened or changed files among equal matches", () => {
  const top = rank(prepare(["a/util.js", "b/util.js"]), "util", p => p === "b/util.js" ? 20 : 0).top.map(m => m.path);
  assert.deepEqual(top, ["b/util.js", "a/util.js"]);
});

test("only the best `limit` are ranked, the same as sorting everything, and the pool keeps every match", () => {
  const entries = [];
  for (let i = 0; i < 400; i++) entries.push(`dir${i % 7}/sub${i % 13}/file${i}.${["js", "md", "ts"][i % 3]}`);
  for (const query of ["f", "d1 s", "file1", "sub3 md"]) {
    const all = rank(prepare(entries), query, () => 0, Infinity);
    const some = rank(prepare(entries), query, () => 0, 10);
    assert.deepEqual(some.top, all.top.slice(0, 10), query);
    assert.equal(some.pool.length, all.top.length, query);
  }
});

test("highlights mark the matched letters, preferring the file name", () => {
  assert.deepEqual([...highlights("main", "src/main.js")].sort((a, b) => a - b), [4, 5, 6, 7]);
  assert.deepEqual([...highlights("s", "src/main.js")], [10]);
  assert.deepEqual([...highlights("src m", "src/main.js")].sort((a, b) => a - b), [0, 1, 2, 4]);
  assert.equal(score(terms("xyz"), prepare(["src/main.js"])[0]), null);
});

const run = promisify(execFile);
const script = new URL("../scripts/keys.sh", import.meta.url).pathname;
const ours = new URL("../keys.json", import.meta.url).pathname;

test("install adds the repo's shortcuts to keys.json and never replaces one already bound", async () => {
  const dir = await mkdtemp(`${tmpdir()}/keys-`);
  try {
    const mine = `${dir}/keys.json`;
    await writeFile(mine, JSON.stringify({ global: { "cmd-p": "mod.open:picker" }, terminal: {} }, null, 2) + "\n");
    const first = await run(script, [ours, mine]);
    assert.match(first.stdout, /added cmd-shift-n/);
    const merged = JSON.parse(await readFile(mine, "utf8"));
    assert.deepEqual(merged.global, { "cmd-p": "mod.open:picker", "cmd-shift-n": "mod.open:find-file" });
    assert.deepEqual(merged.terminal, {});

    const before = await readFile(mine, "utf8");
    assert.equal((await run(script, [ours, mine])).stdout, "");
    assert.equal(await readFile(mine, "utf8"), before);

    merged.global["cmd-shift-n"] = "space.new";
    await writeFile(mine, JSON.stringify(merged, null, 2) + "\n");
    assert.match((await run(script, [ours, mine])).stdout, /kept your cmd-shift-n/);
    assert.equal(JSON.parse(await readFile(mine, "utf8")).global["cmd-shift-n"], "space.new");

    assert.match((await run(script, [ours, `${dir}/missing.json`])).stdout, /not found/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
