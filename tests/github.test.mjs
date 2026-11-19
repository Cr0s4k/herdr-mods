import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const world = {};
globalThis.__githubNative = {
  exec: async (command, args, options) => {
    world.calls.push({ command, args, options });
    if (command === "git") {
      const result = spawnSync(command, args, { cwd: options.cwd, encoding: "utf8" });
      return { code: result.status, stdout: result.stdout, stderr: result.stderr };
    }
    if (world.browserError) throw new Error("Firefox missing");
    if (world.noFirefox && [command, ...args].some(part => /^firefox$/i.test(part))) return { code: 1, stdout: "", stderr: "" };
    return { code: world.browserCode ?? 0, stdout: "", stderr: "" };
  },
  notify: value => world.notices.push(value),
};
let source = (await readFile(new URL("../mods/tabs-show/github.js", import.meta.url), "utf8")).replace(/^import .*;\n/gm, "");
source = "const { exec, notify } = globalThis.__githubNative;\n" + source;
const { githubUrl, repositoryContext, openRepository, GitHubRepo } = await import("data:text/javascript," + encodeURIComponent(source));

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

async function repository(t) {
  Object.assign(world, { calls: [], notices: [], browserError: false, browserCode: 0 });
  const folder = await mkdtemp(join(tmpdir(), "herdr github "));
  t.after(() => rm(folder, { recursive: true, force: true }));
  git(folder, "init", "-q");
  return folder;
}

test("GitHub clone URLs become credential-free repository links", () => {
  for (const remote of ["https://github.com/Owner/repo.git", "git@github.com:Owner/repo.git",
    "ssh://git@github.com/Owner/repo.git", "ssh://git@github.com:22/Owner/repo.git",
    "https://secret@github.com/Owner/repo/", "git://github.com/Owner/repo"]) {
    assert.equal(githubUrl(remote), "https://github.com/Owner/repo");
  }
  for (const remote of ["/local/repo", "git@gitlab.com:Owner/repo.git", "https://github.com.evil/Owner/repo",
    "https://github.com/Owner/repo/issues", "https://github.com/Owner/..", "file:///repo"]) {
    assert.equal(githubUrl(remote), null);
  }
});

test("the focused folder and machine stay within the selected space and tab", () => {
  const spaces = [{ id: "space", active: true, machine: "server", folder: "/project", tabs: [{ id: "tab", active: true }] }];
  const panes = [{ tab: "other", cwd: "/wrong" }, { tab: "tab", cwd: "/project/one" }, { tab: "tab", cwd: "/project/two", focused: true }];
  assert.deepEqual(repositoryContext(spaces, panes, { space: "space", tab: "tab", cwd: "/project/peek" }), { cwd: "/project/peek", on: "server" });
  assert.deepEqual(repositoryContext(spaces, panes, { space: "other", tab: "other", cwd: "/wrong" }), { cwd: "/project/two", on: "server" });
  assert.deepEqual(repositoryContext(spaces, [], null), { cwd: "/project", on: "server" });
  assert.equal(repositoryContext([], panes, null).cwd, null);
});

test("a subfolder uses origin and requests a new Firefox tab locally", async t => {
  const cwd = await repository(t), child = join(cwd, "nested folder");
  await mkdir(child);
  git(cwd, "remote", "add", "aaa", "https://github.com/another/repo.git");
  git(cwd, "remote", "add", "origin", "git@github.com:Owner/repo.git");
  await openRepository({ cwd: child, on: "server" }, "macos");
  assert.deepEqual(world.calls[0].options, { cwd: child, on: "server" });
  assert.deepEqual(world.calls[1], { command: "open", args: ["-na", "Firefox", "--args", "--new-tab", "https://github.com/Owner/repo"], options: undefined });
});

test("a commit opens at its own page under the repository", async t => {
  const cwd = await repository(t);
  git(cwd, "remote", "add", "origin", "https://github.com/Owner/repo.git");
  await openRepository({ cwd, on: null }, "macos", "/commit/abc123");
  assert.deepEqual(world.calls[1].args, ["-na", "Firefox", "--args", "--new-tab", "https://github.com/Owner/repo/commit/abc123"]);
});

test("a worktree resolves rewritten SSH URLs and falls back to a GitHub upstream", async t => {
  const cwd = await repository(t), worktree = join(cwd, "linked checkout");
  git(cwd, "-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "commit", "-qm", "initial", "--allow-empty");
  git(cwd, "remote", "add", "origin", "https://gitlab.com/Owner/repo.git");
  git(cwd, "config", "url.git@github.com:.insteadOf", "gh:");
  git(cwd, "remote", "add", "upstream", "gh:Owner/upstream.git");
  git(cwd, "worktree", "add", "-q", "--detach", worktree);
  await openRepository({ cwd: worktree, on: null }, "linux");
  assert.deepEqual(world.calls[1].args, ["--new-tab", "https://github.com/Owner/upstream"]);
});

test("missing repositories and GitHub remotes never launch a browser", async t => {
  const cwd = await repository(t);
  await assert.rejects(openRepository({ cwd: null }, "macos"), /Select a project/);
  await assert.rejects(openRepository({ cwd }, "macos"), /no GitHub remote/);
  git(cwd, "remote", "add", "origin", "https://gitlab.com/Owner/repo.git");
  await assert.rejects(openRepository({ cwd }, "macos"), /no GitHub remote/);
  await assert.rejects(openRepository({ cwd: tmpdir() }, "macos"), /not a Git repository/);
  assert.ok(world.calls.every(call => call.command === "git"));
});

test("browser launch failures provide a useful recovery message", async t => {
  const cwd = await repository(t);
  git(cwd, "remote", "add", "origin", "https://github.com/Owner/repo");
  world.browserError = true;
  await assert.rejects(openRepository({ cwd }, "macos"), /Could not open a browser\. Open https:\/\/github\.com\/Owner\/repo yourself/);
  world.browserError = false; world.browserCode = 1;
  await assert.rejects(openRepository({ cwd }, "macos"), /Could not open a browser/);
});

test("without Firefox the repository opens in the default browser", async t => {
  const cwd = await repository(t);
  git(cwd, "remote", "add", "origin", "https://github.com/Owner/repo");
  world.noFirefox = true;
  t.after(() => { world.noFirefox = false; });
  await openRepository({ cwd }, "macos");
  assert.deepEqual(world.calls.at(-1), { command: "open", args: ["https://github.com/Owner/repo"], options: undefined });
  world.calls = [];
  await openRepository({ cwd }, "linux");
  assert.deepEqual(world.calls.slice(1).map(call => call.command), ["firefox", "xdg-open"]);
});

test("repeated clicks while opening launch once and failure restores the button", async t => {
  const cwd = await repository(t);
  git(cwd, "remote", "add", "origin", "https://github.com/Owner/repo");
  world.browserError = true;
  const action = new GitHubRepo(), tasks = [];
  const cx = { notify() {}, spawn(callback) { tasks.push(callback(this)); } };
  action.open(cx, { cwd }, "macos");
  action.open(cx, { cwd }, "macos");
  assert.equal(tasks.length, 1);
  await Promise.all(tasks);
  assert.equal(action.opening, false);
  assert.equal(world.notices[0].title, "Cannot open GitHub");
});
