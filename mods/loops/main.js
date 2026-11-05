import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Button } from "gpui-base";
import { appHome, spaces, panes, exec, run, theme } from "herdr";

const STATUS = {
  active: ["Active", "working"],
  paused: ["Paused", "muted"],
  blocked: ["Blocked", "blocked"],
  usage_limited: ["Usage limit", "blocked"],
  budget_limited: ["Budget limit", "blocked"],
  complete: ["Completed", "ansi2"],
};
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
    this.all = localStorage.getItem("scope") === "all";
    this.completed = localStorage.getItem("completed") === "true";
    cx.spawn(async (cx) => this.reload(cx));
    cx.timer.every(10000, (cx) => { cx.spawn(async (cx) => this.reload(cx)); });
  }

  async reload(cx) {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      const r = await exec("python3", [`${appHome()}/mods/loops/codex-goals.py`]);
      let data;
      try { data = JSON.parse(r.stdout); } catch { throw new Error("Could not read Codex goals. Check that Python 3 is installed, then refresh."); }
      if (r.code !== 0 || data.error) throw new Error(data.error || "Could not read Codex goals. Try refreshing.");
      this.items = data.goals;
      this.warning = data.warning;
      this.error = null;
      this.updated = Date.now();
    } catch (e) {
      this.error = e.message || String(e);
    } finally {
      this.loading = false;
      this.refreshing = false;
      cx.notify();
    }
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
    // Resume the exact thread. Matching agents by folder alone can select the wrong session.
    const space = spaces().find((s) => s.active && !s.machine);
    const args = { name: "Codex goal", folder: goal.cwd, argv: ["codex", "resume", goal.thread_id] };
    if (space) run("tab.new", { ...args, space: space.id });
    else run("space.new", { ...args, name: goal.cwd.split("/").pop() || "Codex goal", tab: "Codex goal" });
  }

  render() {
    const t = theme();
    const { space, items } = this.scope();
    const current = items.filter((g) => g.status !== "complete");
    const history = items.filter((g) => g.status === "complete");
    const visible = this.completed ? items : current;
    const button = (id, label, action, selected = false) => Button.new(id).h(26).px(8).flex_none()
      .flex().items_center().justify_center().rounded(6).text_size(11.5)
      .bg(selected ? t.selected : t.raised).text_color(selected ? t.foreground : t.muted)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => action(cx)).child(label);
    const goalRow = (goal) => {
      const [label, color] = STATUS[goal.status] ?? [goal.status, "muted"];
      const project = goal.cwd?.split("/").pop() || "Unknown project";
      const tokens = goal.token_budget == null
        ? `${number(goal.tokens_used)} tokens used`
        : `${number(goal.tokens_used)} / ${number(goal.token_budget)} tokens`;
      const percent = goal.token_budget > 0 ? Math.min(100, Math.max(0, goal.tokens_used / goal.token_budget * 100)) : null;
      return v_flex().id(`goal-${goal.thread_id}`).flex_none().py(14).gap(9).border_b(1).border_color(t.border)
        .child(h_flex().items_center().gap(6)
          .child(div().size(6).rounded(3).flex_none().bg(t[color]))
          .child(div().text_size(11.5).font_medium().text_color(t[color]).child(label))
          .child(div().flex_1().min_w(0).truncate().text_right().text_size(11.5).text_color(t.muted).tooltip(goal.cwd || "Session details unavailable").child(project)))
        .child(div().text_size(12.5).text_color(t.foreground).whitespace_normal().child(goal.objective))
        .when(percent !== null, (el) => el.child(div().h(3).rounded(2).overflow_hidden().bg(t.raised)
          .tooltip("Token budget used; this does not measure task completion")
          .child(div().h_full().w(`${percent}%`).bg(t[color]))))
        .child(v_flex().gap(3).text_size(11).text_color(t.muted)
          .child(div().child(tokens))
          .child(div().child(`${duration(goal.time_used_seconds)} working time`)))
        .child(h_flex().items_center().gap(6)
          .child(div().flex_1().min_w(0).truncate().text_size(10.5).text_color(t.muted)
            .child(goal.updated_at_ms ? `Updated ${new Date(goal.updated_at_ms).toLocaleString()}` : "Codex goal"))
          .when(Boolean(goal.cwd), (el) => el.child(button(`open-${goal.thread_id}`, "Open session", () => this.open(goal))
            .tooltip("Open this exact thread in a new Codex tab"))));
    };
    const empty = !this.all && space?.machine
      ? ["Codex loops are local for now.", "Switch to a local space or choose All projects."]
      : [this.completed ? "No Codex goals here yet." : "No current Codex goals.",
         history.length ? "Show completed goals to see previous work." : "Start one in Codex with /goal <outcome>."];

    return v_flex().id("loops").size_full().min_h(0).rounded(10).overflow_hidden()
      .bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Loops"))
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.muted).child("Codex goals"))
        .child(button("loops-scope", this.all ? "All projects" : "This space", (cx) => {
          this.all = !this.all;
          localStorage.setItem("scope", this.all ? "all" : "space");
          cx.notify();
        }).tooltip(this.all ? "Show goals for this space" : "Show all saved local Codex goals")))
      .child(h_flex().h(38).flex_none().px(14).gap(8).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.muted).child(`${current.length} current`))
        .child(button("loops-completed", `Completed (${history.length})`, (cx) => {
          this.completed = !this.completed;
          localStorage.setItem("completed", String(this.completed));
          cx.notify();
        }, this.completed))
        .child(button("loops-refresh", svg("mods/loops/loops.svg").size(13), (cx) => {
          cx.spawn(async (cx) => this.reload(cx));
        }).accessibility_label("Refresh Codex goals").tooltip("Refresh Codex goals")))
      .child(v_flex().id("loops-list").flex_1().min_h(0).overflow_y_scrollbar().px(14)
        .when(Boolean(this.error), (el) => el.child(v_flex().py(12).gap(5).text_size(11.5).text_color(t.blocked)
          .child(div().whitespace_normal().child(this.error))
          .when(Boolean(this.updated), (row) => row.child(div().child("Showing the last successful refresh.")))))
        .when(Boolean(this.warning), (el) => el.child(div().py(12).text_size(11.5).text_color(t.muted).whitespace_normal().child(this.warning)))
        .when(this.loading, (el) => el.child(div().py(16).text_color(t.muted).child("Loading Codex goals…")))
        .when(!this.loading && !this.error && !visible.length, (el) => el.child(v_flex().py(20).gap(8).text_size(12)
          .child(div().font_medium().child(empty[0]))
          .child(div().text_color(t.muted).whitespace_normal().child(empty[1]))))
        .children(visible.map(goalRow)))
      .child(div().h(28).flex_none().px(14).flex().items_center().text_size(10.5).text_color(t.muted)
        .child(this.updated ? "Local Codex · refreshes every 10s" : "Local Codex"));
  }
}
