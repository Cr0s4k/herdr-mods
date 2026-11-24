import assert from "node:assert/strict";
import test from "node:test";
import { STORE, annotate, removable, suggested, tags, outcome } from "../mods/worktree-cleanup/model.js";
import { STORE as PIPELINES } from "../mods/pipeline/pipeline-model.js";

const row = (extra = {}) => ({ path: "/wt/a", branch: "a", locked: false, gone: false, ahead: 0, only: 0, dirty: 0, ...extra });

test("a checkout an unfinished Pipeline task owns, or with a terminal open in it, is held", () => {
  assert.equal(STORE, PIPELINES);
  const all = {
    "live:x": { live: true, context: { on: null }, tasks: [
      { id: "T-1", status: "review", workspaces: { shop: { root: "/wt/a", cwd: "/wt/a/web" } } },
      { id: "T-2", status: "done", workspaces: { shop: { root: "/wt/b", cwd: "/wt/b" } } },
      { id: "T-3", status: "working", discard: true, workspaces: { shop: { root: "/wt/c", cwd: "/wt/c" } } },
    ] },
    "live:y": { live: true, context: { on: "mini" }, tasks: [{ id: "T-9", status: "pr", workspaces: { shop: { root: "/wt/d", cwd: "/wt/d" } } }] },
    demo: { tasks: [{ id: "T-4", status: "review", workspaces: { shop: { root: "/wt/d", cwd: "/wt/d" } } }] },
  };
  const panes = [{ terminal: "t1", cwd: "/wt/b/src" }, { terminal: "t2", cwd: "/wt/bb" }, { terminal: "mini/t3", cwd: "/wt/c" }, { terminal: null, mod: "pipeline", cwd: "/wt/c" }];
  const found = annotate(["a", "b", "c", "d"].map(name => row({ path: `/wt/${name}` })), all, panes, null);
  assert.deepEqual(found.map(r => [r.task?.id ?? null, r.open]), [["T-1", 0], [null, 1], [null, 0], [null, 0]]);
  assert.equal(found[0].task.state, "in review");
  assert.deepEqual(found.map(removable), [false, false, true, true]);
  assert.equal(annotate([row({ path: "/wt/d" })], all, panes, "mini")[0].task.id, "T-9");
});

test("only what loses nothing is ticked to start with; uncommitted files and locks can't be ticked", () => {
  const plain = { task: null, open: 0 };
  assert.ok(suggested({ ...row(), ...plain }));
  assert.ok(suggested({ ...row({ gone: true, ahead: 3 }), ...plain }));
  assert.ok(!suggested({ ...row({ ahead: 2 }), ...plain }) && removable({ ...row({ ahead: 2 }), ...plain }));
  assert.ok(!suggested({ ...row({ ahead: null }), ...plain }));
  assert.ok(suggested({ ...row({ ahead: 7, only: 7, pr: 216 }), ...plain }));
  assert.ok(!suggested({ ...row({ ahead: 7, pr: 216, dirty: 1 }), ...plain }));
  assert.ok(!removable({ ...row({ dirty: 1 }), ...plain }));
  assert.ok(!removable({ ...row({ locked: true }), ...plain }));
});

test("each checkout's tags say what is in it", () => {
  const texts = (extra, target = "main") => tags({ ...row(extra), task: null, open: 0, ...extra }, target).map(tag => `${tag.tone}:${tag.text}`);
  assert.deepEqual(texts({}), ["good:nothing main lacks"]);
  assert.deepEqual(texts({ ahead: 3, only: 0 }), ["warn:3 commits not in main", "good:pushed"]);
  assert.deepEqual(texts({ ahead: 3, only: 3, pr: 216, dirty: 1 }), ["bad:1 uncommitted file", "good:merged in #216"]);
  assert.deepEqual(texts({ ahead: 1, only: 1, dirty: 2 }), ["bad:2 uncommitted files", "warn:1 commit not in main", "bad:1 not pushed"]);
  assert.deepEqual(texts({ task: { id: "T-1", state: "in review" }, open: 2, locked: true, gone: true, ahead: null, only: null }),
    ["held:Pipeline T-1 · in review", "held:2 terminals open", "held:locked", "good:folder is gone"]);
});

test("the result says what went and what Git kept", () => {
  assert.equal(outcome([{ removed: true, kept: false }, { removed: true, kept: true }, { error: "x" }]), "Removed 2 worktrees · kept 1 branch that isn't merged · Git refused 1");
  assert.equal(outcome([{ removed: true, kept: true }, { removed: true, kept: true }]), "Removed 2 worktrees · kept 2 branches that aren't merged");
  assert.equal(outcome([{ error: "x" }]), "Git refused 1");
});
