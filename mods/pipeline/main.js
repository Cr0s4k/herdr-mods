import { View, div, svg, PathBuilder } from "gpui-kit";
import { h_flex, v_flex, Button, Input, InputState, Textarea, TextareaState, Switch } from "gpui-base";
import { shared, setShared, theme, props, exec, hc, run, focused, knownAgents, nextCommand, settings, appHome, window as appWindow } from "herdr";
import { STORE, LIVE, VERSION, SOURCES, UPDATE_KINDS, newer, openIssue, ACTIVE, MOVING, LABELS, REPOS, SPEEDS, AGENT_OPTIONS, agentRun, tuningFor, tuningLabel, codexModels, createPipeline, createLive, labelFor, migrate, reduce, parseTime, nextScheduled, activeTasks, dependencies, waitsFor, canWaitFor, waitingReason, needsApproval, needsInput, prNeed, prNeeds, prChecklist, prList, workspacesOf, targetOf, quotaHeld, progress, duration } from "./pipeline-model.js";
import { CARD, SUN, RING, layoutScene, samples } from "./geometry.js";
import { trustKeys, fixRequest } from "./pipeline-live.js";
import { readTickets, fullTickets } from "./ticket-source.js";

const CHROME = 50 + 46 + 36 + 32;
const COMET = ["●", "•", "·", "", "", ""];
const CHECK_HINTS = [
  "if [ -f package.json ] && grep -q '\"test\"' package.json; then",
  "  if [ -f pnpm-lock.yaml ]; then echo 'pnpm test'; elif [ -f yarn.lock ]; then echo 'yarn test'; elif [ -f bun.lockb ]; then echo 'bun test'; else echo 'npm test'; fi; fi",
  "if [ -f Makefile ] && grep -q '^check:' Makefile; then echo 'make check'; elif [ -f Makefile ] && grep -q '^test:' Makefile; then echo 'make test'; fi",
  "if [ -f Cargo.toml ]; then echo 'cargo test'; fi",
  "if [ -f go.mod ]; then echo 'go test ./...'; fi",
  "if [ -f pytest.ini ] || grep -qs pytest pyproject.toml; then echo 'python3 -m pytest'; fi",
].join("\n");
// Prints a folder's repository root, with ~ expanded on the machine the project is on; exit 3 means no such folder.
const TOPLEVEL = 'p=$1; case $p in "~") p=$HOME;; "~/"*) p=$HOME/${p#"~/"};; esac; cd -- "$p" 2>/dev/null || exit 3; git rev-parse --show-toplevel';
const DRAWERS = ["picker", "queue", "review", "prs", "done", "activity", "settings", "watch", "quota", "plane", "linear", "schedule"];
const SCOPES = { mine: "My tickets", unassigned: "Unassigned", all: "All tickets" };
const filterLabel = filter => [SCOPES[filter.scope], filter.project?.name].filter(Boolean).join(" · ");
const icon = (name, size = 15) => svg(`mods/pipeline/${name}.svg`).size(size).flex_none();
const dot = (color, size = 6) => div().size(size).rounded(size / 2).bg(color).flex_none();
const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const stateColor = (task, t) => ["failed", "input"].includes(task.status) ? t.blocked : task.status === "done" ? t.ansi2
  : task.status === "pr" ? t.ansi4 : ["review", "merging"].includes(task.status) ? t.ansi5 : ACTIVE.includes(task.status) ? t.accent : t.muted;
