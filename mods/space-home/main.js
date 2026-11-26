import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, agents, terminals, props, run, theme, shared, exec, readTextFile, appHome, knownAgents, home, nextCommand } from "herdr";
import { track } from "./usage.js";
import { ink, spin, watchMotion } from "./ui.js";
import { spacePipeline, openPipeline, pipelineSummary } from "./pipeline-row.js";
import { spaceTerminals } from "./terminal-row.js";
import { closedSessions, resumeArgs, ago } from "./recent.js";
import { homeTab, sections, summary } from "./model.js";

const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
const SESSIONS = 8, STALE = 60000;
const short = path => !path ? "" : path === home() ? "~" : path.startsWith(home() + "/") ? "~" + path.slice(home().length) : path;
const pic = (program, t, color = t.foreground) => !program?.icon ? null : program.tint
  ? svg(program.icon).size(15).flex_none().text_color(color) : image(program.icon).w(15).h(15).flex_none();

export default class SpaceHome extends View {
  init(_props, cx) {
    watchMotion(cx);
    this.handle = cx.focus_handle();
    this.cursor = 0;
    this.recent = null;
    cx.spawn(async () => {
      for (;;) if (await nextCommand() === "focus") this.handle.focus();
    });
  }

  space() {
    const all = spaces();
    return all.find(s => s.id === props()?.space) ?? all.find(s => s.active) ?? null;
  }

  folder(space, ps) {
    const tabs = new Set(space.tabs.map(tab => tab.id));
    return (shared("space.homes") ?? {})[space.id] || ps.find(p => tabs.has(p.tab) && p.cwd)?.cwd || space.folder || "";
  }

  readRecent(space, cwd, cx) {
    const had = this.recent;
    if (!cwd || had?.loading || (had?.cwd === cwd && Date.now() - had.at < STALE)) return;
    this.recent = { rows: [], ...had, cwd, loading: true };
    cx.spawn(async cx => {
      let rows = had?.cwd === cwd ? had.rows : [];
      try {
        this.script ??= await readTextFile(`${appHome()}/mods/spaces-pin/recent.py`);
        rows = JSON.parse((await exec("python3", ["-c", this.script, JSON.stringify({ cwd })], { on: space.machine, timeout: 15000 })).stdout).data ?? rows;
      } catch {}
      try { this.known ??= Object.fromEntries((await knownAgents({ on: space.machine })).map(agent => [agent.key, agent])); } catch {}
      this.recent = { cwd, rows, at: Date.now(), loading: false };
      cx.notify();
    });
  }

  resume(space, session, cwd, cx) {
    cx.spawn(async cx => {
      const agent = (await knownAgents({ on: space.machine })).find(a => a.key === session.agent && a.installed);
      if (!agent) return;
      track("home", "resume");
      run("tab.new", { space: space.id, folder: session.cwd ?? cwd, argv: resumeArgs(agent, session), name: session.title.slice(0, 28) });
      if (this.recent) this.recent = { ...this.recent, rows: this.recent.rows.filter(row => row.id !== session.id) };
      cx.notify();
    });
  }

  open(space, row, cwd, cx) {
    track("home", row.kind);
    if (row.kind === "agent") run("pane.focus", { pane: row.agent.pane });
    else if (row.kind === "task") run(`tabs-show.pipeline-task-${row.task.id}`);
    else if (row.kind === "pipeline") openPipeline(space, row.pipeline);
    else if (row.kind === "terminal") run("pane.focus", { pane: row.term.p.pane });
    else if (row.kind === "pane") run("pane.focus", { pane: row.pane.pane });
    else if (row.kind === "session") this.resume(space, row.session, cwd, cx);
  }

  key(e, cx, space, rows, cwd) {
    const last = rows.length - 1;
    if (e.key === "down" || e.key === "j") this.cursor = Math.min(last, this.cursor + 1);
    else if (e.key === "up" || e.key === "k") this.cursor = Math.max(0, this.cursor - 1);
    else if (e.key === "home") this.cursor = 0;
    else if (e.key === "end") this.cursor = last;
    else if ((e.key === "enter" || e.key === "space") && rows[this.cursor]) this.open(space, rows[this.cursor], cwd, cx);
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  indicator(t, status) {
    const color = t[status] ?? t.dim;
    if (status === "working") return spin(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(color));
    if (status === "blocked") return this.tag(t, "Needs you", color);
    return div().size(7).mx(3).flex_none().rounded(4)
      .when(status === "idle", el => el.border(1.5).border_color(color))
      .when(status !== "idle", el => el.bg(color));
  }

  tag(t, label, color) {
    return div().flex_none().px(6).h(18).rounded(4).bg(color + "26").text_color(color).text_size(11).font_semibold().flex().items_center().child(label);
  }

  parts(t, row) {
    if (row.kind === "agent") return { icon: pic(row.agent.program, t), name: row.name, detail: row.detail ?? [short(row.cwd), row.branch].filter(Boolean).join(" · "),
      note: row.stage, tail: this.indicator(t, row.status), hint: "Go to this agent" };
    if (row.kind === "task") return { icon: svg("mods/pipeline/pipeline.svg").size(15).flex_none().text_color(t.muted), name: row.name, detail: row.task.id,
      tail: row.waiting ? this.tag(t, row.stage, row.failed ? t.blocked : t.done) : null, note: row.waiting ? null : row.stage, hint: "Open this task in Pipeline" };
    if (row.kind === "pipeline") return { icon: svg("mods/pipeline/pipeline.svg").size(15).flex_none().text_color(t.foreground), name: "Open Pipeline",
      detail: pipelineSummary(row.pipeline.state), hint: "Open this space's Pipeline" };
    if (row.kind === "terminal") return { icon: svg("mods/workspace-chrome/terminal.svg").size(15).flex_none().text_color(t.muted), name: row.term.label,
      detail: short(row.term.p.cwd), note: row.term.running, hint: "Go to this terminal" };
    if (row.kind === "pane") return { icon: svg("mods/workspace-chrome/layers.svg").size(15).flex_none().text_color(t.muted), name: row.name, hint: "Go to this tab" };
    return { icon: pic(this.known?.[row.session.agent], t, t.muted) ?? svg("mods/pipeline/clock.svg").size(15).flex_none().text_color(t.muted), name: row.session.title,
      detail: row.session.branch ? `in the worktree of ${row.session.branch}` : "", note: `${ago(row.session.at)} ago`, hint: "Resume in a new tab" };
  }

  row(t, space, row, n, cwd) {
    const { icon, name, detail, note, tail, hint } = this.parts(t, row), on = n === this.cursor && this.handle.is_focused();
    return h_flex().id(`home-${row.key}`).h(34).px(10).gap(9).min_w(0).flex_none().rounded(6).items_center()
      .cursor_pointer().role("button").accessibility_label(`${name}. ${hint}`).tooltip([name, detail, hint].filter(Boolean).join(" · "))
      .hover(el => el.bg(t.hover))
      .on_click((_e, cx) => { this.cursor = n; this.open(space, row, cwd, cx); })
      .when(Boolean(icon), el => el.child(icon))
      .child(div().flex_none().max_w(360).truncate().text_color(t.foreground).child(name))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(detail || ""))
      .when(Boolean(note), el => el.child(div().flex_none().max_w(140).truncate().text_size(11).text_color(t.muted).child(note)))
      .when(Boolean(tail), el => el.child(tail))
      .when(on, el => el.relative().child(div().absolute().inset_0().rounded(6).border_1().border_color(t.accent)));
  }

