#!/usr/bin/env node
// Screenshots Pipeline's inspector for one made-up task per state, so a layout that overflows or hides
// something is seen before a person finds it. Run it from the main checkout after ./install.sh:
//   node scripts/pipeline-shots.mjs [folder]
// It needs Herdr running, and holds its window for about fifteen seconds: it opens a Pipeline tab on a throwaway
// repository in the space on screen, takes one image per task into the folder (a new one under $TMPDIR unless
// given), then removes what it made and returns to where you were.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { STORE, LIVE, createLive, reduce } from "../mods/pipeline/pipeline-model.js";

const app = process.env.HERDR_APP_HOME ?? join(homedir(), ".config/herdr-app");
const out = process.argv[2] ?? mkdtempSync(join(tmpdir(), "pipeline-shots-"));
const repo = mkdtempSync(join(tmpdir(), "pipeline-shots-repo-"));
const stamp = Date.now().toString(36), id = `shots-${stamp}`, key = LIVE + id;
const herdr = (...args) => execFileSync("herdr-app", args, { encoding: "utf8" });
const run = (name, args = {}) => herdr("do", name, JSON.stringify(args));
const wait = ms => new Promise(done => setTimeout(done, ms));

const LONG = "pulse-134-host-only-session-cookie-with-a-very-long-branch-name";
const ok = { draft: false, mergeable: "MERGEABLE", mergeState: "CLEAN", review: null, comments: 0, failed: 0, failing: [], pending: 0, passed: 9 };
const tree = name => ({ shop: { root: `${repo}/wt-${name}`, cwd: `${repo}/wt-${name}`, branch: `${name}-a-branch-named-after-its-task`, base: "a".repeat(40), target: LONG, source: repo } });
const pr = (number, status) => ({ shop: { url: `https://github.invalid/me/shop/pull/${number}`, number, status: { ...ok, ...status } } });
const summary = "Changed: Settings reminder covers open and closed browsers, with a test button.\nChecked: all tests, the mirror check and the build pass.\nUnsure: delivery in Firefox could not be verified from here.";
const TASKS = [
  ["Queued, with a long title that has to wrap over more than one line in the inspector", { status: "queued", description: "In the me page you should be able to set a notification that reminds you to report time." }],
  ["Needs you in its terminal", { status: "input", workspaces: tree("input"), agent: "OpenCode", tuning: "opencode-go/deepseek-v4.1-flash · max effort" }],
  ["Ready for review, checks passed", { status: "review", workspaces: tree("review"), checked: "passed", summary, agent: "Claude Code", tuning: "opus · xhigh effort" }],
  ["Review refused for uncommitted changes", { status: "review", workspaces: tree("dirty"), error: "The task's worktree has uncommitted changes, so its agent may still be working. Ask it to commit them, or commit them anyway." }],
  ["Checks failed", { status: "failed", reason: "checks", workspaces: tree("failed"), checkOutput: Array.from({ length: 20 }, (_, n) => `FAIL src/theme.test.js line ${n}`).join("\n") }],
  ["Stopped: its terminal closed", { status: "failed", workspaces: tree("stopped"), error: "Its terminal closed. Retry to start a new agent in the same worktree, or discard the task." }],
  ["PR: conflicts, failing checks and a review", { status: "pr", workspaces: tree("clash"), prs: pr(216, { mergeable: "CONFLICTING", mergeState: "DIRTY", failed: 2, failing: ["integration-tests", "lint"], review: "CHANGES_REQUESTED", comments: 3 }), summary, agent: "OpenCode", tuning: "opencode-go/deepseek-v4.1-flash · max effort" }],
  ["PR: a draft with checks running", { status: "pr", workspaces: tree("draft"), prs: pr(217, { draft: true, mergeState: "DRAFT", pending: 4, passed: 5 }) }],
  ["PR: ready to merge", { status: "pr", workspaces: tree("ready"), prs: pr(218, { review: "APPROVED" }), evidence: { files: [], url: "https://docstash.ai/d/example" } }],
  ["Merged", { status: "done", summary, prs: { shop: { url: "https://github.invalid/me/shop/pull/219", number: 219, merged: true } }, usage: { written: 305412, read: 4405580, cached: 151839744, turns: 471 } }],
];