const toneColor = (tone, t) => ({ blocked: t.blocked, ready: t.ansi2 })[tone] ?? t.muted;
function cardStatus(state, task) {
  if (task.discard) return "Discarding…";
  if (state.live && task.status === "review" && !needsApproval(task) && !task.discard) return state.delivery === "pr" ? "Approved · PR next" : "Approved · merging next";
  if (state.live && task.status === "review") return task.error ? "Not merged · see why" : task.checked === "passed" ? "Checks passed" : task.checked === "failed" ? "Checks failing" : "Ready for review";
  if (state.live && task.status === "failed" && task.reason === "checks") return "Checks failed";
  if (state.live && task.status === "pr") return prNeeds(task).label;
  if (state.live && task.status === "merging" && state.delivery === "pr") return task.repos.length > 1 ? "Opening PRs" : "Opening PR";
  if (state.live && ["merging", "failed", "done", "routing"].includes(task.status)) return labelFor(state, task.status);
  if (task.status === "queued") {
    const waits = dependencies(state, task);
    if (waits.length) return `Needs ${waits.join(", ")}`;
    return { "Ready for the planner": "Next up", "Waiting for a work slot": "Waiting for a slot", "Waiting for quota above the reserve": "Held by quota reserve", "Outstanding PR limit reached": "Held by PR limit", "Intake paused": "Queued · intake paused" }[waitingReason(state, task)] ?? "Queued";
  }
  if (task.status === "input") return "Needs you";
  if (ACTIVE.includes(task.status)) return `${labelFor(state, task.status)} · slot ${task.slot + 1}`;
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
    this.title = InputState.new({ placeholder: "New task: type a title and press Enter" });
    this.title.on("change", (_e, cx) => cx.notify());
    this.title.on("submit", (_e, cx) => this.create(cx));
    this.reply = InputState.new({ placeholder: "Or type your own answer" });
    this.reply.on("change", (_e, cx) => cx.notify());
    this.reply.on("submit", (_e, cx) => this.answer(this.selected, this.reply.value(), cx));
    this.message = InputState.new({ placeholder: "Message the agent" });
    this.message.on("change", (_e, cx) => cx.notify());
    this.message.on("submit", (_e, cx) => this.send(this.state()?.tasks.find(task => task.id === this.selected), cx));
    this.checkInput = InputState.new({ placeholder: "No checks. For example: npm test" });
    this.checkInput.on("submit", (_e, cx) => this.saveCheck(cx));
    this.checkInput.on("blur", (_e, cx) => this.saveCheck(cx));
    this.checkInput.on("change", (_e, cx) => cx.notify());
    this.checkSuggestions = [];
    this.times = {};
    for (const [kind, placeholder] of [["start", "Not scheduled. For example: 22:00"], ["pause", "Not scheduled. For example: 7:00"]]) {
      const input = this.times[kind] = InputState.new({ placeholder });
      input.on("submit", (_e, cx) => this.saveTime(kind, cx));
      input.on("blur", (_e, cx) => this.saveTime(kind, cx));
      input.on("change", (_e, cx) => cx.notify());
    }
    this.timeError = null;
    this.modelInput = InputState.new({ placeholder: "Or type a model name" });
    this.modelInput.on("submit", (_e, cx) => this.saveModel(cx));
    this.modelInput.on("blur", (_e, cx) => this.saveModel(cx));
    this.modelInput.on("change", (_e, cx) => cx.notify());
    this.repoInput = InputState.new({ placeholder: "Path to another repository, e.g. ~/code/api" });
    this.repoInput.on("submit", (_e, cx) => this.addRepository(cx));
    this.repoInput.on("change", (_e, cx) => { this.repoError = null; cx.notify(); });
    this.repoError = null; this.repoAdding = false;
    this.details = TextareaState.new({ placeholder: "Context, constraints, how to check it…", rows: 4 });
    this.details.on("blur", (_e, cx) => this.saveDetails(cx));
    this.mode = this.context.cwd && localStorage.getItem("mode") === "live" ? "live" : "simulation";
    this.confirm = null; this.peek = { key: null, screen: [], diff: [] }; this.sent = null;
    this.repo = null; this.agentChoices = []; this.codexModels = [];
    this.sources = Object.fromEntries(Object.keys(SOURCES).map(provider => [provider, { loading: false, issues: [], states: [], error: null, kind: null, needsProject: false }]));
    this.ticketPicked = new Set(); this.ticketRequests = {}; this.queueing = false;
    this.updateStates = Object.fromEntries(Object.keys(SOURCES).map(provider => [provider, { loading: false, states: [], error: null }]));
    this.linearFilter = { scope: "mine", project: null };
    try { this.linearFilter = { ...this.linearFilter, ...JSON.parse(localStorage.getItem(`linear:${this.id}`) ?? "{}") }; } catch (_) { /* A damaged filter falls back to My tickets. */ }
    this.projects = null;
    this.motion = localStorage.getItem("motion") !== "false";
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
      }
    });
  }

  close() { this.search.release(); this.title.release(); this.reply.release(); this.message.release(); this.details.release(); this.ticketSearch.release(); this.projectSearch.release(); this.checkInput.release(); this.modelInput.release(); this.times.start.release(); this.times.pause.release(); this.repoInput.release(); this.handle.release(); }
  storeKey() { return this.mode === "live" ? LIVE + this.id : this.id; }
  state() { return shared(STORE)?.[this.storeKey()]; }
  act(action, cx) {
    const all = shared(STORE) ?? {}, key = this.storeKey(), state = all[key];
    if (!state) return;
    const next = reduce(state, action);
    if (next !== state) setShared(STORE, { ...all, [key]: next });
    cx.notify();
  }
  toggleRun(cx) { this.act({ type: "run", space: focused()?.space ?? null }, cx); }
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
    if (!saved) setShared(STORE, { ...all, [key]: createLive(this.context) });
    else if (saved.version !== VERSION && !newer(saved)) setShared(STORE, { ...all, [key]: migrate(saved) });
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
      if (this.repo?.root) {
        const found = await exec("sh", ["-c", CHECK_HINTS], { cwd: this.repo.root, on }).catch(() => null);
        this.checkSuggestions = (found?.stdout ?? "").split("\n").map(line => line.trim()).filter(Boolean).slice(0, 3);
      }
      cx.notify();
    });
  }
  agentName(state) { return state.agent?.name ?? this.agentChoices[0]?.name ?? "Agent"; }
  agentKey(state) { return state.agent ? state.agent.key : this.agentChoices[0]?.key ?? null; }
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
  saveDetails(cx) {
    const task = this.state()?.tasks.find(task => task.id === this.detailsFor);
    if (task && this.details.value() !== (task.description ?? "")) this.act({ type: "describe", id: task.id, text: this.details.value() }, cx);
  }
  peekAt(task, cx) {
    const trees = workspacesOf(task), key = `${task.id}:${task.status}:${task.terminal}:${trees.map(ws => ws.root).join(",")}`;
    if (this.peek.key === key) return;
    this.peek = { key, screen: [], diff: [] };
    const { on } = this.context;
    cx.spawn(async cx => {
      const peek = { key, screen: [], diff: [] };
      if (task.terminal && ["input", "working", "review", "pr"].includes(task.status)) {
        const screen = await hc(["read", task.terminal, "--lines", "60"]).catch(() => null);
        const lines = screen?.code === 0 ? screen.stdout.split("\n").map(line => line.trimEnd()) : [];
        while (lines.length && !lines.at(-1)) lines.pop();
        peek.screen = lines.slice(-14);
        while (peek.screen.length && !peek.screen[0]) peek.screen.shift();
      }
      if (["review", "merging", "pr"].includes(task.status)) for (const ws of trees) {
        const diff = await exec("git", ["-C", ws.root, "diff", "--stat", ws.base], { on }).catch(() => null);
        const status = await exec("git", ["-C", ws.root, "status", "--porcelain"], { on }).catch(() => null);
        const fresh = (status?.stdout ?? "").split("\n").filter(line => line.startsWith("??")).length;
        peek.diff.push({ name: ws.name, lines: [...(diff?.stdout ?? "").trimEnd().split("\n").filter(Boolean), ...(fresh ? [`plus ${fresh} new file${fresh === 1 ? "" : "s"} not yet committed`] : [])] });
      }
      if (this.peek.key === key) { this.peek = peek; cx.notify(); }
    });
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
  saveTime(kind, cx) {
    const state = this.state(), text = this.times[kind].value().trim();
    if (!state || text === (state.schedule?.[kind] ?? "")) return;
    const time = text ? parseTime(text) : null;
    this.timeError = text && !time ? { kind, text: "Use a time like 22:00, 7:30 or 9pm." }
      : time && time === state.schedule?.[kind === "start" ? "pause" : "start"] ? { kind, text: "Start and pause need different times." } : null;
    if (this.timeError) { cx.notify(); return; }
    this.times[kind].set_value(time ?? "");
    this.act({ type: "schedule", [kind]: time, space: focused()?.space ?? null }, cx);
  }
  saveModel(cx) {
    const state = this.state(), key = this.agentKey(state ?? {});
    if (!state?.live || !AGENT_OPTIONS[key] || this.modelInput.value().trim() === (tuningFor(state, key).model ?? "")) return;
    this.act({ type: "tune", key, model: this.modelInput.value() }, cx);
  }
  fix(task, cx) {
    const state = this.state();
    if (!task?.terminal || !state?.check?.command) return;
    cx.spawn(async cx => {
      const sent = await hc(["send", task.terminal, fixRequest(state.check.command, task.checkOutput ?? "")]).then(result => result.code === 0, () => false);
      if (sent) this.act({ type: "fixing", id: task.id }, cx); else { this.focusAgent(task); cx.notify(); }
    });
  }
  open(drawer, cx) {
    if (drawer === "settings" && this.state()?.live) {
      this.checkInput.set_value(this.state().check?.command ?? "");
      this.modelInput.set_value(tuningFor(this.state(), this.agentKey(this.state())).model ?? "");
      if (drawer !== this.drawer) this.loadUpdateStates(cx);
    }
    if (SOURCES[drawer] && !this.state()?.live) return;
    if (drawer === "schedule") { this.timeError = null; for (const kind of ["start", "pause"]) this.times[kind].set_value(this.state()?.schedule?.[kind] ?? ""); }
    if (drawer !== this.drawer && drawer === "picker") this.search.set_value("");
    if (drawer !== this.drawer && SOURCES[drawer]) { this.ticketSearch.set_value(""); this.ticketPicked.clear(); this.projects = null; }
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
          next = { issues: listed.issues, states: states.states, needsProject: Boolean(listed.needsProject), project: listed.project?.name ?? null };
        } else {
          const listed = await readTickets("linear", { op: "issues", open: true, scope: filter.scope, ...(filter.project ? { project: filter.project.id } : {}) });
          const teams = [...new Set((listed.issues ?? []).map(issue => issue.team).filter(Boolean))];
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
    const teams = [...new Set([...state.tasks.filter(task => task.ticket?.provider === "linear" && task.status !== "done").map(task => task.ticket.team),
      ...this.sources.linear.issues.map(issue => issue.team)].filter(Boolean))].slice(0, 5);
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
    this.linearFilter = { ...this.linearFilter, ...change }; this.projects = null; this.ticketPicked.clear();
    localStorage.setItem(`linear:${this.id}`, JSON.stringify(this.linearFilter));
    this.loadTickets("linear", cx); cx.notify();
  }
  loadProjects(cx) {
    const query = this.projectSearch.value().trim(), request = this.projectRequest = (this.projectRequest ?? 0) + 1;
    this.projects = { loading: true, items: this.projects?.items ?? [], error: null };
    cx.spawn(async cx => {
      let next;
      try { next = { loading: false, items: (await readTickets("linear", { op: "projects", ...(query ? { query } : {}) })).projects ?? [], error: null }; }
      catch (error) { next = { loading: false, items: [], error: error?.message || String(error) }; }
      if (this.projectRequest === request && this.projects) { this.projects = next; cx.notify(); }
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
    const opener = appWindow()?.platform === "macos" ? "open" : appWindow()?.platform === "windows" ? "explorer" : "xdg-open";
    exec(opener, [url]).catch(() => {});
  }
  inspect(id, cx) {
    if (this.drawer === "task" && this.detailsFor) this.saveDetails(cx);
    const task = this.state()?.tasks.find(task => task.id === id);
    this.selected = id; this.drawer = "task"; this.confirm = null; this.sent = null;
    this.detailsFor = task?.status === "queued" && this.state()?.live ? id : null;
    if (this.detailsFor) this.details.set_value(task.description ?? "");
    cx.notify();
  }
  nextQuestion(cx) {
    const task = this.state()?.tasks.find(needsInput);
    if (task) { this.inspect(task.id, cx); this.handle.focus(); }
  }
  answer(id, value, cx) {
    if (!id || !String(value ?? "").trim()) return;
    this.act({ type: "answer", id, value }, cx);
    this.reply.set_value("");
    const next = this.state()?.tasks.find(needsInput);
    if (next) this.inspect(next.id, cx); else this.handle.focus();
  }
  create(cx) {
    const title = this.title.value().trim();
    if (!title) { this.handle.focus(); cx.notify(); return; }
    this.act({ type: "create", title }, cx);
    this.title.set_value("");
  }
  speed(cx) {
    const current = this.state()?.speed ?? 1;
    this.act({ type: "speed", value: SPEEDS[(SPEEDS.indexOf(current) + 1) % SPEEDS.length] }, cx);
  }
  toggleMotion(cx) { this.motion = !this.motion; localStorage.setItem("motion", String(this.motion)); cx.notify(); }
  animated() { return this.motion && !this.reducedMotion && appWindow()?.active !== false; }

  button(id, label, fn, t, options = {}) {
    const small = Boolean(options.small);
    return Button.new(`pipeline-${id}`).h(small ? 24 : 32).px(options.iconOnly ? (small ? 5 : 8) : small ? 8 : 11).gap(small ? 5 : 6).flex_none().flex().items_center().justify_center()
      .rounded(6).text_size(small ? 11 : 12).border_1().border_color(options.primary ? t.accent : t.border)
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
  label(text, t) { return div().text_size(12).line_height(1.5).text_color(t.muted).child(text); }
  heading(text) { return div().text_size(12).font_medium().child(text); }

  render(cx) {
    const state = this.state(), t = theme();
    if (!state) return div().p(24).text_color(t.foreground).child("Loading Pipeline…");
    if (newer(state)) return v_flex().p(24).gap(8).text_color(t.foreground)
      .child(div().text_size(14).font_semibold().child("This pipeline was saved by a newer Pipeline"))
      .child(div().text_size(12).line_height(1.5).text_color(t.muted).child("It stays untouched until the newer version is installed again. Run ./install.sh from the herdr-mods checkout that has it."));
    this.seen = new Set();
    const now = Date.now(), motion = this.animated();
    const info = {
      active: activeTasks(state).length,
      queued: state.tasks.filter(task => task.status === "queued").length,
      approvals: state.tasks.filter(needsApproval).length,
      failed: state.tasks.filter(task => task.status === "failed").length,
      questions: state.tasks.filter(needsInput).length,
      done: state.tasks.filter(task => task.status === "done").length,
    };
    const held = state.running && info.queued > 0 && quotaHeld(state);
    const unusable = state.live && this.repo?.error;
    info.status = unusable ? "Not a Git repository" : info.questions ? (state.live ? "An agent needs you" : "Waiting for your answer")
      : !state.running ? (info.active ? (state.live ? "Intake paused · agents keep working" : "Intake paused · finishing active work") : "Paused")
      : held ? "Waiting for quota" : info.active ? (state.live ? "Agents working" : "Pipeline running")
      : info.approvals ? (state.live ? "Waiting for your review" : "Waiting for your approval") : info.queued ? "Waiting" : "Watching for work";
    info.color = held || info.failed || info.questions || unusable ? t.blocked : state.running ? t.accent : t.muted;
    const narrow = this.size.width < 820;
    const root = v_flex().id("pipeline-root").size_full().min_w(0).min_h(0).bg(t.canvas).text_color(t.foreground).text_size(13)
      .track_focus(this.handle)
      .on_size_change((bounds, cx) => {
        // Herdr reports painted bounds; builder lengths are multiplied by app zoom.
        const zoom = Number(settings().zoom) || 1;
        const size = { width: bounds.width / zoom, height: bounds.height / zoom };
        if (Math.abs(size.width - this.size.width) > 1 || Math.abs(size.height - this.size.height) > 1) { this.size = size; cx.notify(); }
      })
      .on_key_down((e, cx) => this.key(e, cx))
      .child(this.header(state, t, narrow))
      .child(this.commands(state, t))
      .child(this.status(state, t, info, motion))
      .child(h_flex().relative().flex_1().min_h(0).min_w(0)
        .child(div().id("pipeline-viewport").flex_1().min_w(0).h_full().overflow_scrollbar()
          .child(this.scene(state, t, info, motion, now, cx)))
        .when(Boolean(this.drawer), el => el.child(this.inspector(state, t, cx)
          .when(this.size.width > 1180, node => node.relative())
          .when(this.size.width <= 1180, node => node.absolute().right(0).top(0).bottom(0)))))
      .child(this.footer(state, t));
    for (const key of [...this.bars.keys()]) if (!this.seen.has(key)) this.bars.delete(key);
    return root;
  }

  key(e, cx) {
    if (e.key === "escape") {
      if (this.drawer) this.open(null, cx); else { this.handle.focus(); cx.notify(); }
      cx.stop_propagation(); return;
    }
    if (!this.handle.is_focused() || (this.state()?.live && ["a", "s"].includes(e.keystroke))) return;
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
    };
    const asked = this.drawer === "task" ? this.state()?.tasks.find(task => task.id === this.selected && needsInput(task)) : null;
    const option = asked?.question?.options[Number(e.keystroke) - 1];
    const action = option ? () => this.answer(asked.id, option, cx) : actions[e.keystroke];
    if (action) { action(); cx.stop_propagation(); }
  }

  header(state, t, narrow) {
    return h_flex().h(50).px(20).gap(10).items_center().flex_none()
      .child(icon("pipeline", 20).text_color(t.accent))
      .child(div().text_size(16).font_semibold().flex_none().child("Pipeline"))
      .child(h_flex().p(2).gap(2).rounded(7).bg(t.raised).flex_none()
        .child(this.button("mode-simulation", "Simulation", cx => this.setMode("simulation", cx), t, { small: true, selected: !state.live, hint: "Example tasks and simulated agents" }))
        .child(this.button("mode-live", "Live", cx => this.setMode("live", cx), t, { small: true, selected: Boolean(state.live), disabled: !this.context.cwd,
          hint: this.context.cwd ? "Real agents, each in its own Git worktree" : "Open Pipeline from a project to run real agents" })))
      .child(div().flex_1().min_w(0).text_size(12).text_color(t.muted).truncate().child(state.live
        ? `${state.repo}${this.repo?.branch ? ` · ${this.repo.branch}` : ""}${(state.repositories?.length ?? 1) > 1 ? ` + ${state.repositories.length - 1} more ${state.repositories.length === 2 ? "repository" : "repositories"}` : ""} · ${this.agentLabel(state)} in its own worktree per task`
        : `${state.context.name} · example repositories: ${REPOS.join(", ")}`))
      .when(!state.live, el => el.child(this.button("speed", `${state.speed}×`, cx => this.speed(cx), t, { icon: "bolt", selected: state.speed > 1, hint: `Simulation speed ${state.speed}× (S)` })))
      .when(!narrow, el => el.child(this.button("motion", "Motion", cx => this.toggleMotion(cx), t,
        { icon: "motion", iconOnly: true, selected: this.motion && !this.reducedMotion, hint: this.reducedMotion ? "System Reduce Motion is enabled" : `${this.motion ? "Turn off" : "Turn on"} animation` })))
      .child(this.button("settings", "Settings", cx => this.open(this.drawer === "settings" ? null : "settings", cx), t, { icon: "settings", iconOnly: true, selected: this.drawer === "settings", hint: "Pipeline settings" }))
      .child(this.runButton(state, t));
  }

  runButton(state, t) {
    const primary = !state.running, next = this.upcoming(state);
    return h_flex().flex_none().items_center()
      .child(this.button("run", state.running ? "Pause intake" : "Start pipeline", cx => this.toggleRun(cx), t,
        { icon: state.running ? "pause" : "play", primary, segment: "left", disabled: Boolean(state.live && this.repo?.error && !state.running),
          hint: `${state.running ? "Pause intake; active work finishes" : state.live ? "Start an agent for each queued task, up to the parallel limit" : "Start dispatching queued work"} (Space)` }))
      .when(primary, el => el.child(div().w(1).h(32).flex_none().flex().items_center().bg(t.accent).child(div().w(1).h(16).bg(t.accent_foreground).opacity(0.35))))
      .child(this.button("schedule", next ? next.time : "Schedule", cx => this.open(this.drawer === "schedule" ? null : "schedule", cx), t,
        { icon: "clock", iconOnly: !next, primary, segment: "right", selected: this.drawer === "schedule",
          hint: next ? `${next.kind === "start" ? "Starts" : "Pauses intake"} every day at ${next.time}. Click to change the schedule` : state.schedule ? "Schedule: nothing more today until you start or pause by hand" : "Schedule a daily start and pause" }));
  }

  commands(state, t) {
    const typed = this.title.value().trim();
    return h_flex().id("pipeline-controls").h(46).px(20).pb(10).gap(8).items_center().flex_none().overflow_x_scrollbar()
      .child(h_flex().flex_1().min_w(240).max_w(480).h(32).pl(10).pr(4).gap(8).items_center().rounded(6).border_1().border_color(t.border).bg(t.input)
        .child(icon("plus", 13).text_color(t.muted))
        .child(div().flex_1().min_w(0).child(Input.new(this.title).w_full().text_size(12).accessibility_label("New task title")))
        .when(Boolean(typed), el => el.child(this.button("create", "Add", cx => this.create(cx), t, { small: true, primary: true, hint: "Add to the queue (Enter)" }))))
      .when(state.live, el => el.child(this.button("agent", this.agentLabel(state), cx => this.open(this.drawer === "settings" ? null : "settings", cx), t, { icon: "terminal", hint: "The agent, model and effort each task starts with" }))
        .child(this.sourceButton("plane", state, t, "Queue tickets from the Plane project linked to this repository (P)"))
        .child(this.sourceButton("linear", state, t, "Queue tickets from Linear (L)")))
      .when(!state.live, el => el.child(this.button("add", "Examples", cx => this.open(this.drawer === "picker" ? null : "picker", cx), t, { icon: "plus", selected: this.drawer === "picker", hint: "Pick example tasks (A)" }))
        .child(this.button("watch", state.watch ? `Watching ${state.column}` : "Watch column", cx => this.open(this.drawer === "watch" ? null : "watch", cx), t, { icon: "eye", selected: state.watch })))
      .child(this.button("parallel", `${state.parallel} parallel`, cx => this.open(this.drawer === "settings" ? null : "settings", cx), t, { icon: "pipeline", hint: state.live ? "How many agents run at once" : "Parallel work slots" }))
      .when(!state.live, el => el.child(this.button("quota", `Quota ${state.quota}%`, cx => this.open(this.drawer === "quota" ? null : "quota", cx), t, { icon: "gauge", hint: "Example quota and reserve controls" })));
  }

  sourceButton(provider, state, t, hint) {
    const watch = state.watching?.[provider];
    return this.button(provider, watch ? `${SOURCES[provider]} · ${watch.name}` : SOURCES[provider], cx => this.open(this.drawer === provider ? null : provider, cx), t,
      { icon: provider, selected: this.drawer === provider || Boolean(watch), hint: state.sourceErrors?.[provider] ?? hint });
  }

  status(state, t, info, motion) {
    return h_flex().id("pipeline-status").h(36).px(20).gap(10).items_center().flex_none().border_y(1).border_color(t.border).text_size(11).text_color(t.muted).overflow_x_scrollbar()
      .child(dot(info.color, 7).id("pipeline-status-dot").when(motion && state.running, el => el.loop("opacity", { from: 0.35, to: 1, period: 1600 })))
      .child(div().font_medium().text_color(t.foreground).flex_none().child(info.status))
      .child(div().flex_none().child(`${info.active}/${state.parallel} active`))
      .child(div().flex_none().child(`${info.queued} queued`))
      .child(div().flex_none().child(`${info.done} done`))
      .child(div().flex_1())
      .when(info.questions > 0, el => el.child(this.button("answer-next", state.live ? `${info.questions} need${info.questions === 1 ? "s" : ""} you` : `Answer ${count(info.questions, "question")}`, cx => this.nextQuestion(cx), t,
        { icon: "question", primary: true, small: true, hint: state.live ? "Show the next agent waiting for you (Q)" : "Open the next question waiting for you (Q)" })))
      .when(info.approvals > 0, el => el.child(this.button("approve-all", !state.live ? `Approve ${count(info.approvals, "task")}` : state.delivery === "pr" ? `Open ${count(info.approvals, "PR")}` : `Merge ${count(info.approvals, "task")}`, cx => this.act({ type: "approveAll" }, cx), t,
        { icon: "check", primary: true, small: true, hint: !state.live ? "Approve every PR waiting for you (Y)" : state.delivery === "pr" ? "Open a pull request for every finished branch, one at a time (Y)"
          : `Merge every finished branch into ${this.repo?.branch ?? "your branch"}, one at a time (Y)` })))
      .when(info.failed > 0, el => el.child(this.button("retry-all", `Retry ${info.failed} failed`, cx => this.act({ type: "retry" }, cx), t,
        { icon: "reset", small: true, hint: "Return failed tasks to the queue (R)" })))
      .when(Boolean(state.live), el => el.child(div().flex_none().child(this.repo?.error ?? `${state.delivery === "pr" ? "Opens pull requests into" : "Merges into"} ${this.repo?.branch ?? "your branch"}`)))
      .when(!state.live, el => el.child(this.button("delivery", state.delivery === "pr" ? "PR approval" : "Auto-merge", cx => this.act({ type: "delivery", value: state.delivery === "pr" ? "direct" : "pr" }, cx), t,
        { small: true, selected: state.delivery === "direct", hint: state.delivery === "pr" ? "New changes wait for your approval. Click to merge after checks pass." : "New changes merge after checks pass. Click to require approval." })));
  }

  footer(state, t) {
    const latest = state.events[0];
    return h_flex().h(32).px(20).gap(10).items_center().border_t(1).border_color(t.border).flex_none().text_size(11)
      .child(dot(latest ? t.accent : t.muted, 4))
      .child(Button.new("pipeline-activity").flex_1().min_w(0).h(24).flex().items_center().justify_start().text_size(11).text_color(t.muted).tab_index(0)
        .accessibility_label("Open activity").tooltip("Open the activity log")
        .hover(el => el.text_color(t.foreground)).focus(el => el.text_color(t.foreground))
        .on_click((_e, cx) => this.open(this.drawer === "activity" ? null : "activity", cx))
        .child(div().min_w(0).truncate().child(latest?.message ?? "Start the pipeline to watch your first tasks enter.")))
      .when(this.size.width > 900, el => el.child(div().text_color(t.muted).flex_none().child(state.live ? "Space start · N new · P Plane · L Linear · Q needs you · Y merge · R retry"
        : "Space start · N new · A examples · Q answer · Y approve · R retry · S speed")));
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

  scene(state, t, info, motion, now, cx) {
    const drawerWidth = this.drawer && this.size.width > 1180 ? 330 : 0;
    const g = layoutScene(state, this.size.width - drawerWidth, this.size.height - CHROME);
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
    for (const task of g.queueShown) { const node = at(task.id); link([node.x + CARD.w / 2, node.y, c.x - SUN, c.y], false); }
    if (!g.queueShown.length) link([30 + CARD.w, c.y, c.x - SUN, c.y], false);
    g.slots.forEach((slot, i) => {
      const task = state.tasks.find(row => ACTIVE.includes(row.status) && row.slot === i);
      link([c.x + SUN, c.y, slot.x - CARD.w / 2, slot.y], Boolean(task), ["routing", "working"].includes(task?.status) && { key: `dispatch-${i}`, color: t.accent });
      link([slot.x + CARD.w / 2, slot.y, g.dock.x, g.dock.y], task?.status === "testing", task?.status === "testing" && { key: `checks-${i}`, color: t.ansi5 });
    });
    for (const task of g.reviewShown) {
      const node = at(task.id);
      link([g.dock.x, g.dock.y, node.x - CARD.w / 2, node.y], needsApproval(task));
      if (task.status === "merging") link([node.x, node.y + CARD.review / 2, g.w - 44, g.h - 66], true, { key: `merge-${task.id}`, color: t.ansi2 });
    }
    for (const task of g.prShown) { const node = at(task.id); link([g.dock.x, g.dock.y, node.x - CARD.w / 2, node.y], false); }
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
    canvas.child(v_flex().absolute().left(c.x - SUN).top(c.y - SUN).size(SUN * 2).rounded(SUN).border_1().border_color(t.accent).bg(t.surface)
      .items_center().justify_center().gap(5).child(icon("pipeline", 24).text_color(t.accent))
      .child(div().font_medium().text_size(13).child("Planner"))
      .child(div().text_color(t.muted).text_size(11).child(!state.running ? "Paused" : info.active ? `${info.active}/${state.parallel} busy` : info.queued ? "Choosing work" : "Idle")));
    const planLeft = Math.max(30 + CARD.w + 20, c.x - 120);
    const planRight = Math.min(c.x + 90, g.slots[1] ? g.slots[1].x - CARD.w / 2 - 14 : c.x + 90);
    canvas.child(v_flex().id("pipeline-plan").absolute().left(planLeft).top(14).w(Math.max(130, planRight - planLeft)).max_h(Math.max(40, c.y - RING - 22)).overflow_hidden().gap(4)
      .child(div().text_size(11).font_medium().text_color(t.muted).child("The plan"))
      .child(div().text_size(12).line_height(1.45).child(state.plan)));

    g.slots.forEach((slot, i) => {
      const launching = state.tasks.find(task => task.status === "routing" && task.slot === i);
      const occupied = state.tasks.some(task => ACTIVE.includes(task.status) && task.status !== "routing" && task.slot === i);
      canvas.child(v_flex().absolute().left(slot.x - CARD.w / 2).top(slot.y - CARD.h / 2).w(CARD.w).h(CARD.h).gap(4).items_center().justify_center()
        .rounded(9).border_1().border_dashed().border_color(t.border).bg(t.canvas)
        .when(!occupied, el => el.child(div().text_size(11).text_color(t.muted).child(`Slot ${i + 1}`))
          .child(div().text_size(11).text_color(t.muted).child(i >= state.parallel ? "Finishing active work" : launching ? `Launching ${launching.id}` : "Available"))));
    });

    canvas.child(this.button("queue", `Queue · ${g.queue.length}`, cx => this.open("queue", cx), t, { hint: "Every queued task" }).absolute().left(30).top(14));
    canvas.child(this.button("review-list", `Review · ${g.review.length}`, cx => this.open("review", cx), t, { hint: "Tasks awaiting approval, merging or failed" }).absolute().right(30).top(14));
    if (g.prs.length) canvas.child(h_flex().absolute().right(30).top(g.prTop).w(CARD.w).h(24).gap(8).items_center()
      .child(div().flex_1().h(1).bg(t.border))
      .child(this.button("pr-list", `Pull requests · ${g.prs.length}`, cx => this.open("prs", cx), t, { small: true, hint: "Open on GitHub: what each one waits for" })));
    if (!g.queue.length) canvas.child(v_flex().absolute().left(30).top(70).w(CARD.w).gap(6)
      .child(div().text_size(13).child(state.watch ? `Watching ${state.column}` : "Queue is clear"))
      .child(div().text_size(12).line_height(1.45).text_color(t.muted).child(state.live ? "Type a task above. Each one gets its own agent, branch and worktree."
        : state.watch ? "New example tasks enter here." : "Type a task above or press A for examples.")));
    if (g.queue.length > g.queueShown.length) canvas.child(this.button("queue-more", `+${g.queue.length - g.queueShown.length} more queued`, cx => this.open("queue", cx), t)
      .absolute().left(30).top(92 + g.queueShown.length * 76 - 16).w(CARD.w));
    if (!g.review.length && !g.prs.length) canvas.child(v_flex().absolute().right(30).top(70).w(CARD.w).gap(6)
      .child(icon("check", 17).text_color(t.muted))
      .child(div().text_size(12).line_height(1.45).text_color(t.muted).child(state.live ? "Finished work docks here for your review and merge." : "Checked changes dock here for approval and merge.")));
    if (g.review.length > g.reviewShown.length && g.reviewFits > 1) canvas.child(this.button("review-more", `+${g.review.length - g.reviewShown.length} more in review`, cx => this.open("review", cx), t)
      .absolute().right(30).top(92 + g.reviewShown.length * 88 - 20).w(CARD.w));
    if (g.prs.length > g.prShown.length && g.prFits > 1) canvas.child(this.button("pr-more", `+${g.prs.length - g.prShown.length} more pull requests`, cx => this.open("prs", cx), t)
      .absolute().right(30).top(g.prY(g.prShown.length) - 20).w(CARD.w));

    for (const node of g.nodes) canvas.child(this.node(node, state, t, motion, now, cx, node.task === g.doneShown[0]));
    canvas.child(this.button("history", `${count(info.done, "task")} completed`, cx => this.open("done", cx), t, { icon: "check", small: true }).absolute().right(24).bottom(12));
    canvas.child(div().absolute().left(30).bottom(17).text_size(11).text_color(t.muted).child("Click any task to inspect it."));
    return canvas;
  }

  node({ task, x, y, kind }, state, t, motion, now, cx, newest) {
    const asking = needsInput(task);
    const [w, h] = asking ? [CARD.w, CARD.review] : { card: [CARD.w, CARD.h], review: [CARD.w, CARD.review], comet: [18, 18], star: [16, 16] }[kind];
    const color = stateColor(task, t), selected = this.drawer === "task" && this.selected === task.id;
    const round = kind === "comet" || kind === "star";
    let wrap = div().id(`pipeline-node-${task.id}`).absolute().left(x - w / 2).top(y - h / 2).w(w).h(h);
    if (motion) wrap = wrap.transition("left", { duration: 850, easing: "ease-in-out" }).transition("top", { duration: 850, easing: "ease-in-out" })
      .transition("width", { duration: 450, easing: "ease-out" }).transition("height", { duration: 450, easing: "ease-out" });
    if (kind === "comet") wrap.child(div().id(`pipeline-glow-${task.id}`).absolute().left(-7).top(-7).size(32).rounded(16).bg(t.accent).opacity(0.25)
      .when(motion, el => el.loop("opacity", { from: 0.08, to: 0.45, period: 900 })));
    if (asking || (kind === "review" && needsApproval(task))) wrap.child(div().id(`pipeline-halo-${task.id}`).absolute().left(-4).top(-4).w(w + 8).h(h + 8).rounded(12)
      .border_1().border_color(asking ? t.blocked : t.ansi5).opacity(0.5).when(motion, el => el.loop("opacity", { from: 0.15, to: 0.85, period: 1800 })));
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
      const busy = ACTIVE.includes(task.status) && !asking && motion, linked = kind === "review" && state.live && task.status === "pr" && Boolean(task.prs);
      card.child(v_flex().size_full().p(kind === "review" || asking ? 9 : 10).gap(4)
        .child(h_flex().gap(6).items_center()
          .child(busy ? svg("mods/pipeline/satellite.svg").id(`pipeline-sat-${task.id}`).size(11).flex_none().text_color(color).spin(task.status === "testing" ? 800 : 1500) : dot(color))
          .child(div().text_size(11).font_medium().text_color(t.muted).flex_none().child(task.id))
          .child(div().flex_1())
          .when(!linked && (!state.live || task.repos.length > 1), el => el.child(div().text_size(11).text_color(t.muted).truncate().child(task.repos.join(" + ")))))
        .child(div().text_size(12).font_medium().truncate().child(task.title))
        .child(asking
          ? h_flex().child(div().px(6).h(18).rounded(4).bg(t.blocked + "26").text_color(t.blocked).text_size(11).font_semibold().flex().items_center().child(cardStatus(state, task)))
          : div().text_size(11).text_color(task.status === "failed" ? t.blocked : task.status === "pr" && state.live ? toneColor(prNeeds(task).tone, t) : t.muted).truncate()
            .when(kind === "review" && (needsApproval(task) || task.status === "failed"), el => el.pr(80)).child(cardStatus(state, task))));
    }
    wrap.child(card);
    if (ACTIVE.includes(task.status) && kind === "card" && !asking && !state.live) wrap.child(div().absolute().left(10).bottom(6).w(CARD.w - 20).h(2).rounded(1).bg(t.raised)
      .child(this.bar(task, state, CARD.w - 20, t.accent, motion, now, cx)));
    if (task.status === "merging" && kind === "review" && !state.live) wrap.child(div().absolute().left(9).bottom(6).w(CARD.w - 18).h(2).rounded(1).bg(t.raised)
      .child(this.bar(task, state, CARD.w - 18, t.ansi2, motion, now, cx)));
    if (kind === "review" && needsApproval(task) && state.live) wrap.child(this.button(`approve-${task.id}`, state.delivery === "pr" ? "Open PR" : "Merge", cx => this.act({ type: "approve", id: task.id }, cx), t,
      { icon: "check", primary: true, small: true, hint: state.delivery === "pr" ? `Push ${task.id}'s branch and open ${task.repos.length > 1 ? `a pull request in each of ${task.repos.join(", ")}` : "a pull request"} into ${targetOf(task) ?? "your branch"}`
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
    else if (asking) wrap.child(this.button(`answer-${task.id}`, "Answer", cx => { if (state.live) this.focusAgent(task); else { this.inspect(task.id, cx); this.handle.focus(); } }, t,
      { icon: "question", primary: true, small: true, hint: state.live ? "Open its agent's terminal" : task.question?.text ?? "Answer the agent" }).absolute().right(8).bottom(8));
    if (kind === "review" && task.status === "failed" && task.reason === "checks") wrap.child(this.button(`fix-${task.id}`, "Fix", cx => this.fix(task, cx), t,
      { icon: "reset", small: true, primary: true, hint: "Send the check output to its agent to fix" }).absolute().right(8).bottom(8));
    else if (kind === "review" && task.status === "failed") wrap.child(this.button(`retry-${task.id}`, "Retry", cx => this.act({ type: "retry", id: task.id }, cx), t,
      { icon: "reset", small: true, hint: `Return ${task.id} to the queue` }).absolute().right(8).bottom(8));
    return wrap;
  }

  inspector(state, t, cx) {
    const titles = { plane: this.sources.plane.project ? `Plane · ${this.sources.plane.project}` : "Plane", linear: `Linear · ${filterLabel(this.linearFilter)}`, picker: "Example tasks", queue: "Queue", review: "Review", prs: "Pull requests", done: "Completed", activity: "Activity", watch: "Watch a column", quota: "Quota", settings: "Pipeline settings", schedule: "Schedule", task: this.selected ?? "Task" };
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
    else if (this.drawer === "queue") rows(state.tasks.filter(task => task.status === "queued"), "Queue is clear. Type a task above or add examples.");
    else if (this.drawer === "review") {
      const approvals = state.tasks.filter(needsApproval).length;
      if (approvals) body.child(this.button("drawer-approve-all", `Approve ${count(approvals, "task")}`, cx => this.act({ type: "approveAll" }, cx), t, { icon: "check", primary: true }));
      rows(state.tasks.filter(task => ["review", "merging", "failed"].includes(task.status)), "Nothing to review. Checked changes arrive here.");
    }
    else if (this.drawer === "prs") rows(state.tasks.filter(task => task.status === "pr"), "No pull requests open. Opened ones wait here until they're merged on GitHub.");
    else if (this.drawer === "done") rows(state.tasks.filter(task => task.status === "done").sort((a, b) => (b.finished ?? 0) - (a.finished ?? 0)), "No completed tasks yet.");
    else if (this.drawer === "activity") {
      if (!state.events.length) body.child(this.label("Start the pipeline to see activity.", t));
      for (const item of state.events) body.child(item.task
        ? Button.new(`pipeline-event-${item.id}`).w_full().text_size(12).line_height(1.45).text_color(t.foreground).tab_index(0)
          .accessibility_label(`${item.message} Inspect ${item.task}`).hover(el => el.text_color(t.accent)).focus(el => el.text_color(t.accent))
          .on_click((_e, cx) => this.inspect(item.task, cx)).child(item.message)
        : this.label(item.message, t));
    }
    else if (this.drawer === "settings") state.live ? this.liveSettings(body, state, t) : this.settings(body, state, t);
    else if (this.drawer === "quota") this.quota(body, state, t);
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
        .child(div().text_size(11).text_color(t.muted).child(`${!state.live || task.repos.length > 1 ? `${task.repos.join(" + ")} · ` : ""}${task.status === "backlog" ? task.column : cardStatus(state, task)}`)));
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
  stepper(body, title, hint, value, type, min, max, t) {
    body.child(v_flex().gap(7).child(this.heading(title)).child(this.label(hint, t))
      .child(h_flex().gap(10).items_center()
        .child(this.button(`${type}-less`, `Decrease ${title}`, cx => this.act({ type, value: value - 1 }, cx), t, { icon: "minus", iconOnly: true, disabled: value <= min }))
        .child(div().min_w(24).text_size(16).font_semibold().child(String(value)))
        .child(this.button(`${type}-more`, `Increase ${title}`, cx => this.act({ type, value: value + 1 }, cx), t, { icon: "plus", iconOnly: true, disabled: value >= max }))));
  }
  settings(body, state, t) {
    this.stepper(body, "Parallel tasks", "Lowering the limit lets active work finish.", state.parallel, "parallel", 1, 6, t);
    this.stepper(body, "Outstanding PRs", "Reserves one PR per repository, including active work.", state.reviewLimit, "reviewLimit", 1, 10, t);
    body.child(this.heading("Delivery for new changes"));
    for (const [value, label] of [["pr", "Create PRs · wait for approval"], ["direct", "Merge after checks pass"]]) body.child(this.button(`delivery-${value}`, label, cx => this.act({ type: "delivery", value }, cx), t, { selected: state.delivery === value }));
    body.child(this.label("Changes already in review keep their delivery policy. Multi-repository tasks complete after every repository merges.", t));
    body.child(this.heading("Simulation speed"));
    body.child(h_flex().gap(8).children(SPEEDS.map(value => this.button(`speed-${value}`, `${value}×`, cx => this.act({ type: "speed", value }, cx), t, { selected: state.speed === value }))));
    body.child(div().h(1).bg(t.border));
    body.child(this.button("ask", state.askNext ? "Next working task will ask" : "Simulate a question", cx => this.act({ type: "ask" }, cx), t, { disabled: state.askNext, icon: "question" }));
    body.child(this.button("fail-check", state.failNext ? "Next check will fail" : "Simulate a failed check", cx => this.act({ type: "fail" }, cx), t, { disabled: state.failNext }));
    body.child(this.motionSwitch(t));
    body.child(this.button("reset", "Reset example pipeline", cx => { this.act({ type: "reset" }, cx); this.picked.clear(); this.selected = null; }, t, { icon: "reset" }));
    body.child(this.label("Runs while Herdr is open. You can close this tab; the pipeline keeps going.", t));
  }
  quota(body, state, t) {
    body.child(div().text_size(29).font_semibold().child(`${state.quota}%`)).child(this.label("Example quota remaining", t));
    body.child(div().h(5).rounded(3).bg(t.raised).child(div().w(`${state.quota}%`).h(5).rounded(3).bg(quotaHeld(state) ? t.blocked : t.accent)));
    body.child(this.label(`Reserve: ${state.reserve}%. Each example launch uses 8%. New work waits before crossing the reserve; active work finishes.`, t));
    body.child(this.button("quota-limit", "Simulate quota limit", cx => this.act({ type: "quota", value: state.reserve }, cx), t, { disabled: state.quota <= state.reserve }));
    body.child(this.button("quota-reset", "Reset example quota", cx => this.act({ type: "quota", value: 100 }, cx), t, { icon: "reset", primary: true }));
    this.stepper(body, "Quota reserve", "Percentage kept for your other work.", state.reserve, "reserve", 0, 50, t);
    body.child(this.label("Quota and launch costs are simulated. Live provider usage and reset times will be connected in a later milestone.", t));
  }
  watch(body, state, t) {
    body.child(this.label("A watched column feeds the same queue as picked tasks. Tasks are claimed once.", t));
    body.child(this.heading("Example board column"));
    for (const column of ["Ready", "Backlog"]) body.child(this.button(`column-${column}`, column, cx => this.act({ type: "column", value: column }, cx), t, { selected: state.column === column }));
    body.child(this.button("watch-toggle", state.watch ? "Stop watching" : `Watch ${state.column}`, cx => this.act({ type: "watch" }, cx), t, { icon: "eye", primary: !state.watch }));
    body.child(this.label(state.watch ? `Watching ${state.column}. New tasks join even while intake is paused.` : "Turn on watch to pick up matching tasks automatically.", t));
    body.child(this.button("arrival", `Move example task to ${state.column}`, cx => this.act({ type: "arrival" }, cx), t, { icon: "plus", disabled: !state.tasks.some(task => task.status === "backlog") }));
    body.child(this.label("This button simulates someone moving a task on the board. No external task service is changed.", t));
  }
  // The time that would change something: a running pipeline's pause, a paused one's start.
  upcoming(state) {
    const kind = state.running ? "pause" : "start", time = state.schedule?.[kind];
    return time ? { kind, time, at: nextScheduled({ schedule: { [kind]: time } }).at } : null;
  }
  schedule(body, state, t) {
    body.child(this.label(state.live ? "Every day at these times Pipeline starts the pipeline or pauses its intake for you, as the Start and Pause buttons do. Agents already working keep going after a pause."
      : "Every day at these times the pipeline starts or pauses its intake for you, as the Start and Pause buttons do. Active work finishes after a pause.", t));
    for (const [kind, title, hint] of [["start", "Start at", state.live ? "Agents start for queued tasks, up to the parallel limit." : "The planner starts dispatching queued work."],
      ["pause", "Pause intake at", state.live ? "No new agents start until the next start." : "No new work enters until the next start."]]) {
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
    body.child(this.label(next ? `Next: ${next.kind === "start" ? "starts" : "pauses intake"} ${day} at ${next.time}.`
      : state.schedule ? `${state.running ? "Running" : "Paused"} now, with no scheduled ${state.running ? "pause" : "start"}.` : "Nothing scheduled.", t));
    body.child(this.label("Times are this computer's local time and repeat daily. Start or pause by hand whenever you like; the schedule acts again at its next time. If Herdr is closed when a time comes round, the latest missed time applies when it opens.", t));
  }
  ticketDrawer(provider, body, state, t) {
    const source = this.sources[provider], service = SOURCES[provider], watch = state.watching?.[provider], filter = this.linearFilter;
    const warn = text => div().text_size(12).line_height(1.45).text_color(t.blocked).child(text);
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
    if (provider === "linear" && this.projects) { this.projectPicker(body, t); return; }
    if (provider === "linear") {
      body.child(h_flex().gap(6).flex_wrap().children(Object.entries(SCOPES).map(([scope, label]) =>
        this.button(`linear-scope-${scope}`, label, cx => this.setLinearFilter({ scope }, cx), t, { small: true, selected: filter.scope === scope }))));
      body.child(h_flex().gap(6).items_center()
        .child(div().flex_1().min_w(0).text_size(12).text_color(t.muted).truncate().child(filter.project?.name ?? "All projects"))
        .child(this.button("linear-project", filter.project ? "Change" : "Choose project", cx => { this.projectSearch.set_value(""); this.loadProjects(cx); this.projectSearch.focus(); }, t, { small: true }))
        .when(Boolean(filter.project), el => el.child(this.button("linear-project-clear", "Clear", cx => this.setLinearFilter({ project: null }, cx), t, { small: true, icon: "x" }))));
      body.child(div().h(1).bg(t.border));
    }
    const watchable = provider !== "linear" || filter.scope === "mine" || Boolean(filter.project);
    const filtered = provider === "linear" ? { scope: filter.scope, project: filter.project, label: filterLabel(filter) } : null;
    body.child(this.heading("Watch a state"));
    body.child(this.label(watch ? `Tickets in ${watch.name}${watch.filter?.label ? ` (${watch.filter.label})` : ""} join the queue within a minute, each one once.`
      : !watchable ? "Choose a project or My tickets to watch a state, so tickets from other teams don't flood the queue."
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
    if (!source.loading && !shown.length) body.child(this.label(query ? "No open tickets match." : provider === "plane" ? "No open tickets in this project." : "No open tickets here. Try All tickets or another project.", t));
    if (shown.length > 80) body.child(this.label(`Showing 80 of ${shown.length}. Search to narrow the list.`, t));
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
  liveSettings(body, state, t) {
    const chosen = state.agent?.name ?? this.agentChoices[0]?.name;
    body.child(this.heading("Agent"));
    body.child(this.label("Each task starts this agent in its own worktree, with the task as its first message.", t));
    if (!this.agentChoices.length) body.child(this.label(this.repo ? "No installed coding agent was found on this machine." : "Looking for installed agents…", t));
    for (const agent of this.agentChoices) body.child(this.button(`agent-${agent.key ?? agent.name}`, agent.name, cx => {
      this.act({ type: "agent", value: { key: agent.key, name: agent.name, run: agent.run } }, cx);
      this.modelInput.set_value(tuningFor(this.state(), agent.key).model ?? "");
    }, t, { selected: chosen === agent.name, icon: chosen === agent.name ? "check" : null, hint: agentRun(state, agent).join(" ") }).w_full().justify_start());
    this.tuning(body, state, t);
    body.child(this.button("auto-trust", state.autoTrust ? "Trusting new worktrees automatically" : "Trust new worktrees automatically", cx => this.act({ type: "autoTrust" }, cx), t,
      { icon: state.autoTrust ? "check" : null, selected: Boolean(state.autoTrust), hint: "Answer the agent's “Do you trust this folder?” prompt for worktrees Pipeline made from your repository" }).w_full().justify_start());
    body.child(this.label("Agents ask once per new folder whether to trust it. Pipeline's worktrees are your repository at its current commit; with this on, Pipeline answers yes for them.", t));
    this.repositories(body, state, t);
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
    if (state.check?.command) body.child(this.button("check-fix", state.check.fix ? "Failures go back to the agent, up to 2 times" : "Failures wait for you",
      cx => this.act({ type: "check", fix: !state.check.fix }, cx), t, { icon: state.check.fix ? "check" : null, selected: state.check.fix,
        hint: state.check.fix ? "Click to stop and wait for you when checks fail" : "Click to send failures back to the agent automatically" }).w_full().justify_start());
    this.stepper(body, "Parallel agents", "Lowering the limit lets running agents finish.", state.parallel, "parallel", 1, 6, t);
    this.stepper(body, "Branches waiting for review", "New agents wait while this many finished branches are unmerged.", state.reviewLimit, "reviewLimit", 1, 10, t);
    body.child(this.heading("Delivery"));
    body.child(h_flex().gap(6).flex_wrap()
      .child(this.button("deliver-merge", "Merge locally", cx => this.act({ type: "deliver", value: "merge" }, cx), t, { small: true, selected: state.delivery !== "pr" }))
      .child(this.button("deliver-pr", "Open a pull request", cx => this.act({ type: "deliver", value: "pr" }, cx), t, { small: true, selected: state.delivery === "pr" })));
    if (state.delivery === "pr") body.child(this.button("auto-pr", state.autoPr ? "Opening pull requests automatically" : "Open pull requests automatically", cx => this.act({ type: "autoPr" }, cx), t,
      { icon: state.autoPr ? "check" : null, selected: Boolean(state.autoPr), hint: state.autoPr ? "Click to wait for you before pushing" : "Push and open the PR as soon as the agent finishes and checks pass, so you review on GitHub" }).w_full().justify_start());
    else body.child(this.button("auto-merge", state.autoMerge ? "Merging automatically" : "Merge automatically", cx => this.act({ type: "autoMerge" }, cx), t,
      { icon: state.autoMerge ? "check" : null, selected: Boolean(state.autoMerge), hint: state.autoMerge ? "Click to wait for you before merging" : "Merge as soon as the agent finishes and checks pass, without waiting for you" }).w_full().justify_start());
    body.child(this.label(state.delivery === "pr"
      ? `${state.autoPr ? "Once the agent finishes and checks pass, Pipeline" : "Approving"} commits anything the agent left, pushes its branch to origin and opens a pull request into ${this.repo?.branch ?? "your branch"} with gh. The task finishes when the PR is merged on GitHub; then its tab closes and the worktree and branch are removed. Needs gh, signed in.`
      : `${state.autoMerge ? "Once the agent finishes and checks pass, Pipeline" : "Merge"} commits anything the agent left, rebases its branch onto ${this.repo?.branch ?? "your branch"} and fast-forwards, so history stays linear. It refuses while your project folder has uncommitted changes or the branch conflicts; the task stays in review with the reason. Afterwards its tab closes and the worktree and branch are removed.`, t));
    this.ticketUpdates(body, state, t);
    body.child(div().h(1).bg(t.border));
    body.child(this.motionSwitch(t));
    body.child(this.label("Agents run in herdr-core, so they keep working if you close this tab or Herdr. Pipeline catches up with them when it opens again.", t));
  }
  repositories(body, state, t) {
    const repos = state.repositories ?? [{ name: state.repo, path: this.context.cwd }];
    body.child(this.heading("Repositories"));
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
    body.child(this.heading("Ticket updates"));
    body.child(this.label("Pipeline can move a ticket as its work goes and link its pull request. Updates never hold up a task: one that fails waits in the task's inspector for Try again.", t));
    for (const [provider, service] of Object.entries(SOURCES)) {
      const setup = state.ticketUpdates?.[provider] ?? {}, source = this.updateStates[provider];
      body.child(div().pt(4).text_size(12).font_semibold().child(service));
      if (source.loading) body.child(this.label("Loading states…", t));
      else if (source.error) body.child(this.label(source.error, t));
      else if (!source.states.length) body.child(this.label(provider === "plane" ? "No states were found for the Plane project linked to this repository."
        : "Queue a Linear ticket first: states come from the teams of queued tickets.", t));
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
      if (provider === "linear") body.child(this.label("Linear updates need a connection with Write permission.", t));
    }
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
    const tune = tuningFor(state, key), chip = (id, text, selected, action, hint) => this.button(id, text, cx => this.act({ type: "tune", key, ...action }, cx), t, { small: true, selected, hint });
    const models = key === "codex" ? this.codexModels : options.models.map(slug => ({ slug, name: `The latest ${slug} model`, efforts: options.efforts }));
    const known = models.find(model => model.slug === tune.model);
    const efforts = known?.efforts.length ? known.efforts : key === "codex" && this.codexModels.length
      ? [...new Set(this.codexModels.flatMap(model => model.efforts))] : options.efforts;
    const pick = model => ({ model: model.slug, ...(tune.effort && model.efforts.length && !model.efforts.includes(tune.effort) ? { effort: null } : {}) });
    body.child(this.heading("Model"));
    body.child(h_flex().gap(6).flex_wrap()
      .child(chip("model-default", "Default", !tune.model, { model: null }, `Whatever ${this.agentName(state)} uses when started on its own`))
      .children(models.map(model => chip(`model-${model.slug}`, model.slug, tune.model === model.slug, pick(model), model.name))));
    body.child(h_flex().gap(6).items_center()
      .child(Input.new(this.modelInput).flex_1().min_w(0).h(32).px(9).bg(t.input).border_1().border_color(t.border).rounded(6).text_size(12)
        .font_family(settings().font_family ?? "JetBrains Mono").accessibility_label("Model name"))
      .child(this.button("model-save", "Save", cx => this.saveModel(cx), t, { small: true, disabled: this.modelInput.value().trim() === (tune.model ?? "") })));
    body.child(this.heading("Effort"));
    body.child(h_flex().gap(6).flex_wrap()
      .child(chip("effort-default", "Default", !tune.effort, { effort: null }, `Whatever ${this.agentName(state)} uses when started on its own`))
      .children(efforts.map(effort => chip(`effort-${effort}`, effort, tune.effort === effort, { effort }))));
    body.child(this.label(`New tasks start with ${tuningLabel(tune) || "the agent's own default model and effort"}. Running agents keep theirs.`, t));
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
    body.child(div().text_size(18).font_semibold().line_height(1.3).child(task.title));
    body.child(h_flex().gap(7).items_center().child(dot(stateColor(task, t))).child(div().text_size(12).child(task.discard ? "Discarding" : labelFor(state, task.status)))
      .when(Boolean(task.agent), el => el.child(div().text_size(12).text_color(t.muted).child(`· ${task.agent}${task.tuning ? ` · ${task.tuning}` : ""}`))));
    if (task.error) body.child(div().text_size(12).line_height(1.45).text_color(t.blocked).child(task.error));
    const ticket = task.ticket, service = SOURCES[ticket?.provider];
    if (service) body.child(h_flex().gap(8).items_center().child(div().flex_1().min_w(0).text_size(12).text_color(t.muted).truncate().child(`${service} ${ticket.key} · ${ticket.status} · ${task.source}`))
      .when(Boolean(ticket.url), el => el.child(this.button(`${ticket.provider}-link-${task.id}`, `Open in ${service}`, () => this.openLink(ticket.url), t, { small: true, icon: ticket.provider, hint: ticket.url }))));
    if (service) this.ticketUpdateDetail(body, task, t);
    if (task.status === "queued") {
      body.child(this.heading("Details for the agent"));
      body.child(Textarea.new(this.details).w_full().h(120).px(9).py(8).rounded(6).border_1().border_color(t.border).bg(t.input).text_size(12).accessibility_label("Details for the agent"));
      body.child(this.label("The title and these details are the agent's first message. Saved when you leave the field.", t));
      body.child(this.label(waitingReason(state, task), t));
      this.repoChips(body, state, task, t);
      this.waitsDetail(body, state, task, t);
    } else {
      if (task.description) body.child(div().text_size(12).line_height(1.5).text_color(t.muted).child(task.description));
      if (several) body.child(this.label(`Repositories: ${task.repos.join(" + ")}`, t));
    }
    if (task.terminal && task.status !== "done" && !task.discard) {
      if (task.reason === "trust") body.child(this.label(`${task.agent ?? "Its agent"} asks whether to trust this new worktree before it starts. The worktree is your repository at its current commit.`, t))
        .child(this.button(`trust-task-${task.id}`, "Trust this worktree", cx => this.trust(task, cx), t, { icon: "check", primary: true, hint: "Answers “Yes, I trust this folder” in its terminal" }));
      body.child(this.button(`open-${task.id}`, "Open agent", () => this.focusAgent(task), t, { icon: "terminal", primary: task.status === "input", hint: "Show its terminal" }));
      if (this.peek.screen.length) body.child(this.screen(this.peek.screen, t, task.status === "input" ? "It's waiting for you. The end of its screen:" : "The end of its screen:"));
      body.child(h_flex().gap(6).items_center()
        .child(Input.new(this.message).flex_1().min_w(0).h(32).px(9).bg(t.input).border_1().border_color(t.border).rounded(6).text_size(12).accessibility_label("Message the agent"))
        .child(this.button(`send-${task.id}`, task.status === "review" ? "Send feedback" : "Send", cx => this.send(task, cx), t,
          { disabled: !this.message.value().trim(), hint: "Types into its terminal and presses Enter" })));
      if (this.sent?.id === task.id) body.child(this.label(this.sent.error ?? (this.sent.pending ? "Sending…" : "Sent. The card follows what the agent does next."), t));
    }
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
      if (!this.peek.diff.length) body.child(this.heading("Changes")).child(this.label("Reading the branch…", t));
      for (const { name, lines } of this.peek.diff) body.child(this.heading(several ? `Changes · ${name}` : "Changes"))
        .child(lines.length ? this.screen(lines, t) : this.label(several ? `No changes in ${name}. It is left out of the merge.` : "No changes yet.", t));
      if (task.prs) body.child(this.label(`Still on GitHub: ${prList(task.prs)}. ${state.delivery === "pr" ? "Opening pull requests again reuses the open ones." : ""}`.trim(), t));
      if (!needsApproval(task)) body.child(this.label(`Approved. It ${state.delivery === "pr" ? "opens its pull requests" : "merges"} once another task finishes merging in ${task.repos.join(" + ")}.`, t));
      else body.child(state.delivery === "pr"
        ? this.button(`merge-${task.id}`, several ? `Open pull requests into ${target}` : `Open a pull request into ${target}`, cx => this.act({ type: "approve", id: task.id }, cx), t,
          { icon: "check", primary: true, hint: `Commits anything left, pushes the branch to origin and opens a pull request with gh${several ? " in each repository the agent changed; each one links the others" : ""}.` })
        : this.button(`merge-${task.id}`, several ? `Merge into ${target} in all ${task.repos.length}` : `Merge into ${target}`, cx => this.act({ type: "approve", id: task.id }, cx), t,
          { icon: "check", primary: true, hint: several ? "Commits anything left, rebases every repository's branch, and fast-forwards them only if all rebased cleanly. Your project folders must have no uncommitted changes."
            : "Commits anything left, rebases onto it and fast-forwards. Your project folder must have no uncommitted changes." }));
      if (state.check?.command) body.child(this.button(`recheck-${task.id}`, "Run checks again", cx => this.act({ type: "recheck", id: task.id }, cx), t, { icon: "reset" }));
    }
    if (task.status === "pr" && task.prs) {
      for (const [name, pr] of Object.entries(task.prs)) {
        const prTarget = task.workspaces?.[name]?.target, need = prNeed(pr, prTarget), suffix = several ? `-${name}` : "", prefix = several ? `${name} · ` : "";
        body.child(this.heading(pr.merged ? `${prefix}Pull request #${pr.number} · Merged` : pr.status ? `${prefix}Pull request #${pr.number} · ${need.label}` : `${prefix}Pull request #${pr.number}`));
        if (!pr.merged && !pr.status) body.child(this.label("Asking GitHub what it waits for…", t));
        if (!pr.merged) for (const item of prChecklist(pr, prTarget)) body.child(h_flex().id(`pipeline-pr-${item.name.toLowerCase()}-${task.id}${suffix}`).gap(8).items_start().text_size(12).line_height(1.45)
          .child(dot(toneColor(item.tone, t)).mt(6))
          .child(div().w(54).flex_none().text_color(t.muted).child(item.name))
          .child(div().flex_1().min_w(0).text_color(item.tone === "blocked" ? t.blocked : t.foreground).child(item.value)));
        body.child(this.button(`pr-link-${task.id}${suffix}`, `Open pull request #${pr.number}`, () => this.openLink(pr.url), t, { icon: "eye", primary: !several, hint: pr.url }));
      }
      body.child(this.label(several ? "Pipeline asks GitHub about each one once a minute. It finishes the task when every pull request is merged, and returns it to review if one is closed; the others stay open."
        : "Pipeline asks GitHub once a minute. It finishes the task when the PR is merged, and returns it to review if it's closed.", t));
    }
    else if (task.status === "merging") body.child(this.label(state.delivery === "pr" ? `Pushing ${several ? "the branches and opening pull requests" : "the branch and opening a pull request"}…` : `Merging into ${target}${several ? ` in ${task.repos.join(" + ")}` : ""}…`, t));
    if (task.status === "done" && task.prs) for (const [name, pr] of Object.entries(task.prs)) body.child(this.button(`pr-link-${task.id}${several ? `-${name}` : ""}`, `${several ? `${name} · ` : ""}Pull request #${pr.number}`, () => this.openLink(pr.url), t, { icon: "eye", hint: pr.url }));
    if (task.status === "failed" && task.reason !== "checks" && !task.discard) body.child(this.button(`retry-task-${task.id}`, trees.length ? `Retry in the same worktree${trees.length > 1 ? "s" : ""}` : "Retry", cx => this.act({ type: "retry", id: task.id }, cx), t, { primary: true, icon: "reset" }));
    if (task.status === "queued" && !trees.length) body.child(this.button(`remove-${task.id}`, "Remove from queue", cx => { this.act({ type: "remove", id: task.id }, cx); this.open(null, cx); }, t));
    else if (!["merging", "pr", "done"].includes(task.status) && !task.discard) {
      const sure = this.confirm === task.id;
      body.child(this.button(`discard-${task.id}`, sure ? `Delete its branch and worktree${several ? "s" : ""}` : "Discard", cx => {
        if (sure) { this.confirm = null; this.act({ type: "discard", id: task.id }, cx); } else { this.confirm = task.id; cx.notify(); }
      }, t, { icon: "x", hint: sure ? "Stops its agent and deletes the worktree and branch. This can't be undone." : "Stop this task and throw its work away" }));
      if (sure) body.child(div().text_size(12).line_height(1.45).text_color(t.blocked).child("Click again to stop its agent and delete the worktree and branch. Unmerged work is lost."));
    }
    if (branch && trees.length > 1) body.child(this.label(`Branch ${branch} in each repository`, t)).children(trees.map(ws => this.label(`${ws.name} · ${ws.cwd}`, t)));
    else if (branch) body.child(this.label(`Branch ${branch}${trees[0]?.cwd ? ` · ${trees[0].cwd}` : ""}`, t));
    const events = state.events.filter(item => item.task === task.id).slice(0, 6);
    if (events.length) body.child(this.heading("Task history"));
    for (const item of events) body.child(this.label(item.message, t));
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
  detail(body, state, t, cx) {
    const task = state.tasks.find(task => task.id === this.selected);
    if (!task) { body.child(this.label("Select a task in the scene.", t)); return; }
    if (state.live) { this.liveDetail(body, state, task, t, cx); return; }
    body.child(div().text_size(18).font_semibold().line_height(1.3).child(task.title));
    body.child(h_flex().gap(7).items_center().child(dot(stateColor(task, t))).child(div().text_size(12).child(LABELS[task.status])));
    if (needsInput(task)) body.child(v_flex().gap(10).p(12).rounded(8).border_1().border_color(t.blocked).bg(t.blocked + "14")
      .child(h_flex().gap(6).items_center().child(icon("question", 14).text_color(t.blocked))
        .child(div().text_size(12).font_semibold().text_color(t.blocked).child(`${task.id} is paused until you answer`)))
      .child(div().text_size(13).line_height(1.45).child(task.question.text))
      .children(task.question.options.map((option, i) => this.button(`choice-${task.id}-${i}`, `${i + 1}  ${option}`, cx => this.answer(task.id, option, cx), t,
        { hint: `Answer “${option}” (${i + 1})` }).w_full().justify_start()))
      .child(h_flex().gap(6).items_center()
        .child(Input.new(this.reply).flex_1().min_w(0).h(32).px(9).bg(t.input).border_1().border_color(t.border).rounded(6).text_size(12).accessibility_label("Your own answer"))
        .child(this.button(`reply-${task.id}`, "Send", cx => this.answer(task.id, this.reply.value(), cx), t, { disabled: !this.reply.value().trim(), hint: "Send your answer (Enter)" }))));
    else if (task.answer) body.child(this.label(`You answered: “${task.answer}”`, t));
    body.child(div().text_size(12).line_height(1.5).text_color(t.muted).child(task.description));
    if (["queued", "backlog"].includes(task.status)) {
      body.child(this.heading("Repositories"));
      body.child(h_flex().gap(6).flex_wrap().children(REPOS.map(repo => this.button(`repo-${task.id}-${repo}`, repo, cx => this.act({ type: "repos", id: task.id, repo }, cx), t,
        { small: true, selected: task.repos.includes(repo), icon: task.repos.includes(repo) ? "check" : null, hint: task.repos.includes(repo) ? `Remove ${repo}` : `Add ${repo}` }))));
    } else body.child(this.label(`Repositories: ${task.repos.join(" + ")}`, t));
    body.child(this.label(`Board: ${task.status === "done" ? "Done" : ["review", "merging"].includes(task.status) ? "Review" : [...ACTIVE, "failed"].includes(task.status) ? "Doing" : task.column} · example`, t));
    if (task.status === "queued") body.child(this.label(waitingReason(state, task), t));
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
