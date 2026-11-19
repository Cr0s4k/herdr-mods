import assert from "node:assert/strict";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const world = { shared: {}, overlays: [] };
globalThis.__historyNative = {
  exec: async (command, args, options = {}) => {
    const r = spawnSync(command, args, { cwd: options.cwd, encoding: "utf8" });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr };
  },
  shared: key => world.shared[key],
  setShared: (key, value) => { world.shared[key] = value; },
  openOverlay: spec => world.overlays.push(spec),
  InputState: { new: () => ({ on() {}, value: () => "" }) },
};
let source = (await readFile(new URL("../mods/changes-modal/history.js", import.meta.url), "utf8")).replace(/^import [^;]*;\n/gm, "");
source = "const { exec, shared, setShared, openOverlay, InputState } = globalThis.__historyNative;\n"
  + "const githubUrl = url => /github\\.com/.test(url) ? url : null;\n" + source;
const { parseRefs, parseLog, graph, matches, commitFiles, ago, History } = await import("data:text/javascript," + encodeURIComponent(source));

const commit = (hash, parents = [], extra = {}) => ({ hash, parents, author: "Ada", time: 0, refs: [], subject: hash, ...extra });

test("refs read as the checked-out branch, other branches, remotes and tags", () => {
  assert.deepEqual(parseRefs("HEAD -> refs/heads/main, refs/remotes/origin/main, refs/remotes/origin/HEAD, tag: refs/tags/v1, refs/heads/feature/x"), [
    { kind: "head", name: "main" }, { kind: "remote", name: "origin/main" }, { kind: "tag", name: "v1" }, { kind: "branch", name: "feature/x" }]);
  assert.deepEqual(parseRefs("HEAD, refs/stash"), [{ kind: "head", name: "HEAD" }]);
  assert.deepEqual(parseRefs(""), []);
});

test("log lines keep parents, author, time and the whole subject", () => {
  const [a, b] = parseLog("aaa\x1fbbb ccc\x1fAda Lovelace\x1f1700000000\x1fHEAD -> refs/heads/main\x1fMerge a\x1fb\nbbb\x1f\x1fAda\x1f1600000000\x1f\x1fFirst\n");
  assert.deepEqual(a.parents, ["bbb", "ccc"]);
  assert.equal(a.author, "Ada Lovelace");
  assert.equal(a.time, 1700000000);
  assert.equal(a.subject, "Merge a\x1fb");
  assert.deepEqual(a.refs, [{ kind: "head", name: "main" }]);
  assert.deepEqual(b.parents, []);
});

test("a straight history stays on one lane", () => {
  const { rows, width } = graph([commit("c", ["b"]), commit("b", ["a"]), commit("a")]);
  assert.equal(width, 1);
  assert.deepEqual(rows.map(r => r.col), [0, 0, 0]);
  assert.deepEqual(rows[0].lines, [[0, 0.5, 0, 1, 0]]);
  assert.deepEqual(rows[1].lines, [[0, 0, 0, 0.5, 0], [0, 0.5, 0, 1, 0]]);
  assert.deepEqual(rows[2].lines, [[0, 0, 0, 0.5, 0]]);
});

test("a merged branch gets its own lane and joins back at the fork", () => {
  const { rows, width } = graph([commit("m", ["b", "d"]), commit("d", ["a"]), commit("b", ["a"]), commit("a")]);
  assert.equal(width, 2);
  assert.deepEqual(rows.map(r => r.col), [0, 1, 0, 0]);
  assert.deepEqual(rows[0].lines, [[0, 0.5, 0, 1, 0], [0, 0.5, 1, 1, 1]]);
  assert.deepEqual(rows[1].lines, [[0, 0, 0, 1, 0], [1, 0, 1, 0.5, 1], [1, 0.5, 1, 1, 1]]);
  assert.deepEqual(rows[3].lines, [[0, 0, 0, 0.5, 0], [1, 0, 0, 0.5, 1]]);
  assert.notEqual(rows[1].color, rows[0].color);
});

