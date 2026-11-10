import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Button } from "gpui-base";
import { appHome, spaces, panes, exec, run, theme, props } from "herdr";
import { moveToPaneButton } from "./panel-actions.js";

const STATUS = {
  active: ["Active", "working"],
  paused: ["Paused", "muted"],
  blocked: ["Blocked", "blocked"],
  usage_limited: ["Usage limit", "blocked"],
  budget_limited: ["Budget limit", "blocked"],
  complete: ["Completed", "ansi2"],
  saved: ["Saved goal", "muted"],
  cleared: ["Cleared", "muted"],
  failed: ["Failed", "blocked"],
  saved_schedule: ["Saved schedule", "muted"],
  schedule_due: ["Run time passed", "muted"],
  cancelled: ["Cancelled", "muted"],
  ended: ["Ended", "muted"],
  expired: ["Expired", "muted"],
  inactive: ["Different project", "muted"],
};
const SOURCES = [{ id: "codex", label: "Codex", script: "codex-goals.py" },
  { id: "claude", label: "Claude", script: "claude-goals.py" },
  { id: "claude-loops", label: "Claude schedules", script: "claude-loops.py" }];
const ended = (goal) => ["complete", "cleared", "failed", "cancelled", "ended", "expired", "inactive"].includes(goal.status);
const sourceOf = (goal) => goal.source || "codex";
const keyOf = (goal) => `${sourceOf(goal)}-${goal.record_id || goal.thread_id}`;
const priority = (goal) => ({ blocked: 0, usage_limited: 1, budget_limited: 1, active: 2,
  saved: 3, paused: 3, saved_schedule: 3, schedule_due: 3 })[goal.status] ?? (ended(goal) ? 4 : 2);
