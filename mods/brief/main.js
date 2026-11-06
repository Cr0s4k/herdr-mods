import { View, div } from "gpui-kit";
import { v_flex, h_flex, Button, TextView } from "gpui-base";
import { spaces, agents, props, shared, setShared, run, theme } from "herdr";
import { ACTIVITY, REPORTS, entriesFor, unreadFor, receipt } from "./model.js";
import { moveToPaneButton } from "./panel-actions.js";

export default class Brief extends View {
  init() { this.history = false; }

  space() {
    // A moved panel stays with its tab, even if another space becomes active.
    const tab = props()?.tab;
    return spaces().find(space => tab ? space.tabs.some(item => item.id === tab) : space.active);
  }

  render() {
    const t = theme(), space = this.space();
    const items = entriesFor(space?.id, shared(ACTIVITY) ?? [], shared(REPORTS) ?? []);
    const unread = unreadFor(items, shared(receipt(space?.id)));
    const visible = this.history ? items : unread;
    const button = (id, label, action) => Button.new(id).h(26).px(8).rounded(6).flex_none()
      .text_size(11.5).bg(t.raised).text_color(t.foreground).hover(s => s.bg(t.hover))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => action(cx)).child(label);
    const section = (id, label, lines, color = t.foreground) => !lines?.length ? null
      : v_flex().gap(5).child(div().font_medium().text_size(11.5).text_color(color).child(label))
        .children(lines.map((line, i) => TextView.markdown(`${id}-${i}`, line)));
    return v_flex().id("brief").size_full().min_h(0).overflow_hidden().bg(t.background)
      .when(!this.embedded, el => el.rounded(10).border_1().border_color(t.border))
      .when(Boolean(this.embedded), el => el.track_focus(this.handle))
      .text_size(12.5).text_color(t.foreground)
      .child(h_flex().px(14).h(42).flex_none().gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().flex_1().font_semibold().child("Since you left"))
        .when(!this.embedded, el => el.child(moveToPaneButton("brief", {}, t))))
      .child(v_flex().px(14).py(12).gap(9).flex_none()
        .child(div().text_size(12).text_color(t.muted).truncate().child(space?.name || "Choose a space"))
        .child(h_flex().items_center().gap(6)
          .child(div().flex_1().text_size(11.5).text_color(t.muted).child(`${unread.length} unread ${unread.length === 1 ? "update" : "updates"}`))
          .child(button("brief-history", this.history ? "Unread" : "History", cx => { this.history = !this.history; cx.notify(); }))
          .when(unread.length > 0, el => el.child(button("brief-reviewed", "Mark reviewed", () => {
            const read = shared(receipt(space.id)) ?? [];
            setShared(receipt(space.id), [...new Set([...read, ...items.map(item => item.id)])].slice(-2000));
          }).tooltip("Mark these updates read. Later arrivals stay unread.")))))
      .child(v_flex().id("brief-list").flex_1().min_h(0).overflow_y_scrollbar().px(14)
        .when(Boolean(shared("brief.error")), el => el.child(div().py(10).text_color(t.blocked).whitespace_normal().child(shared("brief.error"))))
        .when(!visible.length, el => el.child(v_flex().py(22).gap(9)
          .child(div().font_medium().child(this.history ? "No updates recorded yet." : "You’re caught up."))
          .child(div().text_color(t.muted).whitespace_normal().child("Agent activity appears here as it happens. Handoffs add what changed, test results, and open questions."))
          .child(div().text_size(11.5).text_color(t.muted).whitespace_normal().child("Ask an agent to leave a Herdr brief when it finishes."))))
        .children(visible.map(item => {
          const live = agents().find(agent => agent.address === item.terminal && agent.space === space?.id);
          const report = item.source === "agent";
          const color = item.kind === "blocked" ? t.blocked : t.foreground;
          return v_flex().id(`brief-${item.id}`).py(16).gap(10).flex_none().border_b(1).border_color(t.border)
            .child(h_flex().gap(8).items_center()
              .child(div().flex_1().min_w(0).font_medium().text_color(color).whitespace_normal().child(item.title))
              .child(div().flex_none().text_size(10.5).text_color(t.muted)
                .tooltip(new Date(item.time).toLocaleString()).child(new Date(item.time).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }))))
            .child(TextView.markdown(`summary-${item.id}`, item.summary))
            .when(report, el => el.children([
              section(`changes-${item.id}`, "What changed", item.changes),
              section(`tests-${item.id}`, "Validation · agent reported", item.tests),
              section(`questions-${item.id}`, "Open questions", item.questions, t.blocked),
            ].filter(Boolean)))
            .child(h_flex().gap(6).items_center()
              .child(div().flex_1().min_w(0).truncate().text_size(10.5).text_color(t.muted)
                .child(report ? "Agent handoff" : "Observed activity · outcome unverified"))
              .when(Boolean(live), el => el.child(button(`brief-open-${item.id}`, "Open agent", () => run("agent.focus", { terminal: live.address })))));
        })))
      .child(div().px(14).py(9).flex_none().text_size(10.5).text_color(t.muted).whitespace_normal()
        .child("Updates stay here until reviewed. Activity is captured while Herdr is open."));
  }
}