function fixture() {
  let state = { ...createLive({ id, name: "shop", cwd: repo, on: null }, Date.now()), delivery: "pr", setup: false, adopted: true };
  for (const [title] of TASKS) state = reduce(state, { type: "create", title }, Date.now());
  const log = Array.from({ length: 6 }, (_, n) => ({ message: `joined step ${n} of its history.`, at: Date.now() - n * 3600000 }));
  return { ...state, repo: "shop", repositories: [{ name: "shop", path: repo }],
    tasks: state.tasks.map((task, at) => ({ ...task, repos: ["shop"], log: log.map(line => ({ ...line, message: `${task.id} ${line.message}` })), ...TASKS[at][1] })) };
}

// Shared state can only be set from inside Herdr, so a mod that lives for one call does it.
async function inside(body) {
  const name = `pipeline-shots-${stamp}-${Math.random().toString(36).slice(2, 8)}`, folder = join(app, "mods", name);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "mod.json"), JSON.stringify({ place: "none", title: "Pipeline shots" }));
  writeFileSync(join(folder, "main.js"), `import { View, div } from "gpui-kit";\nimport { shared, setShared, props, closeOverlay } from "herdr";\nexport default class Shots extends View {\n  init() { const all = shared(${JSON.stringify(STORE)}) ?? {}; ${body} closeOverlay(props().overlay); }\n  render() { return div(); }\n}\n`);
  try {
    // Herdr notices a new mod folder a moment after it appears.
    for (let tries = 0; ; tries++) {
      try { run("mod.open", { name }); break; } catch (error) { if (tries > 20) throw error; await wait(250); }
    }
    await wait(300);
  } finally { rmSync(folder, { recursive: true, force: true }); }
}

const before = JSON.parse(herdr("status"));
let tab = null;
try {
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  const state = fixture();
  await inside(`setShared(${JSON.stringify(STORE)}, { ...all, [${JSON.stringify(key)}]: ${JSON.stringify(state)} });`);
  await wait(500);
  run("tab.new", { name: "Pipeline shots", mod: "pipeline", props: { context: { ...state.context, space: before.space } } });
  await wait(1500);
  tab = JSON.parse(herdr("status")).tab;
  mkdirSync(out, { recursive: true });
  for (const [at, task] of state.tasks.entries()) {
    // The person may be using Herdr meanwhile: bring the tab back and ask again.
    for (let tries = 0; ; tries++) {
      try { run("space.select", { id: before.space }); run("tab.select", { id: tab }); run(`pipeline.task-${task.id}`); break; } catch (error) { if (tries > 5) throw error; await wait(400); }
    }
    await wait(500);
    run("space.select", { id: before.space }); run("tab.select", { id: tab });
    await wait(200);
    herdr("shot", join(out, `${String(at + 1).padStart(2, "0")}-${task.status}-${task.id}.png`));
  }
  console.log(out);
} finally {
  try { if (tab && tab !== before.tab) run("tab.close", { id: tab, confirmed: true }); } catch { /* Closed already. */ }
  try { await inside(`const { [${JSON.stringify(key)}]: gone, [${JSON.stringify(id)}]: example, ...rest } = all; setShared(${JSON.stringify(STORE)}, rest);`); } catch { /* Herdr went away; the save is pruned once its folder is gone and nothing is unfinished. */ }
  try { run("space.select", { id: before.space }); run("tab.select", { id: before.tab }); if (before.focused_pane) run("pane.focus", { pane: before.focused_pane }); } catch { /* The person moved on. */ }
  rmSync(repo, { recursive: true, force: true });
}