test("two branch tips that were never merged sit side by side", () => {
  const { rows } = graph([commit("x", ["a"]), commit("y", ["a"]), commit("a")]);
  assert.deepEqual(rows.map(r => r.col), [0, 1, 0]);
  assert.deepEqual(rows[1].lines[0], [0, 0, 0, 1, 0]);
});

test("search matches every word in message, author, hash or branch", () => {
  const c = commit("4f2a9c1e", [], { subject: "Fix the sidebar focus", author: "Ada Lovelace", refs: [{ kind: "branch", name: "feature/tabs" }] });
  assert.ok(matches(c, "sidebar ada"));
  assert.ok(matches(c, "4F2A9"));
  assert.ok(matches(c, "feature/tabs"));
  assert.ok(!matches(c, "sidebar grace"));
});

test("a commit's files carry status and line counts", () => {
  const files = commitFiles("M\0src/a.js\0A\0new file.txt\0D\0gone.png\0T\0link\0", "3\t1\tsrc/a.js\0" + "2\t0\tnew file.txt\0" + "-\t-\tgone.png\0");
  assert.deepEqual(files.map(f => [f.path, f.status, f.add, f.del]), [["src/a.js", "M", 3, 1], ["new file.txt", "A", 2, 0], ["gone.png", "D", 0, 0], ["link", "M", 0, 0]]);
  assert.equal(files[2].binary, true);
  assert.ok(files.every(f => f.fresh === false));
});

test("times read as how long ago", () => {
  assert.equal(ago(1000, 1030), "now");
  assert.equal(ago(0, 125), "2m");
  assert.equal(ago(0, 3 * 3600), "3h");
  assert.equal(ago(0, 9 * 86400), "1w");
  assert.equal(ago(0, 400 * 86400), "1y");
});

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

