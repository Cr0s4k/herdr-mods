import { View, div } from "gpui-kit";
import { v_flex, h_flex, Button, TextView } from "gpui-base";
import { spaces, agents, props, shared, setShared, run, theme } from "herdr";
import { ACTIVITY, REPORTS, entriesFor, unreadFor, receipt } from "./model.js";
import { moveToPaneButton, bindMoveCommand } from "./panel-actions.js";

export default class Brief extends View {
  init(_props, cx) { this.history = false; this.expanded = new Set(); bindMoveCommand(this, "brief", cx); }

  space() {
    // A moved panel stays with its tab, even if another space becomes active.
    const tab = props()?.tab;
    return spaces().find(space => tab ? space.tabs.some(item => item.id === tab) : space.active);
  }

  render() {
    const t = theme(), space = this.space();
    const items = entriesFor(space?.id, shared(ACTIVITY) ?? [], shared(REPORTS) ?? []);
    const unread = unreadFor(items, shared(receipt(space?.id)));
    const visible = this.history ? entriesFor(space?.id, shared(ACTIVITY) ?? [], shared(REPORTS) ?? [], true) : unread;
    const button = (id, label, action) => Button.new(id).h(26).px(8).rounded(6).flex_none()
      .text_size(11.5).bg(t.raised).text_color(t.foreground).hover(s => s.bg(t.hover))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => action(cx)).child(label);
    const section = (id, label, lines, color = t.foreground) => !lines?.length ? null
      : v_flex().min_w(0).gap(6).child(div().font_medium().text_size(12).text_color(color).child(label))
        .children(lines.map((line, i) => TextView.markdown(`${id}-${i}`, line).text_size(13).line_height(1.5).selectable(true)));
    return v_flex().id("brief").size_full().min_h(0).overflow_hidden().bg(t.background)
      .when(!this.embedded, el => el.rounded(10).border_1().border_color(t.border))
      .when(Boolean(this.embedded), el => el.track_focus(this.handle))
      .text_size(13).line_height(1.5).text_color(t.foreground)
      .child(h_flex().px(14).h(42).flex_none().gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().flex_1().font_semibold().child("Since you left"))
        .when(!this.embedded, el => el.child(moveToPaneButton("brief", {}, t))))
      .child(v_flex().px(14).py(12).gap(9).flex_none()
        .child(div().text_size(12).text_color(t.muted).truncate().child(space?.name || "Choose a space"))
        .child(h_flex().items_center().gap(6)
          .child(div().flex_1().text_size(12).text_color(t.muted).child(this.history ? "All updates" : `${unread.length} new ${unread.length === 1 ? "update" : "updates"}`))
          .child(button("brief-history", this.history ? "Back to new" : "History", cx => { this.history = !this.history; cx.notify(); }))
          .when(unread.length > 0, el => el.child(button("brief-reviewed", "Mark as read", () => {
            const read = shared(receipt(space.id)) ?? [];
            setShared(receipt(space.id), [...new Set([...read, ...items.map(item => item.id)])].slice(-2000));
          }).tooltip("Mark these updates read. Later arrivals stay unread.")))))
      .child(v_flex().id("brief-list").flex_1().min_h(0).overflow_y_scrollbar().px(14)
        .when(Boolean(shared("brief.error")), el => el.child(div().py(10).text_color(t.blocked).whitespace_normal().child(shared("brief.error"))))
        .when(!visible.length, el => el.child(v_flex().py(22).gap(9)
          .child(div().font_medium().child(this.history ? "No updates yet." : "You’re caught up."))
          .child(div().text_color(t.muted).whitespace_normal().child(this.history
            ? "When your agent leaves a brief, you’ll see what changed and anything that needs your answer."
            : "New results and questions will appear here."))))
        .children(visible.map(item => {
          const live = agents().find(agent => agent.address === item.terminal && agent.space === space?.id);
          const report = item.source === "agent";
          const needsReply = item.kind === "blocked" || Boolean(item.questions?.length);
          const expanded = this.expanded.has(item.id);
          const more = report && Boolean(item.changes?.length);
          const date = new Date(item.time), today = new Date();
          const clock = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
          const stamp = date.toDateString() === today.toDateString() ? clock : `${date.getDate()}/${date.getMonth() + 1} · ${clock}`;
          return v_flex().id(`brief-${item.id}`).min_w(0).py(14).gap(8).flex_none().border_b(1).border_color(t.border)
            .child(div().font_semibold().text_size(14).whitespace_normal().child(item.title))
            .child(TextView.markdown(`summary-${item.id}`, item.summary).text_size(13.5).line_height(1.5).selectable(true))
            .when(report && Boolean(item.caveats?.length), el => el.child(section(`caveats-${item.id}`, "Keep in mind", item.caveats, t.blocked)))
            .when(report && Boolean(item.questions?.length), el => el.child(section(`questions-${item.id}`, "Needs your answer", item.questions, t.blocked)))
            .when(expanded && more, el => el.child(section(`changes-${item.id}`, "What changed", item.changes)))
            .child(h_flex().gap(6).items_center()
              .child(div().flex_1().min_w(0).text_size(11.5).text_color(t.muted)
                .tooltip(`${date.toLocaleString()}${item.auto ? " · Taken from the agent's last reply; it left no brief" : report ? " · Written by your agent" : " · Activity only; no result reported"}`).child(item.auto ? `${stamp} · from its last reply` : stamp))
              .when(more, el => el.child(button(`brief-more-${item.id}`, expanded ? "Read less" : "Read more", cx => {
                if (expanded) this.expanded.delete(item.id); else this.expanded.add(item.id);
                cx.notify();
              })))
              .when(Boolean(live), el => el.child(button(`brief-open-${item.id}`, needsReply ? "Reply to agent" : "Open conversation", () => run("agent.focus", { terminal: live.address })))));
        })));
  }
}
