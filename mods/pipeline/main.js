import { View, div, svg, PathBuilder } from "gpui-kit";
import { h_flex, v_flex, Button, Input, InputState, Textarea, TextareaState } from "gpui-base";
import { shared, setShared, theme, props, exec, hc, run, focused, knownAgents, nextCommand, settings, window as appWindow } from "herdr";
import { STORE, LIVE, VERSION, ACTIVE, MOVING, LABELS, REPOS, SPEEDS, createPipeline, createLive, labelFor, migrate, reduce, activeTasks, dependencies, waitingReason, needsApproval, needsInput, quotaHeld, progress, duration } from "./pipeline-model.js";
import { CARD, SUN, RING, layoutScene, samples } from "./geometry.js";
import { trustKeys, fixRequest } from "./pipeline-live.js";
import { readPlane, openIssue } from "./plane-source.js";

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
const DRAWERS = ["picker", "queue", "review", "done", "activity", "settings", "watch", "quota", "plane"];
const icon = (name, size = 15) => svg(`mods/pipeline/${name}.svg`).size(size).flex_none();
const dot = (color, size = 6) => div().size(size).rounded(size / 2).bg(color).flex_none();
const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const stateColor = (task, t) => ["failed", "input"].includes(task.status) ? t.blocked : task.status === "done" ? t.ansi2
  : ["review", "merging"].includes(task.status) ? t.ansi5 : ACTIVE.includes(task.status) ? t.accent : t.muted;
