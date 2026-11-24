#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

const repo = new URL("../../", import.meta.url);
const { loadProcedures, procedure } = await import(new URL("mods/pipeline/procedures.js", repo));
const live = await import(new URL("mods/pipeline/pipeline-live.js", repo));
const linear = await import(new URL("mods/linear/model.js", repo));
const { noteList, countLabel } = await import(new URL("mods/changes-modal/notes.js", repo));
await loadProcedures(path => readFile(new URL(path, repo), "utf8"));

const ws = { name: "shop", cwd: "/work/worktrees/shop/T-7", root: "/work/worktrees/shop/T-7", source: "/work/shop", branch: "T-7-dark-mode-toggle", target: "main", base: "3f9c2ab71d0e", prBody: "/work/shop/.git/worktrees/T-7/herdr-pr.md" };
const ticket = { provider: "linear", key: "ENG-42", url: "https://linear.app/acme/issue/ENG-42" };
const task = { id: "T-7", title: "Add a dark mode toggle", description: "Follow the system preference until the person picks one.", ticket };
const plain = { id: "T-8", title: "Fix the footer link" };
const issue = { identifier: "ENG-42", title: task.title, url: ticket.url, status: "Todo", priority: 2, project: "Shop", description: task.description };
const notes = [
  { scope: "", path: "src/theme.js", side: "new", line: 42, code: "  const stored = localStorage.theme;", text: "Read it through settings.js like the other preferences." },
  { scope: "", path: "src/theme.js", side: "old", line: 57, code: "  applyTheme(system());", text: "Why did this go? The first paint needs it." },
  { scope: "", path: "src/toggle.js", side: "new", line: 8, to: 10, code: "export function toggle() {", quote: ["export function toggle() {", "  document.body.classList.toggle(\"dark\");", "}"], text: "Go through setTheme() so the choice is saved.\nKeep the export's name." },
];
const everything = { instructions: "Write commits in English.", evidence: true, tryout: "npm run dev", port: 4242,
  implementer: { label: "Codex · gpt-5", command: 'codex exec --sandbox workspace-write -m gpt-5 "$(cat "$(git rev-parse --git-path herdr-brief.md)")"' } };

const SECTIONS = [
  ["First message: a ticket, pull request delivery, Show the change and an implementer", () => live.prompt(task, [ws], "pr", everything)],
  ["First message: a typed task merged locally, nothing else on", () => live.prompt(plain, [{ ...ws, cwd: "/work/worktrees/shop/T-8", branch: "T-8-fix-the-footer-link" }], "merge", {})],
  ["Screenshots asked for from the inspector, after the work", () => live.evidenceRequest(task, ws, everything)],
  ["The check command failed", () => live.fixRequest("npm test", "FAIL src/theme.test.js\n  expected \"dark\", received \"light\"")],
  ["The merge was refused", () => live.rebaseRequest("main", "The branch conflicts with main in src/theme.js.")],
  ["An open pull request conflicts with its base", () => live.prConflictRequest(12, "main")],
  ["An open pull request has failing checks", () => live.prRequest("checks", { number: 12, status: { failing: ["test", "lint"] } }, "main")],
  ["An open pull request has review comments", () => live.prRequest("review", { number: 12 }, "main")],
  ["Delivery found uncommitted changes", () => live.commitRequest()],
  ["A conversation is converted into a task", () => live.adoptAsk(task, "/tmp/herdr-adopt-T-7.json", "/work/shop")],
  ["A converted conversation's work moved to a new agent", () => procedure("adopt-moved", { task: task.id, folder: ws.cwd })],
  ["A ticket started from the Linear or Plane panel", () => linear.taskFor(issue, "Keep the old colours as the light theme.")],
  ["The setup card's task that writes a run-and-show skill", () => procedure("demo-task")],
  ["Notes left on lines of a diff, sent from the Git dialog", () => procedure("review-notes", { count: countLabel(notes.length), notes: noteList(notes) })],
];

export const examples = () => ["# What agents receive", "",
  "Generated from `procedures/` with sample values by `node skills/herdr-pipeline/preview.mjs --write`. Don't edit it by hand.",
  ...SECTIONS.flatMap(([title, text]) => ["", `## ${title}`, "", "````text", text(), "````"]), ""].join("\n");

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ""))) {
  if (process.argv.includes("--write")) await writeFile(new URL("examples.md", import.meta.url), examples());
  else process.stdout.write(examples());
}