const number = (n) => String(Math.max(0, Math.floor(Number(n) || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const path = (p) => p?.replace(/\\/g, "/").replace(/\/$/, "");
const inside = (a, b) => a === b || a?.startsWith(`${b}/`) || b?.startsWith(`${a}/`);

function duration(seconds) {
  const minutes = Math.floor(Math.max(0, seconds || 0) / 60);
  return minutes < 1 ? "<1m" : minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export default class Loops extends View {
  init(_props, cx) {
    this.items = [];
    this.loading = true;
    const state = props()?.panelState;
    this.all = state?.all ?? (localStorage.getItem("scope") === "all");
    this.completed = state?.completed ?? (localStorage.getItem("completed") === "true");
    this.showCodex = state?.showCodex ?? (localStorage.getItem("source-codex") !== "false");
    this.showClaude = state?.showClaude ?? (localStorage.getItem("source-claude") !== "false");
    cx.spawn(async (cx) => this.reload(cx));
    cx.timer.every(10000, (cx) => { cx.spawn(async (cx) => this.reload(cx)); });
  }

  async reload(cx) {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      const results = await Promise.all(SOURCES.map(async (source) => {
        try {
          const args = [`${appHome()}/mods/loops/${source.script}`];
          if (source.id === "claude-loops") {
            const local = spaces().filter((space) => !space.machine);
            const tabs = new Set(local.flatMap((space) => (space.tabs ?? []).map((tab) => tab.id)));
            const folders = new Set([...local.map((space) => space.folder), ...panes().filter((pane) => tabs.has(pane.tab)).map((pane) => pane.cwd)].filter(Boolean));
            for (const folder of folders) args.push("--project", folder);
          }
          const r = await exec("python3", args);
          let data;
          try { data = JSON.parse(r.stdout); } catch { throw new Error("Check that Python 3 is installed, then refresh."); }
          if (r.code !== 0 || data?.error || !Array.isArray(data?.goals)) throw new Error(data?.error || "Could not read loops. Try refreshing.");
          return { source, data };
        } catch (e) {
          return { source, error: `${source.label}: ${e.message || String(e)}` };
        }
      }));
      this.items = results.flatMap(({ source, data }) => data
        ? data.goals.map((goal) => ({ ...goal, source: source.id }))
        : this.items.filter((goal) => sourceOf(goal) === source.id));
      this.items.sort((a, b) => priority(a) - priority(b) || b.updated_at_ms - a.updated_at_ms);
      this.warning = results.map(({ data }) => data?.warning).filter(Boolean).join(" ");
      this.error = results.map(({ error }) => error).filter(Boolean).join(" ") || null;
      this.sourceErrors = results.filter(({ error }) => error).map(({ source, error }) => ({ source: source.id, message: error }));
      this.sourceWarnings = results.filter(({ data }) => data?.warning).map(({ source, data }) => ({ source: source.id, message: data.warning }));
      if (results.some(({ data }) => data)) this.updated = Date.now();
    } finally {
      this.loading = false;
      this.refreshing = false;
      cx.notify();
    }
  }

  sourceEnabled(source) {
    return source.startsWith("claude") ? this.showClaude !== false : this.showCodex !== false;
  }

  toggleSource(source, cx) {
    const field = source === "claude" ? "showClaude" : "showCodex";
    this[field] = this[field] === false;
    localStorage.setItem(`source-${source}`, String(this[field]));
    cx.notify();
  }

  scope() {
    const space = spaces().find((s) => s.active);
    if (this.all) return { space, items: this.items };
    if (!space || space.machine) return { space, items: [] };
    const tabs = new Set((space.tabs ?? []).map((t) => t.id));
    // The space's saved folder can be stale; use its terminals' live folders.
    const folders = panes().filter((p) => tabs.has(p.tab) && p.cwd).map((p) => path(p.cwd));
    if (!folders.length && space.folder) folders.push(path(space.folder));
    return { space, items: this.items.filter((g) => g.cwd && folders.some((p) => inside(path(g.cwd), p))) };
  }

  open(goal) {
    if (sourceOf(goal) !== "codex") return;
    // Resume the exact thread. Matching agents by folder alone can select the wrong session.
    const space = spaces().find((s) => s.active && !s.machine);
    const args = { name: "Codex goal", folder: goal.cwd, argv: ["codex", "resume", goal.thread_id] };
    if (space) run("tab.new", { ...args, space: space.id });
    else run("space.new", { ...args, name: goal.cwd.split("/").pop() || "Codex goal", tab: "Codex goal" });
  }

  render() {
    const t = theme();
    const { space, items: scoped } = this.scope();
    const items = scoped.filter((goal) => this.sourceEnabled(sourceOf(goal)));
    const error = this.sourceErrors?.filter((entry) => this.sourceEnabled(entry.source)).map((entry) => entry.message).join(" ") || (this.sourceErrors ? null : this.error);
    const warning = this.sourceWarnings?.filter((entry) => this.sourceEnabled(entry.source)).map((entry) => entry.message).join(" ") || (this.sourceWarnings ? null : this.warning);
    const current = items.filter((g) => !ended(g));
    const history = items.filter(ended);
    const visible = this.completed ? items : current;
    const button = (id, label, action, selected = false) => Button.new(id).h(26).px(8).flex_none()
      .flex().items_center().justify_center().rounded(6).text_size(11.5)
      .bg(selected ? t.selected : t.raised).text_color(selected ? t.foreground : t.muted)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => action(cx)).child(label);
    const goalRow = (goal) => {
      const [label, color] = STATUS[goal.status] ?? [goal.status, "muted"];
      const claude = sourceOf(goal).startsWith("claude");
      const scheduled = goal.kind === "schedule";
      const key = keyOf(goal);
      const project = goal.cwd?.split("/").pop() || "Unknown project";
      const tokens = goal.token_budget == null
        ? `${number(goal.tokens_used)} tokens used`
        : `${number(goal.tokens_used)} / ${number(goal.token_budget)} tokens`;
      const percent = goal.token_budget > 0 ? Math.min(100, Math.max(0, goal.tokens_used / goal.token_budget * 100)) : null;
      return v_flex().id(`goal-${key}`).flex_none().py(14).gap(9).border_b(1).border_color(t.border)
        .child(h_flex().items_center().gap(6)
          .child(div().size(6).rounded(3).flex_none().bg(t[color]))
          .child(div().text_size(11.5).font_medium().text_color(t[color])
            .tooltip(goal.reason || (claude && goal.status === "saved" ? "Last saved goal state; this does not mean the session is running" : label)).child(label))
          .child(div().flex_1().min_w(0).truncate().text_right().text_size(11.5).text_color(t.muted).tooltip(goal.cwd || "Session details unavailable").child(project)))
        .child(div().text_size(12.5).text_color(t.foreground).whitespace_normal().child(goal.objective))
        .when(percent !== null, (el) => el.child(div().h(3).rounded(2).overflow_hidden().bg(t.raised)
          .tooltip("Token budget used; this does not measure task completion")
          .child(div().h_full().w(`${percent}%`).bg(t[color]))))
        .child(v_flex().gap(3).text_size(11).text_color(t.muted)
          .child(div().child(scheduled ? "Claude · scheduled task" : claude ? "Claude · /goal" : "Codex · /goal"))
          .when(scheduled, (el) => el.child(div().whitespace_normal().child(goal.schedule_kind === "dynamic"
            ? "Self-paced loop" : `${goal.recurring ? "Recurring" : "One-shot"} · ${goal.cron}`)))
          .when(scheduled && goal.recorded_next_run_ms != null, (el) => el.child(div().whitespace_normal()
            .child(`Recorded run: ${new Date(goal.recorded_next_run_ms).toLocaleString()}`)))
          .when(scheduled && goal.expires_at_ms != null, (el) => el.child(div().whitespace_normal()
            .child(`Expiry: ${new Date(goal.expires_at_ms).toLocaleString()}`)))
          .when(scheduled, (el) => el.child(div().whitespace_normal().child(goal.reason || "Last recorded schedule; session may be offline.")))
          .when(goal.tokens_used != null, (el) => el.child(div().child(tokens)))
          .when(goal.time_used_seconds != null, (el) => el.child(div().child(`${duration(goal.time_used_seconds)} ${claude ? "elapsed" : "working time"}`)))
          .when(claude && !scheduled && goal.tokens_used == null && goal.time_used_seconds == null,
            (el) => el.child(div().child("Metrics not recorded yet")))
          .when(claude && goal.iterations != null, (el) => el.child(div().child(`${number(goal.iterations)} evaluated turns`))))
        .child(h_flex().items_center().gap(6)
          .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.muted)
            .child(goal.updated_at_ms ? `Updated ${new Date(goal.updated_at_ms).toLocaleString()}` : "Saved entry"))
          .when(!claude && Boolean(goal.cwd), (el) => el.child(button(`open-${key}`, "Open session", () => this.open(goal))
            .tooltip("Open this exact thread in a new Codex tab")))
          .when(claude, (el) => el.child(button(`copy-${key}`, this.copied === key ? "Copied" : goal.thread_id ? "Copy session ID" : "Copy task ID", (cx) => {
            cx.write_to_clipboard(goal.thread_id || goal.task_id);
            this.copied = key;
            cx.notify();
          }).tooltip(goal.thread_id ? "Copy the Claude session ID" : "Copy the Claude task ID"))));
    };
    const empty = this.showCodex === false && this.showClaude === false
      ? ["No sources selected.", "Enable Codex or Claude above to show loops."]
      : !this.all && space?.machine
      ? ["Loops are local for now.", "Switch to a local space or choose All projects."]
      : [this.completed ? "No loops here yet." : "No current loops.",
         history.length ? "Show history to see previous work." : "Use /goal in Codex or Claude, or /loop in Claude."];

    return v_flex().id("loops").size_full().min_h(0).overflow_hidden().bg(t.background)
      .when(!this.embedded, el => el.rounded(10).border_1().border_color(t.border))
      .when(Boolean(this.embedded), el => el.track_focus(this.handle))
      .text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .when(!this.embedded, el => el.child(div().flex_none().font_semibold().child("Loops")))
        .child(h_flex().gap(4).flex_none().children(["codex", "claude"].map((source) => {
          const name = source === "codex" ? "Codex" : "Claude";
          const selected = this.sourceEnabled(source);
          return button(`loops-source-${source}`, name, (cx) => this.toggleSource(source, cx), selected)
            .selected(selected).accessibility_label(`Show ${name} loops`)
            .tooltip(`${selected ? "Hide" : "Show"} ${name} ${source === "claude" ? "goals and scheduled tasks" : "goals"}`);
        })))
        .child(div().flex_1().min_w(0))
        .child(button("loops-scope", this.all ? "All projects" : "This space", (cx) => {
          this.all = !this.all;
          localStorage.setItem("scope", this.all ? "all" : "space");
          cx.notify();
        }).tooltip(this.all ? "Show loops for this space" : "Show all saved local loops and goals")))
      .child(h_flex().h(38).flex_none().px(14).gap(8).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.muted).child(`${current.length} current`))
        .child(button("loops-completed", `History (${history.length})`, (cx) => {
          this.completed = !this.completed;
          localStorage.setItem("completed", String(this.completed));
          cx.notify();
        }, this.completed))
        .child(button("loops-refresh", svg("mods/loops/loops.svg").size(13), (cx) => {
          cx.spawn(async (cx) => this.reload(cx));
        }).accessibility_label("Refresh loops").tooltip("Refresh loops"))
        .when(!this.embedded, el => el.child(moveToPaneButton("loops", {
          all: this.all, completed: this.completed, showCodex: this.showCodex, showClaude: this.showClaude,
        }, t))))
      .child(v_flex().id("loops-list").flex_1().min_h(0).overflow_y_scrollbar().px(14)
        .when(Boolean(error), (el) => el.child(v_flex().py(12).gap(5).text_size(11.5).text_color(t.blocked)
          .child(div().whitespace_normal().child(error))
          .when(Boolean(this.updated), (row) => row.child(div().whitespace_normal().child("Some entries may be from an earlier refresh.")))))
        .when(Boolean(warning), (el) => el.child(div().py(12).text_size(11.5).text_color(t.muted).whitespace_normal().child(warning)))
        .when(this.loading, (el) => el.child(div().py(16).text_color(t.muted).child("Loading loops…")))
        .when(!this.loading && !error && !visible.length, (el) => el.child(v_flex().py(20).gap(8).text_size(12)
          .child(div().font_medium().child(empty[0]))
          .child(div().text_color(t.muted).whitespace_normal().child(empty[1]))))
        .children(visible.map(goalRow)))
      .child(div().h(28).flex_none().px(14).flex().items_center().text_size(11).text_color(t.muted)
        .child(this.updated ? "Local loops · refreshes every 10s" : "Local loops"));
  }
}
