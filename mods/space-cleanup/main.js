import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { spaces, panes, agents, terminals, focused, shared, theme, props, run, closeOverlay, checking, home } from "herdr";
import { track } from "./usage.js";
import { ink } from "./ui.js";
import { STORE } from "./pipeline-model.js";
import { USED, suggest } from "./model.js";

const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
const short = path => !path ? "" : path === home() ? "~" : path.startsWith(home() + "/") ? "~" + path.slice(home().length) : path;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export default class SpaceCleanup extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.timer.after(300, () => this.handle.focus());
    this.scroll = ScrollHandle.new();
    this.ticked = new Set(); this.seen = new Set(); this.at = 0;
    if (!checking()) track("space-cleanup", "open");
  }

  groups() {
    const groups = suggest({ spaces: spaces(), panes: panes(), agents: agents(), terminals: terminals(), pipelines: shared(STORE) ?? {},
      used: shared(USED) ?? {}, focused: focused()?.pane ?? null, only: props()?.space ?? null });
    const rows = groups.flatMap(group => group.rows), live = new Set(rows.map(row => row.key));
    for (const row of rows) if (!this.seen.has(row.key)) { this.seen.add(row.key); if (row.tick) this.ticked.add(row.key); }
    for (const k of this.ticked) if (!live.has(k)) this.ticked.delete(k);
    return { groups, rows };
  }

  toggle(row, cx) {
    if (row.hold) return;
    this.ticked.has(row.key) ? this.ticked.delete(row.key) : this.ticked.add(row.key);
    this.confirming = false;
    cx.notify();
  }

  close(rows, cx) {
    const going = rows.filter(row => this.ticked.has(row.key) && !row.hold);
    if (!going.length) return;
    if (!this.confirming) { this.confirming = true; return cx.notify(); }
    track("space-cleanup", "close");
    for (const row of going) { run("pane.close", { pane: row.pane }); this.ticked.delete(row.key); }
    this.confirming = false;
    this.note = `Closed ${plural(going.length, "item")}`;
    cx.notify();
  }

  go(row) {
    track("space-cleanup", "go");
    run("pane.focus", { pane: row.pane });
    closeOverlay(props().overlay);
  }

  move(by, n, cx) {
    if (!n) return;
    this.at = Math.max(0, Math.min(n - 1, this.at + by));
    this.scroll.scroll_to_item(this.at + (this.headers?.[this.at] ?? 0));
    cx.notify();
  }

  icon(row, t) {
    const p = row.program;
    if (row.kind === "panel") return svg("mods/workspace-chrome/layers.svg").size(15).flex_none().text_color(t.muted);
    if (!p?.icon) return svg("mods/workspace-chrome/terminal.svg").size(15).flex_none().text_color(t.muted);
    return p.tint ? svg(p.icon).size(15).flex_none().text_color(t.muted) : image(p.icon).w(15).h(15).flex_none();
  }

  header(space, count, t) {
    const color = (shared("space.colors") ?? {})[space.id] ?? "ansi6", fill = color.startsWith("#") ? color : MARK[color] ?? t[color];
    return h_flex().id(`sc-space-${space.id}`).flex_none().h(30).px(10).pt(6).gap(8).items_center().min_w(0)
      .child(h_flex().size(18).flex_none().rounded(5).bg(fill).items_center().justify_center().text_size(11).font_bold().text_color(ink(fill)).child([...space.name][0]?.toUpperCase() ?? "?"))
      .child(div().flex_1().min_w(0).truncate().text_size(12).font_semibold().child(space.name))
      .child(div().flex_none().text_size(11).text_color(t.dim ?? t.muted).child(String(count)));
  }

  row(row, i, t) {
    const on = this.ticked.has(row.key), can = !row.hold;
    const detail = [short(row.cwd), row.branch].filter(Boolean).join(" · ");
    return h_flex().id(`sc-${row.key}`).flex_none().h(38).px(10).gap(10).items_center().min_w(0).rounded(6)
      .when(i === this.at, el => el.bg(t.selected)).when(i !== this.at && can, el => el.hover(st => st.bg(t.hover)))
      .when(can, el => el.cursor_pointer()).role("check_box").accessibility_label(`${row.name}, ${on ? "ticked" : "not ticked"}, ${row.hold ?? row.why}`)
      .tooltip([row.name, detail, row.hold ?? row.why].filter(Boolean).join(" · "))
      .on_click((_e, cx) => { this.at = i; this.toggle(row, cx); cx.notify(); })
      .child(div().size(16).flex_none().flex().items_center().justify_center().rounded(4).border_1().border_color(on ? t.accent : t.border)
        .when(on, el => el.bg(t.accent).text_color(t.accent_foreground ?? t.background)).when(!can, el => el.opacity(0.35)).text_size(11).child(on ? "✓" : ""))
      .child(this.icon(row, t))
      .child(div().flex_none().max_w(240).truncate().when(!can, el => el.text_color(t.muted)).child(row.name))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.muted).child(detail))
      .child(div().flex_none().max_w(260).truncate().text_size(11).text_color(row.hold ? t.muted : row.tick ? t.foreground : t.blocked).child(row.hold ?? row.why))
      .child(div().id(`sc-go-${row.key}`).size(22).flex_none().flex().items_center().justify_center().rounded(4).text_color(t.muted).cursor_pointer()
        .hover(st => st.bg(t.hover).text_color(t.foreground)).role("button").accessibility_label(`Go to ${row.name}`).tooltip("Go there")
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { cx.stop_propagation(); this.go(row); })
        .child(svg("mods/workspace-chrome/chevron-right.svg").size(12)));
  }

  button(id, label, on, primary, enabled, t) {
    return div().id(id).h(30).px(12).flex().items_center().rounded(7).text_size(12).border_1().border_color(primary && enabled ? t.solid : t.border)
      .bg(primary && enabled ? t.solid : t.background).text_color(!enabled ? t.dim : primary ? t.solid_foreground : t.foreground)
      .when(enabled, el => el.cursor_pointer().on_click((_e, cx) => on(cx))).child(label);
  }

  render() {
    const t = theme(), { groups, rows } = this.groups(), n = rows.filter(row => this.ticked.has(row.key) && !row.hold).length;
    this.at = Math.max(0, Math.min(rows.length - 1, this.at));
    const scoped = props()?.space ? spaces().find(s => s.id === props().space) : null;
    const hint = this.confirming ? "Their terminals end. An agent's conversation stays under Recent, to resume."
      : this.note ?? "Spaces stay open; only what's inside them closes.";
    let i = 0;
    this.headers = groups.flatMap((group, n) => group.rows.map(() => n + 1));
    return v_flex().id("space-cleanup").track_focus(this.handle).size_full().min_h(0).bg(t.background).text_size(13).text_color(t.foreground)
      .on_key_down((e, cx) => {
        const k = e.key;
        if (k === "escape") { if (this.confirming) { this.confirming = false; cx.notify(); } else closeOverlay(props().overlay); }
        else if (k === "down" || k === "j") this.move(1, rows.length, cx);
        else if (k === "up" || k === "k") this.move(-1, rows.length, cx);
        else if (k === "space" && rows[this.at]) this.toggle(rows[this.at], cx);
        else if (k === "g" && rows[this.at]) this.go(rows[this.at]);
        else if (k === "enter") this.close(rows, cx);
        else return;
        cx.stop_propagation();
      })
      .child(h_flex().h(48).flex_none().px(16).gap(8).items_center().border_b(1).border_color(t.border)
        .child(svg("mods/space-cleanup/sparkles.svg").size(15).flex_none().text_color(t.accent))
        .child(div().font_semibold().child(scoped ? `Clean up ${scoped.name}` : "Clean up spaces"))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted)
          .child(rows.length ? `${plural(rows.length, "suggestion")}, longest unused first` : ""))
        .child(this.button("sc-close", "✕", () => closeOverlay(props().overlay), false, true, t)))
      .child(v_flex().id("sc-list").flex_1().min_h(0).p(6).gap(1).overflow_y_scrollbar().track_scroll(this.scroll)
        .children(groups.flatMap(group => [this.header(group.space, group.rows.length, t), ...group.rows.map(row => this.row(row, i++, t))]))
        .when(!rows.length, el => el.child(div().id("sc-empty").p(10).line_height(1.5).text_size(12).text_color(t.muted)
          .child("Nothing to clean up. Every agent and terminal was used in the last hour, is working or needs you, and every panel was opened today."))))
      .child(h_flex().h(52).flex_none().px(16).gap(10).items_center().border_t(1).border_color(t.border)
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(this.confirming ? t.foreground : t.muted).child(hint))
        .when(this.confirming, el => el.child(this.button("sc-cancel", "Cancel", cx => { this.confirming = false; cx.notify(); }, false, true, t)))
        .child(this.button("sc-confirm", this.confirming ? `Close ${n}` : `Close ${plural(n, "item")}`, cx => this.close(rows, cx), true, n > 0, t)))
      .child(h_flex().h(28).flex_none().px(16).gap(16).items_center().border_t(1).border_color(t.border).text_size(11).text_color(t.muted)
        .child("↑ ↓ move").child("Space tick").child("G go there").child("↵ close the ticked").child("Esc close"));
  }
}
