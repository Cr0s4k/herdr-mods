import { STORE, SOURCES, taskPort, newer, reduce, waitsFor, CHECK_FIXES, agentRun, agentResume, agentOpening, prConflict, taskTuning, tuningLabel, workspacesOf, prList, liveNotices, stallFor, implementerFor, planKey, plannerHolds, plannerAgent, plannerTuning, PLANNERS, AGENT_OPTIONS, labelFor, ACTIVE, LIMITED, LIMIT_READ } from "./pipeline-model.js";
import { procedure } from "./procedures.js";

export const branchKey = task => `${task.id}-${task.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40)}`.replace(/-+$/, "");

export function prompt(task, workspaces, delivery, extras = {}) {
  const ticket = task.ticket, service = SOURCES[ticket?.provider], [first, ...others] = [].concat(workspaces), pr = delivery === "pr";
  const heading = ticket ? [`${service} ticket ${ticket.key}: ${task.title}`, ...(ticket.url ? [ticket.url] : [])] : [task.title];
  const handoff = pr ? "Don't push or open a pull request: once the person approves in Pipeline, it pushes the branch and opens one into" : null;
  const where = others.length ? [
    `Herdr Pipeline made an isolated Git worktree for each repository this task touches, all on the branch ${first.branch}:`,
    ...[first, ...others].map(ws => `- ${ws.name}: ${ws.cwd}, started from ${ws.target} at ${ws.base.slice(0, 7)}`),
    `Your working folder is ${first.name}'s worktree. The other worktrees are open to you as well.`,
    pr ? `When the task is done, commit your changes on this branch in each repository you changed, and stop. ${handoff} the branch each repository started from.`
      : "When the task is done, commit your changes on this branch in each repository you changed, and stop. The person reviews your work in Pipeline and merges each repository's branch into the branch it started from.",
  ] : [
    "Herdr Pipeline made an isolated Git worktree for this task.",
    `Working folder: ${first.cwd}`,
    `Branch: ${first.branch}, started from ${first.target} at ${first.base.slice(0, 7)}.`,
    pr ? `When the task is done, commit your changes on this branch and stop. ${handoff} ${first.target}.`
      : `When the task is done, commit your changes on this branch and stop. The person reviews your work in Pipeline and merges it into ${first.target}.`,
  ];
  const opening = extras.switching ? [`Herdr Pipeline made this conversation its task ${task.id}: ${task.title}`,
    `It made a Git worktree for it${task.adopt?.moved ? ` and moved your ${task.adopt.moved === 1 ? "uncommitted file" : `${task.adopt.moved} uncommitted files`} there, out of ${first.source}` : ""}.`,
    `Switch this session into the worktree now with the EnterWorktree tool (path: ${first.root}) and do all further work there, never in ${first.source}.`,
    "Then carry on with what you were doing. If it was already finished, do what is asked below and stop."]
    : [...heading, ...(task.description?.trim() ? ["", task.description.trim()] : []),
      ...(task.adopt ? ["", `This continues work from another conversation.${task.adopt.moved ? " Its uncommitted changes are already in your worktree: read `git status` and the diff before you go on." : ""}`] : [])];
  const images = task.images?.length ? ["", `The person attached ${task.images.length === 1 ? "an image" : "images"} to this task. Open ${task.images.length === 1 ? "it" : "them"} before you start:`, ...task.images.map(image => `- ${image.path}`)] : [];
  return [...opening, ...images, "", ...where, ...(pr ? pullRequestRules(task, [first, ...others]) : []), ...(extras.implementer ? implementerRule(extras.implementer, others.length) : []), ...(extras.evidence ? evidenceRule(first, others.length, extras) : []), ...summaryRule(first, others.length),
    ...(extras.instructions ? ["", "The person's instructions for every task in this project:", extras.instructions] : []),
    ...(ticket ? [procedure("ticket", { service, owner: " (Pipeline does that)" })] : [])].join("\n");
}

// The agent keeps the judgement (the approach, the review, the commit) and another model does the typing.
function implementerRule(implementer, others) {
  return ["", procedure("implementer", { implementer: implementer.label, where: others ? "the worktree of the repository the step changes" : "the worktree", command: implementer.command })];
}

// The page is where the person looks first: the screenshots side by side, what changed, and how to try it.
const walkthrough = extras => procedure("walkthrough", { tryout: extras.tryout ? `, and how to try it locally (\`${extras.tryout}\`${extras.port ? `, PIPELINE_PORT=${extras.port}` : ""})` : "" });
const gitFile = (first, others, name) => first.prBody ? first.prBody.replace(/herdr-pr\.md$/, name) : `the path \`git rev-parse --git-path ${name}\` prints in ${others ? `${first.name}'s worktree` : "the worktree"}`;
// Screenshots sit in Git's own folder too. The worktree starts at the base commit, so "before" needs no second checkout.
function evidenceRule(first, others, extras) {
  return ["", procedure("evidence", { tryout: extras.tryout ? ` (\`${extras.tryout}\`${extras.port ? `, with PIPELINE_PORT=${extras.port} when it takes a port` : ""})` : "",
    folder: gitFile(first, others, "herdr-evidence"), walkthrough: walkthrough(extras) })];
}

// For a task that started without Show the change: its worktree already has the work, so "before" comes from the start commit.
export function evidenceRequest(task, ws, extras = {}) {
  return procedure("evidence-later", { tryout: extras.tryout ? `, running the project with \`${extras.tryout}\`${extras.port ? ` (PIPELINE_PORT=${extras.port} when it takes a port)` : ""}` : "",
    base: String(ws.base ?? "the commit this branch started from").slice(0, 7), folder: gitFile(ws, 0, "herdr-evidence"), walkthrough: walkthrough(extras) }).split("\n").join(" ");
}