  render(cx) {
    const t = theme(), space = this.space();
    if (!space) return div().size_full().bg(t.background);
    const ps = panes(), all = agents(), cwd = this.folder(space, ps), features = shared("features") ?? {};
    const mine = all.filter(a => a.space === space.id);
    const tab = homeTab(space, ps), shown = Boolean(space.active && tab?.active);
    if (shown && features.recent !== false) this.readRecent(space, cwd, cx);
    const held = shown && Boolean(ps.find(p => p.pane === tab.pane)?.focused);
    // A task starts inside this render, where focus can't move: wait a moment first.
    if (held && !this.held) cx.spawn(async cx => { await cx.sleep(1); this.handle.focus(); cx.notify(); });
    this.held = held;
    const here = mine.map(a => ({ address: a.address, program: a.program, cwd: ps.find(p => p.pane === a.pane)?.cwd ?? cwd }));
    const parts = sections({
      space, panes: ps, agents: all,
      terminals: features.terminals === false ? [] : spaceTerminals(space, ps, mine),
      pipeline: spacePipeline(space, [space.folder, cwd], ps),
      briefs: shared("brief.reports") ?? [],
      sessions: features.recent === false || this.recent?.cwd !== cwd ? [] : closedSessions(this.recent.rows, here, terminals()).slice(0, SESSIONS),
    });
    const rows = parts.flatMap(section => section.rows);
    this.cursor = Math.max(0, Math.min(rows.length - 1, this.cursor));
    const color = (shared("space.colors") ?? {})[space.id] ?? "ansi6", fill = color.startsWith("#") ? color : MARK[color] ?? t[color];
    const branch = space.branch ?? ps.find(p => p.cwd === cwd && p.branch)?.branch;
    const where = [short(cwd), branch, space.machine].filter(Boolean).join(" · "), counts = summary(parts);
    let n = 0;
    return v_flex().id("space-home").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx, space, rows, cwd))
      .size_full().min_h(0).bg(t.background).text_size(13).text_color(t.foreground)
      .child(v_flex().id(`space-home-scroll-${space.id}`).flex_1().min_h(0).overflow_y_scrollbar().items_center().px(24).py(24)
        .child(v_flex().w_full().max_w(760).gap(16)
          .child(h_flex().id("space-home-title").gap(12).px(10).items_center().min_w(0)
            .child(h_flex().size(30).flex_none().rounded(7).bg(fill).items_center().justify_center().text_size(15).font_bold().text_color(ink(fill)).child([...space.name][0]?.toUpperCase() ?? "?"))
            .child(v_flex().flex_1().min_w(0).gap(2)
              .child(div().truncate().text_size(17).font_semibold().child(space.name))
              .when(Boolean(where), el => el.child(div().truncate().text_size(12).text_color(t.muted).child(where))))
            .when(Boolean(counts), el => el.child(div().flex_none().text_size(12).text_color(t.muted).child(counts))))
          .children(parts.map(section => v_flex().id(`space-home-${section.id}`).gap(2)
            .child(h_flex().h(24).px(10).gap(6).items_center().text_size(11).font_semibold().text_color(section.id === "needs" ? t.blocked : t.muted)
              .child(section.title).child(div().font_normal().text_color(t.dim ?? t.muted).child(String(section.id === "pipeline" ? section.rows.length - 1 || "" : section.rows.length))))
            .children(section.rows.map(row => this.row(t, space, row, n++, cwd)))))
          .when(!rows.length, el => el.child(div().id("space-home-empty").px(10).pt(8).line_height(1.5).text_color(t.muted)
            .child(this.recent?.loading ? "Reading this space…" : "Nothing is open in this space. The + in the tab bar starts a terminal or an agent, and Pipeline queues tasks.")))
          .when(rows.length > 0, el => el.child(div().px(10).pt(4).text_size(11).text_color(t.dim ?? t.muted).child("↑ ↓ to move · Enter to go")))));
  }
}