function cardStatus(state, task) {
  if (task.discard) return "Discarding…";
  if (state.live && task.status === "review") return task.error ? "Not merged · see why" : task.checked === "passed" ? "Checks passed" : task.checked === "failed" ? "Checks failing" : "Ready for review";
  if (state.live && task.status === "failed" && task.reason === "checks") return "Checks failed";
  if (state.live && task.status === "merging" && task.pr) return `PR #${task.pr.number} open`;
  if (state.live && task.status === "merging" && state.delivery === "pr") return "Opening PR";
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
    this.planeSearch = InputState.new({ placeholder: "Search Plane tickets…" });
    this.planeSearch.on("change", (_e, cx) => cx.notify());
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
    this.details = TextareaState.new({ placeholder: "Context, constraints, how to check it…", rows: 4 });
    this.details.on("blur", (_e, cx) => this.saveDetails(cx));
    this.mode = this.context.cwd && localStorage.getItem("mode") === "live" ? "live" : "simulation";
    this.confirm = null; this.peek = { key: null, screen: [], diff: [] }; this.sent = null;
    this.repo = null; this.agentChoices = [];
    this.plane = { loading: false, issues: [], states: [], error: null, kind: null, needsProject: false }; this.planePicked = new Set();
    this.motion = localStorage.getItem("motion") !== "false";
    this.reducedMotion = false;
    const all = shared(STORE) ?? {}, saved = all[this.id];
    if (saved?.version !== VERSION) setShared(STORE, { ...all, [this.id]: saved ? migrate(saved) : createPipeline(this.context) });
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

  close() { this.search.release(); this.title.release(); this.reply.release(); this.message.release(); this.details.release(); this.planeSearch.release(); this.checkInput.release(); this.handle.release(); }
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
    const all = shared(STORE) ?? {}, key = LIVE + this.id;
    if (!all[key]) setShared(STORE, { ...all, [key]: createLive(this.context) });
    const { cwd, on } = this.context;
    cx.spawn(async cx => {
      try {
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
        const branch = await exec("git", ["symbolic-ref", "--short", "HEAD"], { cwd, on });
        this.repo = top.code === 0 ? { root: top.stdout.trim(), branch: branch.code === 0 ? branch.stdout.trim() : null }
          : { error: "This folder isn't in a Git repository, so Live can't give agents their own worktrees." };
      } catch { this.repo = { error: "Git couldn't be run for this folder." }; }
      try { this.agentChoices = (await knownAgents({ on })).filter(agent => agent.installed); } catch { this.agentChoices = []; }
      if (this.repo?.root) {
        const found = await exec("sh", ["-c", CHECK_HINTS], { cwd: this.repo.root, on }).catch(() => null);
        this.checkSuggestions = (found?.stdout ?? "").split("\n").map(line => line.trim()).filter(Boolean).slice(0, 3);
      }
      cx.notify();
    });
  }
  agentName(state) { return state.agent?.name ?? this.agentChoices[0]?.name ?? "Agent"; }
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
    const key = `${task.id}:${task.status}:${task.terminal}:${task.workspace?.root}`;
    if (this.peek.key === key) return;
    this.peek = { key, screen: [], diff: [] };
    const { on } = this.context;
    cx.spawn(async cx => {
      const peek = { key, screen: [], diff: [] };
      if (task.terminal && ["input", "working", "review"].includes(task.status)) {
        const screen = await hc(["read", task.terminal, "--lines", "60"]).catch(() => null);
        const lines = screen?.code === 0 ? screen.stdout.split("\n").map(line => line.trimEnd()) : [];
        while (lines.length && !lines.at(-1)) lines.pop();
        peek.screen = lines.slice(-14);
        while (peek.screen.length && !peek.screen[0]) peek.screen.shift();
      }
      if (task.workspace && ["review", "merging"].includes(task.status)) {
        const diff = await exec("git", ["-C", task.workspace.root, "diff", "--stat", task.workspace.base], { on }).catch(() => null);
        const status = await exec("git", ["-C", task.workspace.root, "status", "--porcelain"], { on }).catch(() => null);
        const fresh = (status?.stdout ?? "").split("\n").filter(line => line.startsWith("??")).length;
        peek.diff = [...(diff?.stdout ?? "").trimEnd().split("\n").filter(Boolean), ...(fresh ? [`plus ${fresh} new file${fresh === 1 ? "" : "s"} not yet committed`] : [])];
      }
      if (this.peek.key === key) { this.peek = peek; cx.notify(); }
    });
  }
  saveCheck(cx) {
    const state = this.state();
    if (!state?.live || this.checkInput.value().trim() === (state.check?.command ?? "")) return;
    this.act({ type: "check", command: this.checkInput.value() }, cx);
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
    if (drawer === "settings" && this.state()?.live) this.checkInput.set_value(this.state().check?.command ?? "");
    if (drawer === "plane" && !this.state()?.live) return;
    if (drawer !== this.drawer && drawer === "picker") this.search.set_value("");
    if (drawer !== this.drawer && drawer === "plane") this.planeSearch.set_value("");
    this.drawer = drawer;
    if (drawer === "plane") { this.loadPlane(cx); this.planeSearch.focus(); }
    else if (drawer === "picker") this.search.focus(); else if (!drawer) this.handle.focus();
    cx.notify();
  }
  loadPlane(cx) {
    if (this.plane.loading) return;
    this.plane = { ...this.plane, loading: true, error: null, kind: null };
    const context = { cwd: this.context.cwd, on: this.context.on };
    cx.spawn(async cx => {
      try {
        const listed = await readPlane({ op: "issues", context, scope: "all" });
        const states = listed.needsProject ? { states: [] } : await readPlane({ op: "states", context });
        this.plane = { loading: false, issues: (listed.issues ?? []).filter(openIssue), states: states.states ?? [], needsProject: Boolean(listed.needsProject),
          project: listed.project?.name ?? null, error: null, kind: null };
      } catch (error) { this.plane = { ...this.plane, loading: false, error: error?.message || String(error), kind: error?.kind ?? null }; }
      cx.notify();
    });
  }
  queuePlane(issues, cx) {
    this.act({ type: "addPlane", issues, source: "Plane" }, cx);
    this.planePicked.clear();
    this.open(null, cx);
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
  label(text, t) { return div().text_size(12).line_height(1.5).text_color(t.muted).child(text); }
  heading(text) { return div().text_size(12).font_medium().child(text); }

  render(cx) {
    const state = this.state(), t = theme();
    if (!state) return div().p(24).text_color(t.foreground).child("Loading Pipeline…");
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
    if (e.keystroke === "p" && this.state()?.live) { this.open("plane", cx); cx.stop_propagation(); return; }
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
        ? `${state.repo}${this.repo?.branch ? ` · ${this.repo.branch}` : ""} · ${this.agentName(state)} in its own worktree per task`
        : `${state.context.name} · example repositories: ${REPOS.join(", ")}`))
      .when(!state.live, el => el.child(this.button("speed", `${state.speed}×`, cx => this.speed(cx), t, { icon: "bolt", selected: state.speed > 1, hint: `Simulation speed ${state.speed}× (S)` })))
      .when(!narrow, el => el.child(this.button("motion", "Motion", cx => this.toggleMotion(cx), t,
        { icon: "motion", iconOnly: true, selected: this.motion && !this.reducedMotion, hint: this.reducedMotion ? "System Reduce Motion is enabled" : `${this.motion ? "Turn off" : "Turn on"} animation` })))
      .child(this.button("settings", "Settings", cx => this.open(this.drawer === "settings" ? null : "settings", cx), t, { icon: "settings", iconOnly: true, selected: this.drawer === "settings", hint: "Pipeline settings" }))
      .child(this.button("run", state.running ? "Pause intake" : "Start pipeline", cx => this.toggleRun(cx), t,
        { icon: state.running ? "pause" : "play", primary: !state.running, disabled: Boolean(state.live && this.repo?.error && !state.running),
          hint: `${state.running ? "Pause intake; active work finishes" : state.live ? "Start an agent for each queued task, up to the parallel limit" : "Start dispatching queued work"} (Space)` }));
  }

  commands(state, t) {
    const typed = this.title.value().trim();
    return h_flex().id("pipeline-controls").h(46).px(20).pb(10).gap(8).items_center().flex_none().overflow_x_scrollbar()
      .child(h_flex().flex_1().min_w(240).max_w(480).h(32).pl(10).pr(4).gap(8).items_center().rounded(6).border_1().border_color(t.border).bg(t.input)
        .child(icon("plus", 13).text_color(t.muted))
        .child(div().flex_1().min_w(0).child(Input.new(this.title).w_full().text_size(12).accessibility_label("New task title")))
        .when(Boolean(typed), el => el.child(this.button("create", "Add", cx => this.create(cx), t, { small: true, primary: true, hint: "Add to the queue (Enter)" }))))
      .when(state.live, el => el.child(this.button("agent", this.agentName(state), cx => this.open(this.drawer === "settings" ? null : "settings", cx), t, { icon: "terminal", hint: "The agent each task starts with" }))
        .child(this.button("plane", state.watchPlane ? `Plane · ${state.watchPlane.name}` : "Plane", cx => this.open(this.drawer === "plane" ? null : "plane", cx), t,
          { icon: "plane", selected: this.drawer === "plane" || Boolean(state.watchPlane), hint: state.planeError ?? "Queue tickets from the Plane project linked to this repository (P)" })))
      .when(!state.live, el => el.child(this.button("add", "Examples", cx => this.open(this.drawer === "picker" ? null : "picker", cx), t, { icon: "plus", selected: this.drawer === "picker", hint: "Pick example tasks (A)" }))
        .child(this.button("watch", state.watch ? `Watching ${state.column}` : "Watch column", cx => this.open(this.drawer === "watch" ? null : "watch", cx), t, { icon: "eye", selected: state.watch })))
      .child(this.button("parallel", `${state.parallel} parallel`, cx => this.open(this.drawer === "settings" ? null : "settings", cx), t, { icon: "pipeline", hint: state.live ? "How many agents run at once" : "Parallel work slots" }))
      .when(!state.live, el => el.child(this.button("quota", `Quota ${state.quota}%`, cx => this.open(this.drawer === "quota" ? null : "quota", cx), t, { icon: "gauge", hint: "Example quota and reserve controls" })));
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
      .when(this.size.width > 900, el => el.child(div().text_color(t.muted).flex_none().child(state.live ? "Space start · N new · P Plane · Q needs you · Y merge · R retry"
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
      .child(div().text_color(t.muted).text_size(10).child(!state.running ? "Paused" : info.active ? `${info.active}/${state.parallel} busy` : info.queued ? "Choosing work" : "Idle")));
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
    if (!g.queue.length) canvas.child(v_flex().absolute().left(30).top(70).w(CARD.w).gap(6)
      .child(div().text_size(13).child(state.watch ? `Watching ${state.column}` : "Queue is clear"))
      .child(div().text_size(12).line_height(1.45).text_color(t.muted).child(state.live ? "Type a task above. Each one gets its own agent, branch and worktree."
        : state.watch ? "New example tasks enter here." : "Type a task above or press A for examples.")));
    if (g.queue.length > g.queueShown.length) canvas.child(this.button("queue-more", `+${g.queue.length - g.queueShown.length} more queued`, cx => this.open("queue", cx), t)
      .absolute().left(30).top(92 + g.queueShown.length * 76 - 16).w(CARD.w));
    if (!g.review.length) canvas.child(v_flex().absolute().right(30).top(70).w(CARD.w).gap(6)
      .child(icon("check", 17).text_color(t.muted))
      .child(div().text_size(12).line_height(1.45).text_color(t.muted).child(state.live ? "Finished work docks here for your review and merge." : "Checked changes dock here for approval and merge.")));
    if (g.review.length > g.reviewShown.length) canvas.child(this.button("review-more", `+${g.review.length - g.reviewShown.length} more in review`, cx => this.open("review", cx), t)
      .absolute().right(30).top(92 + g.reviewShown.length * 88 - 20).w(CARD.w));

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
      const busy = ACTIVE.includes(task.status) && !asking && motion;
      card.child(v_flex().size_full().p(kind === "review" || asking ? 9 : 10).gap(4)
        .child(h_flex().gap(6).items_center()
          .child(busy ? svg("mods/pipeline/satellite.svg").id(`pipeline-sat-${task.id}`).size(11).flex_none().text_color(color).spin(task.status === "testing" ? 800 : 1500) : dot(color))
          .child(div().text_size(10).font_medium().text_color(t.muted).flex_none().child(task.id))
          .child(div().flex_1())
          .child(div().text_size(10).text_color(t.muted).truncate().child(task.repos.join(" + "))))
        .child(div().text_size(12).font_medium().truncate().child(task.title))
        .child(asking
          ? h_flex().child(div().px(6).h(18).rounded(4).bg(t.blocked + "26").text_color(t.blocked).text_size(10.5).font_semibold().flex().items_center().child(cardStatus(state, task)))
          : div().text_size(10).text_color(task.status === "failed" ? t.blocked : t.muted).truncate().when(kind === "review" && (needsApproval(task) || task.status === "failed"), el => el.pr(80)).child(cardStatus(state, task))));
    }
    wrap.child(card);
    if (ACTIVE.includes(task.status) && kind === "card" && !asking && !state.live) wrap.child(div().absolute().left(10).bottom(6).w(CARD.w - 20).h(2).rounded(1).bg(t.raised)
      .child(this.bar(task, state, CARD.w - 20, t.accent, motion, now, cx)));
    if (task.status === "merging" && kind === "review" && !state.live) wrap.child(div().absolute().left(9).bottom(6).w(CARD.w - 18).h(2).rounded(1).bg(t.raised)
      .child(this.bar(task, state, CARD.w - 18, t.ansi2, motion, now, cx)));
    if (kind === "review" && needsApproval(task) && state.live) wrap.child(this.button(`approve-${task.id}`, state.delivery === "pr" ? "Open PR" : "Merge", cx => this.act({ type: "approve", id: task.id }, cx), t,
      { icon: "check", primary: true, small: true, hint: state.delivery === "pr" ? `Push ${task.id}'s branch and open a pull request into ${task.workspace?.target ?? "your branch"}`
        : `Merge ${task.id} into ${task.workspace?.target ?? "your branch"}` }).absolute().right(8).bottom(8));
    else if (kind === "review" && state.live && task.pr) wrap.child(this.button(`pr-${task.id}`, `#${task.pr.number}`, () => this.openLink(task.pr.url), t,
      { icon: "eye", small: true, hint: `Open pull request #${task.pr.number} on GitHub` }).absolute().right(8).bottom(8));
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
    const titles = { plane: this.plane.project ? `Plane · ${this.plane.project}` : "Plane", picker: "Example tasks", queue: "Queue", review: "Review", done: "Completed", activity: "Activity", watch: "Watch a column", quota: "Quota", settings: "Pipeline settings", task: this.selected ?? "Task" };
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
    else if (this.drawer === "plane") this.planeDrawer(body, state, t);
    else if (this.drawer === "queue") rows(state.tasks.filter(task => task.status === "queued"), "Queue is clear. Type a task above or add examples.");
    else if (this.drawer === "review") {
      const approvals = state.tasks.filter(needsApproval).length;
      if (approvals) body.child(this.button("drawer-approve-all", `Approve ${count(approvals, "task")}`, cx => this.act({ type: "approveAll" }, cx), t, { icon: "check", primary: true }));
      rows(state.tasks.filter(task => ["review", "merging", "failed"].includes(task.status)), "Nothing to review. Checked changes arrive here.");
    }
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
    else if (this.drawer === "task") this.detail(body, state, t, cx);
    return panel.child(body);
  }
  taskRow(task, state, t, fn, picked = false) {
    return Button.new(`pipeline-row-${task.id}`).w_full().p(10).rounded(6).bg(picked ? t.selected : t.surface)
      .border_1().border_color(picked ? t.accent : t.border).text_color(t.foreground).tab_index(0)
      .accessibility_label(`${task.id}: ${task.title}. ${picked ? "Selected" : LABELS[task.status]}`)
      .hover(el => el.bg(t.hover)).focus(el => el.border_color(t.accent)).on_click((_e, cx) => fn(cx))
      .child(v_flex().w_full().gap(6).child(h_flex().items_center().gap(6).child(dot(stateColor(task, t)))
        .child(div().text_size(10).text_color(t.muted).child(task.id)).child(div().flex_1())
        .when(picked, el => el.child(icon("check", 13))))
        .child(div().text_size(12).font_medium().child(task.title))
        .child(div().text_size(10).text_color(t.muted).child(`${task.repos.join(" + ")} · ${task.status === "backlog" ? task.column : cardStatus(state, task)}`)));
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
    body.child(this.button("motion-setting", this.motion ? "Turn animation off" : "Turn animation on", cx => this.toggleMotion(cx), t));
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
  planeDrawer(body, state, t) {
    const plane = this.plane, unavailable = plane.needsProject || plane.kind === "auth";
    const warn = text => div().text_size(12).line_height(1.45).text_color(t.blocked).child(text);
    if (unavailable) {
      body.child(this.label(plane.needsProject ? "This repository isn't linked to a Plane project yet. Link it in the Tasks panel, then come back." : "Plane isn't connected on this computer. Connect it in the Tasks panel, then come back.", t));
      body.child(this.button("open-tasks", "Open the Tasks panel", () => run("tabs-show.plane"), t, { icon: "plane" }));
      body.child(this.button("plane-refresh", "Refresh", cx => this.loadPlane(cx), t, { icon: "reset", disabled: plane.loading }));
      return;
    }
    if (plane.error) body.child(warn(plane.error));
    body.child(this.heading("Watch a state"));
    body.child(this.label(state.watchPlane ? `Tickets in ${state.watchPlane.name} join the queue within a minute, each one once.`
      : "Choose a state and its tickets join the queue by themselves, each one once. Pipeline never changes Plane.", t));
    if (state.planeError) body.child(warn(state.planeError));
    body.child(h_flex().gap(6).flex_wrap().children(plane.states.filter(row => !["completed", "canceled"].includes(row.group)).map(row =>
      this.button(`watch-${row.id}`, row.name, cx => this.act({ type: "watchPlane", state: row }, cx), t, { small: true, selected: state.watchPlane?.id === row.id, hint: `Queue tickets that are in ${row.name}` })))
      .when(Boolean(state.watchPlane), el => el.child(this.button("watch-stop", "Stop watching", cx => this.act({ type: "watchPlane", state: null }, cx), t, { small: true, icon: "x" }))));
    if (!plane.states.length && !plane.loading) body.child(this.label("No states were found for this project.", t));
    body.child(div().h(1).bg(t.border));
    body.child(this.heading("Pick tickets"));
    body.child(Input.new(this.planeSearch).w_full().h(34).px(9).bg(t.input).border_1().border_color(t.border).rounded(6).text_size(12).accessibility_label("Search Plane tickets"));
    const query = this.planeSearch.value().trim().toLowerCase();
    const shown = plane.issues.filter(issue => `${issue.identifier} ${issue.title} ${issue.status}`.toLowerCase().includes(query));
    const active = new Set(state.tasks.filter(task => task.plane && task.status !== "done").map(task => task.plane.uuid));
    const chosen = plane.issues.filter(issue => this.planePicked.has(issue.uuid) && !active.has(issue.uuid));
    body.child(h_flex().gap(8).flex_wrap()
      .child(this.button("plane-queue", `Queue ${count(chosen.length, "ticket")}`, cx => this.queuePlane(chosen, cx), t, { primary: true, icon: "plus", disabled: !chosen.length }))
      .child(this.button("plane-refresh", plane.loading ? "Loading…" : "Refresh", cx => this.loadPlane(cx), t, { icon: "reset", disabled: plane.loading })));
    if (plane.loading && !plane.issues.length) body.child(this.label("Loading open tickets…", t));
    for (const issue of shown.slice(0, 80)) body.child(this.issueRow(issue, active.has(issue.uuid), t));
    if (!plane.loading && !shown.length) body.child(this.label(query ? "No open tickets match." : "No open tickets in this project.", t));
    if (shown.length > 80) body.child(this.label(`Showing 80 of ${shown.length}. Search to narrow the list.`, t));
  }
  issueRow(issue, inPipeline, t) {
    const picked = this.planePicked.has(issue.uuid) && !inPipeline;
    return Button.new(`pipeline-plane-${issue.identifier}`).w_full().p(10).rounded(6).bg(picked ? t.selected : t.surface)
      .border_1().border_color(picked ? t.accent : t.border).text_color(t.foreground).tab_index(0).disabled(inPipeline).opacity(inPipeline ? 0.55 : 1)
      .accessibility_label(`${issue.identifier}: ${issue.title}. ${issue.status}.${inPipeline ? " Already in Pipeline." : picked ? " Selected." : ""}`)
      .hover(el => el.bg(t.hover)).focus(el => el.border_color(t.accent))
      .on_click((_e, cx) => { if (inPipeline) return; this.planePicked.has(issue.uuid) ? this.planePicked.delete(issue.uuid) : this.planePicked.add(issue.uuid); cx.notify(); })
      .child(v_flex().w_full().gap(5)
        .child(h_flex().items_center().gap(6).child(div().text_size(10).font_medium().text_color(t.muted).child(issue.identifier))
          .child(div().flex_1().min_w(0).text_size(10).text_color(t.muted).truncate().child(`${issue.status} · ${issue.priority?.name ?? "No priority"}`))
          .when(inPipeline, el => el.child(div().text_size(10).text_color(t.muted).child("In Pipeline")))
          .when(picked, el => el.child(icon("check", 13))))
        .child(div().text_size(12).font_medium().child(issue.title)));
  }
  liveSettings(body, state, t) {
    const chosen = state.agent?.name ?? this.agentChoices[0]?.name;
    body.child(this.heading("Agent"));
    body.child(this.label("Each task starts this agent in its own worktree, with the task as its first message.", t));
    if (!this.agentChoices.length) body.child(this.label(this.repo ? "No installed coding agent was found on this machine." : "Looking for installed agents…", t));
    for (const agent of this.agentChoices) body.child(this.button(`agent-${agent.key ?? agent.name}`, agent.name, cx => this.act({ type: "agent", value: { key: agent.key, name: agent.name, run: agent.run } }, cx), t,
      { selected: chosen === agent.name, icon: chosen === agent.name ? "check" : null, hint: agent.run.join(" ") }).w_full().justify_start());
    body.child(this.button("auto-trust", state.autoTrust ? "Trusting new worktrees automatically" : "Trust new worktrees automatically", cx => this.act({ type: "autoTrust" }, cx), t,
      { icon: state.autoTrust ? "check" : null, selected: Boolean(state.autoTrust), hint: "Answer the agent's “Do you trust this folder?” prompt for worktrees Pipeline made from your repository" }).w_full().justify_start());
    body.child(this.label("Agents ask once per new folder whether to trust it. Pipeline's worktrees are your repository at its current commit; with this on, Pipeline answers yes for them.", t));
    body.child(this.heading("Check before review"));
    body.child(this.label("When an agent finishes, this command runs in its worktree. Passing work moves to review; leave it empty to skip checks.", t));
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
    body.child(this.label(state.delivery === "pr"
      ? `Approving commits anything the agent left, pushes its branch to origin and opens a pull request into ${this.repo?.branch ?? "your branch"} with gh. The task finishes when the PR is merged on GitHub; then its tab closes and the worktree and branch are removed. Needs gh, signed in.`
      : `Merge commits anything the agent left, rebases its branch onto ${this.repo?.branch ?? "your branch"} and fast-forwards, so history stays linear. It refuses while your project folder has uncommitted changes or the branch conflicts; the task stays in review with the reason. Afterwards its tab closes and the worktree and branch are removed.`, t));
    body.child(div().h(1).bg(t.border));
    body.child(this.button("motion-setting", this.motion ? "Turn animation off" : "Turn animation on", cx => this.toggleMotion(cx), t));
    body.child(this.label("Agents run in herdr-core, so they keep working if you close this tab or Herdr. Pipeline catches up with them when it opens again.", t));
  }
  screen(lines, t, caption) {
    return v_flex().w_full().gap(4)
      .when(Boolean(caption), el => el.child(this.label(caption, t)))
      .child(v_flex().w_full().p(10).rounded(6).bg(t.background).border_1().border_color(t.border).font_family(settings().font_family ?? "JetBrains Mono").text_size(11)
        .children(lines.map(line => div().min_h(15).truncate().child(line || " "))));
  }
  liveDetail(body, state, task, t, cx) {
    this.peekAt(task, cx);
    const ws = task.workspace ?? task.planned, target = ws?.target ?? this.repo?.branch ?? "your branch";
    body.child(div().text_size(18).font_semibold().line_height(1.3).child(task.title));
    body.child(h_flex().gap(7).items_center().child(dot(stateColor(task, t))).child(div().text_size(12).child(task.discard ? "Discarding" : labelFor(state, task.status)))
      .when(Boolean(task.agent), el => el.child(div().text_size(12).text_color(t.muted).child(`· ${task.agent}`))));
    if (task.error) body.child(div().text_size(12).line_height(1.45).text_color(t.blocked).child(task.error));
    if (task.plane) body.child(h_flex().gap(8).items_center().child(div().flex_1().min_w(0).text_size(12).text_color(t.muted).truncate().child(`Plane ${task.plane.key} · ${task.plane.status} · ${task.source}`))
      .when(Boolean(task.plane.url), el => el.child(this.button(`plane-link-${task.id}`, "Open in Plane", () => this.openLink(task.plane.url), t, { small: true, icon: "plane", hint: task.plane.url }))));
    if (task.status === "queued") {
      body.child(this.heading("Details for the agent"));
      body.child(Textarea.new(this.details).w_full().h(120).px(9).py(8).rounded(6).border_1().border_color(t.border).bg(t.input).text_size(12).accessibility_label("Details for the agent"));
      body.child(this.label("The title and these details are the agent's first message. Saved when you leave the field.", t));
      body.child(this.label(waitingReason(state, task), t));
    } else if (task.description) body.child(div().text_size(12).line_height(1.5).text_color(t.muted).child(task.description));
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
    if (task.status === "testing") body.child(this.label(`Running ${state.check?.command ?? "checks"} in its worktree…`, t));
    if (task.status === "failed" && task.reason === "checks" && !task.discard) {
      body.child(this.heading("Checks failed"));
      body.child(this.screen((task.checkOutput || "(no output)").split("\n").slice(-16), t, `$ ${state.check?.command ?? ""}`));
      body.child(h_flex().gap(8).flex_wrap()
        .child(this.button(`fix-task-${task.id}`, "Ask the agent to fix it", cx => this.fix(task, cx), t, { primary: true, icon: "reset", hint: "Sends this output to its agent" }))
        .child(this.button(`review-anyway-${task.id}`, "Review anyway", cx => this.act({ type: "reviewAnyway", id: task.id }, cx), t, { hint: "Move it to review with failing checks" }))
        .child(this.button(`recheck-${task.id}`, "Run checks again", cx => this.act({ type: "recheck", id: task.id }, cx), t, { icon: "reset" })));
    }
    if (task.status === "review" && !task.discard) {
      if (task.checked) body.child(div().text_size(12).line_height(1.45).text_color(task.checked === "passed" ? t.muted : t.blocked)
        .child(task.checked === "passed" ? `Checks passed: ${state.check?.command ?? "checks"}` : "Checks were failing when it moved to review."));
      body.child(this.heading("Changes"));
      body.child(this.peek.diff.length ? this.screen(this.peek.diff, t) : this.label("Reading the branch…", t));
      body.child(state.delivery === "pr"
        ? this.button(`merge-${task.id}`, `Open a pull request into ${target}`, cx => this.act({ type: "approve", id: task.id }, cx), t,
          { icon: "check", primary: true, hint: "Commits anything left, pushes the branch to origin and opens a pull request with gh." })
        : this.button(`merge-${task.id}`, `Merge into ${target}`, cx => this.act({ type: "approve", id: task.id }, cx), t,
          { icon: "check", primary: true, hint: "Commits anything left, rebases onto it and fast-forwards. Your project folder must have no uncommitted changes." }));
      if (state.check?.command) body.child(this.button(`recheck-${task.id}`, "Run checks again", cx => this.act({ type: "recheck", id: task.id }, cx), t, { icon: "reset" }));
    }
    if (task.status === "merging" && task.pr) body.child(this.label(`Pull request #${task.pr.number} is open. Pipeline finishes the task when it's merged on GitHub, and returns it to review if it's closed.`, t))
      .child(this.button(`pr-link-${task.id}`, `Open pull request #${task.pr.number}`, () => this.openLink(task.pr.url), t, { icon: "eye", primary: true, hint: task.pr.url }));
    else if (task.status === "merging") body.child(this.label(state.delivery === "pr" ? "Pushing the branch and opening a pull request…" : `Merging into ${target}…`, t));
    if (task.status === "done" && task.pr) body.child(this.button(`pr-link-${task.id}`, `Pull request #${task.pr.number}`, () => this.openLink(task.pr.url), t, { icon: "eye", hint: task.pr.url }));
    if (task.status === "failed" && task.reason !== "checks" && !task.discard) body.child(this.button(`retry-task-${task.id}`, task.workspace ? "Retry in the same worktree" : "Retry", cx => this.act({ type: "retry", id: task.id }, cx), t, { primary: true, icon: "reset" }));
    if (task.status === "queued" && !task.workspace) body.child(this.button(`remove-${task.id}`, "Remove from queue", cx => { this.act({ type: "remove", id: task.id }, cx); this.open(null, cx); }, t));
    else if (!["merging", "done"].includes(task.status) && !task.discard) {
      const sure = this.confirm === task.id;
      body.child(this.button(`discard-${task.id}`, sure ? "Delete its branch and worktree" : "Discard", cx => {
        if (sure) { this.confirm = null; this.act({ type: "discard", id: task.id }, cx); } else { this.confirm = task.id; cx.notify(); }
      }, t, { icon: "x", hint: sure ? "Stops its agent and deletes the worktree and branch. This can't be undone." : "Stop this task and throw its work away" }));
      if (sure) body.child(div().text_size(12).line_height(1.45).text_color(t.blocked).child("Click again to stop its agent and delete the worktree and branch. Unmerged work is lost."));
    }
    if (ws) body.child(this.label(`Branch ${ws.branch}${task.workspace?.cwd ? ` · ${task.workspace.cwd}` : ""}`, t));
    const events = state.events.filter(item => item.task === task.id).slice(0, 6);
    if (events.length) body.child(this.heading("Task history"));
    for (const item of events) body.child(this.label(item.message, t));
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
