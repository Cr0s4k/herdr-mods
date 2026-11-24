import { View, div, svg, image, PathBuilder } from "gpui-kit";
import { h_flex, v_flex, Button, Input, InputState, Textarea, TextareaState, Switch, TextView } from "gpui-base";
import { shared, setShared, theme, props, exec, hc, run, focused, panes, spaces, knownAgents, nextCommand, settings, appHome, readTextFile, openOverlay, window as appWindow } from "herdr";
import { STORE, LIVE, VERSION, IMAGES, SOURCES, UPDATE_KINDS, guessUpdates, guessWatch, updatesLabel, ticketRef, ticketPrefix, shareSettings, inheritSettings, adoptSettings, resetSettings, forgettable, projectPipelines, taskPort, newer, openIssue, ACTIVE, MOVING, LABELS, REPOS, SPEEDS, AGENT_OPTIONS, agentRun, tuningFor, taskTuning, tuningLabel, codexModels, opencodeModels, createPipeline, createLive, labelFor, migrate, reduce, parseTime, nextScheduled, activeTasks, dependencies, waitsFor, canWaitFor, waitingReason, needsApproval, needsInput, prNeed, prNeeds, prAgent, prAsks, flowOf, guessFlow, prChecklist, prList, pushNote, unpushedLabel, afterFailed, canRevert, revertsByPr, workspacesOf, targetOf, quotaHeld, progress, duration, queueOrder, timing, planned, planSig, plannerHolds, PLANNERS, plannerAgent, plannerTuning, IMPLEMENTERS, implementerAgent, implementerTuning, implementerFor, elapsed, taskLog, usageText, compact, LIMITED, limitHold, limitHolding, limitUsed, limitAgent, resetTime, LIMIT_HOLD, TITLE, outsideAgents, adoptStep } from "./pipeline-model.js";
import { CARD, SUN, RING, layoutScene, cardWidth, samples } from "./geometry.js";
import { trustKeys, screenQuestion, answerKeys, replyKeys, fixRequest, rebaseRequest, prRequest, commitRequest, changedFiles, setupArgs, readSetup, openTry, evidenceRequest } from "./pipeline-live.js";
import { loadProcedures, procedure } from "./procedures.js";
import { readTickets, fullTickets } from "./ticket-source.js";

const BAR = 50, CONTROLS = 46, STATUS = 36, ONE_ROW = 1340;
const SHORTCUTS = [["Space", "Start or pause"], ["N", "New task"], ["↑ ↓ J K", "Walk the tasks"], ["D", "Read the selected task's changes", "live"], ["T", "Try the selected task", "live"],
  ["P", "Tickets from Plane", "live"], ["L", "Tickets from Linear", "live"], ["A", "Example tasks", "simulation"], ["Q", "Next task that needs you"], ["1–9", "Pick an answer"],
  ["Y", "Merge or approve everything waiting"], ["R", "Retry failed tasks"], ["S", "Simulation speed", "simulation"], ["?", "Show these keys"], ["Esc", "Close what is open"]];