async function repository(t) {
  const root = await mkdtemp(join(tmpdir(), "herdr history "));
  t.after(() => rm(root, { recursive: true, force: true }));
  git(root, "init", "-q", "-b", "main");
  for (const [key, value] of [["user.name", "Ada"], ["user.email", "ada@example.com"], ["commit.gpgsign", "false"]]) git(root, "config", key, value);
  const save = async (name, text, message, date) => {
    await writeFile(join(root, name), text);
    git(root, "add", "-A");
    const r = spawnSync("git", ["commit", "-q", "-m", message], { cwd: root, env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
    assert.equal(r.status, 0, String(r.stderr));
  };
  return { root, save };
}

const cx = { tasks: [], spawn(fn) { const p = fn(cx); this.tasks.push(p); return p; }, notify() {}, async settle() { while (this.tasks.length) await this.tasks.shift(); } };

test("History reads every branch with refs, lanes and unpushed commits, and opens a commit's diff", async (t) => {
  const { root, save } = await repository(t);
  await save("a.txt", "one\n", "First", "2024-01-01T10:00:00");
  git(root, "checkout", "-q", "-b", "feature");
  await save("b.txt", "two\n", "Feature work", "2024-01-02T10:00:00");
  git(root, "checkout", "-q", "main");
  await save("a.txt", "one\nmore\n", "Main work", "2024-01-03T10:00:00");
  git(root, "tag", "v1");

  const view = { root, on: null, files: [], refresh() {} };
  const history = new History(view);
  history.load(cx);
  await cx.settle();
  assert.equal(history.error, null);
  assert.deepEqual(history.commits.map(c => c.subject), ["Main work", "Feature work", "First"]);
  assert.deepEqual(history.commits[0].refs, [{ kind: "head", name: "main" }, { kind: "tag", name: "v1" }]);
  assert.equal(history.graph.width, 2);
  assert.equal(history.unpushed.size, 0, "a repository without remotes marks nothing as unpushed");
  assert.equal(history.github, false);

  world.shared["changes-modal.history.all"] = false;
  history.stamp = null;
  history.load(cx);
  await cx.settle();
  assert.deepEqual(history.commits.map(c => c.subject), ["Main work", "First"]);

  history.open(history.commits[0], cx);
  await cx.settle();
  const dialog = world.overlays.at(-1);
  assert.equal(dialog.mod, "changes-modal");
  assert.equal(dialog.props.head, history.commits[0].hash);
  assert.equal(dialog.props.base, history.commits[1].hash);
  assert.deepEqual(dialog.props.files.map(f => [f.path, f.status, f.add]), [["a.txt", "M", 1]]);

  history.open(history.commits[1], cx);
  await cx.settle();
  assert.deepEqual(world.overlays.at(-1).props.files.map(f => [f.path, f.status]), [["a.txt", "A"]], "the first commit diffs against the empty tree");
  world.shared = {};
});

test("revert asks only for commits on the current branch, then commits the undo", async (t) => {
  const { root, save } = await repository(t);
  await save("a.txt", "one\n", "First", "2024-01-01T10:00:00");
  await save("a.txt", "one\ntwo\n", "Second", "2024-01-02T10:00:00");
  git(root, "checkout", "-q", "-b", "side", "HEAD~1");
  await save("c.txt", "side\n", "Side", "2024-01-03T10:00:00");
  git(root, "checkout", "-q", "main");

  const view = { root, on: null, files: [], refreshed: 0, refresh() { this.refreshed++; } };
  const history = new History(view);
  history.load(cx);
  await cx.settle();
  const side = history.commits.find(c => c.subject === "Side"), second = history.commits.find(c => c.subject === "Second");

  history.ask(side, cx);
  await cx.settle();
  assert.equal(history.confirm, null);
  assert.match(view.note, /not on the current branch/);

  history.ask(second, cx);
  await cx.settle();
  assert.equal(history.confirm, second.hash);
  history.revert(second, cx);
  await cx.settle();
  assert.equal(history.confirm, null);
  assert.equal(view.refreshed, 1);
  assert.match(git(root, "log", "-1", "--format=%s"), /^Revert "Second"/);
  assert.equal(git(root, "show", "HEAD:a.txt"), "one");
});

test("commits on this branch that no remote has yet are marked unpushed", async (t) => {
  const { root, save } = await repository(t);
  await save("a.txt", "one\n", "Pushed", "2024-01-01T10:00:00");
  git(root, "remote", "add", "origin", "https://github.com/Owner/repo.git");
  git(root, "update-ref", "refs/remotes/origin/main", "main");
  await save("a.txt", "one\ntwo\n", "Local only", "2024-01-02T10:00:00");

  const history = new History({ root, on: null, files: [], refresh() {} });
  history.load(cx);
  await cx.settle();
  assert.deepEqual(history.commits.map(c => [c.subject, history.unpushed.has(c.hash)]), [["Local only", true], ["Pushed", false]]);
  assert.equal(history.github, true);
  assert.deepEqual(history.commits[1].refs, [{ kind: "remote", name: "origin/main" }]);
});

test("a click selects a commit, a second click clears it, and a double-click opens its diff", async (t) => {
  const { root, save } = await repository(t);
  await save("a.txt", "one\n", "First", "2024-01-01T10:00:00");
  const history = new History({ root, on: null, files: [], refresh() {} });
  history.load(cx);
  history.load(cx);
  await cx.settle();
  const [first] = history.commits, opened = world.overlays.length;
  history.click(first.hash, cx);
  assert.equal(history.selected, first.hash);
  history.clicked.at -= 1000;
  history.click(first.hash, cx);
  assert.equal(history.selected, null);
  history.click(first.hash, cx);
  await cx.settle();
  assert.equal(history.selected, first.hash);
  assert.equal(world.overlays.length, opened + 1);
});

test("a load asked for while one runs runs again afterwards", async (t) => {
  const { root, save } = await repository(t);
  await save("a.txt", "one\n", "First", "2024-01-01T10:00:00");
  const history = new History({ root, on: null, files: [], refresh() {} });
  history.load(cx);
  world.shared["changes-modal.history.all"] = false;
  history.load(cx);
  await cx.settle();
  assert.match(history.stamp, /\nfalse\n/);
  world.shared = {};
});