// The reviewer reads this before the diff. It sits in Git's own folder, so it is never committed.
function summaryRule(first, others) {
  return ["", procedure("summary", { file: first.prBody ? first.prBody.replace(/herdr-pr\.md$/, "herdr-summary.md") : `the file \`git rev-parse --git-path herdr-summary.md\` prints in ${others ? `${first.name}'s worktree` : "the worktree"}` })];
}

const NOTES = "the file `git rev-parse --git-path herdr-pr.md` prints in that worktree";
function pullRequestRules(task, workspaces) {
  const files = workspaces.length > 1 ? workspaces.map(ws => `- ${ws.name}: ${ws.prBody ?? NOTES}`) : [workspaces[0].prBody ?? NOTES];
  return ["", procedure("pull-request", { where: workspaces.length > 1 ? "this file for each repository you changed" : "this file", files: files.join("\n"), ticket: task.ticket?.url ? ", and the ticket link" : "" })];
}

// What a converted agent is asked before anything moves: only it knows which uncommitted files are its own.
export const adoptAsk = (task, path, root) => procedure("adopt-ask", { task: task.id, file: path, root });
export const ADOPT_WAIT = 15 * 60000;
const SWITCHES = ["claude"];

const quote = value => `'${String(value).replace(/'/g, `'\\''`)}'`;
export const withEnv = (env, command) => `${Object.entries(env).map(([name, value]) => `export ${name}=${quote(value)}`).join("; ")}; ${command}`;

const TRY_RUN = 'trap : INT; export PIPELINE_TASK="$2" PIPELINE_PORT="$3"; sh -c "$1"; exec "${SHELL:-sh}" -l';
// Runs the Try it command in the task's worktree, in a tab beside its agent, and answers with that tab.
export async function openTry({ run, panes, spaces, focused }, context, task, ws, command, cx, quiet = false) {
  const before = new Set(panes().map(pane => pane.terminal).filter(Boolean)), here = focused(), name = `Try ${task.id}`;
  const opening = { folder: ws.cwd, argv: ["sh", "-c", TRY_RUN, "sh", command, task.id, String(taskPort(task))] };
  if (task.space && spaces().some(space => space.id === task.space)) run("tab.new", { ...opening, space: task.space, name });
  else run("space.new", { ...opening, machine: context.on || "", tab: name });
  if (quiet) try {
    if (here?.space && spaces().some(row => row.id === here.space)) {
      run("space.select", { id: here.space });
      if (here.tab) run("tab.select", { id: here.tab });
      if (here.pane) run("pane.focus", { pane: here.pane });
    }
  } catch { /* It started even if the previous view disappeared. */ }
  for (let i = 0; i < 60; i++) {
    const pane = panes().find(row => row.terminal && !before.has(row.terminal) && row.cwd === ws.cwd);
    if (pane) return pane.tab;
    await cx.sleep(100);
  }
  return null;
}

const WATCHES = {
  plane: (watch, state) => ({ op: "issues", context: { cwd: state.context.cwd, on: state.context.on }, state: watch.id, scope: "all" }),
  linear: watch => ({ op: "issues", scope: watch.filter?.scope ?? "mine", ...(watch.filter?.team ? { team: watch.filter.team.id } : {}), ...(watch.filter?.project ? { project: watch.filter.project.id } : {}), state: watch.id }),
};

export const TRUST = /trust (this|the files in this|the contents of this) (folder|directory)|Yes, I trust this folder|project you created or one you trust/i;

// Picks “Yes, trust” in an arrow-key menu: moves from the marked option to it, then confirms.
export function trustKeys(screen) {
  const lines = String(screen).split("\n");
  const target = lines.findLastIndex(line => /yes/i.test(line) && /trust|allow|continue|proceed/i.test(line));
  const current = lines.findLastIndex(line => /^\s*[❯›>]/.test(line));
  if (target < 0 || current < 0 || Math.abs(target - current) > 6) return null;
  return [...Array(Math.abs(target - current)).fill(target > current ? "down" : "up"), "enter"];
}

const OPTION = /^\s*([❯›>]\s*)?(\d+)\.\s+(.+?)\s*$/, RULE = /^\s*[─━═]{8,}\s*$/, DASHES = /^\s*[╌┄─-]{8,}\s*$/, FOOTER = /^\s*(Enter|Esc|Press)\b/i;
const TYPED = /^(Type something|Type your own|Other)\b/i;

export function screenQuestion(screen) {
  const lines = String(screen ?? "").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").split("\n").map(line => line.replace(/^\s*│|│\s*$/g, "").trimEnd());
  for (let start = lines.length - 1; start >= 0; start--) {
    if (lines[start].match(OPTION)?.[2] !== "1") continue;
    const options = [];
    let marked = -1;
    for (let i = start; i < lines.length && !FOOTER.test(lines[i]); i++) {
      const option = lines[i].match(OPTION);
      if (option && Number(option[2]) === options.length + 1) { if (option[1]) marked = options.length; options.push(option[3]); }
    }
    if (options.length < 2 || marked < 0) continue;
    const above = [];
    for (let i = start - 1; i >= 0 && above.length < 14 && !RULE.test(lines[i]); i--) above.unshift(DASHES.test(lines[i]) ? "" : lines[i].trim());
    while (above.length && !above.at(-1)) above.pop();
    const gap = above.lastIndexOf("");
    const text = above.slice(gap + 1).join(" "), context = above.slice(0, gap + 1).filter(Boolean);
    return { text, context, options, marked, typed: options.findIndex(option => TYPED.test(option)) };
  }
  return null;
}

const moves = (from, to) => Array(Math.abs(to - from)).fill(to > from ? "down" : "up");

// Keys that pick an option by its label, read from a fresh screen so a changed menu is never answered blind.
export function answerKeys(screen, label) {
  const question = screenQuestion(screen), index = question?.options.indexOf(label) ?? -1;
  return index < 0 ? null : [...moves(question.marked, index), "enter"];
}

// Keys that make room for a typed answer: its free-text option, or Esc out of a menu that has none.
export function replyKeys(screen) {
  const question = screenQuestion(screen);
  if (!question) return [];
  return question.typed < 0 ? ["esc"] : moves(question.marked, question.typed);
}

export function observe(task, host) {
  const watched = ["working", "input", "review", "testing"].includes(task.status) || (task.status === "failed" && task.reason === "checks");
  if (!task.terminal || task.discard || !watched) return null;
  const agent = host.agents().find(row => row.address === task.terminal);
  const alive = agent || host.terminals().some(row => row.address === task.terminal && row.state === "live") || host.panes().some(row => row.terminal === task.terminal);
  if (!alive) return { status: "failed", error: "Its terminal closed. Retry to start a new agent in the same worktree, or discard the task." };
  // A finished turn only counts once the agent was seen working, so a stale "done" never ends the next turn early.
  const status = agent?.status === "working" ? "working" : agent?.status === "blocked" ? "input"
    : ["done", "idle"].includes(agent?.status) && task.worked && ["working", "input"].includes(task.status) ? "review" : null;
  return status && (status !== task.status || (status === "working" && !task.worked)) ? { status } : null;
}

// A task with an open pull request keeps its card; what its agent does since is told beside it.
export function agentSeen(task, host) {
  if (task.status !== "pr" || task.discard || task.reopen || !workspacesOf(task).length) return undefined;
  const agent = host.agents().find(row => row.address === task.terminal);
  // A task without a terminal has no agent; a pane that is no terminal has none either, and must not pass for one.
  const alive = task.terminal && (agent || host.terminals().some(row => row.address === task.terminal && row.state === "live") || host.panes().some(row => row.terminal === task.terminal));
  const seen = !alive ? "gone" : agent?.status === "working" ? "working" : agent?.status === "blocked" ? "input" : null;
  return seen === (task.agentState ?? null) ? undefined : seen;
}

export const worktreesOf = task => Object.entries({ ...task.planned, ...task.workspaces }).map(([name, ws]) => ({ name, ...ws }));

// The files a branch changed since its start commit, as the changes dialog lists them: git's name-status, numstat and status, all with -z.
export function changedFiles(names, stats, status) {
  const counts = new Map();
  for (const entry of String(stats ?? "").split("\0")) {
    const [add, del, ...parts] = entry.split("\t");
    if (parts.length) counts.set(parts.join("\t"), { add: Number(add) || 0, del: Number(del) || 0, binary: add === "-" });
  }
  const files = [], parts = String(names ?? "").split("\0");
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const kind = parts[i][0], path = parts[i + 1];
    files.push({ path, status: "ADM".includes(kind) ? kind : "M", fresh: false, ...(counts.get(path) ?? { add: 0, del: 0 }) });
  }
  for (const entry of String(status ?? "").split("\0")) if (entry.startsWith("?? ")) files.push({ path: entry.slice(3), status: "A", fresh: true, add: 0, del: 0 });
  return files.slice(0, 1000);
}

export const tail = (text, lines = 40) => String(text ?? "").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").trimEnd().split("\n").slice(-lines).join("\n").slice(-4000);
export const PLAN_SCHEMA = { type: "object", additionalProperties: false, required: ["summary", "order", "tasks"], properties: {
  summary: { type: "string", description: "One or two plain sentences for the person: the order and why anything waits." },
  order: { type: "array", items: { type: "string" }, description: "Every queued task id, in the order to start them." },
  tasks: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "waits", "reason"], properties: {
    id: { type: "string" }, waits: { type: "array", items: { type: "string" } }, reason: { type: "string" } } } } } };

const blockerText = (state, task, blocker) => {
  const inside = blocker.key && state.tasks.find(row => row !== task && row.ticket?.provider === task.ticket?.provider && row.ticket?.key === blocker.key);
  const where = inside ? `in the pipeline as ${inside.id}, ${labelFor(state, inside.status).toLowerCase()}` : blocker.closed === true ? "closed" : blocker.closed === false ? "still open, outside the pipeline" : "can't be read";
  return `${blocker.key ?? "a ticket"}${blocker.title ? ` "${blocker.title}"` : ""} (${where})`;
};
// What the planner agent reads: the queue, the work already started, and the rules Pipeline keeps whatever it says.
export function planPrompt(state) {
  const queued = state.tasks.filter(task => task.status === "queued"), started = state.tasks.filter(task => [...ACTIVE, "review", "merging", "pr"].includes(task.status));
  const describe = task => [`- ${task.id}: ${task.title}`, `  repositories: ${task.repos.join(", ")} · priority ${task.priority}${task.ticket ? ` · ticket ${task.ticket.key}` : ""}`,
    ...(task.depends.length ? [`  the person has it wait for: ${task.depends.join(", ")}`] : []),
    ...(task.blockers?.length ? [`  blocked by in ${SOURCES[task.ticket?.provider] ?? "its tracker"}: ${task.blockers.map(blocker => blockerText(state, task, blocker)).join("; ")}`] : []),
    ...(task.description?.trim() ? [`  details: ${task.description.trim().replace(/\s+/g, " ").slice(0, 1200)}`] : [])].join("\n");
  const repos = (state.repositories ?? [{ name: state.repo, path: state.context.cwd }]).map(repo => `- ${repo.name}: ${repo.path}`);
  return [
    "You plan the work queue of Herdr Pipeline. Pipeline starts one coding agent per task, each in its own Git worktree and branch, up to " + `${state.parallel} at once; finished branches are merged one at a time into the branch they started from.`,
    "Read the repository as much as you need (you can only read), then decide:",
    "1. The order to start the queued tasks in: what unblocks other work or is most valuable first, then priority (4 is urgent, 1 low).",
    "2. Which queued tasks must wait for another task (queued or already started) to merge first: because they build on its result, or because both would change the same lines and running them in parallel would make the second one conflict. Only add a wait you can justify from the code or the task; independent tasks should run in parallel.",
    "3. One short reason per queued task, in plain words for the person.",
    "Never invent task ids. Waits must not form a circle. Don't change any file.",
    "Tickets' blockers are already enforced: Pipeline holds a task until each blocker in the pipeline merges and each one outside it is closed. Don't repeat those waits, but plan around them: put the work that unblocks others early.",
    "", "Repositories:", ...repos,
    "", "Queued tasks:", ...queued.map(describe),
    ...(started.length ? ["", "Already started (they hold their files until they merge):", ...started.map(task => `- ${task.id}: ${task.title} (${task.status}, ${task.repos.join(", ")})`)] : []),
  ].join("\n");
}
// How planner.py starts each agent read-only and headless; it adds the output flags, the schema and the prompt.
// OpenCode's plan agent can't edit, and its private server is told to refuse the shell and questions too.
const OPENCODE_READ_ONLY = { OPENCODE_CONFIG_CONTENT: JSON.stringify({ permission: { edit: "deny", shell: "deny", question: "deny" } }) };
function readOnly(agent, tune, dirs = []) {
  const options = AGENT_OPTIONS[agent];
  if (agent === "codex") return { args: ["--sandbox", "read-only", "--ephemeral", "--skip-git-repo-check", "--color", "never", ...options.flags(tune), ...options.dirs(dirs)] };
  if (agent === "opencode") return { env: OPENCODE_READ_ONLY,
    args: ["--standalone", "--archived", "--agent", "plan", ...(tune.model ? ["--model", tune.effort ? `${tune.model}#${tune.effort}` : tune.model] : [])] };
  return { args: ["-p", ...options.flags(tune), "--tools", "Read,Grep,Glob", ...options.dirs(dirs), "--no-session-persistence", "--strict-mcp-config", "--disable-slash-commands"] };
}
export function planArgs(state) {
  const agent = plannerAgent(state), tune = plannerTuning(state);
  return { agent, ...readOnly(agent, tune, (state.repositories ?? []).slice(1).map(repo => repo.path)), schema: PLAN_SCHEMA, prompt: planPrompt(state),
    tuning: [tune.model, tune.effort && `${tune.effort} effort`].filter(Boolean) };
}
// What planner.py hands back, as the reducer takes it; a run without a plan throws, carrying what it did see.
export function readPlan(result) {
  const plan = result?.plan, seen = { trace: (result?.trace ?? []).map(String).slice(-80), ms: Number(result?.ms) || null,
    cost: typeof result?.cost === "number" ? result.cost : null, tokens: Number(result?.tokens) || null };
  if (!plan || !Array.isArray(plan.order)) throw Object.assign(new Error(String(result?.error || "The planner gave no plan.").slice(0, 300)), seen);
  const tasks = Array.isArray(plan.tasks) ? plan.tasks.filter(row => row && typeof row.id === "string") : [];
  return { summary: String(plan.summary ?? ""), order: plan.order.map(String),
    waits: Object.fromEntries(tasks.map(row => [row.id, Array.isArray(row.waits) ? row.waits.map(String) : []])),
    reasons: Object.fromEntries(tasks.map(row => [row.id, String(row.reason ?? "")])), ...seen };
}

const choice = (what, extra = {}) => ({ type: "object", additionalProperties: false, required: ["value", "reason"],
  properties: { value: { type: "string", description: what, ...extra }, reason: { type: "string", description: "One short sentence for the person, naming the file it came from." } } });
export const SETUP_SCHEMA = { type: "object", additionalProperties: false, required: ["check", "tryout", "delivery", "after"], properties: {
  check: choice("A shell command, or an empty string for none."), tryout: choice("A shell command, or an empty string for none."), after: choice("A shell command, or an empty string for none."),
  delivery: choice("merge or pr.", { enum: ["merge", "pr"] }) } };
export function setupPrompt(state, facts) {
  return [
    "You set up Herdr Pipeline for this repository. Pipeline starts one coding agent per task, each in its own Git worktree of the repository, and brings finished work back to the branch it started from.",
    "Read the repository as much as you need (you can only read): package scripts, Makefiles, README, CONTRIBUTING, AGENTS.md or CLAUDE.md, CI workflows. Then decide:",
    "1. check: the command Pipeline runs from the repository root after an agent finishes, before the person reviews. Use what this project runs to verify a change (its tests, plus lint or type checks if the project requires them), preferring its own scripts. It must not need a running server, secrets or network services. Empty if there is none.",
    "2. tryout: the command that runs the project so the person can try a change by hand, such as its dev server or the app. Empty if there is nothing to run.",
    `3. delivery: "pr" if this project takes changes through pull requests, "merge" if work merges straight into ${facts.branch ?? "the current branch"}.${facts.github ? "" : " Pull requests need a GitHub origin and gh, which this machine lacks, so choose merge."}`,
    "4. after: the command Pipeline runs in the project folder after it merges a task there, when merged work only takes effect once something is run: an install or deploy script the project's own instructions say to run after every change. Empty for most projects, and empty when delivery is pr.",
    "Don't change any file.",
    "", "What Pipeline already knows:",
    `- current branch: ${facts.branch ?? "unknown"}`,
    `- origin on GitHub with gh installed: ${facts.github ? "yes" : "no"}`,
    `- commands found by file names alone: ${facts.found.length ? facts.found.join(", ") : "none"}`,
    `- set now: check ${state.check?.command ?? "none"}, try it ${state.tryout ?? "none"}, delivery ${state.delivery}, after merge ${state.afterMerge ?? "none"}`,
  ].join("\n");
}
// Choose for me reads the repository read-only, as the agent and model the planner uses.
export function setupArgs(state, facts) {
  const agent = plannerAgent(state), tune = plannerTuning(state);
  return { agent, ...readOnly(agent, tune), schema: SETUP_SCHEMA, prompt: setupPrompt(state, facts), by: [PLANNERS[agent], tune.model].filter(Boolean).join(" · ") };
}
export function readSetup(result, github) {
  const picked = result?.plan, part = key => ({ value: String(picked?.[key]?.value ?? "").trim().slice(0, 500), reason: String(picked?.[key]?.reason ?? "").replace(/\s+/g, " ").trim().slice(0, 300) });
  if (!picked || typeof picked !== "object") throw new Error(String(result?.error || "It gave no answer.").slice(0, 300));
  const delivery = part("delivery");
  const way = delivery.value === "pr" && github ? "pr" : "merge", after = part("after");
  return { check: part("check"), tryout: part("tryout"), delivery: { ...delivery, value: way }, after: way === "pr" ? { value: "", reason: "" } : after, ms: Number(result?.ms) || null };
}

// Agents tick a timer, a token count and a blinking spinner while they wait, so only words count as new output.
export const screenText = text => text.replace(/\d+[a-z]*/gi, "").replace(/[^A-Za-z]+/g, " ").trim();

export const commitRequest = () => procedure("uncommitted");
export const rebaseRequest = (target, error) => procedure("merge-refused", { target, error: error || "The branch conflicts." });
export const prConflictRequest = (number, target) => procedure("pr-conflict", { number, target: target || "its base branch" });
export const prRequest = (kind, pr, target) => kind === "checks" ? procedure("pr-checks", { number: pr.number, checks: (pr.status?.failing ?? []).join(", ") || "see the pull request" })
  : kind === "review" ? procedure("pr-review", { number: pr.number }) : prConflictRequest(pr.number, target);
export const fixRequest = (command, output) => procedure("check-failed", { command, output: output || "(no output)" });

const PR_READ = 60000, PR_READ_AWAY = 600000;
// Starts, merges and discards real agents' work, one job at a time, and maps agent status onto tasks.
export class LiveRunner {
  constructor(host) { this.host = host; this.busy = false; this.peeked = new Map(); this.polled = new Map(); this.polling = new Set(); this.checking = new Set(); this.updating = new Set(); this.trying = new Set(); this.screens = new Map(); this.counted = new Map(); this.summarised = new Map(); this.forgetting = new Set(); this.queues = new Map(); this.planning = new Set(); }

  // GitHub is asked once a minute only where the answer is waited for: the pipeline of the space on screen, and a running one with queued work a merge could release. The rest are asked every ten minutes.
  pace(state) {
    const shown = this.host.shown?.();
    const near = !this.host.shown || (shown && (state.space ?? state.context.space) === shown.space);
    return near || (state.running && state.tasks.some(task => task.status === "queued")) ? PR_READ : PR_READ_AWAY;
  }
  // Opening a Pipeline tab asks again right away, so what it shows is never a stale answer.
  refreshShown() {
    const shown = this.host.shown?.(), viewing = shown?.viewing ? shown.space : null, now = this.host.now();
    if (viewing && viewing !== this.viewing) for (const [id, state] of this.pipelines()) {
      if ((state.space ?? state.context.space) !== viewing) continue;
      for (const [key, at] of this.polled) if ((key.startsWith(`pr/${id}/`) || key.startsWith(`find/${id}/`)) && now - at >= 10000) this.polled.delete(key);
    }
    this.viewing = viewing;
  }

  // Open pull requests are asked about: what they wait for, and whether GitHub merged or closed them.
  watchPullRequest(id, state, task, repo, cx) {
    const pr = task.prs[repo], key = `pr/${id}/${task.id}/${repo}`, now = this.host.now();
    if (this.polling.has(key) || now - (this.polled.get(key) ?? -Infinity) < this.pace(state)) return;
    this.polled.set(key, now); this.polling.add(key);
    cx.spawn(async () => {
      try {
        const source = task.workspaces?.[repo]?.source ?? state.context.cwd;
        const { state: github, status } = await this.host.delivery({ cwd: source, on: state.context.on }, { op: "pr_state", root: source, url: pr.url });
        const now = this.task(id, task.id);
        if (now?.status !== "pr" || now.prs?.[repo]?.url !== pr.url) return;
        if (github === "OPEN" && status) this.apply(id, { type: "prStatus", id: task.id, repo, url: pr.url, status });
        else if (github === "MERGED") {
          this.apply(id, { type: "prMerged", id: task.id, repo, url: pr.url });
          const after = this.task(id, task.id);
          if (after?.status !== "done") return;
          // A pull request followed from another branch never held this worktree's work, so nothing there is thrown away.
          try { await this.clean(state.context, after, !Object.values(after.prs ?? {}).some(pr => pr.from)); } catch { /* Merged on GitHub; a leftover worktree is harmless. */ }
          this.apply(id, { type: "cleaned", id: task.id });
        } else if (github === "CLOSED") this.apply(id, { type: "prClosed", id: task.id, repo, url: pr.url });
      } catch { /* Try again next minute. */ } finally { this.polling.delete(key); }
    });
  }

  // With Rebase on conflicts, a conflicting pull request's agent is asked once it is idle, and reopened for it when its tab is closed.
  autoRebase(id, state, task) {
    if (!state.autoRebase || task.status !== "pr" || task.rebaseAsked || task.reopen || task.discard || ["working", "input"].includes(task.agentState)) return;
    const conflict = prConflict(task);
    if (!conflict || !workspacesOf(task).length) return;
    if (task.agentState === "gone" || !task.terminal) { this.apply(id, { type: "reopen", id: task.id, ask: "rebase" }); return; }
    this.apply(id, { type: "rebaseAsked", id: task.id });
    Promise.resolve(this.host.send?.(task.terminal, prConflictRequest(conflict[1].number, task.workspaces?.[conflict[0]]?.target))).catch(() => {});
  }

  reopenAgent(id, state, task, cx) {
    const key = `reopen/${id}/${task.id}`, host = this.host;
    if (this.polling.has(key)) return;
    this.polling.add(key);
    cx.spawn(async cx => {
      try {
        const ws = workspacesOf(task)[0], known = await host.knownAgents(state.context);
        const agent = known.find(row => row.installed && row.name === task.agent) ?? known.find(row => row.installed && row.key === state.agent?.key) ?? known.find(row => row.installed);
        if (!agent) throw new Error("No coding agent is installed on that machine.");
        const before = host.panes().map(row => row.terminal).filter(Boolean);
        const ask = task.reopenAsk, repo = ask && (ask.repo ?? prConflict(task)?.[0] ?? Object.keys(task.prs ?? {})[0]), pr = repo && task.prs?.[repo], run = agentResume(agent);
        const opening = pr ? agentOpening({ ...agent, run }, prRequest(ask.kind, pr, task.workspaces?.[repo]?.target)) : { argv: run };
        const own = host.resume(state.context, task, ws, opening, state.space ?? task.space);
        const opened = await host.locate(state.context, ws, cx, before);
        if (!opened) throw new Error("Its agent was asked to start, but its terminal never appeared.");
        this.apply(id, { type: "reopened", id: task.id, ...opened, own, agent: agent.name });
      } catch (error) { this.apply(id, { type: "reopenFailed", id: task.id, error: error?.message || String(error) }); }
      finally { this.polling.delete(key); }
    });
  }

  readyPullRequest(id, state, task, repo, cx) {
    const pr = task.prs[repo], key = `ready/${id}/${task.id}/${repo}`;
    if (this.polling.has(key)) return;
    this.polling.add(key);
    cx.spawn(async () => {
      const source = task.workspaces?.[repo]?.source ?? state.context.cwd;
      try {
        const { status } = await this.host.delivery({ cwd: source, on: state.context.on }, { op: "pr_ready", root: source, url: pr.url, undo: pr.readying === "draft" });
        this.apply(id, { type: "prReadied", id: task.id, repo, url: pr.url, status });
      } catch (error) { this.apply(id, { type: "prReadied", id: task.id, repo, url: pr.url, error: String(error?.message ?? error) }); }
      finally { this.polling.delete(key); }
    });
  }

  // A pull request opened by hand on a task's branch is found here, so the task follows it like one Pipeline opened.
  watchBranch(id, state, task, cx) {
    const key = `find/${id}/${task.id}`, now = this.host.now(), workspaces = workspacesOf(task).filter(ws => !task.prs?.[ws.name]);
    if (!workspaces.length || task.approvals?.length || this.polling.has(key) || now - (this.polled.get(key) ?? -Infinity) < this.pace(state)) return;
    this.polled.set(key, now); this.polling.add(key);
    cx.spawn(async () => {
      try {
        const prs = {};
        for (const ws of workspaces) {
          const { found } = await this.host.delivery({ cwd: ws.source, on: state.context.on }, { op: "pr_find", root: ws.source, worktree: ws.root, branch: ws.branch, base: ws.base, ...(task.adopt && ws.target ? { target: ws.target } : {}) });
          if (!found) return;
          prs[ws.name] = found;
        }
        this.apply(id, { type: "prFound", id: task.id, prs });
      } catch { /* Try again next minute. */ } finally { this.polling.delete(key); }
    });
  }

  pipelines() { return Object.entries(this.host.shared(STORE) ?? {}).filter(([, state]) => state?.live && !newer(state)); }
  task(id, taskId) { return this.host.shared(STORE)?.[id]?.tasks.find(task => task.id === taskId); }
  apply(id, action) {
    const all = this.host.shared(STORE) ?? {}, state = all[id];
    if (!state) return;
    const next = reduce(state, action, this.host.now());
    if (next === state) return;
    this.host.setShared(STORE, { ...all, [id]: next });
    for (const notice of liveNotices(state, next)) this.host.announce?.(id, notice);
  }

  start() {
    for (const [id, state] of this.pipelines()) if (state.planning?.status === "running") this.apply(id, { type: "planFailed", key: state.planning.key, error: "Herdr restarted while the planner was planning." });
    // A restart cannot prove whether a start command reached the core. Never replay it.
    for (const [id, state] of this.pipelines()) for (const task of state.tasks) {
      if (task.reopen) this.apply(id, { type: "reopenFailed", id: task.id, error: "Herdr restarted while its agent was reopening. Check for its tab before trying again." });
      if (task.status === "routing" && task.launch === "starting") this.apply(id, { type: "launchFailed", id: task.id,
        error: "Herdr restarted while its agent was starting. Check for its space, then retry or discard." });
      else if (task.status === "routing" && task.launch) this.apply(id, { type: "launch", id: task.id, phase: null });
    }
  }

  // Tickets in a watched state join the queue once; only updateTickets writes to the tracker.
  watchTickets(id, state, provider, cx) {
    const watch = state.watching?.[provider];
    if (!watch || !this.host.tickets) return;
    const lane = `${id}/${provider}`, key = `${lane}/${watch.id}/${JSON.stringify(watch.filter ?? null)}`, now = this.host.now();
    if (this.polling.has(lane) || now - (this.polled.get(key) ?? -Infinity) < 60000) return;
    this.polled.set(key, now); this.polling.add(lane);
    cx.spawn(async () => {
      try {
        const data = await this.host.tickets(provider, WATCHES[provider](watch, state));
        if (data.needsProject) { this.apply(id, { type: "sourceError", provider, error: "Link a Plane project to this repository in the Tasks panel." }); return; }
        this.apply(id, { type: "sourceError", provider, error: null });
        const latest = this.host.shared(STORE)?.[id] ?? state;
        const unseen = (data.issues ?? []).filter(issue => !latest.claimed?.includes(issue.uuid) && !latest.tasks.some(task => task.ticket?.uuid === issue.uuid && task.status !== "done"));
        const issues = this.host.describe ? await this.host.describe(provider, unseen) : unseen;
        this.apply(id, { type: "addTickets", provider, issues, source: `${SOURCES[provider]} · ${watch.name}`, watched: true });
      } catch (error) {
        this.apply(id, { type: "sourceError", provider, error: error?.message || String(error) });
      } finally { this.polling.delete(lane); }
    });
  }

  // Tasks blocked by tickets outside the pipeline ask their tracker once a minute whether those closed.
  watchBlockers(id, state, cx) {
    if (!this.host.blockers) return;
    const lane = `blockers/${id}`, now = this.host.now();
    if (this.polling.has(lane) || now - (this.polled.get(lane) ?? -Infinity) < 60000) return;
    const waiting = state.tasks.filter(task => task.status === "queued" && task.ticket && waitsFor(state, task).some(wait => wait.kind === "ticket"));
    if (!waiting.length) return;
    this.polled.set(lane, now); this.polling.add(lane);
    cx.spawn(async () => {
      try {
        for (const provider of Object.keys(SOURCES)) {
          const tasks = waiting.filter(task => task.ticket.provider === provider);
          if (!tasks.length) continue;
          const found = await this.host.blockers(provider, tasks.map(task => ({ uuid: task.ticket.uuid })));
          for (const task of tasks) if (found.has(task.ticket.uuid)) this.apply(id, { type: "blockers", id: task.id, blockers: found.get(task.ticket.uuid) });
        }
      } catch { /* Try again next minute. */ } finally { this.polling.delete(lane); }
    });
  }

  // Ticket updates run beside the Git queue, one at a time per task, and only ever record their result.
  updateTickets(id, state, cx) {
    if (!this.host.updateTicket) return;
    for (const task of state.tasks) {
      const update = task.ticket?.pending?.[0], key = `ticket/${id}/${task.id}`;
      if (!update || this.updating.has(key)) continue;
      this.updating.add(key);
      cx.spawn(async () => {
        let result;
        try { result = { ok: true, changed: (await this.host.updateTicket(task.ticket.provider, task.ticket, update))?.changed !== false }; }
        catch (error) { result = { ok: false, error: error?.message || String(error), errorKind: error?.kind ?? null }; }
        finally { this.updating.delete(key); }
        this.apply(id, { type: "ticketUpdated", id: task.id, n: update.n, ...result });
      });
    }
  }

  // With Try it set to start by itself, finished work is running by the time the person looks at it. Each task once.
  startTries(id, state, cx) {
    if (!state.tryAuto || !state.tryout || !this.host.tryout) return;
    for (const task of state.tasks) {
      const ws = workspacesOf(task)[0], key = `try/${id}/${task.id}`;
      if (task.status !== "review" || task.tried || task.discard || !ws || this.trying.has(key)) continue;
      this.trying.add(key);
      cx.spawn(async cx => {
        const tab = await this.host.tryout(state.context, task, ws, state.tryout, cx).catch(() => null);
        this.apply(id, { type: "tried", id: task.id, tab: tab ?? "none" });
      });
    }
  }

  // Usage limits are read once per machine every five minutes, when asked, and as soon as a window has reset.
  watchLimits(cx) {
    if (!this.host.limits) return;
    const machines = new Map();
    for (const [id, state] of this.pipelines()) machines.set(state.context.on ?? "", [...(machines.get(state.context.on ?? "") ?? []), [id, state]]);
    for (const [on, rows] of machines) {
      const key = `limits/${on}`, now = this.host.now(), last = this.polled.get(key) ?? -Infinity;
      if (this.polling.has(key)) continue;
      const resets = rows.flatMap(([, state]) => Object.keys(LIMITED).flatMap(agent => (state.limits?.[agent]?.windows ?? []).map(window => window.resets)));
      const due = now - last >= LIMIT_READ || (now - last >= 10000 && (rows.some(([, state]) => state.limitsAsked > last) || resets.some(at => at > last && at <= now)));
      if (!due) continue;
      this.polled.set(key, now); this.polling.add(key);
      cx.spawn(async () => {
        let limits;
        try { limits = await this.host.limits(rows[0][1].context); }
        catch (error) { limits = { error: error?.message || String(error) }; }
        finally { this.polling.delete(key); }
        for (const [id] of rows) this.apply(id, { type: "limits", limits });
      });
    }
  }

  step(cx) {
    this.refreshShown();
    this.watchLimits(cx);
    for (const [id, state] of this.pipelines()) {
      for (const provider of Object.keys(SOURCES)) this.watchTickets(id, state, provider, cx);
      this.watchBlockers(id, state, cx);
      this.plan(id, state, cx);
    }
    for (const [id, state] of this.pipelines()) for (const task of state.tasks) {
      const change = observe(task, this.host);
      if (change) this.apply(id, { type: "observe", id: task.id, ...change });
      else this.watchStartup(id, task, cx);
      const seen = agentSeen(task, this.host);
      if (seen !== undefined) this.apply(id, { type: "agentSeen", id: task.id, state: seen });
      if (task.reopen) this.reopenAgent(id, state, task, cx);
      else this.autoRebase(id, state, this.task(id, task.id) ?? task);
    }
    for (const [id, state] of this.pipelines()) for (const task of state.tasks) { this.askAdopted(id, state, task, cx); this.watchStall(id, task, cx); this.countUsage(id, state, task, cx); this.readSummary(id, state, task, cx); }
    for (const [id, state] of this.pipelines()) for (const task of state.tasks) {
      if (task.status === "testing" && !task.discard) this.runCheck(id, task, cx);
      if (task.status === "pr" && !task.discard) for (const [repo, pr] of Object.entries(task.prs ?? {})) if (!pr.merged) { if (pr.readying) this.readyPullRequest(id, state, task, repo, cx); else this.watchPullRequest(id, state, task, repo, cx); }
      if (["review", "input", "failed"].includes(task.status) && !task.discard) this.watchBranch(id, state, task, cx);
    }
    for (const [id, state] of this.pipelines()) this.updateTickets(id, state, cx);
    for (const [id, state] of this.pipelines()) this.startTries(id, state, cx);
    for (const [id, state] of this.pipelines()) this.forgetImages(id, state, cx);
    if (this.busy) return;
    for (const [id, state] of this.pipelines()) {
      const task = state.tasks.find(task => task.discard) ?? state.tasks.find(task => task.status === "merging" && task.merge) ?? state.tasks.find(task => task.status === "done" && task.revert);
      const retry = !task && state.unpushed?.some(entry => entry.retry);
      const after = !task && !retry && Boolean(state.afterMerge) && state.afterRuns?.some(entry => !entry.error);
      const launch = !task && !retry && !after && state.tasks.find(task => task.status === "routing" && !task.launch);
      if (!task && !retry && !after && !launch) continue;
      this.busy = true;
      cx.spawn(async cx => {
        try {
          if (retry) await this.pushAgain(id);
          else if (after) await this.runAfter(id);
          else if (launch) await this.launch(id, launch, cx);
          else if (task.discard) await this.discard(id, task);
          else if (task.revert) await this.revert(id, task);
          else await this.merge(id, task);
        } finally { this.busy = false; }
      });
      return;
    }
  }

  // A converted agent describes its own work first, beside the Git queue: its turn may take minutes to end.
  askAdopted(id, state, task, cx) {
    const key = `adopt/${id}/${task.id}`, adopt = task.adopt, now = this.host.now();
    if (task.status !== "routing" || task.launch !== "asking" || !adopt || adopt.files || task.discard || this.polling.has(key)) return;
    if (adopt.asked && now - (this.polled.get(key) ?? -Infinity) < 3000) return;
    this.polled.set(key, now); this.polling.add(key);
    cx.spawn(async () => {
      const at = { cwd: state.context.cwd, on: state.context.on }, fail = error => this.apply(id, { type: "launchFailed", id: task.id, error });
      try {
        if (!adopt.asked) {
          const { path, root } = await this.host.delivery(at, { op: "adopt_ask", root: at.cwd, task: task.id });
          // Marked before it is sent: a start that can't be confirmed is never replayed.
          this.apply(id, { type: "adoptAsked", id: task.id });
          if (this.task(id, task.id)?.adopt?.asked) await this.host.send(adopt.terminal, adoptAsk(task, path, root));
          return;
        }
        const read = await this.host.delivery(at, { op: "adopt_read", root: at.cwd, task: task.id });
        if (read.found) this.apply(id, { type: "adoptDescribed", id: task.id, title: read.title, description: read.description, files: read.files });
        else if (!this.host.panes().some(row => row.terminal === adopt.terminal)) fail("Its terminal closed before its agent described the work. Discard the task.");
        else if (now - adopt.asked > ADOPT_WAIT) fail("Its agent didn't describe its work within 15 minutes. Open it to see why, then retry or discard.");
      } catch (error) { fail(error?.message || String(error)); } finally { this.polling.delete(key); }
    });
  }

  // An agent reports no status while its own start-up prompts (folder trust) wait, so read its screen.
  watchStartup(id, task, cx) {
    if (task.status !== "working" || task.worked || !task.terminal || task.discard) return;
    if (this.host.agents().find(row => row.address === task.terminal)?.status) return;
    const now = this.host.now(), key = `${id}/${task.id}`;
    if (now - (this.peeked.get(key) ?? -Infinity) < 3000) return;
    this.peeked.set(key, now);
    cx.spawn(async () => {
      const screen = await this.host.read(task.terminal).catch(() => "");
      if (!TRUST.test(screen)) return;
      const keys = this.host.shared(STORE)?.[id]?.autoTrust && trustKeys(screen);
      if (keys && await this.host.keys(task.terminal, keys).then(() => true, () => false)) this.apply(id, { type: "trusted", id: task.id });
      else this.apply(id, { type: "observe", id: task.id, status: "input", reason: "trust" });
    });
  }

  // The planner agent plans a queue once it has stayed the same for a few seconds, so typing several tasks asks once.
  plan(id, state, cx) {
    if (!this.host.plan || this.planning.has(id) || !plannerHolds(state)) { this.queues.delete(id); return; }
    const key = planKey(state), now = this.host.now(), seen = this.queues.get(id);
    if (seen?.key !== key) { this.queues.set(id, { key, since: now }); return; }
    if (now - seen.since < 4000) return;
    const job = planArgs(state);
    this.apply(id, { type: "planning", key, prompt: job.prompt });
    const asked = this.host.shared(STORE)?.[id]?.planning;
    if (asked?.key !== key) return;
    this.planning.add(id);
    cx.spawn(async () => {
      try { this.apply(id, { type: "planned", key, ...readPlan(await this.host.plan(state.context, { ...job, watch: Boolean(asked.watch), space: state.space ?? null })) }); }
      catch (error) { this.apply(id, { type: "planFailed", key, error: error?.message || String(error), trace: error?.trace, ms: error?.ms, cost: error?.cost, tokens: error?.tokens }); }
      finally { this.planning.delete(id); }
    });
  }

  // A working agent redraws its screen all the time (a timer, a spinner); one that shows nothing new for ten minutes may be stuck.
  watchStall(id, task, cx) {
    const key = `${id}/${task.id}`;
    if (task.status !== "working" || !task.worked || !task.terminal || task.discard) { this.screens.delete(key); return; }
    const now = this.host.now(), seen = this.screens.get(key);
    if (!seen) { this.screens.set(key, { text: null, since: now, read: now }); return; }
    if (now - seen.read < 60000) return;
    this.screens.set(key, { ...seen, read: now });
    cx.spawn(async () => {
      const read = await this.host.read(task.terminal).catch(() => null), text = read === null ? null : screenText(read), last = this.screens.get(key);
      if (text === null || !last) return;
      if (text !== last.text) { this.screens.set(key, { text, since: this.host.now(), read: last.read }); if (this.task(id, task.id)?.stalled) this.apply(id, { type: "stalled", id: task.id, since: null }); }
      else if (this.host.now() - last.since >= stallFor(this.task(id, task.id)) && !this.task(id, task.id)?.stalled) this.apply(id, { type: "stalled", id: task.id, since: last.since });
    });
  }

  // Tokens are read when an agent's turn ends, so a finished task keeps them after its worktree is gone.
  countUsage(id, state, task, cx) {
    const cwd = workspacesOf(task)[0]?.cwd, key = `${id}/${task.id}`, turn = `${task.status}/${task.checkRun ?? 0}`;
    if (task.status === "working") this.counted.delete(key);
    if (!this.host.usage || !cwd || !["input", "testing", "review", "failed", "pr"].includes(task.status) || this.counted.get(key) === turn) return;
    this.counted.set(key, turn);
    cx.spawn(async () => {
      const usage = (await this.host.usage(state.context, [cwd]).catch(() => null))?.[cwd];
      if (usage) this.apply(id, { type: "usage", id: task.id, usage });
    });
  }

  forgetImages(id, state, cx) {
    const folders = state.imageTrash ?? [];
    if (!folders.length || !this.host.forget || this.forgetting.has(id)) return;
    this.forgetting.add(id);
    cx.spawn(async () => {
      try { await this.host.forget(folders); } catch { /* A folder that is already gone needs no second try. */ }
      this.forgetting.delete(id);
      this.apply(id, { type: "imagesForgotten", folders });
    });
  }

  // Read when an agent's turn ends, like its tokens, so the summary outlives the worktree it was written in.
  readSummary(id, state, task, cx) {
    const root = workspacesOf(task)[0]?.root, key = `${id}/${task.id}`, turn = `${task.status}/${task.checkRun ?? 0}`;
    if (task.status === "working") this.summarised.delete(key);
    if (!root || !["testing", "review", "failed", "pr"].includes(task.status) || task.discard || this.summarised.get(key) === turn) return;
    this.summarised.set(key, turn);
    cx.spawn(async () => {
      const read = await this.host.delivery({ cwd: root, on: state.context.on }, { op: "summary", worktree: root }).catch(() => null);
      if (read?.text || read?.evidence) this.apply(id, { type: "summary", id: task.id, text: read.text, ...(read.evidence ? { evidence: read.evidence } : {}) });
      this.apply(id, { type: "unchanged", id: task.id, value: await this.unchanged(state.context, task) });
    });
  }

  // Checks run beside the Git queue so a slow suite never holds up launches or merges. Every repository has to pass.
  runCheck(id, task, cx) {
    const key = `${id}/${task.id}/${task.checkRun}`;
    if (this.checking.has(key)) return;
    this.checking.add(key);
    cx.spawn(async () => {
      try {
        const state = this.host.shared(STORE)?.[id], command = state?.check?.command, workspaces = workspacesOf(task);
        if (!command || !workspaces.length) { this.apply(id, { type: "checkPassed", id: task.id, run: task.checkRun, output: "" }); return; }
        if (this.host.changed && await this.unchanged(state.context, task)) { this.apply(id, { type: "checkPassed", id: task.id, run: task.checkRun, output: "", unchanged: true }); return; }
        const several = workspaces.length > 1, results = [];
        for (const ws of workspaces) {
          const result = await this.host.check(state.context, ws.cwd, command).catch(error => ({ code: -1, output: error?.message || String(error) }));
          results.push({ name: ws.name, code: result.code, output: tail(result.output, several ? 20 : 40) });
        }
        const now = this.task(id, task.id), failed = results.filter(result => result.code !== 0);
        const output = several ? (failed.length ? failed : results).map(result => `${result.name}: ${result.code === 0 ? "passed" : "failed"}\n${result.output}`.trimEnd()).join("\n\n") : results[0].output;
        if (now?.status !== "testing" || now.checkRun !== task.checkRun) return;
        if (!failed.length) { this.apply(id, { type: "checkPassed", id: task.id, run: task.checkRun, output }); return; }
        const fix = state.check.fix && (now.fixes ?? 0) < CHECK_FIXES && now.terminal
          && await this.host.send(now.terminal, fixRequest(command, output)).then(() => true, () => false);
        this.apply(id, { type: "checkFailed", id: task.id, run: task.checkRun, output, fix: Boolean(fix), ...(several ? { repos: failed.map(result => result.name) } : {}) });
      } finally { this.checking.delete(key); }
    });
  }

  async unchanged(context, task) {
    const workspaces = workspacesOf(task);
    if (!this.host.changed || !workspaces.length || Object.keys(task.prs ?? {}).length) return false;
    const read = await this.host.changed({ cwd: workspaces[0].source ?? context.cwd, on: context.on }, workspaces.map(ws => ({ worktree: ws.root, base: ws.base }))).catch(() => null);
    return read?.changed === false;
  }

  source(state, task, name) {
    const path = task.workspaces?.[name]?.source ?? task.planned?.[name]?.source ?? state.repositories?.find(repo => repo.name === name)?.path
      ?? (name === state.repo ? state.context.cwd : null);
    if (!path) throw new Error(`${name} is no longer one of the repositories in Settings. Add it again, or discard the task.`);
    return path;
  }

  async launch(id, task, cx) {
    const { host } = this, context = host.shared(STORE)[id].context;
    const still = () => { const now = this.task(id, task.id); return now?.status === "routing" && !now.discard ? now : null; };
    if (task.adopt && !task.adopt.files) { this.apply(id, { type: "launch", id: task.id, phase: "asking" }); return; }
    try {
      const missing = task.repos.filter(name => !task.workspaces?.[name]);
      if (missing.length) {
        this.apply(id, { type: "launch", id: task.id, phase: "creating" });
        const ticket = { id: task.id, key: branchKey(task) };
        const remote = host.shared(STORE)[id].delivery === "pr" && Boolean(task.depends.length || task.blockers?.length);
        let run = Object.values({ ...task.planned, ...task.workspaces }).find(ws => ws.run)?.run;
        for (const name of missing) {
          const source = this.source(host.shared(STORE)[id], task, name), at = { cwd: source, on: context.on };
          const plan = await host.worktree(at, { op: "inspect", tickets: [ticket], provider: "pipeline", ...(remote ? { remote } : {}), ...(run ? { runId: run } : {}) });
          run = plan.runId ?? run;
          const planned = { root: plan.workspaces[0].root, branch: plan.workspaces[0].branch, base: plan.base, target: plan.branch, source, ...(plan.runId ? { run: plan.runId } : {}) };
          this.apply(id, { type: "launch", id: task.id, phase: "creating", repo: name, planned });
          if (!still()) return;
          const made = await host.worktree(at, { op: "create", plan, ticket, adopt: true });
          this.apply(id, { type: "launch", id: task.id, phase: "creating", repo: name, workspace: { ...planned, root: made.root, cwd: made.cwd, branch: made.branch, ...(made.base ? { base: made.base } : {}), ...(made.prBody ? { prBody: made.prBody } : {}) } });
          const prepare = host.shared(STORE)[id].prepare;
          if (prepare && still()) {
            this.apply(id, { type: "launch", id: task.id, phase: "preparing" });
            const ran = await host.check(context, made.cwd, withEnv({ PIPELINE_TASK: task.id, PIPELINE_SOURCE: source, PIPELINE_PORT: taskPort(still() ?? task) }, prepare)).catch(error => ({ code: -1, output: error?.message || String(error) }));
            this.apply(id, { type: "prepared", id: task.id, ...(ran.code === 0 ? {} : { error: String(ran.output || "It gave no output.").trim().slice(-600) }) });
          }
        }
      }
      let current = still();
      if (!current) return;
      const adopt = current.adopt;
      if (adopt && adopt.moved === undefined) {
        this.apply(id, { type: "launch", id: task.id, phase: "moving" });
        const ws = workspacesOf(current)[0];
        const moved = await host.delivery({ cwd: ws.source, on: context.on }, { op: "adopt_move", root: ws.source, worktree: ws.root, task: task.id, files: adopt.files });
        this.apply(id, { type: "adoptMoved", id: task.id, moved: moved.moved, skipped: moved.skipped });
        if (!(current = still())) return;
      }
      const open = adopt && host.panes().some(row => row.terminal === adopt.terminal);
      const known = adopt ? (await host.knownAgents(context)).find(agent => agent.key === adopt.program && agent.installed) : null;
      // Claude Code moves a running session into a worktree, so the conversation comes along.
      if (open && SWITCHES.includes(adopt.program)) {
        this.apply(id, { type: "launch", id: task.id, phase: "starting" });
        const state = host.shared(STORE)[id];
        await host.send(adopt.terminal, prompt(current, workspacesOf(current), state.delivery,
          { instructions: state.instructions ?? null, evidence: Boolean(state.evidence), tryout: state.tryout ?? null, port: taskPort(current), switching: true }));
        this.apply(id, { type: "launched", id: task.id, space: adopt.space, tab: adopt.tab, terminal: adopt.terminal, own: "pane", agent: known?.name ?? adopt.agent });
        return;
      }
      const agent = known ?? host.shared(STORE)[id].agent ?? (await host.knownAgents(context)).find(agent => agent.installed);
      if (!agent) throw new Error("No coding agent is installed on that machine. Install Claude Code or Codex, then retry.");
      this.apply(id, { type: "launch", id: task.id, phase: "starting" });
      const state = host.shared(STORE)[id], space = state.space ?? adopt?.space, workspaces = workspacesOf(current), implementer = implementerFor(state, current);
      const own = host.start(context, current, workspaces, { ...agent, run: agentRun(state, agent, [...workspaces.slice(1).map(ws => ws.root), ...new Set((current.images ?? []).map(image => image.path.replace(/\/[^/]+$/, "")))], current) }, space, state.delivery,
        { instructions: state.instructions ?? null, evidence: Boolean(state.evidence), tryout: state.tryout ?? null, port: taskPort(current), implementer });
      const opened = await host.locate(context, workspaces[0], cx, current.terminal);
      this.apply(id, opened ? { type: "launched", id: task.id, ...opened, own, agent: agent.name, tuning: tuningLabel(taskTuning(state, current, agent.key)), implementer: implementer?.label }
        : { type: "launchFailed", id: task.id, error: "Its agent was asked to start, but its terminal never appeared. Check the new space before retrying." });
      if (opened && open) await host.send(adopt.terminal, procedure("adopt-moved", { task: task.id, folder: workspaces[0].cwd })).catch(() => null);
    } catch (error) {
      this.apply(id, { type: "launchFailed", id: task.id, error: error?.message || String(error) });
    }
  }

  async merge(id, task) {
    const state = this.host.shared(STORE)[id], context = state.context, workspaces = workspacesOf(task);
    if (await this.unchanged(context, task)) {
      this.apply(id, { type: "closedUnchanged", id: task.id });
      try { await this.clean(context, task, false); } catch { /* Nothing was delivered; a leftover worktree is harmless. */ }
      this.apply(id, { type: "cleaned", id: task.id });
      return;
    }
    if (state.delivery === "pr") {
      try { this.apply(id, { type: "prOpened", id: task.id, prs: await this.publish(state, task, workspaces) }); }
      catch (error) { this.apply(id, { type: "mergeFailed", id: task.id, error: error?.message || String(error) }); }
      return;
    }
    try {
      if (!workspaces.length) throw new Error("This task has no worktree to merge.");
      const result = await this.host.delivery(context, { op: "merge", root: context.cwd, title: `${task.id} ${task.title}`, commit: Boolean(task.commit),
        repos: workspaces.map(ws => ({ name: ws.name, root: ws.source, worktree: ws.root, branch: ws.branch, base: ws.base })) });
      if (result.failed) {
        const merged = result.merged ?? [];
        throw new Error(`${merged.length ? `${merged.join(" and ")} merged, but ` : ""}${result.failed.name} did not: ${result.failed.error}${merged.length ? ` Merging again finishes ${result.failed.name}; ${merged.join(" and ")} won't merge twice.` : ""}`);
      }
      const targets = result.targets ?? {}, names = Object.keys(targets);
      const target = workspaces.length < 2 ? result.target : new Set(Object.values(targets)).size === 1 ? `${Object.values(targets)[0]} in ${names.join(" + ")}`
        : names.map(name => `${targets[name]} in ${name}`).join(" and ");
      const pushes = [];
      if (state.pushAfterMerge) for (const ws of workspaces.filter(ws => (result.merged ?? [ws.name]).includes(ws.name)))
        pushes.push(await this.push(context, { name: ws.name, root: ws.source ?? context.cwd, branch: targets[ws.name] ?? result.target }));
      this.apply(id, { type: "merged", id: task.id, target, landed: result.landed, repos: workspaces.map(ws => ws.name).filter(name => (result.merged ?? [name]).includes(name)), ...(state.pushAfterMerge ? { pushes } : {}) });
    } catch (error) {
      this.apply(id, { type: "mergeFailed", id: task.id, error: error?.message || String(error) });
      return;
    }
    try { await this.clean(context, task, false); } catch { /* The merge landed; a leftover worktree is harmless. */ }
    this.apply(id, { type: "cleaned", id: task.id });
  }

  async revert(id, task) {
    const state = this.host.shared(STORE)[id], context = state.context;
    if (!task.landed?.length) {
      try {
        const prs = [];
        for (const [repo, pr] of Object.entries(task.prs ?? {})) {
          const root = state.repositories?.find(row => row.name === repo)?.path || context.cwd;
          prs.push({ repo, ...await this.host.delivery({ cwd: root, on: context.on }, { op: "pr_revert", root, url: pr.url, title: `${task.id} ${task.title}` }) });
        }
        this.apply(id, { type: "revertOpened", id: task.id, prs });
      } catch (error) {
        this.apply(id, { type: "revertFailed", id: task.id, error: error?.message || String(error) });
      }
      return;
    }
    try {
      await this.host.delivery(context, { op: "revert", title: `${task.id} ${task.title}`, repos: task.landed });
      const pushes = [];
      if (state.pushAfterMerge) for (const repo of task.landed) pushes.push(await this.push(context, { name: repo.name, root: repo.root, branch: repo.branch }));
      this.apply(id, { type: "reverted", id: task.id, ...(state.pushAfterMerge ? { pushes } : {}) });
    } catch (error) {
      this.apply(id, { type: "revertFailed", id: task.id, error: error?.message || String(error) });
    }
  }

  // A push never throws: a refused or unreachable origin is recorded and leaves the merge where it landed.
  async push(context, repo) {
    try {
      const result = await this.host.delivery({ cwd: repo.root, on: context.on }, { op: "push", root: repo.root, branch: repo.branch });
      return { repo: repo.name, root: repo.root, branch: result?.branch ?? repo.branch, remote: result?.remote ?? null, pushed: Boolean(result?.pushed), error: result?.error ?? null };
    } catch (error) {
      return { repo: repo.name, root: repo.root, branch: repo.branch, remote: null, pushed: false, error: error?.message || String(error) };
    }
  }

  async pushAgain(id) {
    const state = this.host.shared(STORE)[id], results = [];
    for (const entry of state.unpushed.filter(entry => entry.retry))
      results.push(await this.push(state.context, { name: entry.repo, root: entry.root ?? state.context.cwd, branch: entry.branch }));
    this.apply(id, { type: "pushed", results });
  }

  // Runs in the Git queue, after the merges waiting there, so it sees a folder no merge is changing.
  // Its entries stay due until it reports, so a run cut short by Pipeline's own reload starts again.
  // Each start is counted in the store, where a reload can't lose it.
  async runAfter(id) {
    const state = this.host.shared(STORE)[id], results = [];
    for (const entry of state.afterRuns.filter(entry => !entry.error)) {
      this.apply(id, { type: "afterMergeStart", root: entry.root });
      if (this.host.shared(STORE)[id].afterRuns.find(row => row.root === entry.root)?.error) continue;
      const result = await this.host.check(state.context, entry.root, state.afterMerge).catch(error => ({ code: -1, output: error?.message || String(error) }));
      results.push({ root: entry.root, code: result.code, output: tail(result.output, 12) });
    }
    this.apply(id, { type: "afterMergeRan", results });
  }

  async publish(state, task, workspaces) {
    if (!workspaces.length) throw new Error("This task has no worktree to open a pull request from.");
    const several = task.repos.length > 1, opened = {};
    const body = task.ticket?.url ? `${SOURCES[task.ticket.provider]}: ${task.ticket.url}` : task.title;
    const title = task.ticket ? `${task.ticket.key}: ${task.title}` : task.title;
    for (const ws of workspaces.filter(ws => !task.prs?.[ws.name]?.merged)) {
      try {
        const pr = await this.host.delivery({ cwd: ws.source, on: state.context.on }, { op: "publish", root: ws.source, worktree: ws.root, branch: ws.branch, base: ws.base, target: ws.target,
          title, body, commit: Boolean(task.commit), ...(several ? { optional: true } : {}), ...(state.evidence && state.evidencePr ? { evidence: true } : {}), ...(state.draftPr ? { draft: true } : {}) });
        if (!pr.skipped) opened[ws.name] = { url: pr.url, number: pr.number };
      } catch (error) {
        const message = error?.message || String(error);
        if (!several) throw error;
        throw new Error(`${ws.name}: ${message}${Object.keys(opened).length ? ` Already open: ${prList(opened)}. Approving again reuses them.` : ""}`);
      }
    }
    if (!Object.keys(opened).length) throw new Error("The agent made no changes to open a pull request for. Send it feedback, or discard the task.");
    const all = { ...task.prs, ...opened }, links = Object.entries(all).filter(([, pr]) => pr.url);
    if (links.length > 1) for (const [name, pr] of links.filter(([, pr]) => !pr.merged)) {
      const others = links.filter(([other]) => other !== name).map(([other, pr]) => `- ${other}: ${pr.url}`);
      const source = task.workspaces?.[name]?.source ?? state.context.cwd;
      try { await this.host.delivery({ cwd: source, on: state.context.on }, { op: "pr_edit", root: source, url: pr.url, note: `${links.length} repositories. Merge these too:\n${others.join("\n")}` }); }
      catch { /* The pull requests are open; a body without the others' links is only less helpful. */ }
    }
    return opened;
  }

  async discard(id, task) {
    const context = this.host.shared(STORE)[id].context;
    try {
      await this.clean(context, task, true);
      this.apply(id, { type: "discarded", id: task.id });
    } catch (error) {
      this.apply(id, { type: "discardFailed", id: task.id, error: error?.message || String(error) });
    }
  }

  async clean(context, task, force) {
    try { if (task.tried) this.host.run("tab.close", { id: task.tried, confirmed: true }); } catch { /* Already closed. */ }
    try {
      if (task.own === "pane") { const pane = this.host.panes().find(row => row.terminal === task.terminal); if (pane) this.host.run("pane.close", { pane: pane.pane }); }
      else if (task.own === "space" && task.space) this.host.run("space.close", { id: task.space, confirmed: true });
      else if (task.tab) this.host.run("tab.close", { id: task.tab, confirmed: true });
      else if (task.terminal) this.host.run("terminal.kill", { terminal: task.terminal });
    } catch { /* Already closed. */ }
    let failure = null;
    for (const ws of worktreesOf(task)) {
      const root = ws.source ?? context.cwd;
      try { await this.host.delivery({ cwd: root, on: context.on }, { op: "remove", root, worktree: ws.root, branch: ws.branch, force }); }
      catch (error) { failure ??= worktreesOf(task).length > 1 ? new Error(`${ws.name}: ${error?.message || String(error)}`) : error; }
    }
    if (failure) throw failure;
  }
}