const shortcuts = live => SHORTCUTS.filter(([, , only]) => !only || only === (live ? "live" : "simulation"));
const KEYS = Object.fromEntries(["live", "simulation"].map(mode => [mode, shortcuts(mode === "live").map(([key, what]) => `${key} ${what.toLowerCase()}`).join(" · ")]));
const COMET = ["●", "•", "·", "", "", ""];
const CHECK_HINTS = [
  "if [ -f package.json ] && grep -q '\"test\"' package.json; then",
  "  if [ -f pnpm-lock.yaml ]; then echo 'pnpm test'; elif [ -f yarn.lock ]; then echo 'yarn test'; elif [ -f bun.lockb ]; then echo 'bun test'; else echo 'npm test'; fi; fi",
  "if [ -f Makefile ] && grep -q '^check:' Makefile; then echo 'make check'; elif [ -f Makefile ] && grep -q '^test:' Makefile; then echo 'make test'; fi",
  "if [ -f Cargo.toml ]; then echo 'cargo test'; fi",
  "if [ -f go.mod ]; then echo 'go test ./...'; fi",
  "if [ -f pytest.ini ] || grep -qs pytest pyproject.toml; then echo 'python3 -m pytest'; fi",
].join("\n");
const TRY_HINTS = [
  'for f in try.sh preview.sh; do [ -x "$f" ] && echo "./$f"; done',
  "if [ -f package.json ]; then pm=npm; [ -f pnpm-lock.yaml ] && pm=pnpm; [ -f yarn.lock ] && pm=yarn; { [ -f bun.lockb ] || [ -f bun.lock ]; } && pm=bun",
  "  for s in dev start preview; do grep -q \"\\\"$s\\\":\" package.json && echo \"$pm run $s\"; done; fi",
  'if [ -f Makefile ]; then for s in run dev preview; do grep -q "^$s:" Makefile && echo "make $s"; done; fi',
  "if [ -f Cargo.toml ]; then echo 'cargo run'; fi",
].join("\n");
const AFTER_HINTS = [
  'for f in install.sh deploy.sh; do [ -x "$f" ] && echo "./$f"; done',
  'if [ -f Makefile ]; then for s in install deploy; do grep -q "^$s:" Makefile && echo "make $s"; done; fi',
].join("\n");
// What a fresh worktree lacks: untracked env files and installed dependencies.
const PREPARE_HINTS = [
  'c=""; for f in .env .env.local */.env */.env.local; do [ -f "$f" ] && ! git ls-files --error-unmatch "$f" >/dev/null 2>&1 && c="${c:+$c && }cp \\"\\$PIPELINE_SOURCE/$f\\" $(dirname "$f")/"; done',
  'if [ -f package.json ]; then i="npm ci"; [ -f pnpm-lock.yaml ] && i="pnpm install --frozen-lockfile"; [ -f yarn.lock ] && i="yarn install --frozen-lockfile"; { [ -f bun.lockb ] || [ -f bun.lock ]; } && i="bun install"; c="${c:+$c && }$i"; fi',
  '[ -n "$c" ] && echo "$c"',
].join("\n");
const ADDRESS = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::\d+)?[^\s"'<>)\]]*/g;
export const tryAddress = screen => String(screen ?? "").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").match(ADDRESS)?.at(-1)?.replace("0.0.0.0", "localhost").replace(/[.,]$/, "") ?? null;
// Whether the repository already tells agents how to run and show it.
const DEMO_SKILL = 'ls .claude/skills/*/SKILL.md .agents/skills/*/SKILL.md 2>/dev/null | grep -qiE "/(demo|run|preview|screenshots?|try)[^/]*/SKILL.md" || grep -qiE "screenshot" AGENTS.md CLAUDE.md 2>/dev/null';
const DEMO_TITLE = "Write a skill that tells agents how to run and show this project";
loadProcedures(path => readTextFile(`${appHome()}/${path}`)).catch(() => null);
const GITHUB = "git remote get-url origin 2>/dev/null | grep -q github.com && command -v gh >/dev/null";
// Ctrl-C stops the command but not the tab, which drops into the person's shell in the worktree.
const TICKET_NAMES = "git log -300 --format='%s %D' 2>/dev/null; git branch -a --format='%(refname:short)' 2>/dev/null";
// Prints a folder's repository root, with ~ expanded on the machine the project is on; exit 3 means no such folder.
const TOPLEVEL = 'p=$1; case $p in "~") p=$HOME;; "~/"*) p=$HOME/${p#"~/"};; esac; cd -- "$p" 2>/dev/null || exit 3; git rev-parse --show-toplevel';
// Where a task's own work begins: its start commit, or after a rebase the newer commit it now shares with its target branch.
const IMAGE = /\.(png|jpe?g|gif|webp)$/i;
const IMAGE_DIR = 'd=$1; [ -n "$d" ] || { mkdir -p "$3" && d=$(mktemp -d "$3/XXXXXX"); } || exit 1; ';
const IMAGE_COPY = IMAGE_DIR + 'cp -- "$2" "$d/" && printf "%s/%s" "$d" "$(basename -- "$2")"';
const IMAGE_PASTE = IMAGE_DIR + 'f="$d/pasted-$(date +%H%M%S).png"; osascript -e "on run argv" -e "set f to open for access POSIX file (item 1 of argv) with write permission" '
  + '-e "write (the clipboard as «class PNGf») to f" -e "close access f" -e "end run" "$f" >/dev/null 2>&1 || { rm -f "$f"; exit 4; }; printf "%s" "$f"';
const conflicted = task => task.status === "review" && task.error && task.terminal && !task.discard && /rebase|conflict/i.test(task.error);
const uncommitted = task => task.status === "review" && !task.discard && /task's worktree has uncommitted changes/.test(task.error ?? "");
const FORK = 'cd -- "$1" || exit 1; fork=$(git merge-base HEAD "$3" 2>/dev/null); if [ -n "$fork" ] && git merge-base --is-ancestor "$2" "$fork" 2>/dev/null; then echo "$fork"; else echo "$2"; fi';
const plannerBusy = state => plannerHolds(state) && state.planning?.status !== "failed";
const MODEL_CHIPS = 12, MODEL_LIST = 300;
const DRAWERS = ["picker", "queue", "review", "prs", "done", "activity", "settings", "watch", "quota", "plane", "linear", "schedule", "planner", "outside"];
const SECTIONS = {
  live: { agent: "Agent", implementer: "Implementer", limits: "Usage limits", planner: "AI helper", repositories: "Repositories", checks: "Checks and Try it", delivery: "Delivery", tickets: "Ticket updates", general: "General" },
  simulation: { pipeline: "Pipeline", simulation: "Simulation", general: "General" },
};
const SCOPES = { mine: "My tickets", unassigned: "Unassigned", all: "All tickets" };
const filterLabel = filter => [SCOPES[filter.scope], filter.team?.name, filter.project?.name].filter(Boolean).join(" · ");
const icon = (name, size = 15) => svg(`mods/pipeline/${name}.svg`).size(size).flex_none();
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const stamp = at => { const d = new Date(at), two = n => String(n).padStart(2, "0"); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${two(d.getHours())}:${two(d.getMinutes())}`; };
const dot = (color, size = 6) => div().size(size).rounded(size / 2).bg(color).flex_none();
const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const choices = question => (question?.options ?? []).filter((_, i) => i !== question.typed);
const stateColor = (task, t) => ["failed", "input"].includes(task.status) ? t.blocked : task.status === "done" ? (task.reverted ? t.muted : t.ansi2)
  : task.status === "pr" ? t.ansi4 : ["review", "merging"].includes(task.status) ? t.ansi5 : ACTIVE.includes(task.status) ? t.accent : t.muted;
const toneColor = (tone, t) => ({ blocked: t.blocked, ready: t.ansi2 })[tone] ?? t.muted;
function cardStatus(state, task) {
  if (task.discard) return "Discarding…";
  if (state.live && task.status === "review" && !needsApproval(task) && !task.discard) return state.delivery === "pr" ? "Approved · PR next" : "Approved · merging next";
  if (state.live && task.status === "review" && task.unchanged && !task.error) return "No file changes";
  if (state.live && task.status === "review") return task.error ? "Not merged · see why" : task.checked === "passed" ? "Checks passed" : task.checked === "failed" ? "Checks failing" : "Ready for review";
  if (state.live && task.status === "failed" && task.reason === "checks") return "Checks failed";
  if (state.live && task.status === "pr") return [task.agentState !== "gone" && prAgent(task), prNeeds(task, state).label].filter(Boolean).join(" · ");
  if (state.live && task.status === "merging" && task.unchanged) return "Closing";
  if (state.live && task.status === "done" && task.unchanged) return "Done · no changes";
  if (state.live && task.status === "merging" && state.delivery === "pr") return task.repos.length > 1 ? "Opening PRs" : "Opening PR";
  if (state.live && task.status === "done" && (task.revert || task.reverted)) return task.revert ? "Reverting…" : "Reverted";
  if (state.live && task.status === "done" && afterFailed(state).some(entry => entry.task === task.id)) return "Merged · after-merge failed";
  const pushed = state.live && task.status === "done" && pushNote(task);
  if (pushed) return `Merged${task.repos.length < 2 && task.target ? ` into ${task.target}` : ""} · ${pushed.text}`;
  if (state.live && adoptStep(task)) return adoptStep(task);
  if (state.live && ["merging", "failed", "done", "routing"].includes(task.status)) return labelFor(state, task.status);
  if (task.status === "queued") {
    const waits = dependencies(state, task);
    if (waits.length) return `Needs ${waits.join(", ")}`;
    if (waitingReason(state, task).startsWith("Held by")) return "Held by usage limit";
    return { "Waiting for the planner": "Waiting for the planner", "Ready for the planner": "Next up", "Waiting for a work slot": "Waiting for a slot", "Waiting for quota above the reserve": "Held by quota reserve", "Outstanding PR limit reached": "Held by PR limit" }[waitingReason(state, task)] ?? (task.rank ? "Queued · starts first" : "Queued");
  }
  if (task.status === "input") return "Needs you";
  if (state.live && task.stalled) return `No output for ${elapsed(Date.now() - task.stalled)}`;
  if (ACTIVE.includes(task.status)) return `${labelFor(state, task.status)} · ${state.live && timing(task) ? timing(task) : `slot ${task.slot + 1}`}`;
  if (needsApproval(task)) {
    const left = task.repos.filter(repo => !task.approvals.includes(repo)).length;
    return left === task.repos.length ? count(left, "PR") + " ready" : `${left} of ${task.repos.length} left`;
  }
  if (task.status === "review") return task.delivery === "direct" ? "Checks passed · merging next" : "Approved · next to merge";
  return LABELS[task.status];
}

export default class Pipeline extends View {
  init(_p, cx) {
    this.context = props()?.context ?? { id: "example", name: "Example project", cwd: "", on: null };
    this.id = this.context.id;
    this.drawer = null; this.selected = null; this.picked = new Set();
    this.size = { width: 1200, height: 780 };
    this.bars = new Map(); this.seen = new Set(); this.kicking = false;
    this.handle = cx.focus_handle(); this.handle.focus();
    this.search = InputState.new({ placeholder: "Search example tasks or repositories…" });
    this.search.on("change", (_e, cx) => cx.notify());
    this.ticketSearch = InputState.new({ placeholder: "Search tickets…" });
    this.ticketSearch.on("change", (_e, cx) => cx.notify());
    this.projectSearch = InputState.new({ placeholder: "Find a Linear project…" });
    this.projectSearch.on("submit", (_e, cx) => this.loadProjects(cx));
    this.teamSearch = InputState.new({ placeholder: "Find a Linear team…" });
    this.teamSearch.on("submit", (_e, cx) => this.loadTeams(cx));
    this.title = InputState.new({ placeholder: "New task: type a title and press Enter" });
    this.title.on("change", (_e, cx) => cx.notify());
    this.title.on("submit", (_e, cx) => this.create(cx));
    this.reply = InputState.new({ placeholder: "Or type your own answer" });
    this.reply.on("change", (_e, cx) => cx.notify());
    this.reply.on("submit", (_e, cx) => this.answer(this.selected, this.reply.value(), cx, true));
    this.follow = InputState.new({ placeholder: "What should change?" });
    this.follow.on("change", (_e, cx) => cx.notify());
    this.follow.on("submit", (_e, cx) => this.followUp(this.state()?.tasks.find(task => task.id === this.selected), cx));
    this.message = InputState.new({ placeholder: "Message the agent" });
    this.message.on("change", (_e, cx) => cx.notify());
    this.message.on("submit", (_e, cx) => this.send(this.state()?.tasks.find(task => task.id === this.selected), cx));
    this.checkInput = InputState.new({ placeholder: "No checks. For example: npm test" });
    this.checkInput.on("submit", (_e, cx) => this.saveCheck(cx));
    this.checkInput.on("blur", (_e, cx) => this.saveCheck(cx));
    this.checkInput.on("change", (_e, cx) => cx.notify());
    this.checkSuggestions = [];
    this.tryInput = InputState.new({ placeholder: "Nothing to run. For example: npm run dev" });
    this.tryInput.on("submit", (_e, cx) => this.saveTry(cx));
    this.tryInput.on("blur", (_e, cx) => this.saveTry(cx));
    this.tryInput.on("change", (_e, cx) => cx.notify());
    this.trySuggestions = [];
    this.afterInput = InputState.new({ placeholder: "Nothing. For example: ./install.sh" });
    this.afterInput.on("submit", (_e, cx) => this.saveAfter(cx));
    this.afterInput.on("blur", (_e, cx) => this.saveAfter(cx));
    this.afterInput.on("change", (_e, cx) => cx.notify());
    this.afterSuggestions = [];
    this.times = {};
    for (const [kind, placeholder] of [["start", "Not scheduled. For example: 22:00"], ["pause", "Not scheduled. For example: 7:00"]]) {
      const input = this.times[kind] = InputState.new({ placeholder });
      input.on("submit", (_e, cx) => this.saveTime(kind, cx));
      input.on("blur", (_e, cx) => this.saveTime(kind, cx));
      input.on("change", (_e, cx) => cx.notify());
    }
    this.timeError = null;
    this.modelInput = InputState.new({ placeholder: "Find a model, or type its name" });
    this.modelInput.on("submit", (_e, cx) => this.saveModel(cx));
    this.modelInput.on("change", (_e, cx) => cx.notify());
    this.plannerModelInput = InputState.new({ placeholder: "Find a model, or type its name" });
    this.plannerModelInput.on("submit", (_e, cx) => this.savePlannerModel(cx));
    this.plannerModelInput.on("change", (_e, cx) => cx.notify());
    this.implementerModelInput = InputState.new({ placeholder: "Find a model, or type its name" });
    this.implementerModelInput.on("submit", (_e, cx) => this.saveImplementerModel(cx));
    this.implementerModelInput.on("change", (_e, cx) => cx.notify());
    this.taskModelInput = InputState.new({ placeholder: "Find a model, or type its name" });
    this.taskModelInput.on("submit", (_e, cx) => this.saveTaskModel(cx));
    this.taskModelInput.on("change", (_e, cx) => cx.notify());
    this.repoInput = InputState.new({ placeholder: "Path to another repository, e.g. ~/code/api" });
    this.repoInput.on("submit", (_e, cx) => this.addRepository(cx));
    this.repoInput.on("change", (_e, cx) => { this.repoError = null; cx.notify(); });
    this.repoError = null; this.repoAdding = false;
    this.details = TextareaState.new({ placeholder: "Context, constraints, how to check it…", rows: 4 });
    this.instructions = TextareaState.new({ placeholder: "Answer in Swedish in pull requests. Never touch the migrations folder…", rows: 4 });
    this.instructions.on("change", (_e, cx) => cx.notify());
    this.prepareInput = InputState.new({ placeholder: 'cp "$PIPELINE_SOURCE/.env" . && npm ci' });
    this.prepareInput.on("change", (_e, cx) => cx.notify());
    this.prepareInput.on("submit", (_e, cx) => this.savePrepare(cx));
    this.teamGuess = null; this.asked = null; this.prepareSuggestions = []; this.demoSkill = null; this.linearWrite = null;
    this.details.on("blur", (_e, cx) => this.saveDetails(cx));
    this.mode = this.context.cwd && localStorage.getItem("mode") !== "simulation" ? "live" : "simulation";
    this.confirm = null; this.peek = { key: null, screen: [], diff: [] }; this.sent = null;
    this.repo = null; this.agentChoices = []; this.codexModels = []; this.opencodeModels = []; this.github = false; this.deciding = null;
    this.sources = Object.fromEntries(Object.keys(SOURCES).map(provider => [provider, { loading: false, issues: [], states: [], error: null, kind: null, needsProject: false }]));
    this.ticketPicked = new Set(); this.ticketRequests = {}; this.queueing = false;
    this.updateStates = Object.fromEntries(Object.keys(SOURCES).map(provider => [provider, { loading: false, states: [], error: null }]));
    this.linearFilter = { scope: "mine", team: null, project: null };
    try { this.linearFilter = { ...this.linearFilter, ...JSON.parse(localStorage.getItem(`linear:${this.id}`) ?? "{}") }; } catch (_) { /* A damaged filter falls back to My tickets. */ }
    this.projects = null; this.teams = null;
    this.motion = localStorage.getItem("motion") !== "false";
    this.layout = localStorage.getItem("layout") === "board" ? "board" : "map";
    this.reducedMotion = false;
    const all = shared(STORE) ?? {}, saved = all[this.id];
    if (saved?.version !== VERSION && !newer(saved)) setShared(STORE, { ...all, [this.id]: saved ? migrate(saved) : createPipeline(this.context) });
    if (this.mode === "live") this.enterLive(cx);
    if (appWindow()?.platform === "macos") cx.spawn(async cx => {
      try {
        const result = await exec("defaults", ["read", "com.apple.universalaccess", "reduceMotion"]);
        this.reducedMotion = result.code === 0 && result.stdout.trim() === "1"; cx.notify();
      } catch (_) { /* Motion stays under the local toggle when the preference can't be read. */ }
    });
    cx.timer.every(60000, cx => { if (this.state()?.live && activeTasks(this.state()).length) cx.notify(); });
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand(), state = this.state();
        if (!state) continue;
        if (command === "focus") this.handle.focus();
        else if ((command === "start" && !state.running) || (command === "pause" && state.running)) this.toggleRun(cx);
        else if (command === "new") { this.title.focus(); cx.notify(); }
        else if (command === "approve") this.act({ type: "approveAll" }, cx);
        else if (command === "retry") this.act({ type: "retry" }, cx);
        else if (command === "answer") this.nextQuestion(cx);
        else if (command === "live" || command === "simulation") this.setMode(command, cx);
        else if (DRAWERS.includes(command)) this.open(command, cx);
        else if (command === "close") this.open(null, cx);
        else if (command.startsWith("task-") && state.tasks.some(task => task.id === command.slice(5))) this.inspect(command.slice(5), cx);
      }
    });
  }

  close() { this.search.release(); this.title.release(); this.reply.release(); this.message.release(); this.details.release(); this.ticketSearch.release(); this.projectSearch.release(); this.teamSearch.release(); this.plannerModelInput.release(); this.implementerModelInput.release(); this.taskModelInput.release(); this.checkInput.release(); this.tryInput.release(); this.afterInput.release(); this.modelInput.release(); this.times.start.release(); this.times.pause.release(); this.repoInput.release(); this.instructions.release(); this.prepareInput.release(); this.handle.release(); }
  storeKey() { return this.mode === "live" ? LIVE + this.id : this.id; }
  state() { return shared(STORE)?.[this.storeKey()]; }
  // A log of what was pressed, kept on this computer only, to see later which parts of Pipeline are used. No titles or text go in it.
  track(name, detail = {}) {
    if (shared("features")?.usageLog === false) return;
    const line = JSON.stringify({ at: Date.now(), pipeline: this.storeKey(), name, ...detail });
    Promise.resolve(exec("sh", ["-c", 'mkdir -p "$1" && printf "%s\\n" "$2" >> "$1/usage.jsonl"', "sh", `${appHome()}/pipeline`, line])).catch(() => {});
  }
  act(action, cx) {
    const all = shared(STORE) ?? {}, key = this.storeKey(), state = all[key];
    if (!state) return;
    const on = action.id && state.tasks?.find(task => task.id === action.id);
    this.track(action.type, { ...(on ? { task: on.id, status: on.status } : {}), ...(typeof action.value === "boolean" || typeof action.value === "string" && action.value.length < 24 ? { value: action.value } : {}) });
    const next = reduce(state, action);
    if (next !== state) setShared(STORE, shareSettings({ ...all, [key]: next }, key, state, next));
    cx.notify();
  }
  toggleRun(cx) { this.act({ type: "run", space: this.context.space ?? focused()?.space ?? null }, cx); }
  trust(task, cx) {
    if (!task?.terminal) return;
    cx.spawn(async cx => {
      const screen = await hc(["read", task.terminal, "--lines", "40"]).catch(() => null);
      const keys = screen?.code === 0 ? trustKeys(screen.stdout) : null;
      const sent = keys && await hc(["keys", task.terminal, ...keys]).then(result => result.code === 0, () => false);
      if (sent) this.act({ type: "trusted", id: task.id, manual: true }, cx); else { this.focusAgent(task); cx.notify(); }
    });
  }
  setMode(mode, cx) {
    if (mode === this.mode || (mode === "live" && !this.context.cwd)) return;
    this.mode = mode; this.drawer = null; this.selected = null; this.confirm = null;
    localStorage.setItem("mode", mode);
    if (mode === "live") this.enterLive(cx);
    this.handle.focus(); cx.notify();
  }
  enterLive(cx) {
    const all = shared(STORE) ?? {}, key = LIVE + this.id, saved = all[key];
    if (!saved) setShared(STORE, { ...all, [key]: inheritSettings(all, createLive(this.context)) });
    else if (saved.version !== VERSION && !newer(saved)) setShared(STORE, { ...all, [key]: migrate(saved) });
    else if (!saved.space && this.context.space && !newer(saved)) setShared(STORE, { ...all, [key]: { ...saved, space: this.context.space } });
    const now = shared(STORE) ?? {}, adopted = adoptSettings(now, now[key]);
    if (adopted !== now[key]) setShared(STORE, { ...now, [key]: adopted });
    const kept = this.state()?.linear;
    if (kept) this.linearFilter = { ...this.linearFilter, team: kept.team ?? null, project: kept.project ?? null };
    const { cwd, on } = this.context;
    cx.spawn(async cx => {
      try {
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
        const branch = await exec("git", ["symbolic-ref", "--short", "HEAD"], { cwd, on });
        this.repo = top.code === 0 ? { root: top.stdout.trim(), branch: branch.code === 0 ? branch.stdout.trim() : null }
          : { error: "This folder isn't in a Git repository, so Live can't give agents their own worktrees." };
      } catch { this.repo = { error: "Git couldn't be run for this folder." }; }
      try { this.agentChoices = (await knownAgents({ on })).filter(agent => agent.installed); } catch { this.agentChoices = []; }
      if (this.agentChoices.some(agent => agent.key === "codex")) {
        const cache = await exec("sh", ["-c", 'cat "${CODEX_HOME:-$HOME/.codex}/models_cache.json"'], { on }).catch(() => null);
        this.codexModels = cache?.code === 0 ? codexModels(cache.stdout) : [];
      }
      if (this.agentChoices.some(agent => agent.key === "opencode")) {
        const [list, providers] = await Promise.all(["model", "provider"].map(what => exec("sh", ["-c", `opencode api GET /api/${what}`], { on }).catch(() => null)));
        this.opencodeModels = list?.code === 0 ? opencodeModels(list.stdout, providers?.code === 0 ? providers.stdout : "") : [];
      }
      if (this.repo?.root) {
        const found = await exec("sh", ["-c", CHECK_HINTS], { cwd: this.repo.root, on }).catch(() => null);
        this.checkSuggestions = (found?.stdout ?? "").split("\n").map(line => line.trim()).filter(Boolean).slice(0, 3);
        const runs = await exec("sh", ["-c", TRY_HINTS], { cwd: this.repo.root, on }).catch(() => null);
        this.trySuggestions = (runs?.stdout ?? "").split("\n").map(line => line.trim()).filter(Boolean).slice(0, 3);
        const after = await exec("sh", ["-c", AFTER_HINTS], { cwd: this.repo.root, on }).catch(() => null);
        this.afterSuggestions = (after?.stdout ?? "").split("\n").map(line => line.trim()).filter(Boolean).slice(0, 3);
        const prepares = await exec("sh", ["-c", PREPARE_HINTS], { cwd: this.repo.root, on }).catch(() => null);
        this.prepareSuggestions = (prepares?.stdout ?? "").split("\n").map(line => line.trim()).filter(Boolean).slice(0, 1);
        const demo = await exec("sh", ["-c", DEMO_SKILL], { cwd: this.repo.root, on }).catch(() => null);
        this.demoSkill = demo ? demo.code === 0 : null;
        const hub = await exec("sh", ["-c", GITHUB], { cwd: this.repo.root, on }).catch(() => null);
        this.github = hub?.code === 0;
        if (this.github && this.state()?.setup) {
          const merged = await exec("gh", ["pr", "list", "--state", "merged", "--limit", "20", "--json", "reviewDecision,author"], { cwd: this.repo.root, on, timeout: 20000 }).catch(() => null);
          try { this.flowGuess = merged?.code === 0 ? guessFlow(JSON.parse(merged.stdout)) : null; } catch { this.flowGuess = null; }
        }
      }
      this.loadUpdateStates(cx);
      if (this.repo?.root && this.state()?.setup && !this.state()?.linear?.team) try {
        const names = await exec("sh", ["-c", TICKET_NAMES], { cwd: this.repo.root, on });
        const prefix = ticketPrefix(names.stdout), folder = String(this.state().repo ?? "").toLowerCase();
        const teams = (await readTickets("linear", { op: "teams" })).teams ?? [];
        const team = teams.find(row => prefix && String(row.key).toUpperCase() === prefix) ?? teams.find(row => String(row.name).toLowerCase() === folder);
        this.teamGuess = team ? { id: team.uuid || team.id, name: team.name } : null;
      } catch { /* Without Linear connected there is no team to offer. */ }
      cx.notify();
    });
  }
  agentName(state) { return state.agent?.name ?? this.agentChoices[0]?.name ?? "Agent"; }
  agentKey(state) { return state.agent ? state.agent.key : this.agentChoices[0]?.key ?? null; }
  listedModels(key) {
    return key === "codex" ? this.codexModels : key === "opencode" ? this.opencodeModels
      : (AGENT_OPTIONS[key]?.models ?? []).map(slug => ({ slug, name: slug, hint: `The latest ${slug} model`, efforts: AGENT_OPTIONS[key].efforts }));
  }
  agentLabel(state) {
    const tuning = tuningLabel(tuningFor(state, this.agentKey(state)));
    return tuning ? `${this.agentName(state)} · ${tuning}` : this.agentName(state);
  }
  focusAgent(task) {
    if (!task?.terminal) return;
    try {
      if (task.space) run("space.select", { id: task.space });
      if (task.tab) run("tab.select", { id: task.tab });
      run("pane.focus", { terminal: task.terminal });
    } catch { /* Its space may have closed; the card will follow the agent's status. */ }
  }
  send(task, cx) {
    const text = this.message.value().trim();
    if (!text || !task?.terminal) return;
    this.message.set_value("");
    this.sent = { id: task.id, pending: true };
    cx.spawn(async cx => {
      const result = await hc(["send", ...(task.status === "input" ? ["--force"] : []), task.terminal, text]).catch(error => ({ code: 1, stderr: String(error) }));
      this.sent = result.code === 0 ? { id: task.id, ok: true } : { id: task.id, error: result.stderr?.trim() || "The agent couldn't be reached." };
      cx.notify();
    });
    cx.notify();
  }
  liveQuestion(task) {
    return task?.status === "input" && this.peek.task === task.id ? this.peek.question : null;
  }
  answerAgent(task, value, typed, cx) {
    if (!task.terminal) return;
    this.reply.set_value("");
    this.sent = { id: task.id, pending: true };
    cx.spawn(async cx => {
      const failed = error => ({ code: 1, stderr: String(error) });
      const screen = await hc(["read", task.terminal, "--lines", "60"]).catch(failed);
      const keys = screen.code === 0 ? (typed ? replyKeys(screen.stdout) : answerKeys(screen.stdout, value)) : null;
      let result = keys ? keys.length ? await hc(["keys", task.terminal, ...keys]).catch(failed) : { code: 0 }
        : { code: 1, stderr: "Its question changed. Read it again below." };
      if (typed && result.code === 0) result = await hc(["send", "--force", task.terminal, value]).catch(failed);
      this.sent = result.code === 0 ? { id: task.id, ok: true, answer: value } : { id: task.id, error: result.stderr?.trim() || "The agent couldn't be reached." };
      this.peek = { ...this.peek, question: null };
      cx.notify();
      await cx.sleep(800);
      this.peek = { ...this.peek, key: null };
      cx.notify();
    });
    cx.notify();
  }
  saveDetails(cx) {
    const task = this.state()?.tasks.find(task => task.id === this.detailsFor);
    if (task && this.details.value() !== (task.description ?? "")) this.act({ type: "describe", id: task.id, text: this.details.value() }, cx);
  }
  peekAt(task, cx) {
    const trees = workspacesOf(task), key = `${task.id}:${task.status}:${task.terminal}:${task.tried ?? ""}:${trees.map(ws => ws.root).join(",")}`;
    if (this.peek.key === key) return;
    this.peek = this.peek.task === task.id ? { ...this.peek, key } : { key, task: task.id, screen: [], diff: [] };
    const { on } = this.context;
    cx.spawn(async cx => {
      const peek = { key, task: task.id, screen: [], diff: [], question: null };
      if (task.terminal && ["input", "working", "review", "pr"].includes(task.status)) {
        const screen = await hc(["read", task.terminal, "--lines", "60"]).catch(() => null);
        if (task.status === "input" && task.reason !== "trust" && screen?.code === 0) peek.question = screenQuestion(screen.stdout);
        const lines = screen?.code === 0 ? screen.stdout.split("\n").map(line => line.trimEnd()) : [];
        while (lines.length && !lines.at(-1)) lines.pop();
        peek.screen = lines.slice(-14);
        while (peek.screen.length && !peek.screen[0]) peek.screen.shift();
      }
      const trying = task.tried && panes().find(pane => pane.tab === task.tried)?.terminal;
      if (trying) peek.address = tryAddress((await hc(["read", trying, "--lines", "80"]).catch(() => null))?.stdout);
      if (!["queued", "routing", "done"].includes(task.status)) for (const ws of trees) {
        const git = args => exec("git", ["-C", ws.root, ...args], { on }).catch(() => null);
        const forked = await exec("sh", ["-c", FORK, "sh", ws.root, ws.base, ws.target ?? ""], { on }).catch(() => null);
        const base = forked?.code === 0 && forked.stdout.trim() ? forked.stdout.trim() : ws.base;
        const names = await git(["diff", base, "--name-status", "-z", "--no-renames"]), stats = await git(["diff", base, "--numstat", "-z", "--no-renames"]);
        const status = await git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
        peek.diff.push({ name: ws.name, root: ws.root, base, files: changedFiles(names?.stdout, stats?.stdout, status?.stdout) });
      }
      if (this.peek.key === key) { this.peek = peek; cx.notify(); }
    });
  }
  viewChanges(repo, index = 0) {
    if (!repo?.files.length) return;
    openOverlay({ mod: "changes-modal", kind: "dialog", width: 0.9, height: 0.9,
      props: { root: repo.root, on: this.context.on ?? null, hasHead: true, base: repo.base, files: repo.files, index } });
  }
  askPr(task, pr, target, kind, cx) {
    cx.spawn(async cx => {
      const sent = await hc(["send", task.terminal, prRequest(kind, pr, target)]).then(result => result.code === 0, () => false);
      if (sent) { this.prAsked = `${task.id}/${kind}`; if (kind === "rebase") this.act({ type: "rebaseAsked", id: task.id }, cx); } else this.focusAgent(task);
      this.track("prAsk", { task: task.id, kind });
      cx.notify();
    });
  }
  resolve(task, cx, ask = "rebase") {
    if (!task?.terminal || !task.error) return;
    const target = targetOf(task) ?? this.repo?.branch ?? "your branch";
    cx.spawn(async cx => {
      const sent = await hc(["send", task.terminal, ask === "commit" ? commitRequest() : rebaseRequest(target, task.error)]).then(result => result.code === 0, () => false);
      if (sent) this.act({ type: "resolving", id: task.id, ask }, cx); else { this.focusAgent(task); cx.notify(); }
    });
  }
  step(delta, cx) {
    const state = this.state();
    if (!state) return;
    const order = [...queueOrder(state), ...activeTasks(state).sort((a, b) => a.slot - b.slot),
      ...state.tasks.filter(task => ["review", "merging", "failed"].includes(task.status)), ...state.tasks.filter(task => task.status === "pr")];
    if (!order.length) return;
    const at = this.drawer === "task" ? order.findIndex(task => task.id === this.selected) : -1;
    this.inspect(order[at < 0 ? (delta > 0 ? 0 : order.length - 1) : (at + delta + order.length) % order.length].id, cx);
  }
  addRepository(cx) {
    const path = this.repoInput.value().trim();
    if (!path || !this.state()?.live || this.repoAdding) return;
    this.repoAdding = true; this.repoError = null;
    cx.spawn(async cx => {
      try {
        const result = await exec("sh", ["-c", TOPLEVEL, "sh", path], { cwd: this.context.cwd, on: this.context.on });
        const top = result.code === 0 ? result.stdout.trim() : "";
        const known = [this.repo?.root, ...(this.state()?.repositories ?? []).map(repo => repo.path)];
        if (!top) this.repoError = result.code === 3 ? `There's no folder at ${path} on ${this.context.on ? "the project's machine" : "this computer"}.` : `${path} isn't in a Git repository.`;
        else if (known.includes(top)) this.repoError = `${top} is already one of the repositories.`;
        else { this.act({ type: "addRepository", path: top }, cx); this.repoInput.set_value(""); }
      } catch (error) { this.repoError = error?.message || String(error); }
      finally { this.repoAdding = false; cx.notify(); }
    });
    cx.notify();
  }
  saveCheck(cx) {
    const state = this.state();
    if (!state?.live || this.checkInput.value().trim() === (state.check?.command ?? "")) return;
    this.act({ type: "check", command: this.checkInput.value() }, cx);
  }
  saveTry(cx) {
    const state = this.state();
    if (!state?.live || this.tryInput.value().trim() === (state.tryout ?? "")) return;
    this.act({ type: "tryout", command: this.tryInput.value() }, cx);
  }
  saveAfter(cx) {
    const state = this.state();
    if (!state?.live || this.afterInput.value().trim() === (state.afterMerge ?? "")) return;
    this.act({ type: "afterMerge", command: this.afterInput.value() }, cx);
  }
  tryTask(task, cx) {
    const command = this.state()?.tryout, ws = task && workspacesOf(task)[0];
    if (!command || !ws || task.discard) return;
    const open = task.tried && spaces().find(space => space.tabs.some(tab => tab.id === task.tried));
    if (open) {
      try { run("space.select", { id: open.id }); run("tab.select", { id: task.tried }); } catch { /* It closed meanwhile. */ }
      return;
    }
    cx.spawn(async cx => {
      const tab = await openTry({ run, panes, spaces, focused }, this.context, task, ws, command, cx);
      if (tab) this.act({ type: "tried", id: task.id, tab }, cx);
    });
  }
  savePrepare(cx) {
    const state = this.state();
    if (!state?.live || this.prepareInput.value().trim() === (state.prepare ?? "")) return;
    this.act({ type: "prepare", command: this.prepareInput.value() }, cx);
  }
  saveInstructions(cx) {
    if (this.state()?.live) this.act({ type: "instructions", text: this.instructions.value() }, cx);
  }
  // Removes a saved pipeline that has nothing left to finish. Its agents, worktrees and pull requests are already gone.
  forget(key, cx) {
    const all = { ...(shared(STORE) ?? {}) };
    if (!forgettable(all[key])) return;
    delete all[key];
    const plain = key.slice(LIVE.length);
    if (all[plain] && !all[plain].live && plain !== this.id) delete all[plain];
    setShared(STORE, all);
    this.confirm = null; cx.notify();
  }
  resetProject(cx) {
    const all = { ...(shared(STORE) ?? {}) }, key = this.storeKey();
    for (const [other, state] of [[key, all[key]], ...projectPipelines(all, key)]) all[other] = resetSettings(state);
    setShared(STORE, all);
    try { localStorage.removeItem(`linear:${this.id}`); } catch (_) { /* Nothing was saved. */ }
    this.linearFilter = { scope: "mine", team: null, project: null };
    this.confirm = null; this.open(null, cx);
  }
  askEvidence(task, cx) {
    const state = this.state(), ws = task && workspacesOf(task)[0];
    if (!task?.terminal || !ws) return;
    const request = evidenceRequest(task, ws, { tryout: state.tryout ?? null, port: taskPort(task) });
    this.asked = { id: task.id, pending: true }; cx.notify();
    cx.spawn(async cx => {
      const sent = await hc(["send", task.terminal, request]).then(result => result.code === 0, () => false);
      this.asked = { id: task.id, sent };
      if (!sent) this.focusAgent(task);
      cx.notify();
    });
  }
  queueDemoSkill(cx) {
    const id = `T-${(this.state().created ?? 0) + 1}`, text = procedure("demo-task");
    this.act({ type: "create", title: DEMO_TITLE }, cx);
    this.act({ type: "describe", id, text }, cx);
  }
  showEvidence(task, file) {
    exec("herdr-show", [file, "--title", `${task.id} · ${file.split("/").pop().replace(/\.[a-z]+$/i, "")}`]).catch(() => null);
  }
  useUpdates(provider, guess, cx) {
    this.act({ type: "ticketUpdates", provider, ...guess, link: true }, cx);
    if (provider === "linear") this.loadUpdateStates(cx);
  }

  saveTime(kind, cx) {
    const state = this.state(), text = this.times[kind].value().trim();
    if (!state || text === (state.schedule?.[kind] ?? "")) return;
    const time = text ? parseTime(text) : null;
    this.timeError = text && !time ? { kind, text: "Use a time like 22:00, 7:30 or 9pm." }
      : time && time === state.schedule?.[kind === "start" ? "pause" : "start"] ? { kind, text: "Start and pause need different times." } : null;
    if (this.timeError) { cx.notify(); return; }
    this.times[kind].set_value(time ?? "");
    this.act({ type: "schedule", [kind]: time, space: this.context.space ?? focused()?.space ?? null }, cx);
  }
  saveModel(cx) {
    const state = this.state(), key = this.agentKey(state ?? {});
    if (state?.live && AGENT_OPTIONS[key]) this.saveTyped(key, tuningFor(state, key), this.modelInput, (change, cx) => this.act({ type: "tune", key, ...change }, cx), cx);
  }
  savePlannerModel(cx) {
    const state = this.state();
    if (state?.live) this.saveTyped(plannerAgent(state), plannerTuning(state), this.plannerModelInput, (change, cx) => this.act({ type: "plannerSetup", ...change }, cx), cx);
  }
  saveImplementerModel(cx) {
    const state = this.state();
    if (state?.live) this.saveTyped(implementerAgent(state), implementerTuning(state), this.implementerModelInput, (change, cx) => this.act({ type: "implementerSetup", ...change }, cx), cx);
  }
  saveTaskModel(cx) {
    const state = this.state(), key = this.agentKey(state ?? {}), task = state?.tasks.find(task => task.id === this.detailsFor);
    if (state?.live && AGENT_OPTIONS[key] && task) this.saveTyped(key, { model: task.tune?.model ?? null, effort: task.tune?.effort ?? null }, this.taskModelInput,
      (change, cx) => this.act({ type: "tuneTask", id: task.id, key, ...change }, cx), cx);
  }
  saveTyped(key, tune, input, set, cx) {
    const typed = input.value().trim(), match = typed ? this.modelMatches(key, tune, input)[0] : null;
    if (typed === (tune.model ?? "")) return;
    set(match ? this.modelChange(key, tune, match) : { model: typed }, cx);
    if (match) input.set_value(match.slug);
  }
  modelMatches(key, tune, input) {
    const typed = input.value().trim().toLowerCase(), words = typed === (tune.model ?? "").toLowerCase() ? [] : typed.split(/\s+/).filter(Boolean);
    return this.listedModels(key).filter(model => words.every(word => `${model.slug} ${model.name} ${model.group ?? ""} ${model.free ? "free" : ""}`.toLowerCase().includes(word)));
  }
  modelChange(key, tune, model) {
    return { model: model.slug, ...(tune.effort && (model.efforts.length || AGENT_OPTIONS[key].exact) && !model.efforts.includes(tune.effort) ? { effort: null } : {}) };
  }
  fix(task, cx) {
    const state = this.state();
    if (!task?.terminal || !state?.check?.command) return;
    cx.spawn(async cx => {
      const sent = await hc(["send", task.terminal, fixRequest(state.check.command, task.checkOutput ?? "")]).then(result => result.code === 0, () => false);
      if (sent) this.act({ type: "fixing", id: task.id }, cx); else { this.focusAgent(task); cx.notify(); }
    });
  }
  open(drawer, cx, section) {
    if (drawer) this.track("open", { drawer, ...(section ? { section } : {}) });
    if (section) this.section = section;
    if (drawer === "settings" && this.state()?.live) {
      this.checkInput.set_value(this.state().check?.command ?? "");
      this.tryInput.set_value(this.state().tryout ?? "");
      this.afterInput.set_value(this.state().afterMerge ?? "");
      this.prepareInput.set_value(this.state().prepare ?? "");
      this.instructions.set_value(this.state().instructions ?? "");
      this.modelInput.set_value(tuningFor(this.state(), this.agentKey(this.state())).model ?? "");
      this.plannerModelInput.set_value(this.state().planner?.model ?? "");
      this.implementerModelInput.set_value(this.state().implementer?.model ?? "");
      if (drawer !== this.drawer) this.loadUpdateStates(cx);
    }
    if (SOURCES[drawer] && !this.state()?.live) return;
    if (drawer === "schedule") { this.timeError = null; for (const kind of ["start", "pause"]) this.times[kind].set_value(this.state()?.schedule?.[kind] ?? ""); }
    if (drawer !== this.drawer && drawer === "picker") this.search.set_value("");
    if (SOURCES[drawer]) localStorage.setItem(`tickets:${this.id}`, drawer);
    if (drawer !== this.drawer && SOURCES[drawer]) { this.ticketSearch.set_value(""); this.ticketPicked.clear(); this.projects = null; this.teams = null; }
    this.drawer = drawer;
    if (SOURCES[drawer]) { this.loadTickets(drawer, cx); this.ticketSearch.focus(); }
    else if (drawer === "picker") this.search.focus(); else if (!drawer) this.handle.focus();
    cx.notify();
  }
  loadTickets(provider, cx) {
    const request = this.ticketRequests[provider] = (this.ticketRequests[provider] ?? 0) + 1;
    this.sources[provider] = { ...this.sources[provider], loading: true, error: null, kind: null };
    const context = { cwd: this.context.cwd, on: this.context.on }, filter = this.linearFilter;
    cx.spawn(async cx => {
      let next;
      try {
        if (provider === "plane") {
          const listed = await readTickets("plane", { op: "issues", context, scope: "all" });
          const states = listed.needsProject ? { states: [] } : await readTickets("plane", { op: "states", context });
          next = { issues: listed.issues, states: states.states, needsProject: Boolean(listed.needsProject), project: listed.project ? [listed.project.workspace, listed.project.name].filter(Boolean).join(" · ") : null };
        } else {
          const listed = await readTickets("linear", { op: "issues", open: true, scope: filter.scope, ...(filter.team ? { team: filter.team.id } : {}), ...(filter.project ? { project: filter.project.id } : {}) });
          const teams = filter.team ? [filter.team.id] : [...new Set((listed.issues ?? []).map(issue => issue.team).filter(Boolean))];
          const states = teams.length ? await readTickets("linear", { op: "states", teams }) : { states: [] };
          next = { issues: listed.issues, states: states.states };
        }
        next = { ...next, issues: (next.issues ?? []).filter(openIssue), states: next.states ?? [], loading: false, error: null, kind: null };
      } catch (error) { next = { ...this.sources[provider], loading: false, error: error?.message || String(error), kind: error?.kind ?? null }; }
      if (this.ticketRequests[provider] !== request) return;
      this.sources[provider] = next; cx.notify();
    });
  }
  // States to move tickets to: the linked Plane project's, and Linear's merged by name over the teams of its queued tickets.
  loadUpdateStates(cx) {
    const state = this.state(), context = { cwd: this.context.cwd, on: this.context.on };
    const teams = [...new Set([state.linear?.team?.id, ...state.tasks.filter(task => task.ticket?.provider === "linear" && task.status !== "done").map(task => task.ticket.team),
      ...this.sources.linear.issues.map(issue => issue.team)].filter(Boolean))].slice(0, 5);
    if (updatesLabel(state.ticketUpdates?.linear) || state.ticketUpdates?.linear?.link || state.linear?.team) cx.spawn(async cx => {
      try { this.linearWrite = (await readTickets("linear", { op: "access" })).write ?? null; } catch { this.linearWrite = null; }
      cx.notify();
    });
    for (const provider of Object.keys(SOURCES)) {
      if (provider === "linear" && !teams.length) { this.updateStates.linear = { loading: false, states: [], error: null }; continue; }
      this.updateStates[provider] = { ...this.updateStates[provider], loading: true, error: null };
      cx.spawn(async cx => {
        let next;
        try { next = { states: (await readTickets(provider, provider === "plane" ? { op: "states", context } : { op: "states", teams })).states ?? [], error: null }; }
        catch (error) { next = { states: [], error: error?.message || String(error) }; }
        this.updateStates[provider] = { ...next, loading: false }; cx.notify();
      });
    }
  }
  connectLinear() {
    const args = { name: "Connect Linear", argv: ["python3", `${appHome()}/mods/linear/herdr-linear`, "--home", appHome(), "connect"] };
    if (this.context.on) run("space.new", { ...args, machine: "" });
    else run("tab.new", { ...args, space: focused()?.space });
  }
  setLinearFilter(change, cx) {
    this.linearFilter = { ...this.linearFilter, ...change, ...("team" in change ? { project: null } : {}) };
    this.projects = null; this.teams = null; this.ticketPicked.clear(); this.ticketSearch.set_value("");
    this.sources.linear = { ...this.sources.linear, issues: [], states: [] };
    localStorage.setItem(`linear:${this.id}`, JSON.stringify(this.linearFilter));
    if ("team" in change || "project" in change) { this.act({ type: "linear", team: this.linearFilter.team, project: this.linearFilter.project }, cx); this.loadUpdateStates(cx); }
    if (this.drawer === "linear") this.loadTickets("linear", cx);
    cx.notify();
  }
  loadProjects(cx) {
    const query = this.projectSearch.value().trim(), team = this.linearFilter.team, request = this.projectRequest = (this.projectRequest ?? 0) + 1;
    this.projects = { loading: true, items: this.projects?.items ?? [], error: null };
    cx.spawn(async cx => {
      let next;
      try { next = { loading: false, items: (await readTickets("linear", { op: "projects", ...(team ? { team: team.id } : {}), ...(query ? { query } : {}) })).projects ?? [], error: null }; }
      catch (error) { next = { loading: false, items: [], error: error?.message || String(error) }; }
      if (this.projectRequest === request && this.projects) { this.projects = next; cx.notify(); }
    });
    cx.notify();
  }
  loadTeams(cx) {
    const query = this.teamSearch.value().trim(), request = this.teamRequest = (this.teamRequest ?? 0) + 1;
    this.teams = { loading: true, items: this.teams?.items ?? [], error: null };
    cx.spawn(async cx => {
      let next;
      try { next = { loading: false, items: (await readTickets("linear", { op: "teams", ...(query ? { query } : {}) })).teams ?? [], error: null }; }
      catch (error) { next = { loading: false, items: [], error: error?.message || String(error) }; }
      if (this.teamRequest === request && this.teams) { this.teams = next; cx.notify(); }
    });
    cx.notify();
  }
  queueTickets(provider, issues, cx) {
    if (this.queueing) return;
    this.queueing = true; cx.notify();
    cx.spawn(async cx => {
      try {
        const full = await fullTickets(provider, issues);
        this.act({ type: "addTickets", provider, issues: full, source: SOURCES[provider] }, cx);
        this.ticketPicked.clear();
        this.open(null, cx);
      } catch (error) { this.sources[provider] = { ...this.sources[provider], error: error?.message || String(error), kind: error?.kind ?? null }; }
      finally { this.queueing = false; cx.notify(); }
    });
  }
  openLink(url) {
    if (!/^https?:\/\//.test(url ?? "")) return;
    this.track("link", { host: url.replace(/^https?:\/\/([^/]+).*$/, "$1"), ...(/\/pull\/\d+/.test(url) ? { kind: "pr" } : {}) });
    const opener = appWindow()?.platform === "macos" ? "open" : appWindow()?.platform === "windows" ? "explorer" : "xdg-open";
    exec(opener, [url]).catch(() => {});
  }
  // Images are copied into Herdr's own folder, so the agent gets one small folder to read and the originals can move.
  async addImages(task, sources, cx) {
    const store = `${appHome()}/pipeline-images`, name = path => path.replace(/^.*\//, "");
    let dir = task.images?.[0]?.path.replace(/\/[^/]+$/, "") ?? "", note = null;
    if (this.context.on) note = "Images can be added to projects on this computer only.";
    else for (const source of sources ?? [null]) {
      if ((this.state()?.tasks.find(row => row.id === task.id)?.images?.length ?? 0) >= IMAGES) { note = `A task takes up to ${IMAGES} images.`; break; }
      if (source && !IMAGE.test(source)) { note = `${name(source)} isn't a PNG, JPEG, GIF or WebP image.`; continue; }
      const result = await exec("sh", ["-c", source ? IMAGE_COPY : IMAGE_PASTE, "sh", dir, source ?? "", store]).catch(() => null);
      const path = result?.code === 0 ? result.stdout.trim() : "";
      if (!path) { note = source ? `${name(source)} couldn't be copied.` : "The clipboard holds no image. Copy a screenshot first."; continue; }
      dir = path.replace(/\/[^/]+$/, "");
      this.act({ type: "image", id: task.id, path }, cx);
    }
    this.imageNote = note; cx.notify();
  }
  removeImage(task, path, cx) {
    this.act({ type: "imageRemove", id: task.id, path }, cx);
    if (path.startsWith(`${appHome()}/pipeline-images/`)) exec("rm", ["-f", path]).catch(() => null);
  }
  imagesDetail(body, task, t) {
    const images = task.images ?? [], full = images.length >= IMAGES;
    body.child(this.heading("Images"));
    body.child(v_flex().id(`pipeline-images-${task.id}`).w_full().p(8).gap(8).rounded(6).border_1().border_dashed().border_color(t.border)
      .on_drop((event, cx) => cx.spawn(cx => this.addImages(task, event.paths, cx)))
      .children(images.map((item, i) => h_flex().id(`pipeline-image-${task.id}-${i}`).gap(8).items_center()
        .child(div().w(48).h(34).flex_none().rounded(4).overflow_hidden().bg(t.raised).child(image(item.path).size_full()))
        .child(div().flex_1().min_w(0).text_size(12).truncate().child(item.path.replace(/^.*\//, "")))
        .child(this.button(`image-remove-${task.id}-${i}`, "Remove image", cx => this.removeImage(task, item.path, cx), t, { icon: "x", iconOnly: true, small: true, hint: "Remove this image" }))))
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().min_w(0).text_size(12).line_height(1.45).text_color(t.muted).child(full ? `${IMAGES} images is the most a task takes.` : images.length ? "Drop more images here." : "Drop screenshots or mockups here. The agent opens them before it starts."))
        .when(!full && appWindow()?.platform === "macos", el => el.child(this.button(`image-paste-${task.id}`, "Paste image", cx => cx.spawn(cx => this.addImages(task, null, cx)), t, { small: true, hint: "Adds the image on the clipboard, such as a screenshot you just copied" })))));
    if (this.imageNote) body.child(div().id(`pipeline-image-note-${task.id}`).text_size(12).line_height(1.45).text_color(t.blocked).child(this.imageNote));
  }
  followUp(task, cx) {
    const text = this.follow.value().trim(), before = this.state()?.tasks.length;
    if (!task || !text) return;
    this.act({ type: "followUp", id: task.id, text }, cx);
    const tasks = this.state().tasks;
    if (tasks.length === before) return;
    this.follow.set_value("");
    this.inspect(tasks.at(-1).id, cx);
  }
  inspect(id, cx) {
    if (this.drawer === "task" && this.detailsFor) this.saveDetails(cx);
    const task = this.state()?.tasks.find(task => task.id === id);
    if (task) this.track("inspect", { task: id, status: task.status });
    this.selected = id; this.drawer = "task"; this.confirm = null; this.sent = null; this.imageNote = null;
    this.detailsFor = task?.status === "queued" && this.state()?.live ? id : null;
    if (this.detailsFor) { this.details.set_value(task.description ?? ""); this.taskModelInput.set_value(task.tune?.model ?? ""); }
    cx.notify();
  }
  nextQuestion(cx) {
    const task = this.state()?.tasks.find(needsInput);
    if (task) { this.inspect(task.id, cx); this.handle.focus(); }
  }
  answer(id, value, cx, typed = false) {
    if (!id || !String(value ?? "").trim()) return;
    const task = this.state()?.live && this.state().tasks.find(task => task.id === id);
    if (task) { this.answerAgent(task, value.trim(), typed, cx); return; }
    this.act({ type: "answer", id, value }, cx);
    this.reply.set_value("");
    const next = this.state()?.tasks.find(needsInput);
    if (next) this.inspect(next.id, cx); else this.handle.focus();
  }
  create(cx) {
    const title = this.title.value().trim();
    if (!title) { this.handle.focus(); cx.notify(); return; }
    const ref = this.state()?.live && ticketRef(title);
    this.title.set_value("");
    if (!ref) { this.act({ type: "create", title }, cx); return; }
    // A Linear link or key becomes that ticket, so its updates and its pull request link work. Anything that fails leaves the typed task.
    cx.spawn(async cx => {
      try {
        const found = (await readTickets("linear", { op: "details", ids: [ref] })).issues ?? [];
        if (!found.length) throw new Error("No such ticket.");
        this.act({ type: "addTickets", provider: "linear", issues: await fullTickets("linear", found), source: "Linear" }, cx);
      } catch { this.act({ type: "create", title }, cx); }
    });
  }
  speed(cx) {
    const current = this.state()?.speed ?? 1;
    this.act({ type: "speed", value: SPEEDS[(SPEEDS.indexOf(current) + 1) % SPEEDS.length] }, cx);
  }
  toggleMotion(cx) { this.motion = !this.motion; localStorage.setItem("motion", String(this.motion)); cx.notify(); }
  toggleLayout(cx) { this.layout = this.layout === "map" ? "board" : "map"; localStorage.setItem("layout", this.layout); cx.notify(); }
  animated() { return this.motion && !this.reducedMotion && appWindow()?.active !== false; }

  button(id, label, fn, t, options = {}) {
    const small = Boolean(options.small);
    return Button.new(`pipeline-${id}`).h(small ? 24 : 32).px(options.iconOnly ? (small ? 5 : 8) : small ? 8 : 11).gap(small ? 5 : 6).flex_none().flex().items_center().justify_center()
      .rounded(6).max_w_full().overflow_hidden().text_size(small ? 11 : 12).border_1().border_color(options.primary ? t.accent : t.border)
      .when(options.segment === "left", el => el.rounded_r(0))
      .when(options.segment === "right", el => el.rounded_l(0).when(!options.primary, el => el.border_l(0)))
      .bg(options.primary ? t.accent : options.selected ? t.selected : t.surface)
      .text_color(options.primary ? t.accent_foreground : t.foreground).disabled(Boolean(options.disabled))
      .opacity(options.disabled ? 0.45 : 1).tab_index(0).accessibility_label(options.hint ?? label)
      .when(Boolean(options.hint), el => el.tooltip(options.hint))
      .hover(el => el.bg(options.primary ? t.accent : t.hover))
      .focus(el => el.border_color(options.primary ? t.foreground : t.accent))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => fn(cx))
      .when(Boolean(options.icon), el => el.child(icon(options.icon, small ? 12 : 15)))
      .when(!options.iconOnly, el => el.child(label));
  }
  motionSwitch(t) {
    const on = this.motion && !this.reducedMotion, locked = this.reducedMotion;
    return this.switchRow("motion-setting", "Animation", locked ? "Off while the system's Reduce Motion is on" : "Flowing work, progress bars and the spinning ring", on, cx => this.toggleMotion(cx), t, locked);
  }
  switchRow(id, title, hint, on, fn, t, locked = false) {
    return Switch.new(`pipeline-${id}`).checked(on).disabled(locked).on_change((_value, cx) => fn(cx))
      .accessibility_label(title)
      .child(h_flex().py(6).gap(12).items_center().opacity(locked ? 0.55 : 1).when(!locked, el => el.cursor_pointer())
        .child(v_flex().flex_1().min_w(0).gap(3)
          .child(div().text_size(12).font_medium().child(title))
          .child(div().text_size(11).text_color(t.muted).child(hint)))
        .child(div().w(30).h(18).p(2).flex_none().flex().items_center().rounded(9)
          .bg(on ? t.accent : t.raised).border_1().border_color(on ? t.accent : t.border)
          .when(on, el => el.justify_end())
          .child(div().size(12).rounded(6).bg(on ? t.accent_foreground : t.muted))));
  }
  // Text that can be selected and copied, which a plain element's can't.
  copyable(id, text) {
    const plain = String(text ?? "").replace(/([\\`*_{}\[\]<>()#+\-.!|~])/g, "\\$1").replace(/\n/g, "  \n");
    return TextView.markdown(`pipeline-${id}`, plain).selectable(true);
  }
  label(text, t) { return div().text_size(12).line_height(1.5).text_color(t.muted).child(text); }
  heading(text) { return div().text_size(12).font_medium().child(text); }

  render(cx) {
    const state = this.state(), t = theme();
    if (!state) {
      // A save pruned while this view stayed open is made again.
      cx.timer?.after(0, cx => {
        const all = shared(STORE) ?? {};
        if (!all[this.id]) setShared(STORE, { ...all, [this.id]: createPipeline(this.context) });
        if (this.mode === "live") this.enterLive(cx);
        cx.notify();
      });
      return div().p(24).text_color(t.foreground).child("Loading Pipeline…");
    }
    if (newer(state)) return v_flex().p(24).gap(8).text_color(t.foreground)
      .child(div().text_size(14).font_semibold().child("This pipeline was saved by a newer Pipeline"))
      .child(div().text_size(12).line_height(1.5).text_color(t.muted).child("It stays untouched until the newer version is installed again. Run ./install.sh from the herdr-mods checkout that has it."));
    this.seen = new Set();
    const now = Date.now(), motion = this.animated();
    if (this.drawer && !this.drawerShown && motion) { this.entering = true; cx.timer.after(34, cx => { this.entering = false; cx.notify(); }); }
    this.drawerShown = Boolean(this.drawer);
    const info = {
      active: activeTasks(state).length,
      queued: state.tasks.filter(task => task.status === "queued").length,
      approvals: state.tasks.filter(needsApproval).length,
      failed: state.tasks.filter(task => task.status === "failed").length,
      questions: state.tasks.filter(needsInput).length,
      done: state.tasks.filter(task => task.status === "done").length,
    };
    const held = state.running && state.tasks.some(task => task.status === "queued" && quotaHeld(state, task, now));
    const unusable = state.live && this.repo?.error;
    info.status = unusable ? "Not a Git repository" : info.questions ? (state.live ? "An agent needs you" : "Waiting for your answer")
      : !state.running ? (info.active ? (state.live ? "Paused · agents finish their work" : "Paused · finishing started work") : "Paused")
      : held ? (state.live ? "Held by a usage limit" : "Waiting for quota") : info.active ? (state.live ? "Agents working" : "Pipeline running")
      : info.approvals ? (state.live ? "Waiting for your review" : "Waiting for your approval") : info.queued ? "Waiting" : "Idle";
    info.color = held || info.failed || info.questions || unusable ? t.blocked : state.running ? t.accent : t.muted;
    const narrow = this.size.width < 820, compact = this.size.width < 640, wide = this.size.width >= ONE_ROW;
    // Herdr paints running animations above later siblings, so the scene holds still under the settings modal and the setup card.
    const covered = this.drawer === "settings" || Boolean(this.keysShown) || Boolean(state.live && state.setup);
    const root = v_flex().id("pipeline-root").size_full().min_w(0).min_h(0).bg(t.canvas).text_color(t.foreground).text_size(13)
      .track_focus(this.handle)
      .on_size_change((bounds, cx) => {
        // Herdr reports painted bounds; builder lengths are multiplied by app zoom.
        const zoom = Number(settings().zoom) || 1;
        const size = { width: bounds.width / zoom, height: bounds.height / zoom };
        if (Math.abs(size.width - this.size.width) > 1 || Math.abs(size.height - this.size.height) > 1) { this.size = size; cx.notify(); }
      })
      .on_key_down((e, cx) => this.key(e, cx))
      .child(this.header(state, t, narrow, compact, wide))
      .when(!wide, el => el.child(this.commands(state, t)))
      .child(h_flex().relative().flex_1().min_h(0).min_w(0)
        .child(div().id("pipeline-viewport").flex_1().min_w(0).h_full().overflow_scrollbar()
          .child(this.layout === "map" ? this.scene(state, t, info, motion && !covered, now, cx) : this.board(state, t, info, motion && !covered, now, cx)))
        .when(Boolean(this.drawer) && this.drawer !== "settings", el => el.child(this.inspector(state, t, cx)
          .when(motion, node => node.opacity(this.entering ? 0 : 1).transition("opacity", { duration: 160, easing: "ease-out" }))
          .when(this.size.width > 1180, node => node.relative())
          .when(this.size.width <= 1180, node => node.absolute().right(0).top(0).bottom(0)))))
      .child(this.status(state, t, info, motion))
      .when(this.drawer === "settings", el => el.child(this.settingsModal(state, t)
        .when(motion, node => node.opacity(this.entering ? 0 : 1).transition("opacity", { duration: 160, easing: "ease-out" }))))
      .when(Boolean(this.keysShown), el => el.child(this.keysModal(state, t)));
    for (const key of [...this.bars.keys()]) if (!this.seen.has(key)) this.bars.delete(key);
    return root;
  }

  key(e, cx) {
    if (e.key === "escape") {
      if (this.keysShown) { this.keysShown = false; cx.notify(); }
      else if (this.drawer) this.open(null, cx); else { this.handle.focus(); cx.notify(); }
      cx.stop_propagation(); return;
    }
    if (!this.handle.is_focused() || this.drawer === "settings" || (this.state()?.live && ["a", "s"].includes(e.keystroke))) return;
    if (["?", "shift-/", "shift-?"].includes(e.keystroke)) { this.keysShown = !this.keysShown; cx.notify(); cx.stop_propagation(); return; }
    if (this.keysShown) return;
    const move = { down: 1, right: 1, j: 1, up: -1, left: -1, k: -1 }[e.keystroke];
    if (move) { this.step(move, cx); cx.stop_propagation(); return; }
    const source = { p: "plane", l: "linear" }[e.keystroke];
    if (source && this.state()?.live) { this.open(source, cx); cx.stop_propagation(); return; }
    const actions = {
      space: () => this.toggleRun(cx),
      n: () => { this.title.focus(); cx.notify(); },
      a: () => this.open("picker", cx),
      y: () => this.act({ type: "approveAll" }, cx),
      r: () => this.act({ type: "retry" }, cx),
      q: () => this.nextQuestion(cx),
      s: () => this.speed(cx),
      d: () => { if (this.state()?.live && this.drawer === "task") this.viewChanges(this.peek.diff.find(repo => repo.files.length)); },
      t: () => { if (this.state()?.live && this.drawer === "task") this.tryTask(this.state().tasks.find(task => task.id === this.selected), cx); },
    };
    const asked = this.drawer === "task" ? this.state()?.tasks.find(task => task.id === this.selected && needsInput(task)) : null;
    const option = choices(asked && (this.state().live ? this.liveQuestion(asked) : asked.question))[Number(e.keystroke) - 1];
    const action = option ? () => this.answer(asked.id, option, cx) : actions[e.keystroke];
    if (action) { action(); cx.stop_propagation(); }
  }

  keysModal(state, t) {
    const close = cx => { this.keysShown = false; cx.notify(); };
    return div().id("pipeline-keys-modal").absolute().inset_0().flex().items_center().justify_center().bg("#00000080")
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); close(cx); })
      .child(v_flex().id("pipeline-keys-panel").w(Math.min(380, this.size.width - 32)).max_h(this.size.height - 32).rounded(10).overflow_hidden().bg(t.surface).border_1().border_color(t.border).text_color(t.foreground)
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(h_flex().px(16).py(11).gap(10).items_center().flex_none().border_b(1).border_color(t.border)
          .child(div().flex_1().font_semibold().text_size(14).child("Keys"))
          .child(this.button("close-keys", "Close keys", close, t, { icon: "x", iconOnly: true, small: true, hint: "Close (Esc)" })))
        .child(v_flex().id("pipeline-keys-list").px(16).py(12).gap(7).overflow_y_scrollbar().children(shortcuts(state.live).map(([key, what]) => h_flex().gap(12).items_center().text_size(12)
          .child(div().w(72).flex_none().child(h_flex().child(div().px(6).h(20).flex().items_center().rounded(4).bg(t.raised).border_1().border_color(t.border).text_size(11).font_medium().child(key))))
          .child(div().flex_1().min_w(0).text_color(t.muted).child(what))))));
  }

  header(state, t, narrow, compact, wide) {
    return h_flex().h(50).px(20).gap(10).items_center().flex_none()
      .child(icon("pipeline", 20).text_color(t.accent))
      .when(!compact, el => el.child(div().text_size(16).font_semibold().flex_none().child("Pipeline")))
      .when(!state.live, el => el.child(h_flex().id("pipeline-demo-badge").h(24).px(8).gap(5).items_center().flex_none().rounded(12).bg(t.ansi3 + "26").text_color(t.ansi3).text_size(11).font_medium()
        .tooltip(this.context.cwd ? "Example tasks and pretend agents. Nothing real is touched" : "Example tasks and pretend agents. Open Pipeline from a project to run real agents")
        .child(icon("flask", 12)).child("Demo")))
      .when(!state.live && Boolean(this.context.cwd), el => el.child(this.button("mode", "Exit demo", cx => this.setMode("live", cx), t, { icon: "x", small: true, iconOnly: compact, hint: "Back to your pipeline: real agents on this project" })))
      .when(wide, el => el.children(this.controls(state, t)).child(div().flex_1()))
      .when(!wide, el => el.child(div().flex_1().min_w(0).text_size(12).text_color(t.muted).truncate().child(state.live
        ? `${state.repo}${this.repo?.branch ? ` · ${this.repo.branch}` : ""}${(state.repositories?.length ?? 1) > 1 ? ` + ${state.repositories.length - 1} more ${state.repositories.length === 2 ? "repository" : "repositories"}` : ""} · ${this.agentLabel(state)} in its own worktree per task`
        : `${state.context.name} · example repositories: ${REPOS.join(", ")}`)))
      .when(!state.live && !compact, el => el.child(this.button("speed", `${state.speed}×`, cx => this.speed(cx), t, { icon: "bolt", selected: state.speed > 1, hint: `Simulation speed ${state.speed}× (S)` })))
      .child(this.button("layout", "View", cx => this.toggleLayout(cx), t, { icon: this.layout === "map" ? "columns" : "pipeline", iconOnly: true,
        hint: this.layout === "map" ? "Show the board: Queue, Working and Review as columns" : "Show the map: work flowing through the agents" }))
      .when(!narrow, el => el.child(this.button("motion", "Motion", cx => this.toggleMotion(cx), t,
        { icon: "motion", iconOnly: true, selected: this.motion && !this.reducedMotion, hint: this.reducedMotion ? "System Reduce Motion is enabled" : `${this.motion ? "Turn off" : "Turn on"} animation` })))
      .child(this.button("settings", "Settings", cx => this.open(this.drawer === "settings" ? null : "settings", cx), t, { icon: "settings", iconOnly: true, selected: this.drawer === "settings", hint: "Pipeline settings" }))
      .child(this.runButton(state, t, compact));
  }

  runButton(state, t, compact) {
    const primary = !state.running, next = this.upcoming(state);
    return h_flex().flex_none().items_center()
      .child(this.button("run", state.running ? "Pause" : compact ? "Start" : "Start pipeline", cx => this.toggleRun(cx), t,
        { icon: state.running ? "pause" : "play", primary, segment: "left", disabled: Boolean(state.live && this.repo?.error && !state.running),
          hint: `${state.running ? "Pause: no new task starts, and work already started finishes" : state.live ? "Start an agent for each queued task, up to the parallel limit" : "Start dispatching queued work"} (Space)` }))
      .when(primary, el => el.child(div().w(1).h(32).flex_none().flex().items_center().bg(t.accent).child(div().w(1).h(16).bg(t.accent_foreground).opacity(0.35))))
      .child(this.button("schedule", next ? next.time : "Schedule", cx => this.open(this.drawer === "schedule" ? null : "schedule", cx), t,
        { icon: "clock", iconOnly: !next, primary, segment: "right", selected: this.drawer === "schedule",
          hint: next ? `${next.kind === "start" ? "Starts" : "Pauses"} every day at ${next.time}. Click to change the schedule` : state.schedule ? "Schedule: nothing more today until you start or pause by hand" : "Schedule a daily start and pause" }));
  }

  commands(state, t) {
    return h_flex().id("pipeline-controls").h(CONTROLS).px(20).pb(10).gap(8).items_center().flex_none().overflow_x_scrollbar().children(this.controls(state, t));
  }
  controls(state, t) {
    const typed = this.title.value().trim();
    const toggle = drawer => cx => this.open(this.drawer === drawer ? null : drawer, cx);
    return [h_flex().flex_1().min_w(200).max_w(480).h(32).pl(10).pr(4).gap(8).items_center().rounded(6).border_1().border_color(t.border).bg(t.input)
        .child(icon("plus", 13).text_color(t.muted))
        .child(div().flex_1().min_w(0).child(Input.new(this.title).w_full().text_size(12).accessibility_label("New task title")))
        .when(typed.length > TITLE, el => el.child(div().id("pipeline-create-long").flex_none().text_size(11).text_color(t.muted).child("Title + details")))
        .when(Boolean(typed), el => el.child(this.button("create", "Add", cx => this.create(cx), t, { small: true, primary: true,
          hint: typed.length > TITLE ? "Add to the queue (Enter). The title is its first sentence or opening words; the whole text goes in its details" : "Add to the queue (Enter)" }))),
      ...(state.live ? [this.ticketsButton(state, t), ...this.outsideButton(state, t), this.statusChip(state, t)]
        : [this.button("add", "Examples", toggle("picker"), t, { icon: "plus", selected: this.drawer === "picker", hint: "Pick example tasks (A)" }),
          this.button("watch", state.watch ? `Watching ${state.column}` : "Watch column", toggle("watch"), t, { icon: "eye", selected: state.watch }),
          this.button("parallel", `${state.parallel} parallel`, cx => this.open("settings", cx, "pipeline"), t, { icon: "pipeline", hint: "Parallel work slots" }),
          this.button("quota", `Quota ${state.quota}%`, toggle("quota"), t, { icon: "gauge", hint: "Example quota and reserve controls" })])];
  }

  ticketProvider(state) {
    const saved = localStorage.getItem(`tickets:${this.id}`);
    return SOURCES[saved] ? saved : state.watching?.linear && !state.watching?.plane ? "linear" : "plane";
  }
  ticketsButton(state, t) {
    const provider = SOURCES[this.drawer] ? this.drawer : this.ticketProvider(state);
    const watches = Object.keys(SOURCES).filter(key => state.watching?.[key]).map(key => `${SOURCES[key]} ${state.watching[key].name}`);
    const error = Object.values(state.sourceErrors ?? {}).find(Boolean);
    return this.button("tickets", watches.length ? `Watching ${watches.join(" + ")}` : "Add from tickets", cx => this.open(SOURCES[this.drawer] ? null : provider, cx), t,
      { icon: provider, selected: Boolean(SOURCES[this.drawer]) || watches.length > 0, hint: error ?? "Queue tickets from Plane (P) or Linear (L), or watch a state so they join by themselves" });
  }
  outside(state) { return outsideAgents(shared(STORE), state, panes()); }
  outsideButton(state, t) {
    const found = this.outside(state).length;
    if (!found && this.drawer !== "outside") return [];
    return [this.button("outside", `${count(found, "agent")} outside`, cx => this.open(this.drawer === "outside" ? null : "outside", cx), t,
      { icon: "terminal", selected: this.drawer === "outside", hint: `${found === 1 ? "An agent is" : "Agents are"} working in ${state.repo} outside the pipeline. Convert one to review and merge its work here` })];
  }
  showPane(pane) {
    try {
      const space = spaces().find(row => row.tabs.some(tab => tab.id === pane.tab));
      if (space) run("space.select", { id: space.id });
      run("tab.select", { id: pane.tab });
      run("pane.focus", { terminal: pane.terminal });
    } catch { /* It closed meanwhile; the list follows. */ }
  }
  convert(pane, cx) {
    const space = spaces().find(row => row.tabs.some(tab => tab.id === pane.tab));
    this.act({ type: "adopt", terminal: pane.terminal, tab: pane.tab, space: space?.id ?? null, program: pane.program?.key ?? null, agent: pane.program?.name ?? null,
      title: String(pane.title ?? "").replace(/^[^\p{L}\p{N}]+/u, "") }, cx);
    const task = this.state()?.tasks.find(task => task.adopt?.terminal === pane.terminal);
    if (task) this.inspect(task.id, cx);
  }
  outsideDrawer(body, state, t) {
    const found = this.outside(state);
    body.child(this.label(`Agents working in ${state.repo}'s folder that Pipeline didn't start. Convert one and its agent names the uncommitted files that are its own; Pipeline moves them into a worktree and branch for a new task, and the work is reviewed and ${state.delivery === "pr" ? "opened as a pull request" : "merged"} from here.`, t));
    if (!found.length) body.child(this.label("None right now.", t));
    for (const pane of found) {
      const tab = spaces().flatMap(space => space.tabs).find(tab => tab.id === pane.tab), agent = pane.program?.name ?? "Agent", moves = pane.program?.key === "claude";
      const status = { working: "working", blocked: "waiting for you", done: "finished", idle: "idle" }[pane.status] ?? "no status yet";
      body.child(v_flex().id(`pipeline-outside-${pane.terminal}`).w_full().p(10).gap(8).rounded(6).bg(t.surface).border_1().border_color(t.border)
        .child(div().text_size(12).font_medium().child(String(pane.title ?? "").replace(/^[^\p{L}\p{N}]+/u, "") || agent))
        .child(div().text_size(11).text_color(pane.status === "blocked" ? t.blocked : t.muted).child([agent, tab?.name && `tab ${tab.name}`, status].filter(Boolean).join(" · ")))
        .child(h_flex().gap(6)
          .child(this.button(`outside-convert-${pane.terminal}`, "Convert to task", cx => this.convert(pane, cx), t, { small: true, primary: true, icon: "plus", disabled: pane.status === "blocked",
            hint: pane.status === "blocked" ? "It is waiting for you in its terminal. Answer it first" : moves ? "Its conversation moves into the task's worktree and carries on there" : `Its work moves into the task's worktree, where a new ${agent} continues from its description` }))
          .child(this.button(`outside-open-${pane.terminal}`, "Open", () => this.showPane(pane), t, { small: true, icon: "terminal", hint: "Show its terminal" }))));
    }
  }
  statusChip(state, t) {
    const used = this.limitPercent(state), held = state.running && state.tasks.some(task => task.status === "queued" && quotaHeld(state, task, Date.now()));
    const label = [this.agentLabel(state), `${state.parallel} parallel`, used === null ? null : `${used}% used`].filter(Boolean).join(" · ");
    return this.button("agent", label, cx => this.open("settings", cx, held ? "limits" : "agent"), t, { icon: "terminal",
      hint: `${state.repo}${this.repo?.branch ? ` · ${this.repo.branch}` : ""}: the agent, model and effort each task starts with, how many run at once, and how full ${LIMITED[limitAgent(state)] ?? "the agent"}'s usage limits are. Opens Settings` })
      .when(held, el => el.border_color(t.blocked).text_color(t.blocked));
  }

  status(state, t, info, motion) {
    const latest = state.events[0];
    return h_flex().id("pipeline-status").h(STATUS).px(20).gap(10).items_center().flex_none().border_t(1).border_color(t.border).text_size(11).text_color(t.muted).overflow_x_scrollbar()
      .child(dot(info.color, 7).id("pipeline-status-dot").when(motion && state.running, el => el.loop("opacity", { from: 0.35, to: 1, period: 1600 })))
      .child(div().font_medium().text_color(t.foreground).flex_none().child(info.status))
      .child(Button.new("pipeline-activity").flex_1().min_w(60).h(24).pl(10).gap(8).flex().items_center().justify_start().border_l(1).border_color(t.border).text_size(11).text_color(t.muted).tab_index(0)
        .accessibility_label("Open activity").tooltip("Open the activity log")
        .hover(el => el.text_color(t.foreground)).focus(el => el.text_color(t.foreground))
        .on_click((_e, cx) => this.open(this.drawer === "activity" ? null : "activity", cx))
        .child(div().min_w(0).truncate().child(latest?.message ?? "Start the pipeline to watch your first tasks enter.")))
      .when(info.questions > 0, el => el.child(this.button("answer-next", state.live ? `${info.questions} need${info.questions === 1 ? "s" : ""} you` : `Answer ${count(info.questions, "question")}`, cx => this.nextQuestion(cx), t,
        { icon: "question", primary: true, small: true, hint: state.live ? "Show the next agent waiting for you (Q)" : "Open the next question waiting for you (Q)" })))
      .when(info.approvals > 0, el => el.child(this.button("approve-all", !state.live ? `Approve ${count(info.approvals, "task")}` : state.delivery === "pr" ? `Open ${count(info.approvals, "PR")}` : `Merge ${count(info.approvals, "task")}`, cx => this.act({ type: "approveAll" }, cx), t,
        { icon: "check", primary: true, small: true, hint: !state.live ? "Approve every PR waiting for you (Y)" : state.delivery === "pr" ? "Open a pull request for every finished branch, one at a time (Y)"
          : `Merge every finished branch into ${this.repo?.branch ?? "your branch"}, one at a time (Y)` })))
      .when(info.failed > 0, el => el.child(this.button("retry-all", `Retry ${info.failed} failed`, cx => this.act({ type: "retry" }, cx), t,
        { icon: "reset", small: true, hint: "Return failed tasks to the queue (R)" })))
      .child(this.button("keys", "Keys", cx => { this.keysShown = !this.keysShown; cx.notify(); }, t, { icon: "question", small: true, iconOnly: true, hint: "Keyboard shortcuts (?)" }))
      .when(Boolean(state.live), el => el.child(div().flex_none().child(this.repo?.error ?? `${state.delivery === "pr" ? "Opens pull requests into" : "Merges into"} ${this.repo?.branch ?? "your branch"}${state.delivery !== "pr" && state.pushAfterMerge ? " · pushes to origin" : ""}`)))
      .when(Boolean(state.live && state.unpushed?.length), el => el.child(this.unpushed(state, t)))
      .when(Boolean(state.live && afterFailed(state).length), el => el.child(this.afterFailure(state, t)))
      .when(!state.live, el => el.child(this.button("delivery", state.delivery === "pr" ? "PR approval" : "Auto-merge", cx => this.act({ type: "delivery", value: state.delivery === "pr" ? "direct" : "pr" }, cx), t,
        { small: true, selected: state.delivery === "direct", hint: state.delivery === "pr" ? "New changes wait for your approval. Click to merge after checks pass." : "New changes merge after checks pass. Click to require approval." })));
  }

  unpushed(state, t) {
    const entries = state.unpushed, pushing = entries.every(entry => entry.retry), several = entries.length > 1;
    const remotes = [...new Set(entries.map(entry => entry.remote))].join(" + ");
    return h_flex().id("pipeline-unpushed").gap(8).items_center().flex_none()
      .child(div().flex_none().text_color(t.blocked).child(`${unpushedLabel(state)} ${several ? "are" : "is"} ahead of ${remotes}`))
      .child(this.button("push-now", pushing ? "Pushing…" : "Push now", cx => this.act({ type: "pushNow" }, cx), t,
        { icon: "reset", small: true, disabled: pushing, hint: `Last push failed: ${entries.map(entry => `${several ? `${entry.branch} in ${entry.repo}: ` : ""}${entry.error}`).join(" ")} Click to push again. Pipeline never forces or pulls.` }));
  }

  afterFailure(state, t) {
    const failed = afterFailed(state);
    return h_flex().id("pipeline-after-failed").gap(8).items_center().flex_none()
      .child(div().flex_none().text_color(t.blocked).child(`${state.afterMerge} failed after ${failed.map(entry => entry.task).join(", ")} merged`))
      .child(this.button("after-now", "Run again", cx => this.act({ type: "afterMergeNow" }, cx), t,
        { icon: "reset", small: true, hint: `${failed.map(entry => entry.error.split("\n").pop()).join(" ")} The merge stays. Click to run it again in ${failed.length > 1 ? "those folders" : "your project folder"}.` }));
  }

  bar(task, state, width, color, motion, now, cx) {
    const key = `${task.id}-${task.status}-${Math.round(task.since)}`;
    const reached = Math.round(width * progress(state, task, now));
    const fill = div().id(`pipeline-bar-${key}`).h(2).rounded(1).bg(color);
    this.seen.add(key);
    if (!motion) { this.bars.delete(key); return fill.w(reached); }
    // A new bar renders where the stage is now, then a second render targets full width
    // so the native transition runs out the rest of the stage without script frames.
    if (!this.bars.has(key)) {
      this.bars.set(key, Math.max(16, Math.round((1 - progress(state, task, now)) * duration(state, task.status))));
      if (!this.kicking) { this.kicking = true; cx.timer.after(34, cx => { this.kicking = false; cx.notify(); }); }
      return fill.w(reached).transition("width", { duration: this.bars.get(key), easing: "linear" });
    }
    return fill.w(width).transition("width", { duration: this.bars.get(key), easing: "linear" });
  }

  planHeading(state) {
    const thinking = state.live && state.planner?.on && plannerBusy(state);
    const planner = state.live && state.planner?.on ? (thinking ? "planning…" : state.planning?.status === "failed" ? "planner stopped" : planned(state) && state.planning ? `by ${[PLANNERS[state.planning.agent] ?? "Claude Code", state.planning.model].filter(Boolean).join(" · ")}` : null) : null;
    return { thinking, heading: planner ? `The plan · ${planner}` : "The plan" };
  }

  board(state, t, info, motion, now, cx) {
    const drawerWidth = this.drawer && this.drawer !== "settings" && this.size.width > 1180 ? 330 : 0;
    const w = Math.max(680, this.size.width - drawerWidth), h = Math.max(320, this.size.height - BAR - STATUS - (this.size.width >= ONE_ROW ? 0 : CONTROLS));
    const col = Math.floor((w - 40 - 24) / 3), cw = this.cardW = col - 22, tall = h - 60;
    const card = (task, kind) => {
      const ch = kind === "review" || needsInput(task) ? CARD.review : CARD.h;
      return div().relative().w(cw).h(ch).flex_none().child(this.node({ task, x: cw / 2, y: ch / 2, kind }, state, t, motion, now, cx));
    };
    const note = text => div().px(2).py(4).text_size(12).line_height(1.45).text_color(t.muted).child(text);
    const head = (title, tally) => h_flex().h(24).px(4).gap(6).items_center().flex_none()
      .child(div().text_size(12).font_medium().child(title)).child(div().text_size(12).text_color(t.muted).child(String(tally)));
    const column = (key, title, tally, rows) => v_flex().id(`pipeline-column-${key}`).w(col).h(tall).p(6).gap(4).flex_none().rounded(10).border_1().border_color(t.border)
      .child(head(title, tally))
      .child(v_flex().id(`pipeline-column-${key}-rows`).flex_1().min_h(0).p(4).gap(10).overflow_y_scrollbar().children(rows));
    const queue = queueOrder(state), active = activeTasks(state).sort((a, b) => a.slot - b.slot);
    const review = state.tasks.filter(task => ["review", "merging", "failed"].includes(task.status)), prs = state.tasks.filter(task => task.status === "pr");
    const free = Array.from({ length: Math.max(0, state.parallel - active.length) }, (_, i) => div().id(`pipeline-free-${i}`).w(cw).h(40).flex_none().flex().items_center().justify_center()
      .rounded(9).border_1().border_dashed().border_color(t.border).text_size(11).text_color(t.muted).child("Free"));
    const { thinking, heading } = this.planHeading(state);
    const setup = state.live && state.setup;
    return v_flex().id("pipeline-board").relative().w(w).h(h).px(20).pb(14).gap(10).flex_none()
      .child(h_flex().h(36).gap(10).items_center().flex_none()
        .child(Button.new("pipeline-plan-open").flex_1().min_w(0).h(28).px(6).gap(8).flex().items_center().justify_start().rounded(6).text_size(12).text_color(t.foreground).tab_index(0)
          .accessibility_label(`${heading}: ${state.plan}. Read the plan`).tooltip("Read the plan").hover(el => el.bg(t.hover)).focus(el => el.bg(t.hover))
          .on_click((_e, cx) => this.open(this.drawer === "planner" ? null : "planner", cx))
          .child(dot(thinking ? t.accent : state.planning?.status === "failed" && state.planner?.on ? t.blocked : t.muted, 5))
          .child(div().flex_none().font_medium().text_color(t.muted).child(heading))
          .child(div().min_w(0).truncate().child(state.plan)))
        .child(this.button("history", `${count(info.done, "task")} completed`, cx => this.open("done", cx), t, { icon: "check", small: true })))
      .child(h_flex().gap(12).items_start().flex_none()
        .child(column("queue", "Queue", queue.length, queue.length ? queue.map(task => card(task, "card"))
          : [note(state.watch ? `Watching ${state.column}. New example tasks enter here.` : state.live ? "Type a task above. Each one gets its own agent, branch and worktree." : "Type a task above or press A for examples.")]))
        .child(column("working", "Working", `${active.length}/${state.parallel}`, [...active.map(task => card(task, "card")), ...free]))
        .child(column("review", "Review", review.length, [
          ...(review.length || prs.length ? review.map(task => card(task, "review")) : [note(state.live ? "Finished work lands here for you to read and merge." : "Checked changes land here for approval and merge.")]),
          ...(prs.length ? [head("Pull requests", prs.length), ...prs.map(task => card(task, "review"))] : [])])))
      .when(Boolean(setup), el => el.child(this.setupCard(state, t, { w, h, center: { x: w / 2, y: h / 2 } })));
  }

  scene(state, t, info, motion, now, cx) {
    const drawerWidth = this.drawer && this.drawer !== "settings" && this.size.width > 1180 ? 330 : 0;
    const cw = this.cardW = cardWidth(this.size.width);
    const g = layoutScene(state, this.size.width - drawerWidth, this.size.height - BAR - STATUS - (this.size.width >= ONE_ROW ? 0 : CONTROLS), cw);
    const c = g.center;
    const canvas = div().id("pipeline-scene").relative().w(g.w).h(g.h).flex_none().overflow_hidden();
    const alive = motion && (state.running || state.tasks.some(task => MOVING.includes(task.status)));
    const layer = (path, color) => canvas.child(window.paint_path(path.build(), color).absolute().inset(0).size_full());

    for (const star of g.stars) canvas.child(div().id(`pipeline-star-${star.id}`).absolute().left(star.x).top(star.y).size(star.size).rounded(star.size).bg(t.muted)
      .opacity((star.low + star.high) / 2).when(alive, el => el.loop("opacity", { from: star.low, to: star.high, period: star.period })));
    for (const [radius, glow] of [[260, 0.025], [180, 0.04], [112, 0.06]]) canvas.child(div().id(`pipeline-nebula-${radius}`).absolute()
      .left(c.x - radius).top(c.y - radius).size(radius * 2).rounded(radius).bg(t.accent).opacity(glow)
      .when(motion && state.running && radius === 180, el => el.loop("opacity", { from: 0.02, to: 0.07, period: 5200 })));

    const orbits = PathBuilder.stroke(1);
    for (const radius of g.orbits) orbits.move_to(c.x + radius * Math.cos(-1.75), c.y + radius * Math.sin(-1.75))
      .arc_to(radius, radius, 0, true, true, c.x + radius * Math.cos(1.75), c.y + radius * Math.sin(1.75));
    layer(orbits.dash_array([2, 6]), t.border);
    layer(PathBuilder.stroke(1).move_to(c.x - RING, c.y).arc_to(RING, RING, 0, false, true, c.x + RING, c.y)
      .arc_to(RING, RING, 0, false, true, c.x - RING, c.y).dash_array([3, 7]), t.border);

    const idle = PathBuilder.stroke(1), live = PathBuilder.stroke(1.5), flows = [];
    let lit = 0;
    const link = (points, on, flow) => {
      const [x1, y1, x2, y2] = points, mid = (x1 + x2) / 2;
      (on ? live : idle).move_to(x1, y1).cubic_bezier_to(x2, y2, mid, y1, mid, y2);
      if (on) lit++;
      if (flow) flows.push({ points, ...flow });
    };
    const at = id => g.nodes.find(node => node.task.id === id);
    for (const task of g.queueShown) { const node = at(task.id); link([node.x + cw / 2, node.y, c.x - SUN, c.y], false); }
    if (!g.queueShown.length) link([30 + cw, c.y, c.x - SUN, c.y], false);
    g.slots.forEach((slot, i) => {
      const task = state.tasks.find(row => ACTIVE.includes(row.status) && row.slot === i);
      link([c.x + SUN, c.y, slot.x - cw / 2, slot.y], Boolean(task), ["routing", "working"].includes(task?.status) && { key: `dispatch-${i}`, color: t.accent });
      link([slot.x + cw / 2, slot.y, g.dock.x, g.dock.y], task?.status === "testing", task?.status === "testing" && { key: `checks-${i}`, color: t.ansi5 });
    });
    for (const task of g.reviewShown) {
      const node = at(task.id);
      link([g.dock.x, g.dock.y, node.x - cw / 2, node.y], needsApproval(task));
      if (task.status === "merging") link([node.x, node.y + CARD.review / 2, g.w - 44, g.h - 66], true, { key: `merge-${task.id}`, color: t.ansi2 });
    }
    for (const task of g.prShown) { const node = at(task.id); link([g.dock.x, g.dock.y, node.x - cw / 2, node.y], false); }
    const trail = g.doneShown.map(task => at(task.id));
    trail.slice(1).forEach((node, i) => idle.move_to(trail[i].x, trail[i].y).line_to(node.x, node.y));
    layer(idle, t.border);
    if (lit) layer(live, t.accent);
    if (motion) for (const flow of flows) {
      const [x1, y1, x2, y2] = flow.points;
      const n = Math.max(6, Math.min(20, Math.round(Math.hypot(x2 - x1, y2 - y1) / 22)));
      samples(flow.points, n).forEach((point, i) => canvas.child(div().id(`pipeline-flow-${flow.key}-${i}`).absolute().left(point.x - 6).top(point.y - 8).w(12).h(16)
        .flex().items_center().justify_center().text_size(9).text_color(flow.color)
        .frames(COMET.map((_, step) => COMET[(((step - i) % COMET.length) + COMET.length) % COMET.length]), 85)));
    }

    if (motion && state.running) {
      // Native loops take raw lengths, without the app zoom that builder lengths get.
      const zoom = Number(settings().zoom) || 1, reach = SUN + 38;
      const pulse = (from, to, easing = "ease-out") => ({ from, to, period: 3200, easing });
      canvas.child(div().absolute().left(c.x - reach).top(c.y - reach).size(reach * 2).flex().items_center().justify_center()
        .child(div().id("pipeline-corona").size(SUN * 2).flex_none().rounded(reach).border_1().border_color(t.accent)
          .loop("width", pulse(SUN * 2 * zoom, reach * 2 * zoom)).loop("height", pulse(SUN * 2 * zoom, reach * 2 * zoom)).loop("opacity", pulse(0.75, 0, "linear"))));
    }
    canvas.child(svg("mods/pipeline/moon.svg").id("pipeline-moon").absolute().left(c.x - RING).top(c.y - RING).size(RING * 2).text_color(t.accent)
      .when(motion && state.running, el => el.spin(7000)));
    canvas.child(svg("mods/pipeline/moon-small.svg").id("pipeline-electron").absolute().left(c.x - SUN - 12).top(c.y - SUN - 12).size(SUN * 2 + 24).text_color(t.muted)
      .when(motion && state.running, el => el.spin(3200)));
    const { thinking, heading } = this.planHeading(state);
    const resting = !state.running ? "Paused" : info.active ? `${info.active}/${state.parallel} busy` : info.queued ? "Starting next" : "Idle";
    const sun = el => el.absolute().left(c.x - SUN).top(c.y - SUN).size(SUN * 2).rounded(SUN).border_1().bg(t.surface);
    if (!state.live) canvas.child(sun(v_flex()).border_color(t.accent)
      .items_center().justify_center().gap(5).child(icon("pipeline", 24).text_color(t.accent))
      .child(div().font_medium().text_size(13).child("Planner"))
      .child(div().text_color(t.muted).text_size(11).child(resting)));
    else {
      // With real agents the centre says what waits for the person, and takes them there.
      const need = info.questions ? { text: `${info.questions} need${info.questions === 1 ? "s" : ""} you`, color: t.blocked, go: cx => this.nextQuestion(cx), hint: "Show the next agent waiting for you (Q)" }
        : info.failed ? { text: `${info.failed} stopped`, color: t.blocked, go: cx => this.open("review", cx), hint: "Show the tasks that stopped" }
        : info.approvals ? { text: `${info.approvals} to review`, color: t.ansi5, go: cx => this.open("review", cx), hint: "Show the work waiting for your review" }
        : thinking ? { text: "Planning", color: t.accent, go: cx => this.open("planner", cx), hint: "The planner agent is ordering the queue. Show what it does" }
        : state.planner?.on ? state.planning?.status === "failed"
          ? { text: "Planner", color: t.blocked, go: cx => this.open("planner", cx), hint: "The planner stopped. Show why" }
          : { text: "Planner", color: t.accent, go: cx => this.open("planner", cx), hint: "Show the plan" }
        : { text: "Agents", color: t.accent, go: cx => this.open("queue", cx), hint: "Show the queue" };
      canvas.child(sun(Button.new("pipeline-sun")).border_color(need.color).text_color(t.foreground).tab_index(0).accessibility_label(`${need.text}. ${need.hint}`).tooltip(need.hint)
        .hover(el => el.bg(t.hover)).focus(el => el.border_color(t.foreground)).on_click((_e, cx) => need.go(cx))
        .child(v_flex().size_full().items_center().justify_center().gap(5).child(icon("pipeline", 24).text_color(need.color))
          .child(div().font_medium().text_size(13).child(need.text))
          .child(div().text_color(t.muted).text_size(11).child(resting))));
    }
    const planLeft = Math.max(30 + cw + 20, c.x - 120);
    canvas.child(div().id("pipeline-plan").absolute().left(planLeft).top(14).w(Math.max(200, Math.min(420, g.w - 30 - cw - 20 - planLeft)))
      .child(Button.new("pipeline-plan-open").w_full().px(10).py(7).rounded(7).border_1().border_color(this.drawer === "planner" ? t.accent : t.border).bg(t.surface).text_color(t.foreground).tab_index(0)
        .accessibility_label(`${heading}: ${state.plan}. Read the plan`).tooltip("Read the plan").hover(el => el.bg(t.hover)).focus(el => el.border_color(t.accent))
        .on_click((_e, cx) => this.open(this.drawer === "planner" ? null : "planner", cx))
        .child(v_flex().w_full().min_w(0).gap(2)
          .child(h_flex().gap(6).items_center().child(dot(thinking ? t.accent : state.planning?.status === "failed" && state.planner?.on ? t.blocked : t.muted, 5))
            .child(div().flex_1().min_w(0).text_size(11).font_medium().text_color(t.muted).truncate().child(heading)))
          .child(div().text_size(12).truncate().child(state.plan)))));

    g.slots.forEach((slot, i) => {
      const launching = state.tasks.find(task => task.status === "routing" && task.slot === i);
      const occupied = state.tasks.some(task => ACTIVE.includes(task.status) && task.status !== "routing" && task.slot === i);
      canvas.child(v_flex().absolute().left(slot.x - cw / 2).top(slot.y - CARD.h / 2).w(cw).h(CARD.h).gap(4).items_center().justify_center()
        .rounded(9).border_1().border_dashed().border_color(t.border).bg(t.canvas)
        .when(!occupied, el => el.child(div().text_size(11).text_color(t.muted).child(i >= state.parallel ? "Not used" : launching ? `Starting ${launching.id}` : "Free"))));
    });

    canvas.child(this.button("queue", `Queue · ${g.queue.length}`, cx => this.open("queue", cx), t, { hint: "Every queued task" }).absolute().left(30).top(14));
    canvas.child(this.button("review-list", `Review · ${g.review.length}`, cx => this.open("review", cx), t, { hint: "Tasks awaiting approval, merging or failed" }).absolute().right(30).top(14));
    if (g.prs.length) canvas.child(h_flex().absolute().right(30).top(g.prTop).w(cw).h(24).gap(8).items_center()
      .child(div().flex_1().h(1).bg(t.border))
      .child(this.button("pr-list", `Pull requests · ${g.prs.length}`, cx => this.open("prs", cx), t, { small: true, hint: "Open on GitHub: what each one waits for" })));
    const setup = state.live && state.setup;
    if (!g.queue.length && !setup) canvas.child(v_flex().absolute().left(30).top(70).w(cw).gap(6)
      .child(div().text_size(13).child(state.watch ? `Watching ${state.column}` : "Queue is clear"))
      .child(div().text_size(12).line_height(1.45).text_color(t.muted).child(state.live ? "Type a task above. Each one gets its own agent, branch and worktree."
        : state.watch ? "New example tasks enter here." : "Type a task above or press A for examples.")));
    if (g.queue.length > g.queueShown.length) canvas.child(this.button("queue-more", `+${g.queue.length - g.queueShown.length} more queued`, cx => this.open("queue", cx), t)
      .absolute().left(30).top(92 + g.queueShown.length * 76 - 16).w(cw));
    if (!g.review.length && !g.prs.length) canvas.child(v_flex().absolute().right(30).top(70).w(cw).gap(6)
      .child(icon("check", 17).text_color(t.muted))
      .child(div().text_size(12).line_height(1.45).text_color(t.muted).child(state.live ? "Finished work lands here for you to read and merge." : "Checked changes land here for approval and merge.")));
    if (g.review.length > g.reviewShown.length && g.reviewFits > 1) canvas.child(this.button("review-more", `+${g.review.length - g.reviewShown.length} more in review`, cx => this.open("review", cx), t)
      .absolute().right(30).top(92 + g.reviewShown.length * 88 - 20).w(cw));
    if (g.prs.length > g.prShown.length && g.prFits > 1) canvas.child(this.button("pr-more", `+${g.prs.length - g.prShown.length} more pull requests`, cx => this.open("prs", cx), t)
      .absolute().right(30).top(g.prY(g.prShown.length) - 20).w(cw));

    for (const node of g.nodes) canvas.child(this.node(node, state, t, motion, now, cx, node.task === g.doneShown[0]));
    if (setup) canvas.child(this.setupCard(state, t, g));
    canvas.child(this.button("history", `${count(info.done, "task")} completed`, cx => this.open("done", cx), t, { icon: "check", small: true }).absolute().right(24).bottom(12));
    canvas.child(div().absolute().left(30).bottom(17).text_size(11).text_color(t.muted).child("Click a task or use the arrow keys. Press ? for every key."));
    return canvas;
  }

  setupJob(state) {
    return setupArgs(state, { branch: this.repo?.branch ?? null, github: this.github, found: [...this.checkSuggestions, ...this.trySuggestions, ...this.afterSuggestions] });
  }
  decideSetup(cx) {
    const state = this.state();
    if (!state?.live || !this.repo?.root || this.deciding?.running) return;
    const { by, ...job } = this.setupJob(state), root = this.repo.root;
    this.deciding = { running: true, by };
    cx.spawn(async cx => {
      try {
        const script = await readTextFile(`${appHome()}/mods/pipeline/planner.py`);
        if (!script) throw new Error("A Pipeline helper is missing. Reinstall the mods.");
        const ran = await exec("python3", ["-c", script, JSON.stringify({ ...job, cwd: root })], { cwd: root, on: this.context.on, timeout: 320000 });
        let reply;
        try { reply = JSON.parse(ran.stdout); } catch { throw new Error(ran.stderr?.trim().slice(-300) || "Python 3 couldn't run on that machine."); }
        const picked = readSetup(reply.data, this.github);
        if (picked.check.value) { this.checkInput.set_value(picked.check.value); this.act({ type: "check", command: picked.check.value }, cx); }
        if (picked.tryout.value) { this.tryInput.set_value(picked.tryout.value); this.act({ type: "tryout", command: picked.tryout.value }, cx); }
        this.act({ type: "deliver", value: picked.delivery.value }, cx);
        if (picked.after.value) { this.afterInput.set_value(picked.after.value); this.act({ type: "afterMerge", command: picked.after.value }, cx); }
        this.deciding = { by, ...picked };
      } catch (error) { this.deciding = { by, error: String(error?.message ?? error).slice(0, 300) }; }
      cx.notify();
    });
    cx.notify();
  }
  setupCard(state, t, g) {
    const w = Math.min(520, g.w - 60), branch = this.repo?.branch ?? "your branch", ai = this.deciding;
    const job = this.setupJob(state), canAsk = this.agentChoices.some(agent => agent.key === job.agent) && Boolean(this.repo?.root);
    const change = (key, section, label = "Change") => this.button(`setup-${key}-change`, label, cx => this.open("settings", cx, section), t, { small: true, hint: `Open ${SECTIONS.live[section]} in Settings` });
    const use = (id, label, fn, hint) => this.button(`setup-${id}-use`, label, fn, t, { small: true, hint });
    const chose = (key, value) => ai?.[key] && (ai[key].value ? ai[key].value === value : !value) ? ai[key] : null;
    const row = (key, title, mark, value, actions, picked) => v_flex().id(`pipeline-setup-${key}`).gap(1)
      .child(h_flex().min_h(34).gap(10).items_center()
        .child(div().w(16).flex_none().flex().justify_center().child(picked ? icon("sparkles", 13).text_color(t.accent) : mark()))
        .child(div().w(72).flex_none().text_size(12).text_color(t.muted).child(title))
        .child(div().flex_1().min_w(0).text_size(12).truncate().child(value))
        .children(actions))
      .when(Boolean(picked?.reason), el => el.child(div().pl(108).pb(4).text_size(11).line_height(1.4).text_color(t.muted).child(picked.reason)));
    const ok = () => icon("check", 13).text_color(t.ansi2), todo = () => dot(t.ansi3, 7), plain = () => dot(t.muted, 5);
    const tracker = state.linear?.team || this.teamGuess ? "linear" : this.ticketProvider(state), moves = state.ticketUpdates?.[tracker], readonly = tracker === "linear" && this.linearWrite === false && Boolean(updatesLabel(moves)), guess = guessUpdates(this.updateStates[tracker].states), watchGuess = guessWatch(this.updateStates[tracker].states);
    const demoQueued = state.tasks.some(task => task.title === DEMO_TITLE), prepareHint = this.prepareSuggestions[0], checkHint = this.checkSuggestions[0], tryHint = this.trySuggestions[0], afterHint = this.afterSuggestions[0], watched = Object.entries(state.watching ?? {}).filter(([, watch]) => watch);
    const flow = flowOf(state), hint = this.flowGuess && this.flowGuess.flow !== flow ? { reason: `This looks like ${this.flowGuess.flow === "team" ? "a repository a team reviews" : "a repository you merge yourself"}: ${this.flowGuess.why}.` } : null;
    const rows = [
      row("flow", "Who merges", flow === "mixed" ? todo : ok, { solo: "Just you: finished work merges locally", team: "A team on GitHub: draft pull requests that wait for an approval", mixed: "Your own mix of the settings below" }[flow], [
        ...(flow !== "solo" ? [use("solo", "Just me", cx => this.act({ type: "flow", value: "solo" }, cx), "Finished work merges into your branch locally, once you approve it")] : []),
        ...(flow !== "team" && this.github ? [use("team", "A team reviews", cx => this.act({ type: "flow", value: "team" }, cx),
          "Finished work opens a draft pull request, counts as ready to merge only once approved, and its agent rebases when it conflicts")] : [])], hint),
      row("helper", "AI helper", canAsk ? () => icon("sparkles", 13).text_color(t.accent) : todo,
        canAsk ? job.by : `Needs ${PLANNERS[job.agent]} installed`, [change("helper", "planner")]),
      row("agent", "Agent", this.agentChoices.length ? ok : todo,
        this.agentChoices.length ? this.agentLabel(state) : this.repo ? "No coding agent found" : "Looking for agents…", [change("agent", "agent")]),
      row("checks", "Checks", state.check ? ok : todo, state.check?.command ?? "None, so unchecked work reaches review", [
        ...(!state.check && checkHint ? [use("check", `Use ${checkHint}`, cx => { this.checkInput.set_value(checkHint); this.act({ type: "check", command: checkHint }, cx); },
          "Found in this repository. Runs in each finished task's worktree before review")] : []),
        change("checks", "checks", state.check ? "Change" : "Set")], chose("check", state.check?.command)),
      row("prepare", "Prepare", state.prepare ? ok : plain, state.prepare ?? "New worktrees start as Git leaves them", [
        ...(!state.prepare && prepareHint ? [use("prepare", "Use what's missing", cx => { this.prepareInput.set_value(prepareHint); this.act({ type: "prepare", command: prepareHint }, cx); },
          `Runs once in each new worktree, before its agent starts:\n${prepareHint}`)] : []),
        change("prepare", "checks", state.prepare ? "Change" : "Set")]),
      row("tryout", "Try it", state.tryout ? ok : plain, state.tryout ?? "Nothing to run", [
        ...(!state.tryout && tryHint ? [use("try", `Use ${tryHint}`, cx => { this.tryInput.set_value(tryHint); this.act({ type: "tryout", command: tryHint }, cx); },
          "Found in this repository. Runs a task's change in a tab so you can try it")] : []),
        change("tryout", "checks", state.tryout ? "Change" : "Set")], chose("tryout", state.tryout)),
      row("delivery", "Delivery", ok, state.delivery === "pr" ? `Pull request into ${branch}` : `Merge into ${branch} locally`, [
        ...(state.delivery !== "pr" && this.github ? [use("pr", "Use pull requests", cx => this.act({ type: "deliver", value: "pr" }, cx),
          "This repository is on GitHub and gh is installed, so finished work can open a pull request instead")] : []),
        change("delivery", "delivery")], chose("delivery", state.delivery)),
      ...(state.delivery !== "pr" ? [] : [row("prs", "Pull requests", state.draftPr || state.prApproval || state.autoRebase ? ok : plain,
        `${state.draftPr ? "Open as drafts" : "Open ready for review"} · ${state.prApproval ? "ready to merge once approved" : "ready to merge when GitHub says so"}${state.autoRebase ? " · rebases on conflicts" : ""}`, [
        ...(!state.draftPr ? [use("draft", "Open as drafts", cx => this.act({ type: "draftPr" }, cx), "Each pull request opens as a draft; mark it ready from its task when it should be reviewed")] : []),
        ...(!state.prApproval ? [use("approval", "Wait for an approval", cx => this.act({ type: "prApproval" }, cx), "A pull request counts as ready to merge only once someone approved it, even where GitHub requires no review")] : []),
        ...(!state.autoRebase ? [use("rebase", "Rebase on conflicts", cx => this.act({ type: "autoRebase" }, cx), "When a pull request conflicts with its base, its agent rebases and pushes by itself")] : []),
        change("prs", "delivery")])]),
      ...(state.delivery === "pr" ? [] : [row("after", "After merge", state.afterMerge ? ok : plain, state.afterMerge ?? "Nothing to run", [
        ...(!state.afterMerge && afterHint ? [use("after", `Use ${afterHint}`, cx => { this.afterInput.set_value(afterHint); this.act({ type: "afterMerge", command: afterHint }, cx); },
          "Found in this repository. Runs in your project folder after each merge, so merged work is installed")] : []),
        change("after", "delivery", state.afterMerge ? "Change" : "Set")], chose("after", state.afterMerge))]),
      row("tickets", "Tickets", watched.length || state.linear?.team ? ok : plain,
        watched.length ? watched.map(([provider, watch]) => `${SOURCES[provider]} · ${watch.name}`).join(", ") : state.linear?.team ? `Linear · ${state.linear.team.name}` : "Typed here", [
        ...(!watched.length && tracker === "plane" && watchGuess ? [use("watch", `Watch Plane · ${watchGuess.name}`, cx => this.act({ type: "watchTickets", provider: "plane", state: watchGuess }, cx),
          `Tickets in ${watchGuess.name} join the queue within a minute, each one once`)] : []),
        ...(!state.linear?.team && this.teamGuess ? [use("team", `Use Linear · ${this.teamGuess.name}`, cx => this.setLinearFilter({ team: this.teamGuess }, cx),
          "This repository's branches and commits name this Linear team. Tickets and their states then come from it")] : []),
        this.button("setup-tickets-add", "Add from tickets", cx => this.open(this.ticketProvider(state), cx), t, { small: true, icon: this.ticketProvider(state), hint: "Queue tickets from Plane or Linear, or watch a state" })]),
      row("updates", "Updates", updatesLabel(moves) && !readonly ? ok : todo, readonly ? "Your Linear connection can only read" : updatesLabel(moves) || `${SOURCES[tracker]} tickets stay as they are`, [
        ...(readonly ? [this.button("setup-linear-connect", "Connect Linear", () => this.connectLinear(), t, { small: true, icon: "linear", hint: "Opens a terminal that asks privately for a key with Write permission" })] : []),
        ...(!updatesLabel(moves) && updatesLabel(guess) ? [use("updates", `Use ${updatesLabel(guess)}`, cx => this.useUpdates(tracker, guess, cx),
          `Moves a ${SOURCES[tracker]} ticket as its work starts, is ready for review and merges, and links its pull request`)] : []),
        change("updates", "tickets", updatesLabel(moves) ? "Change" : "Set")]),
      row("evidence", "Screenshots", state.evidence ? ok : plain, state.evidence ? "Agents show the change, before and after" : "Agents aren't asked for any", [
        ...(!state.evidence ? [use("evidence", "Ask for before and after", cx => this.act({ type: "evidence" }, cx), "Each agent screenshots what it changes, before and after. They appear in the task's inspector")] : []),
        ...(state.evidence && this.demoSkill === false && !demoQueued ? [use("demo", "Queue: write how to run it", cx => this.queueDemoSkill(cx),
          "This repository has no skill that says how to start it and which screens matter. Queues a task that writes one, so agents stop working it out each time")] : []),
        change("evidence", "agent")]),
    ];
    const note = ai?.running ? [`${ai.by} is reading the repository. It only reads, and you can keep typing tasks.`, t.accent]
      : ai?.error ? [`${ai.by} couldn't choose: ${ai.error}`, t.blocked]
      : ai ? [`${ai.by} chose what's marked with sparkles${ai.ms ? ` in ${Math.max(1, Math.round(ai.ms / 1000))} s` : ""}. Change anything you disagree with.`, t.muted]
      : state.inherited ? ["These come from this project's other pipeline. A change here changes it there too.", t.muted]
      : ["The defaults work. These are the ones worth a look before the first agent starts.", t.muted];
    const tall = 528 + (state.delivery === "pr" ? 0 : 36) + ["check", "tryout", "delivery", "after"].filter(key => ai?.[key]?.reason).length * 18;
    return v_flex().id("pipeline-setup").absolute().left(Math.max(30, Math.min(g.w - 30 - w, g.center.x - w / 2))).top(Math.max(60, Math.min(g.center.y - tall / 2, g.h - tall - 20))).w(w).p(16).gap(4)
      .rounded(10).border_1().border_color(t.border).bg(t.surface).text_color(t.foreground).shadow_lg()
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(h_flex().gap(8).items_center().pb(6)
        .child(div().flex_1().text_size(14).font_semibold().child("Set up this pipeline"))
        .child(this.button("setup-decide", ai?.running ? "Choosing…" : ai && !ai.error ? "Choose again" : "Choose for me", cx => this.decideSetup(cx), t, {
          small: true, icon: "sparkles", disabled: ai?.running || !canAsk,
          hint: canAsk ? `The AI helper, ${job.by}, reads this repository, read-only, and picks the check command, Try it and delivery. Uses a little of your ${PLANNERS[job.agent]} usage`
            : `Needs ${PLANNERS[job.agent]} installed on the project's machine` }))
        .child(this.button("setup-close", "Close setup", cx => this.act({ type: "setupDone" }, cx), t, { small: true, icon: "x", iconOnly: true, hint: "Hide this; everything stays in Settings" })))
      .child(div().pb(6).text_size(12).line_height(1.45).text_color(note[1]).child(note[0]))
      .children(rows)
      .child(h_flex().pt(10).gap(8).items_center()
        .child(this.button("setup-settings", "All settings", cx => this.open("settings", cx, "agent"), t, { small: true, icon: "settings" }))
        .child(div().flex_1().text_size(11).text_color(t.muted).truncate().child("Type a task above, then press Space"))
        .child(this.button("setup-done", "Done", cx => this.act({ type: "setupDone" }, cx), t, { small: true })));
  }

  node({ task, x, y, kind }, state, t, motion, now, cx, newest) {
    const asking = needsInput(task), cw = this.cardW ?? CARD.w;
    const [w, h] = asking ? [cw, CARD.review] : { card: [cw, CARD.h], review: [cw, CARD.review], comet: [18, 18], star: [16, 16] }[kind];
    const color = stateColor(task, t), selected = this.drawer === "task" && this.selected === task.id;
    const round = kind === "comet" || kind === "star";
    let wrap = div().id(`pipeline-node-${task.id}`).absolute().left(x - w / 2).top(y - h / 2).w(w).h(h);
    if (motion) wrap = wrap.transition("left", { duration: 620, easing: "ease-in-out" }).transition("top", { duration: 620, easing: "ease-in-out" })
      .transition("width", { duration: 320, easing: "ease-out" }).transition("height", { duration: 320, easing: "ease-out" });
    if (kind === "comet") wrap.child(div().id(`pipeline-glow-${task.id}`).absolute().left(-7).top(-7).size(32).rounded(16).bg(t.accent).opacity(0.25)
      .when(motion, el => el.loop("opacity", { from: 0.08, to: 0.45, period: 900 })));
    if (asking || (kind === "review" && needsApproval(task))) wrap.child(div().id(`pipeline-halo-${task.id}`).absolute().left(-4).top(-4).w(w + 8).h(h + 8).rounded(12)
      .border_1().border_color(asking ? t.blocked : t.ansi5).opacity(0.5).when(motion && asking, el => el.loop("opacity", { from: 0.15, to: 0.85, period: 1800 })));
    if (kind === "star" && newest) wrap.child(div().id(`pipeline-nova-${task.id}`).absolute().left(-6).top(-6).size(28).rounded(14).border_1().border_color(t.ansi2)
      .opacity(0.5).when(motion, el => el.loop("opacity", { from: 0.1, to: 0.8, period: 2400 })));
    const card = Button.new(`pipeline-card-${task.id}`).size_full().rounded(round ? h / 2 : 9)
      .bg(kind === "comet" ? t.accent : kind === "star" ? t.canvas : selected ? t.selected : t.surface)
      .border_1().border_color(selected ? t.accent : ["failed", "input"].includes(task.status) ? t.blocked : kind === "star" ? t.canvas : kind === "comet" ? t.accent : t.border)
      .text_color(t.foreground).text_size(12).tab_index(0).flex().items_center().justify_center()
      .accessibility_label(`${task.id}: ${task.title}. ${labelFor(state, task.status)}. ${task.repos.join(", ")}`)
      .tooltip(task.status === "queued" ? `${task.title}\n${waitingReason(state, task)}` : `${task.title}\n${labelFor(state, task.status)}`)
      .hover(el => el.bg(round ? (kind === "comet" ? t.accent : t.hover) : t.hover).border_color(t.accent)).focus(el => el.border_color(t.accent))
      .on_click((_e, cx) => this.inspect(task.id, cx));
    if (kind === "star") card.child(div().id(`pipeline-twinkle-${task.id}`).size(newest ? 9 : 7).rounded(5).bg(color)
      .when(motion, el => el.loop("opacity", { from: 0.55, to: 1, period: 1800 + (task.finished ?? 0) % 7 * 300 })));
    else if (kind !== "comet") {
      const agent = state.live && task.status === "pr" ? task.agentState : null, lead = agent === "working" ? t.accent : agent === "input" ? t.blocked : color;
      const busy = (agent === "working" || (ACTIVE.includes(task.status) && !asking)) && motion, linked = kind === "review" && state.live && task.status === "pr" && Boolean(task.prs);
      card.child(v_flex().size_full().p(kind === "review" || asking ? 9 : 10).gap(4)
        .child(h_flex().gap(6).items_center()
          .child(busy ? svg("mods/pipeline/satellite.svg").id(`pipeline-sat-${task.id}`).size(11).flex_none().text_color(lead).spin(task.status === "testing" ? 800 : 1500) : dot(lead))
          .child(div().text_size(11).font_medium().text_color(t.muted).flex_none().child(task.id))
          .child(div().flex_1())
          .when(!linked && (!state.live || task.repos.length > 1), el => el.child(div().text_size(11).text_color(t.muted).truncate().child(task.repos.join(" + ")))))
        .child(div().text_size(12).font_medium().truncate().child(task.title))
        .child(asking
          ? h_flex().child(div().px(6).h(18).rounded(4).bg(t.blocked + "26").text_color(t.blocked).text_size(11).font_semibold().flex().items_center().child(cardStatus(state, task)))
          : agent === "working" || agent === "input"
            ? h_flex().id(`pipeline-pr-agent-${task.id}`).gap(6).items_center().min_w(0).text_size(11)
              .child(agent === "input" ? div().px(6).h(18).flex_none().rounded(4).bg(t.blocked + "26").text_color(t.blocked).font_semibold().flex().items_center().child("Needs you")
                : div().flex_none().font_medium().text_color(t.accent).child("Agent working"))
              .child(div().flex_1().min_w(0).truncate().text_color(toneColor(prNeeds(task, state).tone, t)).child(prNeeds(task, state).label))
            : div().text_size(11).text_color(task.status === "failed" || task.stalled ? t.blocked : task.status === "pr" && state.live ? toneColor(prNeeds(task, state).tone, t) : t.muted).truncate()
              .when(kind === "review" && (needsApproval(task) || task.status === "failed"), el => el.pr(80)).child(cardStatus(state, task))));
    }
    wrap.child(card);
    if (ACTIVE.includes(task.status) && kind === "card" && !asking && !state.live) wrap.child(div().absolute().left(10).bottom(6).w(cw - 20).h(2).rounded(1).bg(t.raised)
      .child(this.bar(task, state, cw - 20, t.accent, motion, now, cx)));
    if (task.status === "merging" && kind === "review" && !state.live) wrap.child(div().absolute().left(9).bottom(6).w(cw - 18).h(2).rounded(1).bg(t.raised)
      .child(this.bar(task, state, cw - 18, t.ansi2, motion, now, cx)));
    if (kind === "review" && needsApproval(task) && state.live && task.unchanged) wrap.child(this.button(`approve-${task.id}`, "Done", cx => this.act({ type: "approve", id: task.id }, cx), t,
      { icon: "check", primary: true, small: true, hint: `${task.id} changed no files. Mark it done and remove its worktree` }).absolute().right(8).bottom(8));
    else if (kind === "review" && needsApproval(task) && state.live) wrap.child(this.button(`approve-${task.id}`, state.delivery === "pr" ? "Open PR" : "Merge", cx => this.act({ type: "approve", id: task.id }, cx), t,
      { icon: "check", primary: !conflicted(task), small: true, hint: state.delivery === "pr" ? `Push ${task.id}'s branch and open ${task.repos.length > 1 ? `a pull request in each of ${task.repos.join(", ")}` : "a pull request"} into ${targetOf(task) ?? "your branch"}`
        : `Merge ${task.id} into ${targetOf(task) ?? "your branch"}${task.repos.length > 1 ? ` in ${task.repos.join(", ")}, all or none` : ""}` }).absolute().right(8).bottom(8));
    else if (kind === "review" && state.live && task.status === "pr" && task.prs) {
      const prs = Object.values(task.prs), one = prs.length === 1 ? prs[0] : null;
      wrap.child(this.button(`pr-${task.id}`, one ? `#${one.number}` : `${prs.length} PRs`, cx => one ? this.openLink(one.url) : this.inspect(task.id, cx), t,
        { small: true, hint: one ? `Open pull request #${one.number} on GitHub` : `Pull requests ${prList(task.prs)}` }).h(20).text_color(t.ansi4).absolute().right(6).top(5));
    }
    else if (kind === "review" && needsApproval(task)) {
      const left = task.repos.filter(repo => !task.approvals.includes(repo)).length;
      wrap.child(this.button(`approve-${task.id}`, left > 1 ? `Approve ${left}` : "Approve", cx => this.act({ type: "approve", id: task.id }, cx), t,
        { icon: "check", primary: true, small: true, hint: `Approve ${task.id}'s ${count(left, "PR")}` }).absolute().right(8).bottom(8));
    }
    if (asking && task.reason === "trust") wrap.child(this.button(`trust-${task.id}`, "Trust", cx => this.trust(task, cx), t,
      { icon: "check", primary: true, small: true, hint: "Answer “Yes, I trust this folder” in its terminal. The worktree is your repository at its current commit." }).absolute().right(8).bottom(8));
    else if (asking) wrap.child(this.button(`answer-${task.id}`, "Answer", cx => { this.inspect(task.id, cx); this.handle.focus(); }, t,
      { icon: "question", primary: true, small: true, hint: state.live ? "Answer its agent here" : task.question?.text ?? "Answer the agent" }).absolute().right(8).bottom(8));
    if (kind === "review" && task.status === "failed" && task.reason === "checks") wrap.child(this.button(`fix-${task.id}`, "Fix", cx => this.fix(task, cx), t,
      { icon: "reset", small: true, primary: true, hint: "Send the check output to its agent to fix" }).absolute().right(8).bottom(8));
    else if (kind === "review" && task.status === "failed") wrap.child(this.button(`retry-${task.id}`, "Retry", cx => this.act({ type: "retry", id: task.id }, cx), t,
      { icon: "reset", small: true, hint: `Return ${task.id} to the queue` }).absolute().right(8).bottom(8));
    return wrap;
  }

  inspector(state, t, cx) {
    const titles = { plane: this.sources.plane.project ? `Plane · ${this.sources.plane.project}` : "Plane", linear: `Linear · ${filterLabel(this.linearFilter)}`, picker: "Example tasks", queue: "Queue", review: "Review", prs: "Pull requests", done: "Completed", activity: "Activity", watch: "Watch a column", quota: "Quota", planner: "Plan", schedule: "Schedule", outside: "Agents outside the pipeline", task: this.selected ?? "Task" };
    const panel = v_flex().id("pipeline-inspector").w(Math.min(330, this.size.width - 16)).h_full().min_h(0).flex_none().bg(t.surface).border_l(1).border_color(t.border)
      .child(h_flex().px(18).py(12).gap(8).items_center().flex_none().border_b(1).border_color(t.border)
        .child(div().flex_1().font_semibold().text_size(14).truncate().child(titles[this.drawer]))
        .child(this.button("close-drawer", "Close inspector", cx => this.open(null, cx), t, { icon: "x", iconOnly: true, hint: "Close (Esc)" })));
    const body = v_flex().id("pipeline-inspector-scroll").flex_1().min_h(0).p(18).gap(14).overflow_y_scrollbar();
    const rows = (tasks, empty) => {
      if (!tasks.length) body.child(this.label(empty, t));
      for (const task of tasks) body.child(this.taskRow(task, state, t, cx => this.inspect(task.id, cx)));
    };
    if (this.drawer === "picker") this.picker(body, state, t);
    else if (SOURCES[this.drawer]) this.ticketDrawer(this.drawer, body, state, t);
    else if (this.drawer === "queue") rows(queueOrder(state), "Queue is clear. Type a task above or add examples.");
    else if (this.drawer === "review") {
      const approvals = state.tasks.filter(needsApproval).length;
      if (approvals) body.child(this.button("drawer-approve-all", `Approve ${count(approvals, "task")}`, cx => this.act({ type: "approveAll" }, cx), t, { icon: "check", primary: true }));
      rows(state.tasks.filter(task => ["review", "merging", "failed"].includes(task.status)), "Nothing to review. Checked changes arrive here.");
    }
    else if (this.drawer === "prs") rows(state.tasks.filter(task => task.status === "pr"), "No pull requests open. Opened ones wait here until they're merged on GitHub.");
    else if (this.drawer === "done") {
      const done = state.tasks.filter(task => task.status === "done"), timed = done.filter(task => task.spent), used = done.filter(task => task.usage);
      const parts = [timed.length && `${elapsed(timed.reduce((sum, task) => sum + task.spent, 0))} of agent time`,
        used.length && `${compact(used.reduce((sum, task) => sum + task.usage.written, 0))} tokens written`].filter(Boolean);
      if (state.live && parts.length) body.child(this.label(`${count(done.length, "task")} · ${parts.join(" · ")}`, t));
      rows(state.tasks.filter(task => task.status === "done").sort((a, b) => (b.finished ?? 0) - (a.finished ?? 0)), "No completed tasks yet.");
    }
    else if (this.drawer === "activity") {
      if (!state.events.length) body.child(this.label("Start the pipeline to see activity.", t));
      for (const item of state.events) body.child(item.task
        ? Button.new(`pipeline-event-${item.id}`).w_full().text_size(12).line_height(1.45).text_color(t.foreground).tab_index(0)
          .accessibility_label(`${item.message} Inspect ${item.task}`).hover(el => el.text_color(t.accent)).focus(el => el.text_color(t.accent))
          .on_click((_e, cx) => this.inspect(item.task, cx)).child(item.message)
        : this.label(item.message, t));
    }
    else if (this.drawer === "quota") this.quota(body, state, t);
    else if (this.drawer === "planner") this.plannerView(body, state, t);
    else if (this.drawer === "outside") this.outsideDrawer(body, state, t);
    else if (this.drawer === "watch") this.watch(body, state, t);
    else if (this.drawer === "schedule") this.schedule(body, state, t);
    else if (this.drawer === "task") this.detail(body, state, t, cx);
    return panel.child(body);
  }
  taskRow(task, state, t, fn, picked = false) {
    return Button.new(`pipeline-row-${task.id}`).w_full().p(10).rounded(6).bg(picked ? t.selected : t.surface)
      .border_1().border_color(picked ? t.accent : t.border).text_color(t.foreground).tab_index(0)
      .accessibility_label(`${task.id}: ${task.title}. ${picked ? "Selected" : LABELS[task.status]}`)
      .hover(el => el.bg(t.hover)).focus(el => el.border_color(t.accent)).on_click((_e, cx) => fn(cx))
      .child(v_flex().w_full().gap(6).child(h_flex().items_center().gap(6).child(dot(stateColor(task, t)))
        .child(div().text_size(11).text_color(t.muted).child(task.id)).child(div().flex_1())
        .when(picked, el => el.child(icon("check", 13))))
        .child(div().text_size(12).font_medium().child(task.title))
        .child(div().text_size(11).text_color(t.muted).child(`${!state.live || task.repos.length > 1 ? `${task.repos.join(" + ")} · ` : ""}${task.status === "backlog" ? task.column : cardStatus(state, task)}${state.live && task.status === "done" && timing(task) ? ` · ${timing(task)}` : ""}`)));
  }
  picker(body, state, t) {
    const query = this.search.value().trim().toLowerCase();
    const backlog = state.tasks.filter(task => task.status === "backlog");
    const tasks = backlog.filter(task => `${task.id} ${task.title} ${task.repos.join(" ")}`.toLowerCase().includes(query));
    const valid = backlog.filter(task => this.picked.has(task.id)).map(task => task.id);
    body.child(this.label("Pick example tasks for the queue. To add your own, type a title in the New task field.", t));
    body.child(h_flex().gap(8).flex_wrap()
      .child(this.button("add-picked", `Add ${count(valid.length, "task")}`, cx => { this.act({ type: "add", ids: valid }, cx); this.picked.clear(); this.open(null, cx); }, t, { primary: true, disabled: !valid.length, icon: "plus" }))
      .child(this.button("add-all", `Add all ${backlog.length}`, cx => { this.act({ type: "addAll" }, cx); this.picked.clear(); this.open(null, cx); }, t, { disabled: !backlog.length })));
    body.child(Input.new(this.search).w_full().h(34).px(9).bg(t.input).border_1().border_color(t.border).rounded(6).text_size(12).accessibility_label("Search example tasks"));
    for (const task of tasks) body.child(this.taskRow(task, state, t, cx => { this.picked.has(task.id) ? this.picked.delete(task.id) : this.picked.add(task.id); cx.notify(); }, this.picked.has(task.id)));
    if (!tasks.length) body.child(this.label(query ? "No matching example tasks." : "Every example task has joined the pipeline.", t));
    body.child(this.button("generate", "Generate 6 more examples", cx => this.act({ type: "generate", count: 6 }, cx), t, { icon: "plus", hint: "Queue six new example tasks" }));
  }
  stepper(body, title, hint, value, type, min, max, t, step = 1, unit = "") {
    body.child(v_flex().gap(7).child(this.heading(title)).child(this.label(hint, t))
      .child(h_flex().gap(10).items_center()
        .child(this.button(`${type}-less`, `Decrease ${title}`, cx => this.act({ type, value: value - step }, cx), t, { icon: "minus", iconOnly: true, disabled: value <= min }))
        .child(div().min_w(24).text_size(16).font_semibold().child(`${value}${unit}`))
        .child(this.button(`${type}-more`, `Increase ${title}`, cx => this.act({ type, value: value + step }, cx), t, { icon: "plus", iconOnly: true, disabled: value >= max }))));
  }
  settingsModal(state, t) {
    const sections = SECTIONS[state.live ? "live" : "simulation"], keys = Object.keys(sections);
    const section = keys.includes(this.section) ? this.section : keys[0];
    const width = Math.min(880, this.size.width - 32), height = Math.min(680, this.size.height - 32), stacked = width < 620;
    const body = v_flex().w_full().max_w(640).px(stacked ? 18 : 28).py(stacked ? 18 : 24).gap(14)
      .child(div().text_size(16).font_semibold().child(sections[section]));
    if (state.live) this.liveSettings(section, body, state, t); else this.settings(section, body, state, t);
    const tab = key => Button.new(`pipeline-settings-${key}`).h(30).px(10).flex_none().flex().items_center().justify_start().rounded(6).text_size(12).tab_index(0)
      .text_color(key === section ? t.foreground : t.muted).when(key === section, el => el.bg(t.selected).font_medium()).when(!stacked, el => el.w_full())
      .accessibility_label(`${sections[key]} settings`).hover(el => el.bg(key === section ? t.selected : t.hover)).focus(el => el.text_color(t.foreground).border_1().border_color(t.accent))
      .on_click((_e, cx) => { this.section = key; cx.notify(); }).child(sections[key]);
    const nav = stacked ? h_flex().id("pipeline-settings-nav").px(12).py(8).gap(4).flex_none().overflow_x_scrollbar().border_b(1).border_color(t.border).children(keys.map(tab))
      : v_flex().id("pipeline-settings-nav").w(180).h_full().p(10).gap(2).flex_none().border_r(1).border_color(t.border).bg(t.canvas).children(keys.map(tab));
    const page = div().id(`pipeline-settings-scroll-${section}`).flex_1().min_w(0).min_h(0).overflow_y_scrollbar().child(body);
    return div().id("pipeline-settings-modal").absolute().inset_0().flex().items_center().justify_center().bg("#00000080")
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.open(null, cx); })
      .on_scroll_wheel((_e, cx) => cx.stop_propagation())
      .child(v_flex().id("pipeline-settings-panel").w(width).h(height).rounded(10).overflow_hidden().bg(t.surface).border_1().border_color(t.border).text_color(t.foreground)
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(h_flex().px(18).py(12).gap(10).items_center().flex_none().border_b(1).border_color(t.border)
          .child(icon("settings", 16).text_color(t.muted))
          .child(div().flex_none().font_semibold().text_size(14).child("Pipeline settings"))
          .child(div().flex_1().min_w(0).text_size(12).text_color(t.muted).truncate().child(state.live
            ? `${state.repo}${this.repo?.branch ? ` · ${this.repo.branch}` : ""}` : `${state.context.name} · simulation`))
          .child(this.button("close-settings", "Close settings", cx => this.open(null, cx), t, { icon: "x", iconOnly: true, hint: "Close (Esc)" })))
        .child(stacked ? v_flex().flex_1().min_h(0).child(nav).child(page) : h_flex().flex_1().min_h(0).child(nav).child(page)));
  }
  settings(section, body, state, t) {
    if (section === "pipeline") {
      this.stepper(body, "Parallel tasks", "Lowering the limit lets active work finish.", state.parallel, "parallel", 1, 6, t);
      this.stepper(body, "Outstanding PRs", "Reserves one PR per repository, including active work.", state.reviewLimit, "reviewLimit", 1, 10, t);
      body.child(this.heading("Delivery for new changes"));
      body.child(h_flex().gap(6).flex_wrap().children([["pr", "Create PRs · wait for approval"], ["direct", "Merge after checks pass"]].map(([value, label]) =>
        this.button(`delivery-${value}`, label, cx => this.act({ type: "delivery", value }, cx), t, { selected: state.delivery === value }))));
      body.child(this.label("Changes already in review keep their delivery policy. Multi-repository tasks complete after every repository merges.", t));
    } else if (section === "simulation") {
      body.child(this.heading("Simulation speed"));
      body.child(h_flex().gap(8).children(SPEEDS.map(value => this.button(`speed-${value}`, `${value}×`, cx => this.act({ type: "speed", value }, cx), t, { selected: state.speed === value }))));
      body.child(this.heading("Try what happens"));
      body.child(h_flex().gap(8).flex_wrap()
        .child(this.button("ask", state.askNext ? "Next working task will ask" : "Simulate a question", cx => this.act({ type: "ask" }, cx), t, { disabled: state.askNext, icon: "question" }))
        .child(this.button("fail-check", state.failNext ? "Next check will fail" : "Simulate a failed check", cx => this.act({ type: "fail" }, cx), t, { disabled: state.failNext })));
      body.child(div().h(1).bg(t.border));
      body.child(h_flex().child(this.button("reset", "Reset example pipeline", cx => { this.act({ type: "reset" }, cx); this.picked.clear(); this.selected = null; }, t, { icon: "reset" })));
    } else {
      body.child(this.motionSwitch(t));
      body.child(this.label("Runs while Herdr is open. You can close this tab; the pipeline keeps going.", t));
      body.child(this.heading("Keys")).child(this.label(KEYS.simulation, t));
    }
  }
  quota(body, state, t) {
    body.child(div().text_size(29).font_semibold().child(`${state.quota}%`)).child(this.label("Example quota remaining", t));
    body.child(div().h(5).rounded(3).bg(t.raised).child(div().w(`${state.quota}%`).h(5).rounded(3).bg(quotaHeld(state) ? t.blocked : t.accent)));
    body.child(this.label(`Reserve: ${state.reserve}%. Each example launch uses 8%. New work waits before crossing the reserve; active work finishes.`, t));
    body.child(this.button("quota-limit", "Simulate quota limit", cx => this.act({ type: "quota", value: state.reserve }, cx), t, { disabled: state.quota <= state.reserve }));
    body.child(this.button("quota-reset", "Reset example quota", cx => this.act({ type: "quota", value: 100 }, cx), t, { icon: "reset", primary: true }));
    this.stepper(body, "Quota reserve", "Percentage kept for your other work.", state.reserve, "reserve", 0, 50, t);
    body.child(this.label("Quota and launch costs are simulated. In Live, Pipeline reads Claude's and Codex's real usage limits.", t));
  }
  limitPercent(state) {
    const key = limitAgent(state), windows = state.limits?.[key]?.windows;
    return LIMITED[key] && windows?.length ? Math.round(Math.max(...windows.map(window => limitUsed(window)))) : null;
  }
  limits(body, state, t) {
    const hold = limitHold(state), key = limitAgent(state), now = Date.now(), warn = text => div().text_size(12).line_height(1.45).text_color(t.blocked).child(text);
    for (const agent of Object.keys(LIMITED).sort((a, b) => (b === key) - (a === key))) {
      const reading = state.limits?.[agent];
      body.child(h_flex().gap(8).items_center().child(this.heading(LIMITED[agent]))
        .when(agent === key, el => el.child(div().text_size(11).text_color(t.muted).child("New tasks start with it"))));
      if (!reading) { body.child(this.label("Reading…", t)); continue; }
      if (reading.error) { body.child(reading.missing ? this.label(reading.error, t) : warn(reading.error)); continue; }
      if (!reading.windows.length) body.child(this.label("No limits reported.", t));
      for (const window of reading.windows) {
        const used = limitUsed(window, now), over = hold !== null && used >= hold;
        body.child(v_flex().gap(5)
          .child(h_flex().gap(8).items_center().text_size(12)
            .child(div().flex_1().min_w(0).truncate().child(window.name))
            .child(div().flex_none().text_color(over ? t.blocked : t.muted).child(`${Math.round(used)}%${window.resets && window.resets > now ? ` · resets ${resetTime(window.resets, now)}` : ""}`)))
          .child(div().h(5).rounded(3).bg(t.raised).child(div().w(`${Math.min(100, used)}%`).h(5).rounded(3).bg(over ? t.blocked : t.accent))));
      }
      const scoped = reading.windows.filter(window => window.model);
      if (scoped.length) body.child(this.label(`${scoped.map(window => window.name).join(" and ")} only hold${scoped.length === 1 ? "s" : ""} tasks whose model is set to ${scoped.map(window => window.model).join(" or ")}.`, t));
      if (reading.extra !== undefined) body.child(this.label(`Extra usage is on, so ${LIMITED[agent]} keeps working past a full limit on paid credits. ${reading.extra}% of this month's cap is spent.`, t));
      if (reading.seen) body.child(this.label(`As of ${LIMITED[agent]}'s last reply on this machine, ${elapsed(now - reading.seen)} ago.`, t));
      else if (state.limits?.read) body.child(this.label(`Read ${elapsed(now - state.limits.read)} ago.`, t));
    }
    if (state.limits?.error) body.child(warn(state.limits.error));
    body.child(this.button("limits-read", "Read again", cx => this.act({ type: "readLimits" }, cx), t, { icon: "reset", small: true, hint: "Read both agents' limits now" }));
    body.child(div().h(1).bg(t.border));
    body.child(this.switchRow("limit-hold", "Hold new agents near a limit", hold === null ? "New agents start whatever the limits say" : `New agents wait while a limit of the agent they start is at ${hold}% or more`,
      hold !== null, cx => this.act({ type: "limitHold", value: hold === null ? LIMIT_HOLD : null }, cx), t));
    if (hold !== null) this.stepper(body, "Hold at", "Lower it to keep more of each limit for your own work.", hold, "limitHold", 50, 100, t, 5, "%");
    body.child(this.label("Agents already working keep going; only new agents wait, and they start once the limit resets. Claude's limits come from Anthropic, asked with Claude Code's own login every five minutes. Codex's come from its newest session on this machine, so they're as fresh as its last reply.", t));
  }
  watch(body, state, t) {
    body.child(this.label("A watched column feeds the same queue as picked tasks. Tasks are claimed once.", t));
    body.child(this.heading("Example board column"));
    for (const column of ["Ready", "Backlog"]) body.child(this.button(`column-${column}`, column, cx => this.act({ type: "column", value: column }, cx), t, { selected: state.column === column }));
    body.child(this.button("watch-toggle", state.watch ? "Stop watching" : `Watch ${state.column}`, cx => this.act({ type: "watch" }, cx), t, { icon: "eye", primary: !state.watch }));
    body.child(this.label(state.watch ? `Watching ${state.column}. New tasks join even while paused.` : "Turn on watch to pick up matching tasks automatically.", t));
    body.child(this.button("arrival", `Move example task to ${state.column}`, cx => this.act({ type: "arrival" }, cx), t, { icon: "plus", disabled: !state.tasks.some(task => task.status === "backlog") }));
    body.child(this.label("This button simulates someone moving a task on the board. No external task service is changed.", t));
  }
  // The time that would change something: a running pipeline's pause, a paused one's start.
  upcoming(state) {
    const kind = state.running ? "pause" : "start", time = state.schedule?.[kind];
    return time ? { kind, time, at: nextScheduled({ schedule: { [kind]: time } }).at } : null;
  }
  schedule(body, state, t) {
    body.child(this.label(state.live ? "Every day at these times Pipeline starts or pauses the pipeline for you, as the Start and Pause buttons do. Agents already working keep going after a pause."
      : "Every day at these times the pipeline starts or pauses for you, as the Start and Pause buttons do. Active work finishes after a pause.", t));
    for (const [kind, title, hint] of [["start", "Start at", state.live ? "Agents start for queued tasks, up to the parallel limit." : "The planner starts dispatching queued work."],
      ["pause", "Pause at", state.live ? "No new agents start until the next start." : "No new work enters until the next start."]]) {
      const input = this.times[kind], saved = state.schedule?.[kind] ?? "";
      body.child(v_flex().gap(7).child(this.heading(title)).child(this.label(hint, t))
        .child(h_flex().gap(6).items_center()
          .child(Input.new(input).flex_1().min_w(0).h(32).px(9).bg(t.input).border_1().border_color(this.timeError?.kind === kind ? t.blocked : t.border).rounded(6).text_size(12).accessibility_label(title))
          .child(this.button(`schedule-${kind}-save`, "Save", cx => this.saveTime(kind, cx), t, { small: true, disabled: input.value().trim() === saved }))
          .when(Boolean(saved), el => el.child(this.button(`schedule-${kind}-clear`, `Clear ${title.toLowerCase()}`, cx => { input.set_value(""); this.saveTime(kind, cx); }, t,
            { small: true, icon: "x", iconOnly: true, hint: `Stop ${kind === "start" ? "starting" : "pausing"} at ${saved}` }))))
        .when(this.timeError?.kind === kind, el => el.child(div().text_size(12).line_height(1.45).text_color(t.blocked).child(this.timeError.text))));
    }
    const next = this.upcoming(state);
    const day = next && new Date(next.at).toDateString() === new Date().toDateString() ? "today" : "tomorrow";
    body.child(this.label(next ? `Next: ${next.kind === "start" ? "starts" : "pauses"} ${day} at ${next.time}.`
      : state.schedule ? `${state.running ? "Running" : "Paused"} now, with no scheduled ${state.running ? "pause" : "start"}.` : "Nothing scheduled.", t));
    body.child(this.label("Times are this computer's local time and repeat daily. Start or pause by hand whenever you like; the schedule acts again at its next time. If Herdr is closed when a time comes round, the latest missed time applies when it opens.", t));
  }
  ticketDrawer(provider, body, state, t) {
    const source = this.sources[provider], service = SOURCES[provider], watch = state.watching?.[provider], filter = this.linearFilter;
    const warn = text => div().text_size(12).line_height(1.45).text_color(t.blocked).child(text);
    body.child(h_flex().children(Object.keys(SOURCES).map((key, i) => this.button(key, SOURCES[key], cx => this.open(key, cx), t,
      { icon: key, small: true, selected: key === provider, segment: i ? "right" : "left", hint: `Tickets from ${SOURCES[key]} (${key[0].toUpperCase()})` }))));
    const refresh = id => this.button(id, source.loading ? "Loading…" : "Refresh", cx => this.loadTickets(provider, cx), t, { icon: "reset", disabled: source.loading });
    if (source.needsProject || source.kind === "auth") {
      const panel = provider === "plane" ? "Tasks" : "Linear";
      body.child(this.label(source.needsProject ? "This repository isn't linked to a Plane project yet. Link it in the Tasks panel, then come back."
        : `${service} isn't connected on this computer. Connect it in the ${panel} panel, then come back.`, t));
      body.child(this.button(provider === "plane" ? "open-tasks" : "open-linear", `Open the ${panel} panel`, () => run(`tabs-show.${provider}`), t, { icon: provider }));
      body.child(refresh(`${provider}-refresh`));
      return;
    }
    if (source.error) body.child(warn(source.error));
    if (provider === "linear" && this.teams) { this.teamPicker(body, t); return; }
    if (provider === "linear" && this.projects) { this.projectPicker(body, t); return; }
    if (provider === "linear") {
      body.child(h_flex().gap(6).flex_wrap().children(Object.entries(SCOPES).map(([scope, label]) =>
        this.button(`linear-scope-${scope}`, label, cx => this.setLinearFilter({ scope }, cx), t, { small: true, selected: filter.scope === scope }))));
      body.child(h_flex().gap(6).items_center()
        .child(div().flex_1().min_w(0).text_size(12).text_color(t.muted).truncate().child(filter.team ? `Team · ${filter.team.name}` : "All teams"))
        .child(this.button("linear-team", filter.team ? "Change team" : "Choose team", cx => { this.teamSearch.set_value(""); this.loadTeams(cx); this.teamSearch.focus(); }, t, { small: true }))
        .when(Boolean(filter.team), el => el.child(this.button("linear-team-clear", "Clear", cx => this.setLinearFilter({ team: null }, cx), t, { small: true, icon: "x", hint: "Show tickets from all teams" }))));
      body.child(h_flex().gap(6).items_center()
        .child(div().flex_1().min_w(0).text_size(12).text_color(t.muted).truncate().child(filter.project?.name ?? "All projects"))
        .child(this.button("linear-project", filter.project ? "Change" : "Choose project", cx => { this.projectSearch.set_value(""); this.loadProjects(cx); this.projectSearch.focus(); }, t, { small: true }))
        .when(Boolean(filter.project), el => el.child(this.button("linear-project-clear", "Clear", cx => this.setLinearFilter({ project: null }, cx), t, { small: true, icon: "x" }))));
      body.child(div().h(1).bg(t.border));
    }
    const watchable = provider !== "linear" || filter.scope === "mine" || Boolean(filter.team || filter.project);
    const filtered = provider === "linear" ? { scope: filter.scope, ...(filter.team ? { team: filter.team } : {}), project: filter.project, label: filterLabel(filter) } : null;
    body.child(this.heading("Watch a state"));
    body.child(this.label(watch ? `Tickets in ${watch.name}${watch.filter?.label ? ` (${watch.filter.label})` : ""} join the queue within a minute, each one once.`
      : !watchable ? "Choose a team, a project or My tickets to watch a state, so tickets from other teams don't flood the queue."
      : `Choose a state and its tickets join the queue by themselves, each one once. Pipeline changes ${service} only as Ticket updates in Settings say.`, t));
    if (state.sourceErrors?.[provider]) body.child(warn(state.sourceErrors[provider]));
    const current = row => watch?.id === row.id && JSON.stringify(watch?.filter ?? null) === JSON.stringify(filtered);
    body.child(h_flex().gap(6).flex_wrap().children(source.states.filter(row => openIssue({ statusType: row.group ?? row.type })).map(row =>
      this.button(`watch-${row.id}`, row.name, cx => this.act({ type: "watchTickets", provider, state: row, filter: filtered }, cx), t,
        { small: true, selected: current(row), disabled: !watchable, hint: `Queue tickets that are in ${row.name}` })))
      .when(Boolean(watch), el => el.child(this.button("watch-stop", "Stop watching", cx => this.act({ type: "watchTickets", provider, state: null }, cx), t, { small: true, icon: "x" }))));
    if (!source.states.length && !source.loading) body.child(this.label(provider === "plane" ? "No states were found for this project." : "No states were found. States come from the teams of the tickets listed below.", t));
    body.child(div().h(1).bg(t.border));
    body.child(this.heading("Pick tickets"));
    body.child(Input.new(this.ticketSearch).w_full().h(34).px(9).bg(t.input).border_1().border_color(t.border).rounded(6).text_size(12).accessibility_label(`Search ${service} tickets`));
    const query = this.ticketSearch.value().trim().toLowerCase();
    const shown = source.issues.filter(issue => `${issue.identifier} ${issue.title} ${issue.status}`.toLowerCase().includes(query));
    const active = new Set(state.tasks.filter(task => task.ticket && task.status !== "done").map(task => task.ticket.uuid));
    const chosen = source.issues.filter(issue => this.ticketPicked.has(issue.uuid) && !active.has(issue.uuid));
    const limit = provider === "linear" ? 10 : Infinity;
    body.child(h_flex().gap(8).flex_wrap()
      .child(this.button(`${provider}-queue`, this.queueing ? "Queueing…" : `Queue ${count(chosen.length, "ticket")}`, cx => this.queueTickets(provider, chosen, cx), t,
        { primary: true, icon: "plus", disabled: !chosen.length || chosen.length > limit || this.queueing, hint: chosen.length > limit ? `Queue up to ${limit} Linear tickets at a time` : undefined }))
      .child(refresh(`${provider}-refresh`)));
    if (source.loading && !source.issues.length) body.child(this.label("Loading open tickets…", t));
    for (const issue of shown.slice(0, 80)) body.child(this.issueRow(provider, issue, active.has(issue.uuid), t));
    if (!source.loading && !shown.length) body.child(this.label(query ? "No open tickets match." : provider === "plane" ? "No open tickets in this project." : "No open tickets here. Try All tickets or change the team or project.", t));
    if (shown.length > 80) body.child(this.label(`Showing 80 of ${shown.length}. Search to narrow the list.`, t));
  }
  teamPicker(body, t) {
    const teams = this.teams;
    body.child(h_flex().gap(8).items_center()
      .child(this.button("linear-team-back", "Back", cx => { this.teams = null; cx.notify(); }, t, { small: true }))
      .child(div().text_size(12).font_medium().child("Choose a team")));
    body.child(Input.new(this.teamSearch).w_full().h(34).px(9).bg(t.input).border_1().border_color(t.border).rounded(6).text_size(12).accessibility_label("Find a Linear team"));
    body.child(this.label("Press Enter to search Linear.", t));
    if (teams.error) body.child(div().text_size(12).line_height(1.45).text_color(t.blocked).child(teams.error));
    if (teams.loading && !teams.items.length) body.child(this.label("Loading teams…", t));
    for (const team of teams.items) body.child(Button.new(`pipeline-linear-team-${team.id}`).w_full().px(10).py(9).rounded(6).bg(t.surface)
      .border_1().border_color(t.border).text_color(t.foreground).text_size(12).tab_index(0).accessibility_label(`Use team ${team.name}`)
      .hover(el => el.bg(t.hover)).focus(el => el.border_color(t.accent))
      .on_click((_e, cx) => this.setLinearFilter({ team: { id: team.uuid || team.id, name: team.name } }, cx))
      .child(div().w_full().whitespace_normal().child(team.name)));
    if (!teams.loading && !teams.items.length && !teams.error) body.child(this.label("No teams match.", t));
  }
  projectPicker(body, t) {
    const projects = this.projects;
    body.child(h_flex().gap(8).items_center()
      .child(this.button("linear-project-back", "Back", cx => { this.projects = null; cx.notify(); }, t, { small: true }))
      .child(div().text_size(12).font_medium().child("Choose a project")));
    body.child(Input.new(this.projectSearch).w_full().h(34).px(9).bg(t.input).border_1().border_color(t.border).rounded(6).text_size(12).accessibility_label("Find a Linear project"));
    body.child(this.label("Press Enter to search Linear.", t));
    if (projects.error) body.child(div().text_size(12).line_height(1.45).text_color(t.blocked).child(projects.error));
    if (projects.loading && !projects.items.length) body.child(this.label("Loading projects…", t));
    for (const project of projects.items) body.child(Button.new(`pipeline-linear-project-${project.id}`).w_full().px(10).py(9).rounded(6).bg(t.surface)
      .border_1().border_color(t.border).text_color(t.foreground).text_size(12).tab_index(0).accessibility_label(`Use ${project.name}`)
      .hover(el => el.bg(t.hover)).focus(el => el.border_color(t.accent))
      .on_click((_e, cx) => this.setLinearFilter({ project: { id: project.id, name: project.name } }, cx))
      .child(div().w_full().whitespace_normal().child(project.name)));
    if (!projects.loading && !projects.items.length && !projects.error) body.child(this.label("No projects match.", t));
  }
  issueRow(provider, issue, inPipeline, t) {
    const picked = this.ticketPicked.has(issue.uuid) && !inPipeline;
    return Button.new(`pipeline-${provider}-${issue.identifier}`).w_full().p(10).rounded(6).bg(picked ? t.selected : t.surface)
      .border_1().border_color(picked ? t.accent : t.border).text_color(t.foreground).tab_index(0).disabled(inPipeline).opacity(inPipeline ? 0.55 : 1)
      .accessibility_label(`${issue.identifier}: ${issue.title}. ${issue.status}.${inPipeline ? " Already in Pipeline." : picked ? " Selected." : ""}`)
      .hover(el => el.bg(t.hover)).focus(el => el.border_color(t.accent))
      .on_click((_e, cx) => { if (inPipeline) return; this.ticketPicked.has(issue.uuid) ? this.ticketPicked.delete(issue.uuid) : this.ticketPicked.add(issue.uuid); cx.notify(); })
      .child(v_flex().w_full().gap(5)
        .child(h_flex().items_center().gap(6).child(div().text_size(11).font_medium().text_color(t.muted).child(issue.identifier))
          .child(div().flex_1().min_w(0).text_size(11).text_color(t.muted).truncate().child([issue.status, issue.priority?.name ?? "No priority", provider === "linear" ? issue.team : null].filter(Boolean).join(" · ")))
          .when(inPipeline, el => el.child(div().text_size(11).text_color(t.muted).child("In Pipeline")))
          .when(picked, el => el.child(icon("check", 13))))
        .child(div().text_size(12).font_medium().child(issue.title)));
  }
  liveSettings(section, body, state, t) {
    if (section === "agent") {
      const chosen = state.agent?.name ?? this.agentChoices[0]?.name;
      body.child(this.label("Each task starts this agent in its own worktree, with the task as its first message.", t));
      if (!this.agentChoices.length) body.child(this.label(this.repo ? "No installed coding agent was found on this machine." : "Looking for installed agents…", t));
      if (this.agentChoices.length) body.child(h_flex().gap(6).flex_wrap().children(this.agentChoices.map(agent => this.button(`agent-${agent.key ?? agent.name}`, agent.name, cx => {
        this.act({ type: "agent", value: { key: agent.key, name: agent.name, run: agent.run } }, cx);
        this.modelInput.set_value(tuningFor(this.state(), agent.key).model ?? "");
      }, t, { selected: chosen === agent.name, icon: chosen === agent.name ? "check" : null, hint: agentRun(state, agent).join(" ") }))));
      this.tuning(body, state, t);
      body.child(div().h(1).bg(t.border));
      this.stepper(body, "Parallel agents", "Lowering the limit lets running agents finish.", state.parallel, "parallel", 1, 6, t);
      body.child(div().h(1).bg(t.border));
      body.child(this.switchRow("auto-trust", "Trust new worktrees automatically", "Agents ask once per new folder whether to trust it. Pipeline's worktrees are your repository at its current commit; with this on, Pipeline answers yes for them.",
        Boolean(state.autoTrust), cx => this.act({ type: "autoTrust" }, cx), t));
      body.child(div().h(1).bg(t.border));
      body.child(this.heading("Agent instructions"));
      body.child(this.label("Added to every task's first message, after Pipeline's own. For what is yours; how to run and test the project belongs in the repository's AGENTS.md or a skill, which agents read anyway.", t));
      body.child(Textarea.new(this.instructions).w_full().p(8).bg(t.input).border_1().border_color(t.border).rounded(6).text_size(12).accessibility_label("Agent instructions"));
      body.child(h_flex().child(this.button("instructions-save", "Save", cx => this.saveInstructions(cx), t, { small: true, disabled: this.instructions.value().trim() === (state.instructions ?? "") })));
      body.child(this.switchRow("evidence", "Show the change", "Asks each agent for before and after screenshots of what it changes, presented on a private page it publishes. The task's inspector opens it.",
        Boolean(state.evidence), cx => this.act({ type: "evidence" }, cx), t));
    } else if (section === "limits") this.limits(body, state, t);
    else if (section === "implementer") this.implementerSettings(body, state, t);
    else if (section === "planner") this.plannerSettings(body, state, t);
    else if (section === "repositories") this.repositories(body, state, t);
    else if (section === "checks") {
      body.child(this.heading("Check before review"));
      body.child(this.label("When an agent finishes, this command runs in its worktree, in each repository the task touches. Passing work moves to review; leave it empty to skip checks.", t));
      body.child(h_flex().gap(6).items_center()
        .child(Input.new(this.checkInput).flex_1().min_w(0).h(32).px(9).bg(t.input).border_1().border_color(t.border).rounded(6).text_size(12)
          .font_family(settings().font_family ?? "JetBrains Mono").accessibility_label("Check command"))
        .child(this.button("check-save", "Save", cx => this.saveCheck(cx), t, { small: true, disabled: this.checkInput.value().trim() === (state.check?.command ?? "") })));
      const suggestions = this.checkSuggestions.filter(command => command !== state.check?.command);
      if (suggestions.length) body.child(h_flex().gap(6).flex_wrap().children(suggestions.map(command => this.button(`check-use-${command}`, `Use ${command}`, cx => {
        this.checkInput.set_value(command); this.act({ type: "check", command }, cx);
      }, t, { small: true, hint: "Found in this repository" }))));
      if (state.check?.command) body.child(this.switchRow("check-fix", "Send failures back to the agent", state.check.fix ? "Up to 2 times, then the task waits for you" : "Failures wait for you",
        Boolean(state.check.fix), cx => this.act({ type: "check", fix: !state.check.fix }, cx), t));
      body.child(div().h(1).bg(t.border));
      body.child(this.heading("Try it"));
      body.child(this.label("Runs a task's branch from its worktree, in a tab of its own, so you can use the change before merging: a dev server, a preview build, a second app window. Its task id is in $PIPELINE_TASK. The tab closes when the task merges or is discarded.", t));
      body.child(h_flex().gap(6).items_center()
        .child(Input.new(this.tryInput).flex_1().min_w(0).h(32).px(9).bg(t.input).border_1().border_color(t.border).rounded(6).text_size(12)
          .font_family(settings().font_family ?? "JetBrains Mono").accessibility_label("Try it command"))
        .child(this.button("try-save", "Save", cx => this.saveTry(cx), t, { small: true, disabled: this.tryInput.value().trim() === (state.tryout ?? "") })));
      const runs = this.trySuggestions.filter(command => command !== state.tryout);
      if (runs.length) body.child(h_flex().gap(6).flex_wrap().children(runs.map(command => this.button(`try-use-${command}`, `Use ${command}`, cx => {
        this.tryInput.set_value(command); this.act({ type: "tryout", command }, cx);
      }, t, { small: true, hint: "Found in this repository" }))));
      if (state.tryout) body.child(this.switchRow("try-auto", "Start it when work is ready for review", "Each finished task is running by the time you look at it, in a tab beside its agent. Its own port is in $PIPELINE_PORT, so two can run at once if the command uses it.",
        Boolean(state.tryAuto), cx => this.act({ type: "tryAuto" }, cx), t));
      body.child(div().h(1).bg(t.border));
      body.child(this.heading("Prepare a new worktree"));
      body.child(this.label("Runs once in each new worktree, before its agent starts: what Git doesn't carry over, such as cp \"$PIPELINE_SOURCE/.env\" . && npm ci. Your project folder is in $PIPELINE_SOURCE. A failure is noted in the task's history and the agent still starts.", t));
      body.child(h_flex().gap(6).items_center()
        .child(Input.new(this.prepareInput).flex_1().min_w(0).h(32).px(9).bg(t.input).border_1().border_color(t.border).rounded(6).text_size(12)
          .font_family(settings().font_family ?? "JetBrains Mono").accessibility_label("Prepare command"))
        .child(this.button("prepare-save", "Save", cx => this.savePrepare(cx), t, { small: true, disabled: this.prepareInput.value().trim() === (state.prepare ?? "") })));
      const prepares = this.prepareSuggestions.filter(command => command !== state.prepare);
      if (prepares.length) body.child(h_flex().gap(6).flex_wrap().children(prepares.map(command => this.button("prepare-use", `Use ${command}`, cx => {
        this.prepareInput.set_value(command); this.act({ type: "prepare", command }, cx);
      }, t, { small: true, hint: "What this repository ignores but needs to run" }))));
    } else if (section === "delivery") {
      body.child(h_flex().gap(6).flex_wrap()
        .child(this.button("deliver-merge", "Merge locally", cx => this.act({ type: "deliver", value: "merge" }, cx), t, { selected: state.delivery !== "pr" }))
        .child(this.button("deliver-pr", "Open a pull request", cx => this.act({ type: "deliver", value: "pr" }, cx), t, { selected: state.delivery === "pr" })));
      if (state.delivery === "pr") body.child(this.switchRow("auto-pr", "Open pull requests automatically", state.autoPr ? "As soon as the agent finishes and checks pass, so you review on GitHub" : "Each pull request waits for you to approve it",
        Boolean(state.autoPr), cx => this.act({ type: "autoPr" }, cx), t));
      else body.child(this.switchRow("auto-merge", "Merge automatically", state.autoMerge ? "As soon as the agent finishes and checks pass, without waiting for you" : "Each merge waits for you",
        Boolean(state.autoMerge), cx => this.act({ type: "autoMerge" }, cx), t));
      if (state.delivery === "pr") body.child(this.switchRow("draft-pr", "Open them as drafts", state.draftPr ? "Each one opens as a draft; mark it ready from its task" : "Each one opens ready for review",
        Boolean(state.draftPr), cx => this.act({ type: "draftPr" }, cx), t));
      if (state.delivery === "pr") body.child(this.switchRow("pr-approval", "Wait for an approval", state.prApproval ? "A pull request is ready to merge only once someone approved it" : "A pull request is ready to merge when GitHub says so, approved or not",
        Boolean(state.prApproval), cx => this.act({ type: "prApproval" }, cx), t));
      if (state.delivery === "pr") body.child(this.switchRow("auto-rebase", "Rebase on conflicts", state.autoRebase ? "A pull request that conflicts has its agent rebase and push by itself, reopening the agent if its tab is closed" : "A conflicting pull request waits for you to ask its agent",
        Boolean(state.autoRebase), cx => this.act({ type: "autoRebase" }, cx), t));
      if (state.delivery === "pr" && state.evidence) body.child(this.switchRow("evidence-pr", "Link the walkthrough page in the pull request", "Adds one line to the description linking the before and after page. The screenshots themselves stay out of the repository",
        Boolean(state.evidencePr), cx => this.act({ type: "evidencePr" }, cx), t));
      if (state.delivery !== "pr") body.child(this.switchRow("push-after-merge", "Push after merging", `Pushes ${this.repo?.branch ?? "your branch"} to origin after each merge`,
        Boolean(state.pushAfterMerge), cx => this.act({ type: "pushAfterMerge" }, cx), t));
      body.child(this.label(state.delivery === "pr"
        ? `${state.autoPr ? "Once the agent finishes and checks pass, Pipeline" : "Approving"} pushes its branch to origin and opens a pull request into ${this.repo?.branch ?? "your branch"} with gh, described by the agent. It waits while the agent has uncommitted changes. The task finishes when the PR is merged on GitHub; then its tab closes and the worktree and branch are removed. Needs gh, signed in.`
        : `${state.autoMerge ? "Once the agent finishes and checks pass, Pipeline" : "Merge"} rebases its branch onto ${this.repo?.branch ?? "your branch"} and fast-forwards, so history stays linear. It refuses while the agent or your project folder has uncommitted changes, or the branch conflicts; the task stays in review with the reason. ${state.pushAfterMerge ? `Then it pushes ${this.repo?.branch ?? "the branch"} to origin. It never forces or pulls: if origin refuses, the merge stays, the task is done, and the status bar offers Push now. ` : ""}Afterwards its tab closes and the worktree and branch are removed.`, t));
      if (state.delivery !== "pr") {
        body.child(div().h(1).bg(t.border));
        body.child(this.heading("After merge"));
        body.child(this.label("Runs in your project folder once merges have landed, in each repository a task merged into: an install or deploy script, so merged work takes effect without you. One run covers every merge before it. If it fails, the merge stays and the status bar offers Run again.", t));
        body.child(h_flex().gap(6).items_center()
          .child(Input.new(this.afterInput).flex_1().min_w(0).h(32).px(9).bg(t.input).border_1().border_color(t.border).rounded(6).text_size(12)
            .font_family(settings().font_family ?? "JetBrains Mono").accessibility_label("After merge command"))
          .child(this.button("after-save", "Save", cx => this.saveAfter(cx), t, { small: true, disabled: this.afterInput.value().trim() === (state.afterMerge ?? "") })));
        const afters = this.afterSuggestions.filter(command => command !== state.afterMerge);
        if (afters.length) body.child(h_flex().gap(6).flex_wrap().children(afters.map(command => this.button(`after-use-${command}`, `Use ${command}`, cx => {
          this.afterInput.set_value(command); this.act({ type: "afterMerge", command }, cx);
        }, t, { small: true, hint: "Found in this repository" }))));
      }
      body.child(div().h(1).bg(t.border));
      this.stepper(body, "Branches waiting for review", "New agents wait while this many finished branches are unmerged.", state.reviewLimit, "reviewLimit", 1, 10, t);
    } else if (section === "tickets") this.ticketUpdates(body, state, t);
    else {
      body.child(this.switchRow("notify", "Notify me", "When checks fail, a merge is refused, a pull request needs you or finished work is ready, while you're looking elsewhere",
        !state.quiet, cx => this.act({ type: "quiet" }, cx), t));
      body.child(this.motionSwitch(t));
      body.child(h_flex().gap(10).items_center()
        .child(div().flex_1().min_w(0).text_size(12).text_color(t.muted).child("The card a new pipeline opens with: checks, Try it, delivery and After merge at a glance, with Choose for me."))
        .child(this.button("setup-show", "Show setup", cx => { this.act({ type: "setupShow" }, cx); this.open(null, cx); }, t, { small: true, icon: "sparkles", disabled: Boolean(state.setup) })));
      body.child(h_flex().gap(10).items_center()
        .child(div().flex_1().min_w(0).text_size(12).text_color(t.muted).child("See how Pipeline works with example tasks and pretend agents. Nothing real is touched, and this pipeline keeps running."))
        .child(this.button("demo", "Try a demo", cx => this.setMode("simulation", cx), t, { small: true, icon: "flask" })));
      body.child(this.label("Agents run in herdr-core, so they keep working if you close this tab or Herdr. Pipeline catches up with them when it opens again.", t));
      this.savedPipelines(body, state, t);
      body.child(this.heading("Keys")).child(this.label(KEYS.live, t));
    }
  }
  // Every pipeline Herdr has saved, so the ones no longer wanted can go. Settings are the project's, shared by its spaces.
  savedPipelines(body, state, t) {
    const all = shared(STORE) ?? {}, own = this.storeKey(), open = new Set(spaces().map(space => space.id));
    const others = Object.entries(all).filter(([key, saved]) => key !== own && saved?.live && !newer(saved));
    const shares = projectPipelines(all, own).length;
    body.child(div().h(1).bg(t.border));
    body.child(this.heading("Saved pipelines"));
    body.child(this.label(`This project's settings are saved with it${shares ? ` and shared with its ${shares === 1 ? "other pipeline" : `${shares} other pipelines`}` : ""}: closing Pipeline keeps them, and a new space on this folder starts with them.`, t));
    const asked = this.confirm === "reset-settings";
    body.child(h_flex().gap(10).items_center()
      .child(div().flex_1().min_w(0).text_size(12).text_color(asked ? t.blocked : t.muted).child(asked ? "Clears the agent, checks, Try it, delivery, ticket updates and instructions for this project. Tasks stay." : "Start this project's settings over."))
      .child(this.button("settings-reset", asked ? "Yes, reset" : "Reset project settings", cx => { if (asked) this.resetProject(cx); else { this.confirm = "reset-settings"; cx.notify(); } }, t, { small: true, icon: "reset" })));
    const stale = others.filter(([, saved]) => forgettable(saved));
    for (const [key, saved] of others.slice(0, 30)) {
      const left = (saved.tasks ?? []).filter(task => task.status !== "done").length, can = forgettable(saved);
      body.child(h_flex().id(`pipeline-saved-${key}`).gap(10).items_center()
        .child(v_flex().flex_1().min_w(0).text_size(12)
          .child(div().truncate().child(`${saved.context?.name ?? saved.repo ?? "Pipeline"}${saved.space && !open.has(saved.space) ? " · its space is closed" : ""}`))
          .child(div().truncate().text_size(11).text_color(t.muted).child(`${saved.context?.cwd ?? ""} · ${can ? (saved.tasks?.length ? "all tasks merged" : "no tasks") : saved.running ? "started" : `${left} unfinished ${left === 1 ? "task" : "tasks"}`}`)))
        .child(this.button(`forget-${key}`, "Forget", cx => this.forget(key, cx), t, { small: true, icon: "x", disabled: !can, hint: can ? "Removes this saved pipeline and its history. Nothing of it is running" : "Close that pipeline first: it still has work" })));
    }
    if (stale.length > 1) body.child(h_flex().child(this.button("forget-all", `Forget the ${stale.length} with nothing left to do`, cx => { for (const [key] of stale) this.forget(key, cx); }, t, { small: true, icon: "x" })));
    if (!others.length) body.child(this.label("No other pipeline is saved.", t));
  }
  repositories(body, state, t) {
    const repos = state.repositories ?? [{ name: state.repo, path: this.context.cwd }];
    body.child(this.label("Tasks start in the project's repository. Add others a task may change too, then pick them per task in its inspector. Each task gets its own worktree and branch in every repository it touches.", t));
    repos.forEach((repo, i) => body.child(h_flex().id(`pipeline-repository-${repo.name}`).gap(8).items_center()
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().text_size(12).font_medium().truncate().child(i ? repo.name : `${repo.name} · project`))
        .child(div().text_size(11).text_color(t.muted).truncate().child(repo.path)))
      .when(i > 0, el => el.child(this.button(`repository-remove-${repo.name}`, `Remove ${repo.name}`, cx => this.act({ type: "removeRepository", name: repo.name }, cx), t,
        { small: true, icon: "x", iconOnly: true, hint: `Stop offering ${repo.name} to tasks. Work already started there keeps its worktree.` })))));
    body.child(h_flex().gap(6).items_center()
      .child(Input.new(this.repoInput).flex_1().min_w(0).h(32).px(9).bg(t.input).border_1().border_color(this.repoError ? t.blocked : t.border).rounded(6).text_size(12)
        .font_family(settings().font_family ?? "JetBrains Mono").accessibility_label("Repository path"))
      .child(this.button("repository-add", this.repoAdding ? "Checking…" : "Add", cx => this.addRepository(cx), t,
        { small: true, disabled: !this.repoInput.value().trim() || this.repoAdding, hint: `A folder on ${this.context.on ? "the project's machine" : "this computer"} inside a Git repository` })));
    if (this.repoError) body.child(div().text_size(12).line_height(1.45).text_color(t.blocked).child(this.repoError));
  }
  ticketUpdates(body, state, t) {
    body.child(this.label("Pipeline can move a ticket as its work goes and link its pull request. Updates never hold up a task: one that fails waits in the task's inspector for Try again.", t));
    for (const [provider, service] of Object.entries(SOURCES)) {
      const setup = state.ticketUpdates?.[provider] ?? {}, source = this.updateStates[provider];
      body.child(div().pt(4).text_size(12).font_semibold().child(service));
      if (provider === "linear") body.child(h_flex().gap(8).items_center()
        .child(div().flex_1().min_w(0).text_size(12).text_color(t.muted).child(state.linear?.team ? `Team: ${state.linear.team.name}${state.linear.project ? ` · ${state.linear.project.name}` : ""}` : "No team chosen. Its states come from the team."))
        .child(this.button("update-linear-team", state.linear?.team ? "Change team" : "Choose team", cx => { this.open("linear", cx); this.teamSearch.set_value(""); this.loadTeams(cx); }, t, { small: true, icon: "linear" })));
      const guess = guessUpdates(source.states);
      if (updatesLabel(guess) && updatesLabel(guess) !== updatesLabel(setup)) body.child(h_flex().child(this.button(`update-${provider}-guess`, `Use ${updatesLabel(guess)}`, cx => this.useUpdates(provider, guess, cx), t,
        { small: true, icon: "sparkles", hint: "Sets the three moves below and links pull requests" })));
      if (source.loading) body.child(this.label("Loading states…", t));
      else if (source.error) body.child(this.label(source.error, t));
      else if (!source.states.length) body.child(this.label(provider === "plane" ? "No states were found for the Plane project linked to this repository."
        : "Choose a team, or queue a Linear ticket: states come from the team.", t));
      for (const [kind, title] of Object.entries(UPDATE_KINDS)) {
        const options = [...source.states, ...(setup[kind] && !source.states.some(row => row.id === setup[kind].id) ? [setup[kind]] : [])];
        body.child(this.label(title, t));
        body.child(h_flex().gap(6).flex_wrap()
          .child(this.button(`update-${provider}-${kind}-none`, "Don't change", cx => this.act({ type: "ticketUpdates", provider, [kind]: null }, cx), t, { small: true, selected: !setup[kind] }))
          .children(options.map(row => this.button(`update-${provider}-${kind}-${row.id}`, row.name, cx => this.act({ type: "ticketUpdates", provider, [kind]: { id: row.id, name: row.name } }, cx), t,
            { small: true, selected: setup[kind]?.id === row.id, hint: `${title}, move its ${service} ticket to ${row.name}` }))));
      }
      body.child(this.switchRow(`update-${provider}-link`, "Link pull requests to the ticket", `Adds “PR #N: title” to the ${service} ticket when its pull request opens`,
        Boolean(setup.link), cx => this.act({ type: "ticketUpdates", provider, link: !setup.link }, cx), t));
      if (provider === "linear" && this.linearWrite === false) body.child(h_flex().id("pipeline-linear-readonly").gap(8).items_center()
        .child(div().flex_1().min_w(0).text_size(12).line_height(1.45).text_color(t.blocked).child("Your Linear connection can only read, so these updates will fail."))
        .child(this.button("linear-connect-settings", "Connect Linear", () => this.connectLinear(), t, { small: true, icon: "linear", hint: "Opens a terminal that asks privately for a key with Write permission" })));
      else if (provider === "linear") body.child(this.label(this.linearWrite ? "Your Linear connection can write." : "Linear updates need a connection with Write permission.", t));
    }
  }
  evidenceDetail(body, task, t) {
    const files = task.evidence.files ?? [], local = !this.context.on, name = file => file.split("/").pop().replace(/\.[a-z]+$/i, "");
    body.child(this.heading("Before and after"));
    if (task.evidence.url) body.child(h_flex().child(this.button(`walkthrough-${task.id}`, "Open walkthrough", () => this.openLink(task.evidence.url), t,
      { icon: "sparkles", primary: true, hint: `The agent's page with the screenshots side by side\n${task.evidence.url}` })));
    else if (files.length) body.child(this.label("Its agent published no page, so here are the screenshots on their own.", t));
    if (files.length) body.child(h_flex().id(`pipeline-evidence-${task.id}`).gap(6).flex_wrap().children(files.map((file, i) => this.button(`evidence-${task.id}-${i}`, name(file), () => this.showEvidence(task, file), t,
      { small: true, icon: "eye", disabled: !local, hint: local ? "Opens it in the Show panel, where you can mark it up" : "Saved in its worktree on the project's machine" }))));
  }
  ticketUpdateDetail(body, task, t) {
    const ticket = task.ticket, service = SOURCES[ticket.provider], failed = ticket.failed ?? [];
    for (const update of failed) body.child(div().text_size(12).line_height(1.45).text_color(t.blocked)
      .child(`${update.kind === "link" ? update.links ? "Couldn't link the pull requests" : `Couldn't link PR #${update.number}` : `Couldn't move it to ${update.state.name}`}: ${update.error}`));
    if (failed.length) body.child(h_flex().gap(8).flex_wrap()
      .child(this.button(`ticket-retry-${task.id}`, "Try again", cx => this.act({ type: "ticketRetry", id: task.id }, cx), t, { icon: "reset", hint: `Make the ${service} update again` }))
      .when(ticket.provider === "linear" && failed.some(update => update.errorKind === "write_access"), el => el.child(this.button(`linear-connect-${task.id}`, "Connect Linear", () => this.connectLinear(), t,
        { icon: "linear", hint: "Opens a terminal that asks privately for a key with Write permission" }))));
    else if (ticket.pending?.length) body.child(this.label(`Updating ${service}…`, t));
    else if (ticket.update?.ok) body.child(this.label(ticket.update.text, t));
  }
  tuning(body, state, t) {
    const key = this.agentKey(state), options = AGENT_OPTIONS[key];
    if (!this.agentChoices.length) return;
    if (!options) { body.child(this.label(`Pipeline starts ${this.agentName(state)} with its own default model and effort.`, t)); return; }
    const tune = tuningFor(state, key);
    this.modelAndEffort(body, t, { prefix: "", key, name: this.agentName(state), tune, input: this.modelInput, set: (change, cx) => this.act({ type: "tune", key, ...change }, cx) });
    body.child(this.label(`New tasks start with ${tuningLabel(tune) || "the agent's own default model and effort"}. Running agents keep theirs.`, t));
  }
  // The model list and effort chips, for the agent tasks start with and for the AI helper.
  modelAndEffort(body, t, { prefix, key, name, tune, input, set, same = null }) {
    const options = AGENT_OPTIONS[key], listed = this.listedModels(key), known = listed.find(model => model.slug === (tune.model ?? same?.model));
    const unset = same ? "As set" : "Default", unsetHint = same ? "Follows the model and effort in Settings" : `Whatever ${name} uses when started on its own`;
    const efforts = known && (known.efforts.length || options.exact) ? known.efforts : listed.length ? [...new Set(listed.flatMap(model => model.efforts))] : options.efforts;
    const matches = this.modelMatches(key, tune, input), typed = input.value().trim(), searching = Boolean(typed) && typed !== (tune.model ?? ""), first = searching ? matches[0] : null;
    const groups = [...new Set(matches.map(model => model.group ?? ""))].map(group => [group, matches.filter(model => (model.group ?? "") === group)]);
    const row = (id, label, picked, hint, pick, tag) => Button.new(`pipeline-${prefix}model-${id}`).w_full().px(8).py(5).rounded(4).text_color(t.foreground).text_size(12).tab_index(0)
      .bg(t.background).accessibility_label(`Use ${label}`).selected(picked).tooltip(hint)
      .hover(el => el.bg(t.hover)).focus(el => el.bg(t.hover)).on_click(pick)
      .child(h_flex().w_full().gap(8).items_center()
        .child(div().w(10).flex_none().text_color(t.accent).child(picked ? "●" : ""))
        .child(div().flex_1().min_w(0).truncate().child(label))
        .when(Boolean(tag), el => el.child(div().flex_none().text_size(11).text_color(t.muted).child(tag ?? ""))));
    const rows = [
      ...(searching ? [] : [row("default", unset, !tune.model, unsetHint, (_e, cx) => {
        const base = listed.find(model => model.slug === same?.model);
        set({ model: null, ...(options.exact && tune.effort && !base?.efforts.includes(tune.effort) ? { effort: null } : {}) }, cx); input.set_value("");
      })]),
      ...groups.flatMap(([group, models]) => [
        ...(group ? [div().px(8).pt(8).pb(4).text_size(11).font_medium().text_color(t.muted).child(group)] : []),
        ...models.map(model => row(model.slug, model.name, model.slug === tune.model, model.hint ?? model.slug,
          (_e, cx) => { set(this.modelChange(key, tune, model), cx); input.set_value(model.slug); }, model.free ? "Free" : null).when(model === first, el => el.bg(t.selected)))]),
      ...(matches.length ? [] : [div().px(8).py(5).text_size(12).text_color(t.muted).child(searching ? "No listed model matches." : `${name} lists no models here.`)])];
    const headers = groups.filter(([group]) => group).length, height = Math.min(MODEL_LIST, (rows.length - headers) * 26 + headers * 30 + 10);
    const chip = (id, text, selected, change, hint) => this.button(`${prefix}${id}`, text, cx => set(change, cx), t, { small: true, selected, hint });
    body.child(this.heading(same ? "Model for this task" : "Model"));
    body.child(h_flex().gap(6).items_center()
      .child(Input.new(input).flex_1().min_w(0).h(32).px(9).bg(t.input).border_1().border_color(t.border).rounded(6).text_size(12)
        .font_family(settings().font_family ?? "JetBrains Mono").accessibility_label("Find a model, or type its name"))
      .child(this.button(`${prefix}model-save`, "Save", cx => this.saveTyped(key, tune, input, set, cx), t, { small: true, disabled: typed === (tune.model ?? ""),
        hint: first ? `Uses ${first.name}, the first match (Enter)` : "Uses the name as typed (Enter)" })));
    // A list scrolls only at a set height: one that only has a maximum grows past it and clips.
    body.child(div().w_full().h(height).flex_none().rounded(6).bg(t.background).border_1().border_color(t.border).overflow_hidden()
      .child(v_flex().id(`pipeline-${prefix}model-list`).size_full().p(4).overflow_y_scrollbar().children(rows)));
    body.child(this.label(first ? `Enter picks ${first.name}.` : searching ? `Enter or Save uses “${typed}” as typed.`
      : "Type to narrow the list, or type a model that isn't listed.", t));
    body.child(this.heading(same ? "Effort for this task" : "Effort"));
    if (options.exact && !known && !(tune.model ?? same?.model)) body.child(this.label(`Pick a model to choose its effort: ${name} sets effort per model.`, t));
    else body.child(h_flex().gap(6).flex_wrap()
      .child(chip("effort-default", unset, !tune.effort, { effort: null }, unsetHint))
      .children(efforts.map(effort => chip(`effort-${effort}`, effort, tune.effort === effort, { effort }))));
  }
  screen(lines, t, caption) {
    return v_flex().w_full().gap(4)
      .when(Boolean(caption), el => el.child(this.label(caption, t)))
      .child(v_flex().w_full().p(10).rounded(6).bg(t.background).border_1().border_color(t.border).font_family(settings().font_family ?? "JetBrains Mono").text_size(11)
        .children(lines.map(line => div().min_h(15).truncate().child(line || " "))));
  }
  waitsDetail(body, state, task, t) {
    const service = SOURCES[task.ticket?.provider], others = state.tasks.filter(other => other !== task && other.status !== "done");
    if (!task.blockers?.length && !others.length) return;
    body.child(this.heading("Waits for"));
    (task.blockers ?? []).forEach((blocker, i) => {
      const inside = blocker.key && state.tasks.find(row => row !== task && row.ticket?.provider === task.ticket?.provider && row.ticket?.key === blocker.key);
      const status = inside ? labelFor(state, inside.status) : blocker.closed === true ? `Closed in ${service}` : blocker.closed === false ? `Open in ${service}` : "Can't be read";
      const title = blocker.title.length > 34 ? `${blocker.title.slice(0, 33)}…` : blocker.title;
      body.child(this.button(`blocker-${task.id}-${i}`, [blocker.key ?? "Ticket", status, title].filter(Boolean).join(" · "), cx => inside ? this.inspect(inside.id, cx) : this.openLink(blocker.url), t,
        { small: true, disabled: !inside && !blocker.url, hint: blocker.title || blocker.key || "A ticket Pipeline can't read" }).w_full().justify_start());
    });
    if (task.blockers?.length) body.child(this.label(`Blockers come from ${service}. One in the pipeline waits until it merges, any other until its ticket closes.`, t));
    if (others.length) {
      body.child(h_flex().gap(6).flex_wrap().children(others.map(other => {
        const linked = task.depends.includes(other.id), allowed = linked || canWaitFor(state, task, other);
        return this.button(`wait-${task.id}-${other.id}`, other.id, cx => this.act({ type: "link", id: task.id, on: other.id }, cx), t,
          { small: true, selected: linked, icon: linked ? "check" : null, disabled: !allowed, hint: !allowed ? `${other.id} already waits for this task` : `${linked ? "Stop waiting for" : "Wait for"} ${other.id}: ${other.title}` });
      })));
      body.child(this.label("Pick tasks this one should start after. It starts once they merge.", t));
    }
    if (waitsFor(state, task).length) body.child(this.button(`unblock-${task.id}`, "Start anyway", cx => this.act({ type: "unblock", id: task.id, value: true }, cx), t,
      { icon: "play", hint: "Let the planner start it without waiting" }));
    else if (task.unblocked) body.child(this.label("Starts without waiting for what it depends on.", t))
      .child(this.button(`reblock-${task.id}`, "Wait again", cx => this.act({ type: "unblock", id: task.id, value: false }, cx), t, { icon: "pause" }));
  }
  liveDetail(body, state, task, t, cx) {
    this.peekAt(task, cx);
    const trees = workspacesOf(task), several = task.repos.length > 1, target = targetOf(task) ?? this.repo?.branch ?? "your branch";
    const branch = (trees[0] ?? Object.values(task.planned ?? {})[0])?.branch;
    body.child(this.copyable(`title-${task.id}`, task.title).text_size(18).font_semibold().line_height(1.3));
    body.child(h_flex().gap(7).items_center().flex_wrap().child(dot(stateColor(task, t))).child(div().text_size(12).child(task.discard ? "Discarding" : adoptStep(task) ?? labelFor(state, task.status)))
      .when(Boolean(timing(task)), el => el.child(div().text_size(12).text_color(t.muted).child(`· ${timing(task)}`))));
    if (task.agent) body.child(div().id(`pipeline-agent-line-${task.id}`).w_full().min_w(0).text_size(12).line_height(1.45).text_color(t.muted).child(`${task.agent}${task.tuning ? ` · ${task.tuning}` : ""}${task.implementer ? ` · code by ${task.implementer}` : ""}`));
    if (task.error) body.child(this.copyable(`error-${task.id}`, task.error).text_size(12).line_height(1.45).text_color(t.blocked));
    if (task.status === "pr" && task.prs) this.prDetail(body, state, task, t, several);
    if (adoptStep(task) && !task.discard) {
      const pane = panes().find(row => row.terminal === task.adopt.terminal), agent = task.adopt.agent ?? "Its agent";
      body.child(this.label(!task.adopt.files ? `${agent} was asked what it is working on and which uncommitted files are its own. It answers when its current turn ends; then Pipeline makes the worktree and moves those files.`
        : task.adopt.moved === undefined ? "Making its worktree and moving its files out of the project folder." : `Telling ${agent} to carry on in the worktree.`, t));
      if (pane) body.child(this.button(`open-${task.id}`, "Open agent", () => this.showPane(pane), t, { icon: "terminal", hint: "Show its terminal" }));
    }
    if (task.stalled) body.child(div().text_size(12).line_height(1.45).text_color(t.blocked).child(`Its terminal has shown nothing new for ${elapsed(Date.now() - task.stalled)}. Open its agent to see whether it is stuck.`));
    if (conflicted(task)) body.child(this.button(`resolve-${task.id}`, `Ask the agent to rebase onto ${target}`, cx => this.resolve(task, cx), t,
      { icon: "reset", primary: true, hint: "Sends the refusal to its agent, which rebases, resolves the conflicts and stops for review again" }));
    if (uncommitted(task)) body.child(h_flex().gap(8).flex_wrap()
      .when(Boolean(task.terminal), el => el.child(this.button(`ask-commit-${task.id}`, "Ask the agent to commit", cx => this.resolve(task, cx, "commit"), t,
        { icon: "reset", primary: true, hint: "Asks its agent to commit what belongs to the task, or to finish first if it is still working" })))
      .child(this.button(`commit-anyway-${task.id}`, "Commit them anyway", cx => this.act({ type: "approve", id: task.id, commit: true }, cx), t,
        { icon: "check", hint: `Commits everything in its worktree as one commit, then ${state.delivery === "pr" ? "opens the pull request" : "merges"}` })));
    const ticket = task.ticket, service = SOURCES[ticket?.provider];
    if (service) body.child(h_flex().gap(8).items_center().child(div().flex_1().min_w(0).text_size(12).text_color(t.muted).truncate().child(`${service} ${ticket.key} · ${ticket.status} · ${task.source}`))
      .when(Boolean(ticket.url), el => el.child(this.button(`${ticket.provider}-link-${task.id}`, `Open in ${service}`, () => this.openLink(ticket.url), t, { small: true, icon: ticket.provider, hint: ticket.url }))));
    if (service) this.ticketUpdateDetail(body, task, t);
    if (service && task.status !== "done" && !updatesLabel(state.ticketUpdates?.[task.ticket.provider])) body.child(h_flex().gap(8).items_center()
      .child(div().flex_1().min_w(0).text_size(12).line_height(1.45).text_color(t.ansi3).child(`Its ${service} ticket stays ${task.ticket.status ? `in ${task.ticket.status}` : "as it is"}: ticket updates are off.`))
      .child(this.button(`ticket-setup-${task.id}`, "Set up", cx => this.open("settings", cx, "tickets"), t, { small: true, hint: "Choose the states its ticket moves to" })));
    if (task.status === "queued") {
      body.child(this.heading("Details for the agent"));
      body.child(Textarea.new(this.details).w_full().h(120).px(9).py(8).rounded(6).border_1().border_color(t.border).bg(t.input).text_size(12).accessibility_label("Details for the agent"));
      body.child(this.label("The title and these details are the agent's first message. Saved when you leave the field.", t));
      this.imagesDetail(body, task, t);
      body.child(this.label(waitingReason(state, task), t));
      if (state.planner?.on && task.plan?.reason && task.plan.sig === planSig(task)) body.child(div().id(`pipeline-plan-reason-${task.id}`).text_size(12).line_height(1.45)
        .child(`Planner: ${task.plan.reason}${task.plan.waits.length ? ` Waits for ${task.plan.waits.join(", ")}.` : ""}`));
      const queue = queueOrder(state), at = queue.findIndex(row => row.id === task.id);
      body.child(h_flex().gap(6).items_center().flex_wrap().child(this.firstButton(task, t))
        .child(this.button(`up-${task.id}`, "Move up", cx => this.act({ type: "move", id: task.id, delta: -1 }, cx), t, { disabled: at <= 0, hint: "Start it before the task above it" }))
        .child(this.button(`down-${task.id}`, "Move down", cx => this.act({ type: "move", id: task.id, delta: 1 }, cx), t, { disabled: at < 0 || at >= queue.length - 1, hint: "Start it after the task below it" })));
      this.taskTune(body, state, task, t);
      if (state.implementer?.on) body.child(this.switchRow(`solo-${task.id}`, "Hand the implementation over", task.solo ? `${this.agentName(state)} writes this task's code itself` : `Code by ${implementerFor(state, task).label}`,
        !task.solo, cx => this.act({ type: "solo", id: task.id }, cx), t));
      this.repoChips(body, state, task, t);
      this.waitsDetail(body, state, task, t);
    } else {
      if (task.description) body.child(this.copyable(`description-${task.id}`, task.description).text_size(12).line_height(1.5).text_color(t.muted));
      if (several) body.child(this.label(`Repositories: ${task.repos.join(" + ")}`, t));
    }
    if (task.summary && task.status !== "queued") body.child(this.heading("Summary from the agent"))
      .child(v_flex().id(`pipeline-summary-${task.id}`).w_full().p(10).gap(2).rounded(6).border_1().border_color(t.border).bg(t.surface).text_size(12).line_height(1.5)
        .children(task.summary.split("\n").filter(line => line.trim()).map(line => {
          const [, label, rest] = line.match(/^\s*(Changed|Checked|Unsure):\s*(.*)$/) ?? [];
          return label ? h_flex().gap(8).items_start().child(div().w(56).flex_none().text_color(label === "Unsure" ? t.ansi3 : t.muted).child(label)).child(div().flex_1().min_w(0).child(this.copyable(`summary-${task.id}-${label}`, rest).text_size(12).line_height(1.5))) : div().child(line);
        })));
    if (task.evidence && task.status !== "queued") this.evidenceDetail(body, task, t);
    if (task.terminal && trees.length && !(task.evidence?.files?.length && task.evidence.url) && ["working", "input", "review"].includes(task.status) && !task.discard) {
      const asked = this.asked?.id === task.id ? this.asked : null;
      body.child(h_flex().gap(8).items_center()
        .child(this.button(`evidence-ask-${task.id}`, asked?.pending ? "Asking…" : task.evidence?.files?.length ? "Ask for the walkthrough page" : "Ask for screenshots", cx => this.askEvidence(task, cx), t,
          { small: true, icon: "eye", disabled: Boolean(asked?.pending || asked?.sent), hint: "Asks its agent for before and after screenshots of what it changed, presented on a page. It appears here when its turn ends" }))
        .when(Boolean(asked && !asked.pending), el => el.child(div().flex_1().min_w(0).text_size(12).text_color(t.muted).child(asked.sent ? "Asked. The page appears here when its turn ends." : "Couldn't reach its terminal."))));
    }
    if (task.terminal && task.status !== "done" && !task.discard && !(task.status === "pr" && (task.agentState === "gone" || task.reopen))) {
      if (task.reason === "trust") body.child(this.label(`${task.agent ?? "Its agent"} asks whether to trust this new worktree before it starts. The worktree is your repository at its current commit.`, t))
        .child(this.button(`trust-task-${task.id}`, "Trust this worktree", cx => this.trust(task, cx), t, { icon: "check", primary: true, hint: "Answers “Yes, I trust this folder” in its terminal" }));
      const question = this.liveQuestion(task);
      if (question) body.child(this.questionCard(task, question, t));
      body.child(this.button(`open-${task.id}`, "Open agent", () => this.focusAgent(task), t, { icon: "terminal", primary: task.status === "input" && !question, hint: "Show its terminal" }));
      if (this.peek.screen.length && !question) body.child(this.screen(this.peek.screen, t, task.status === "input" ? "It's waiting for you. The end of its screen:" : "The end of its screen:"));
      if (!question) body.child(h_flex().gap(6).items_center()
        .child(Input.new(this.message).flex_1().min_w(0).h(32).px(9).bg(t.input).border_1().border_color(t.border).rounded(6).text_size(12).accessibility_label("Message the agent"))
        .child(this.button(`send-${task.id}`, task.status === "review" ? "Send feedback" : "Send", cx => this.send(task, cx), t,
          { disabled: !this.message.value().trim(), hint: "Types into its terminal and presses Enter" })));
      if (this.sent?.id === task.id) body.child(this.label(this.sent.error ?? (this.sent.pending ? "Sending…" : this.sent.answer ? `You answered: “${this.sent.answer}”` : "Sent. The card follows what the agent does next."), t));
    }
    if (state.tryout && trees.length && !["queued", "routing", "done"].includes(task.status) && !task.discard) {
      const open = task.tried && spaces().some(space => space.tabs.some(tab => tab.id === task.tried));
      body.child(this.button(`try-${task.id}`, open ? "Show its Try it tab" : "Try it", cx => this.tryTask(task, cx), t,
        { icon: "play", hint: open ? "Shows the tab already running it (T)" : `Runs ${state.tryout} in ${several ? `its ${task.repos[0]} worktree` : "its worktree"}, in a tab of its own (T)` }));
      const address = open && this.peek.task === task.id ? this.peek.address : null;
      if (address) body.child(h_flex().child(this.button(`try-open-${task.id}`, `Open ${address.replace(/^https?:\/\//, "")}`, () => this.openLink(address), t, { small: true, hint: "The address its Try it tab printed last" })));
    }
    if (trees.length && !["queued", "routing", "done"].includes(task.status) && !task.discard) this.changes(body, task, t, several);
    if (task.status === "testing") body.child(this.label(`Running ${state.check?.command ?? "checks"} in ${several ? `each of its ${trees.length} worktrees` : "its worktree"}…`, t));
    if (task.status === "failed" && task.reason === "checks" && !task.discard) {
      body.child(this.heading(several && task.checkRepos?.length ? `Checks failed in ${task.checkRepos.join(" + ")}` : "Checks failed"));
      body.child(this.screen((task.checkOutput || "(no output)").split("\n").slice(-16), t, `$ ${state.check?.command ?? ""}`));
      body.child(h_flex().gap(8).flex_wrap()
        .child(this.button(`fix-task-${task.id}`, "Ask the agent to fix it", cx => this.fix(task, cx), t, { primary: true, icon: "reset", hint: "Sends this output to its agent" }))
        .child(this.button(`review-anyway-${task.id}`, "Review anyway", cx => this.act({ type: "reviewAnyway", id: task.id }, cx), t, { hint: "Move it to review with failing checks" }))
        .child(this.button(`recheck-${task.id}`, "Run checks again", cx => this.act({ type: "recheck", id: task.id }, cx), t, { icon: "reset" })));
    }
    if (task.status === "review" && !task.discard) {
      if (task.checked) body.child(div().text_size(12).line_height(1.45).text_color(task.checked === "passed" ? t.muted : t.blocked)
        .child(task.checked === "passed" ? `Checks passed: ${state.check?.command ?? "checks"}` : "Checks were failing when it moved to review."));
      if (task.prs) body.child(this.label(`Still on GitHub: ${prList(task.prs)}. ${state.delivery === "pr" ? "Opening pull requests again reuses the open ones." : ""}`.trim(), t));
      if (task.unchanged) body.child(this.label(`It changed no files, so ${state.check?.command ? "checks were skipped and " : ""}there is nothing to ${state.delivery === "pr" ? "open a pull request for" : "merge"}.`, t));
      if (!needsApproval(task)) body.child(this.label(`Approved. It ${state.delivery === "pr" ? "opens its pull requests" : "merges"} once another task finishes merging in ${task.repos.join(" + ")}.`, t));
      else if (task.unchanged) body.child(this.button(`merge-${task.id}`, "Mark it done", cx => this.act({ type: "approve", id: task.id }, cx), t,
        { icon: "check", primary: true, hint: "Closes the task and removes its worktree and branch" }));
      else body.child(state.delivery === "pr"
        ? this.button(`merge-${task.id}`, several ? `Open pull requests into ${target}` : `Open a pull request into ${target}`, cx => this.act({ type: "approve", id: task.id }, cx), t,
          { icon: "check", primary: !uncommitted(task), hint: `Pushes the branch to origin and opens a pull request with gh${several ? " in each repository the agent changed; each one links the others" : ""}. Refuses while the agent has uncommitted changes.` })
        : this.button(`merge-${task.id}`, several ? `Merge into ${target} in all ${task.repos.length}` : `Merge into ${target}`, cx => this.act({ type: "approve", id: task.id }, cx), t,
          { icon: "check", primary: !conflicted(task) && !uncommitted(task), hint: several ? "Rebases every repository's branch, and fast-forwards them only if all rebased cleanly. Its worktrees and your project folders must have no uncommitted changes."
            : "Rebases onto it and fast-forwards. Its worktree and your project folder must have no uncommitted changes." }));
      if (state.check?.command) body.child(this.button(`recheck-${task.id}`, "Run checks again", cx => this.act({ type: "recheck", id: task.id }, cx), t, { icon: "reset" }));
    }
    if (task.status === "merging") body.child(this.label(state.delivery === "pr" ? `Pushing ${several ? "the branches and opening pull requests" : "the branch and opening a pull request"}…` : `Merging into ${target}${several ? ` in ${task.repos.join(" + ")}` : ""}${state.pushAfterMerge ? " and pushing to origin" : ""}…`, t));
    const pushed = task.status === "done" && pushNote(task);
    if (pushed && !pushed.ok) {
      body.child(div().id(`pipeline-push-error-${task.id}`).text_size(12).line_height(1.45).text_color(t.blocked).child(`Merged, not pushed. ${pushed.error}`));
      if (state.unpushed?.length) body.child(this.button(`push-now-${task.id}`, state.unpushed.every(entry => entry.retry) ? "Pushing…" : "Push now", cx => this.act({ type: "pushNow" }, cx), t,
        { icon: "reset", disabled: state.unpushed.every(entry => entry.retry), hint: "Push again. Each push carries everything merged since, and never forces." }));
    }
    const after = task.status === "done" && afterFailed(state).find(entry => entry.task === task.id);
    if (after) {
      body.child(div().id(`pipeline-after-error-${task.id}`).text_size(12).line_height(1.45).text_color(t.blocked).child(`Merged, but ${state.afterMerge} failed. ${after.error}`));
      body.child(this.button(`after-now-${task.id}`, "Run again", cx => this.act({ type: "afterMergeNow" }, cx), t, { icon: "reset", hint: `Runs ${state.afterMerge} again in ${after.root}` }));
    }
    if (task.status === "done" && (task.landed?.length || task.reverted || task.revertPrs || revertsByPr(task))) this.revertDetail(body, state, task, t);
    if (task.status === "done") body.child(this.heading("Follow up"))
      .child(h_flex().gap(6).items_center()
        .child(Input.new(this.follow).flex_1().min_w(0).h(32).px(9).bg(t.input).border_1().border_color(t.border).rounded(6).text_size(12).accessibility_label("What should change"))
        .child(this.button(`follow-${task.id}`, "Queue it", cx => this.followUp(task, cx), t, { disabled: !this.follow.value().trim(),
          hint: `Queues a new task that knows what ${task.id} was, what its agent reported and where its commits are` })))
      .child(this.label(`A new task for a fresh agent, starting from ${targetOf(task) ?? "your branch"} as it is now.`, t));
    if (task.status === "done" && task.prs) for (const [name, pr] of Object.entries(task.prs)) body.child(this.button(`pr-link-${task.id}${several ? `-${name}` : ""}`, `${several ? `${name} · ` : ""}Pull request #${pr.number}`, () => this.openLink(pr.url), t, { icon: "eye", hint: pr.url }));
    if (task.status === "failed" && task.reason !== "checks" && !task.discard) body.child(this.button(`retry-task-${task.id}`, trees.length ? `Retry in the same worktree${trees.length > 1 ? "s" : ""}` : "Retry", cx => this.act({ type: "retry", id: task.id }, cx), t, { primary: true, icon: "reset" }));
    if (task.images?.length && task.status !== "queued") body.child(this.label(`Its agent was given ${count(task.images.length, "image")}: ${task.images.map(item => item.path.replace(/^.*\//, "")).join(", ")}`, t));
    if (task.adopt && !trees.length && !task.planned && ["routing", "failed"].includes(task.status) && !task.discard) body.child(this.button(`remove-${task.id}`, "Cancel", cx => { this.act({ type: "discard", id: task.id }, cx); this.open(null, cx); }, t,
      { icon: "x", hint: "Nothing has moved yet. Its agent keeps working where it is" }));
    else if (task.status === "queued" && !trees.length) body.child(this.button(`remove-${task.id}`, "Remove from queue", cx => { this.act({ type: "remove", id: task.id }, cx); this.open(null, cx); }, t));
    else if (!["merging", "pr", "done"].includes(task.status) && !task.discard) {
      const sure = this.confirm === task.id;
      body.child(this.button(`discard-${task.id}`, sure ? `Delete its branch and worktree${several ? "s" : ""}` : "Discard", cx => {
        if (sure) { this.confirm = null; this.act({ type: "discard", id: task.id }, cx); } else { this.confirm = task.id; cx.notify(); }
      }, t, { icon: "x", hint: sure ? "Stops its agent and deletes the worktree and branch. This can't be undone." : "Stop this task and throw its work away" }));
      if (sure) body.child(div().text_size(12).line_height(1.45).text_color(t.blocked).child("Click again to stop its agent and delete the worktree and branch. Unmerged work is lost."));
    }
    if (branch && trees.length > 1) body.child(this.label(`Branch ${branch} in each repository`, t)).children(trees.map(ws => this.label(`${ws.name} · ${ws.cwd}`, t)));
    else if (branch) body.child(this.label(`Branch ${branch}${trees[0]?.cwd ? ` · ${trees[0].cwd}` : ""}`, t));
    if (task.usage) body.child(this.label(`${task.agent ?? "Its agent"} used ${usageText(task.usage)}, over ${task.usage.turns} ${task.usage.turns === 1 ? "reply" : "replies"}.`, t));
    const log = (task.log ?? state.events.filter(item => item.task === task.id)).slice(0, 12), shown = this.history === task.id;
    if (log.length) body.child(h_flex().id(`pipeline-history-${task.id}`).gap(6).items_center().cursor_pointer().text_size(12).text_color(t.muted).hover(el => el.text_color(t.foreground))
      .role("button").accessibility_label(`${shown ? "Hide" : "Show"} task history`)
      .on_click((_e, cx) => { this.history = shown ? null : task.id; this.track("history", { task: task.id }); cx.notify(); })
      .child(svg(`mods/workspace-chrome/chevron-${shown ? "down" : "right"}.svg`).size(11).flex_none()).child(`History · ${log.length}`));
    if (log.length && shown) body.child(v_flex().id(`pipeline-history-lines-${task.id}`).gap(3).pl(18).children(log.map((item, n) => h_flex().gap(8).items_start().text_size(11.5).line_height(1.45).text_color(t.muted)
      .child(div().w(84).flex_none().child(item.at ? stamp(item.at) : ""))
      .child(div().flex_1().min_w(0).child(this.copyable(`history-${task.id}-${n}`, String(item.message ?? item).replace(new RegExp(`^${task.id.replace(/[^\\w-]/g, "")}( · | )`), "")).text_size(11.5).line_height(1.45))))));
  }
  // An open pull request comes first in its task: what it waits for, and what can be done about it from here.
  prDetail(body, state, task, t, several) {
    for (const [name, pr] of Object.entries(task.prs)) {
      const prTarget = task.workspaces?.[name]?.target, need = prNeed(pr, prTarget, state), suffix = several ? `-${name}` : "", prefix = several ? `${name} · ` : "";
      body.child(this.heading(pr.merged ? `${prefix}Pull request #${pr.number} · Merged` : pr.status ? `${prefix}Pull request #${pr.number} · ${need.label}` : `${prefix}Pull request #${pr.number}`));
      if (!pr.merged && !pr.status) body.child(this.label("Asking GitHub what it waits for…", t));
      if (!pr.merged) for (const item of prChecklist(pr, prTarget, state)) body.child(h_flex().id(`pipeline-pr-${item.name.toLowerCase()}-${task.id}${suffix}`).gap(8).items_start().text_size(12).line_height(1.45)
        .child(dot(toneColor(item.tone, t)).mt(6))
        .child(div().w(54).flex_none().text_color(t.muted).child(item.name))
        .child(div().flex_1().min_w(0).text_color(item.tone === "blocked" ? t.blocked : t.foreground).child(item.value)));
      const asks = prAsks(pr), clash = asks.includes("rebase"), gone = task.agentState === "gone" || !task.terminal;
      const VERBS = { rebase: ["rebase", `rebase onto origin/${prTarget ?? "the base branch"}, resolve the conflicts and push`], checks: ["fix the checks", "read the failing checks, fix their cause and push"],
        review: ["address the review", "read the review comments, make the changes and push, without replying on the pull request"] };
      asks.forEach((kind, at) => {
        const asked = this.prAsked === `${task.id}/${kind}`;
        body.child(this.button(`pr-ask-${kind}-${task.id}${suffix}`, task.reopen ? "Reopening…" : gone ? `Reopen agent to ${VERBS[kind][0]}` : asked ? "Asked. It pushes when done" : `Ask the agent to ${VERBS[kind][0]}`,
          cx => gone ? this.act({ type: "reopen", id: task.id, ask: kind, repo: name }, cx) : this.askPr(task, pr, prTarget, kind, cx), t,
          { icon: "reset", primary: at === 0 && !task.reopen && !asked, disabled: Boolean(task.reopen) || task.agentState === "working",
            hint: `${gone ? "Starts its agent again in the worktree, continuing its last conversation, and tells it" : "Tells its agent"} to ${VERBS[kind][1]}` }));
      });
      if (pr.readyError) body.child(div().id(`pipeline-pr-ready-error-${task.id}${suffix}`).text_size(12).line_height(1.45).text_color(t.blocked).child(pr.readyError));
      const draft = Boolean(pr.status?.draft);
      body.child(h_flex().gap(8).flex_wrap()
        .child(this.button(`pr-link-${task.id}${suffix}`, `Open pull request #${pr.number}`, () => this.openLink(pr.url), t, { icon: "eye", primary: !several && !draft && !asks.length, hint: pr.url }))
        .when(!pr.merged && Boolean(pr.status), el => el.child(this.button(`pr-ready-${task.id}${suffix}`, pr.readying ? "Asking GitHub…" : draft ? "Mark ready" : "Back to draft",
          cx => this.act({ type: "prReady", id: task.id, repo: name, undo: !draft }, cx), t,
          { icon: draft ? "check" : null, primary: draft && !pr.readying, disabled: Boolean(pr.readying), hint: draft ? "Marks it ready for review on GitHub (gh pr ready)" : "Makes it a draft again on GitHub (gh pr ready --undo)" }))));
    }
    if (task.agentState === "gone" || task.reopen) {
      body.child(this.label(`Its agent's tab is closed, so nobody is there to fix what the pull request needs. Its worktree${several ? "s are" : " is"} still here.`, t));
      if (task.reopenError) body.child(div().id(`pipeline-reopen-error-${task.id}`).text_size(12).line_height(1.45).text_color(t.blocked).child(task.reopenError));
      body.child(this.button(`reopen-${task.id}`, task.reopen ? "Reopening…" : "Reopen agent", cx => this.act({ type: "reopen", id: task.id }, cx), t,
        { icon: "reset", disabled: Boolean(task.reopen), hint: `Starts ${task.agent ?? "its agent"} again in the worktree, continuing its last conversation there` }));
    } else if (prAgent(task)) body.child(this.label(`${prAgent(task)} in its worktree. The card stays here until the pull request merges or closes.`, t));
    body.child(this.label(several ? "Pipeline asks GitHub about each one once a minute. It finishes the task when every pull request is merged, and returns it to review if one is closed; the others stay open."
      : "Pipeline asks GitHub once a minute. It finishes the task when the PR is merged, and returns it to review if it's closed.", t));
  }
  revertDetail(body, state, task, t) {
    const where = [...new Set((task.landed ?? []).map(repo => repo.branch))].join(" + "), sure = this.confirm === `revert-${task.id}`, byPr = revertsByPr(task);
    if (task.revertPrs) {
      body.child(this.label(`${task.revertPrs.length > 1 ? "Pull requests that revert it are" : "A pull request that reverts it is"} open. Merging on GitHub undoes the task; Pipeline doesn't follow ${task.revertPrs.length > 1 ? "them" : "it"}.`, t));
      for (const pr of task.revertPrs) body.child(this.button(`revert-pr-${task.id}-${pr.number}`, `${task.revertPrs.length > 1 && pr.repo ? `${pr.repo} · ` : ""}Revert pull request #${pr.number}`, () => this.openLink(pr.url), t, { icon: "eye", hint: pr.url }));
      return;
    }
    if (task.reverted) { body.child(this.label(`Reverted with a new commit on ${where}. Its commits stay in the history.`, t)); return; }
    if (task.revert) { body.child(this.label(byPr ? "Opening a pull request that reverts it…" : `Reverting on ${where}…`, t)); return; }
    if (task.revertError) body.child(div().id(`pipeline-revert-error-${task.id}`).text_size(12).line_height(1.45).text_color(t.blocked).child(`Not reverted. ${task.revertError}`));
    body.child(this.button(`revert-${task.id}`, sure ? (byPr ? "Open the revert pull request" : `Undo it on ${where}`) : "Revert", cx => {
      if (sure) { this.confirm = null; this.act({ type: "revert", id: task.id }, cx); } else { this.confirm = `revert-${task.id}`; cx.notify(); }
    }, t, { icon: "reset", hint: byPr ? "Opens a pull request on GitHub that undoes this task's pull request" : sure ? "Adds one commit that undoes this task's changes. Never rewrites history." : "Undo this task's changes with a new commit" }));
    if (sure) body.child(div().text_size(12).line_height(1.45).text_color(t.blocked).child(byPr ? "Click again to open a pull request that reverts this one, with gh. Nothing changes until you merge it on GitHub."
      : `Click again to undo this task's changes on ${where} with one new commit. Work merged since stays.${state.pushAfterMerge ? " The commit is pushed." : ""}${state.afterMerge ? ` Then ${state.afterMerge} runs again.` : ""}`));
  }
  plannerView(body, state, t) {
    const planning = state.planning, now = Date.now();
    body.child(v_flex().gap(4).child(this.heading("Right now")).child(div().text_size(13).line_height(1.5).child(state.plan)));
    if (!state.live) return;
    body.child(div().h(1).bg(t.border));
    if (!state.planner?.on) {
      body.child(this.label("The planner agent is off: tasks start by Start first, then priority, then arrival. With Plan with an agent on, the AI helper orders the queue and says which task waits for which.", t));
      body.child(this.button("planner-settings", "Open Settings", cx => this.open("settings", cx, "planner"), t, { icon: "settings" }));
      if (!planning) return;
    }
    const watching = Boolean(state.planner?.watch);
    if (state.planner?.on) body.child(h_flex().gap(8).flex_wrap()
      .child(this.button("planner-again", "Plan again", cx => this.act({ type: "replan" }, cx), t, { icon: "reset", disabled: planning?.status === "running", hint: "Read the queue and the repository again" }))
      .child(this.button("planner-watch", watching ? "Next plan opens in a tab" : "Watch the next plan", cx => this.act({ type: "watchPlan" }, cx), t,
        { icon: "terminal", selected: watching, hint: watching ? "Click to plan in the background again" : "Run the next plan in a terminal tab, so you see what it reads as it goes" })));
    if (!planning) { body.child(this.label("It hasn't planned yet. It plans a few seconds after a task joins the queue.", t)); return; }
    const who = [PLANNERS[planning.agent] ?? "Claude Code", planning.model ?? "default model", planning.effort ? `${planning.effort} effort` : null].filter(Boolean).join(" · ");
    const cost = [planning.ms && `took ${Math.max(1, Math.round(planning.ms / 1000))} s`, planning.tokens && `${compact(planning.tokens)} tokens`, typeof planning.cost === "number" && `$${planning.cost.toFixed(planning.cost < 0.01 ? 4 : 2)}`].filter(Boolean);
    const status = planning.status === "running" ? `Planning since ${elapsed(now - planning.at)} ago${planning.watch ? ", in its own tab" : ""}…`
      : planning.status === "failed" ? `Couldn't plan, ${elapsed(now - planning.at)} ago` : `Planned ${elapsed(now - planning.at)} ago`;
    body.child(v_flex().gap(3)
      .child(h_flex().gap(7).items_center().child(dot(planning.status === "failed" ? t.blocked : planning.status === "running" ? t.accent : t.ansi2)).child(div().text_size(13).font_medium().child(status)))
      .child(this.label([who, ...cost].join(" · "), t)));
    if (planning.status === "failed") body.child(div().text_size(12).line_height(1.45).text_color(t.blocked).child(planning.error));
    if (planning.summary && planning.summary !== state.plan) body.child(div().text_size(13).line_height(1.5).child(planning.summary));
    if (planning.tasks?.length) {
      body.child(this.heading("Its order"));
      planning.tasks.forEach((row, i) => {
        const task = state.tasks.find(other => other.id === row.id);
        body.child(Button.new(`pipeline-planned-${row.id}`).w_full().p(10).rounded(6).bg(t.surface).border_1().border_color(t.border).text_color(t.foreground).tab_index(0)
          .accessibility_label(`${i + 1}. ${row.id}: ${row.title}`).hover(el => el.bg(t.hover)).focus(el => el.border_color(t.accent))
          .on_click((_e, cx) => { if (task) this.inspect(task.id, cx); })
          .child(v_flex().w_full().gap(4)
            .child(h_flex().gap(6).items_center().child(div().text_size(11).font_medium().text_color(t.muted).child(`${i + 1}. ${row.id}`)).child(div().flex_1())
              .child(div().text_size(11).text_color(t.muted).child(task ? labelFor(state, task.status) : "Gone")))
            .child(div().text_size(12).font_medium().child(row.title))
            .when(Boolean(row.reason), el => el.child(div().text_size(12).line_height(1.45).text_color(t.muted).child(row.reason)))
            .when(row.waits.length > 0, el => el.child(div().text_size(11).text_color(t.ansi5).child(`Waits for ${row.waits.join(", ")}`)))));
      });
    }
    if (planning.trace?.length) body.child(this.heading("What it read and did")).child(this.screen(planning.trace, t));
    else if (planning.status !== "running") body.child(this.label("It didn't report reading anything.", t));
    if (planning.prompt) {
      body.child(this.button("planner-prompt", this.showPrompt ? "Hide what it was asked" : "Show what it was asked", cx => { this.showPrompt = !this.showPrompt; cx.notify(); }, t, { small: true }));
      if (this.showPrompt) body.child(v_flex().w_full().p(10).rounded(6).bg(t.background).border_1().border_color(t.border).text_size(11).line_height(1.45)
        .font_family(settings().font_family ?? "JetBrains Mono").children(planning.prompt.split("\n").map(line => div().whitespace_normal().min_h(15).child(line || " "))));
    }
  }
  plannerSettings(body, state, t) {
    const setup = { on: false, model: null, effort: null, ...state.planner }, installed = Object.keys(PLANNERS).filter(key => this.agentChoices.some(agent => agent.key === key));
    const agent = plannerAgent(state), name = PLANNERS[agent];
    body.child(this.label("One agent does Pipeline's own reading, and it can only read. Choose for me, on a new pipeline's setup card, asks it to pick the check command, Try it and delivery. With Plan with an agent on, it also orders the queue.", t));
    const plan = () => body.child(this.switchRow("planner", "Plan with an agent", installed.length ? `${name} reads the queue, ticket blockers and the repository, orders the tasks and says which must wait for which`
      : "Needs Claude Code, Codex or OpenCode installed on the project's machine", setup.on, cx => this.act({ type: "plannerSetup", on: !setup.on }, cx), t, !installed.length && !setup.on));
    if (!installed.length) { body.child(this.label("Needs Claude Code, Codex or OpenCode installed on the project's machine.", t)); plan(); return; }
    const set = (change, cx) => this.act({ type: "plannerSetup", ...change }, cx);
    if (installed.length > 1 || !installed.includes(agent)) body.child(h_flex().gap(6).flex_wrap().children(installed.map(key => this.button(`planner-agent-${key}`, PLANNERS[key],
      cx => { set({ agent: key }, cx); this.plannerModelInput.set_value(this.state().planner?.model ?? ""); }, t, { small: true, selected: agent === key, hint: `Use ${PLANNERS[key]}` }))));
    this.modelAndEffort(body, t, { prefix: "planner-", key: agent, name, tune: plannerTuning(state), input: this.plannerModelInput, set });
    plan();
    if (!setup.on) return;
    body.child(this.button("planner-open", state.planning ? "See what the planner did" : "Open the planner", cx => this.open("planner", cx), t, { icon: "eye" }));
    body.child(this.label("It runs whenever the queue changes, and new agents wait for its plan. Pipeline still keeps the rules: limits, waits you set, no circles. Start first and Start anyway still win.", t));
  }
  implementerSettings(body, state, t) {
    const setup = { on: false, ...state.implementer }, agent = implementerAgent(state), name = IMPLEMENTERS[agent].name, lead = this.agentLabel(state);
    const installed = Object.keys(IMPLEMENTERS).filter(key => this.agentChoices.some(choice => choice.key === key)), set = (change, cx) => this.act({ type: "implementerSetup", ...change }, cx);
    body.child(this.label(`With this on, a task's agent (${lead}) plans the work, hands the code to a second agent with its own model, then reviews the result and commits. For planning with a strong model and writing with a cheaper one.`, t));
    body.child(this.switchRow("implementer", "Hand the implementation to another agent", `${lead} runs ${name} from the task's worktree, once per step, with a written brief`,
      setup.on, cx => set({ on: !setup.on }, cx), t));
    body.child(h_flex().gap(6).flex_wrap().children(Object.keys(IMPLEMENTERS).map(key => this.button(`implementer-agent-${key}`, IMPLEMENTERS[key].name,
      cx => { set({ agent: key }, cx); this.implementerModelInput.set_value(this.state().implementer?.model ?? ""); }, t, { small: true, selected: agent === key, hint: `Implement with ${IMPLEMENTERS[key].name}` }))));
    if (this.repo && !installed.includes(agent)) body.child(div().text_size(12).line_height(1.45).text_color(t.blocked).child(`${name} wasn't found on the project's machine. Tasks would do the work themselves.`));
    this.modelAndEffort(body, t, { prefix: "implementer-", key: agent, name, tune: implementerTuning(state), input: this.implementerModelInput, set });
    body.child(this.label(setup.on ? `New tasks hand their code to ${implementerFor({ ...state, implementer: setup }).label}. Running agents keep what they started with, and a queued task can opt out in its inspector.`
      : "Off: each task's agent writes its own code.", t));
    body.child(this.label(`${name} runs without asking before it edits files in the worktree. Its tokens count towards the task where Pipeline can read them.`, t));
  }
  firstButton(task, t) {
    return this.button(`first-${task.id}`, task.rank ? "Starts first" : "Start first", cx => this.act({ type: "first", id: task.id }, cx), t,
      { icon: task.rank ? "check" : "bolt", selected: Boolean(task.rank), hint: task.rank ? "Click to put it back in its usual place: by priority, then arrival" : "Start it before the rest of the queue, whatever its priority" });
  }
  taskTune(body, state, task, t) {
    const key = this.agentKey(state), options = AGENT_OPTIONS[key];
    if (!options) return;
    const own = task.tune ?? {}, listed = this.listedModels(key), models = listed.map(model => model.slug);
    if (listed.length > MODEL_CHIPS) {
      this.modelAndEffort(body, t, { prefix: "task-", key, name: this.agentName(state), tune: { model: own.model ?? null, effort: own.effort ?? null }, input: this.taskModelInput,
        same: tuningFor(state, key), set: (change, cx) => this.act({ type: "tuneTask", id: task.id, key, ...change }, cx) });
      body.child(this.label(`Starts ${this.agentName(state)} with ${tuningLabel(taskTuning(state, task, key)) || "its own default model and effort"}.`, t));
      return;
    }
    const efforts = listed.length ? [...new Set(listed.flatMap(model => model.efforts))] : options.efforts;
    const chip = (id, text, selected, change) => this.button(`${id}-${task.id}`, text, cx => this.act({ type: "tuneTask", id: task.id, key, ...change }, cx), t, { small: true, selected });
    body.child(this.heading("Model and effort for this task"));
    body.child(h_flex().gap(6).flex_wrap().child(chip("task-model-same", "As set", !own.model, { model: null }))
      .children(models.map(model => chip(`task-model-${model}`, model, own.model === model, { model }))));
    body.child(h_flex().gap(6).flex_wrap().child(chip("task-effort-same", "As set", !own.effort, { effort: null }))
      .children(efforts.map(effort => chip(`task-effort-${effort}`, effort, own.effort === effort, { effort }))));
    body.child(this.label(`Starts ${this.agentName(state)} with ${tuningLabel(taskTuning(state, task, key)) || "its own default model and effort"}.`, t));
  }
  changes(body, task, t, several) {
    if (!this.peek.diff.length) { body.child(this.heading("Changes")).child(this.label("Reading the branch…", t)); return; }
    for (const repo of this.peek.diff) {
      const files = repo.files, add = files.reduce((n, file) => n + file.add, 0), del = files.reduce((n, file) => n + file.del, 0), suffix = several ? `-${repo.name}` : "";
      body.child(h_flex().gap(8).items_center()
        .child(div().flex_1().min_w(0).child(this.heading(several ? `Changes · ${repo.name}` : "Changes")))
        .when(files.length > 0, el => el.child(div().text_size(11).text_color(t.muted).child(count(files.length, "file")))
          .child(div().text_size(11).text_color(t.ansi2).child(`+${add}`)).child(div().text_size(11).text_color(t.ansi1).child(`−${del}`)))
        .child(this.button(`changes-refresh-${task.id}${suffix}`, "Read the changes again", cx => { this.peek = { ...this.peek, key: null }; cx.notify(); }, t,
          { small: true, icon: "reset", iconOnly: true, hint: "Read the changes again" })));
      if (!files.length) { body.child(this.label(several ? `No changes in ${repo.name}. It is left out of the merge.` : "No changes yet.", t)); continue; }
      body.child(v_flex().w_full().py(3).rounded(6).bg(t.background).border_1().border_color(t.border)
        .children(files.slice(0, 12).map((file, i) => {
          const parts = file.path.split("/"), name = parts.pop();
          return Button.new(`pipeline-file-${task.id}${suffix}-${i}`).w_full().h(24).px(9).gap(7).flex().items_center().text_size(11).text_color(t.foreground).tab_index(0)
            .accessibility_label(`${file.path}: read its changes`).tooltip(file.path).hover(el => el.bg(t.hover)).focus(el => el.bg(t.hover))
            .on_click(() => this.viewChanges(repo, i))
            .child(div().w(9).flex_none().text_color(file.status === "A" ? t.ansi2 : file.status === "D" ? t.ansi1 : t.blocked).child(file.status))
            .child(div().flex_none().max_w(170).truncate().child(name))
            .child(div().flex_1().min_w(0).text_color(t.muted).truncate().child(parts.join("/")))
            .when(file.add > 0, el => el.child(div().flex_none().text_color(t.ansi2).child(`+${file.add}`)))
            .when(file.del > 0, el => el.child(div().flex_none().text_color(t.ansi1).child(`−${file.del}`)));
        }))
        .when(files.length > 12, el => el.child(div().px(9).h(22).flex().items_center().text_size(11).text_color(t.muted).child(`and ${files.length - 12} more`))));
      body.child(this.button(`diff-${task.id}${suffix}`, several ? `Read the changes in ${repo.name}` : "Read the changes", () => this.viewChanges(repo), t,
        { icon: "eye", hint: `The full diff since this task started, file by file${several ? "" : " (D)"}` }));
    }
  }
  repoChips(body, state, task, t) {
    const repos = state.repositories ?? [];
    if (repos.length < 2) return;
    const fixed = workspacesOf(task).length > 0;
    body.child(this.heading("Repositories"));
    body.child(h_flex().gap(6).flex_wrap().children(repos.map(repo => {
      const on = task.repos.includes(repo.name);
      return this.button(`repo-${task.id}-${repo.name}`, repo.name, cx => this.act({ type: "repos", id: task.id, repo: repo.name }, cx), t,
        { small: true, selected: on, icon: on ? "check" : null, disabled: fixed || (on && task.repos.length === 1),
          hint: fixed ? "Its worktrees are already made" : on ? `Leave ${repo.name} out` : `Work in ${repo.name} too (${repo.path})` });
    })));
    body.child(this.label(fixed ? "Its worktrees are already made, so its repositories stay as they are." : "The agent starts in the first one and can open the others. Each gets its own worktree and branch.", t));
  }
  questionCard(task, question, t) {
    return v_flex().gap(10).p(12).rounded(8).border_1().border_color(t.blocked).bg(t.blocked + "14")
      .child(h_flex().gap(6).items_center().child(icon("question", 14).text_color(t.blocked))
        .child(div().text_size(12).font_semibold().text_color(t.blocked).child(`${task.id} is paused until you answer`)))
      .when(Boolean(question.context?.length), el => el.child(this.screen(question.context, t)))
      .child(div().text_size(13).line_height(1.45).child(question.text || "Its agent is waiting for you to pick one."))
      .children(choices(question).map((option, i) => this.button(`choice-${task.id}-${i}`, `${i + 1}  ${option}`, cx => this.answer(task.id, option, cx), t,
        { hint: `Answer “${option}” (${i + 1})` }).w_full().justify_start()))
      .child(h_flex().gap(6).items_center()
        .child(Input.new(this.reply).flex_1().min_w(0).h(32).px(9).bg(t.input).border_1().border_color(t.border).rounded(6).text_size(12).accessibility_label("Your own answer"))
        .child(this.button(`reply-${task.id}`, "Send", cx => this.answer(task.id, this.reply.value(), cx, true), t, { disabled: !this.reply.value().trim(), hint: "Send your answer (Enter)" })));
  }
  detail(body, state, t, cx) {
    const task = state.tasks.find(task => task.id === this.selected);
    if (!task) { body.child(this.label("Select a task in the scene.", t)); return; }
    if (state.live) { this.liveDetail(body, state, task, t, cx); return; }
    body.child(div().text_size(18).font_semibold().line_height(1.3).child(task.title));
    body.child(h_flex().gap(7).items_center().child(dot(stateColor(task, t))).child(div().text_size(12).child(LABELS[task.status])));
    if (needsInput(task)) body.child(this.questionCard(task, task.question, t));
    else if (task.answer) body.child(this.label(`You answered: “${task.answer}”`, t));
    body.child(div().text_size(12).line_height(1.5).text_color(t.muted).child(task.description));
    if (["queued", "backlog"].includes(task.status)) {
      body.child(this.heading("Repositories"));
      body.child(h_flex().gap(6).flex_wrap().children(REPOS.map(repo => this.button(`repo-${task.id}-${repo}`, repo, cx => this.act({ type: "repos", id: task.id, repo }, cx), t,
        { small: true, selected: task.repos.includes(repo), icon: task.repos.includes(repo) ? "check" : null, hint: task.repos.includes(repo) ? `Remove ${repo}` : `Add ${repo}` }))));
    } else body.child(this.label(`Repositories: ${task.repos.join(" + ")}`, t));
    body.child(this.label(`Board: ${task.status === "done" ? "Done" : ["review", "merging"].includes(task.status) ? "Review" : [...ACTIVE, "failed"].includes(task.status) ? "Doing" : task.column} · example`, t));
    if (task.status === "queued") body.child(this.label(waitingReason(state, task), t)).child(this.firstButton(task, t));
    if (task.depends.length) {
      body.child(this.heading("Dependencies"));
      for (const id of task.depends) body.child(this.button(`dep-${id}`, `${id} · ${state.tasks.find(row => row.id === id)?.status === "done" ? "Merged" : "Waiting"}`, cx => this.inspect(id, cx), t));
    }
    if (["review", "merging", "done"].includes(task.status)) {
      body.child(this.heading("Related changes"));
      if (needsApproval(task) && task.repos.length > 1) body.child(this.button(`approve-task-${task.id}`, `Approve all ${task.repos.length} PRs`, cx => this.act({ type: "approve", id: task.id }, cx), t, { icon: "check", primary: true }));
      for (const repo of task.repos) {
        const approved = task.approvals.includes(repo);
        body.child(v_flex().gap(7).py(9).border_b(1).border_color(t.border)
          .child(div().text_size(12).font_medium().child(`${repo} · example PR`))
          .child(this.label(task.status === "done" ? "Merged" : task.status === "merging" ? "Merging after checks" : approved ? "Approved" : task.delivery === "direct" ? "Checks passed · automatic merge" : "Checks passed · approval needed", t))
          .when(task.status === "review" && task.delivery !== "direct" && !approved, el => el.child(this.button(`approve-${task.id}-${repo}`, `Approve ${repo} PR`, cx => this.act({ type: "approve", id: task.id, repo }, cx), t, { icon: "check" }))));
      }
      if (task.status === "review" && task.repos.every(repo => task.approvals.includes(repo))) body.child(this.label("Approved. Waiting for this repository's active merge to finish.", t));
    }
    if (task.status === "failed") body.child(this.label(task.error, t)).child(this.button(`retry-task-${task.id}`, "Retry task", cx => this.act({ type: "retry", id: task.id }, cx), t, { primary: true, icon: "reset" }));
    if (task.status === "queued") body.child(this.button(`remove-${task.id}`, "Remove from queue", cx => { this.act({ type: "remove", id: task.id }, cx); this.open(null, cx); }, t, { disabled: state.watch && task.column === state.column, hint: state.watch && task.column === state.column ? "Stop watching this column before removing a matching task" : "Return this task to the example backlog" }));
    const events = state.events.filter(item => item.task === task.id).slice(0, 6);
    if (events.length) body.child(this.heading("Task history"));
    for (const item of events) body.child(this.label(item.message, t));
  }
}
