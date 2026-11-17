import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, Switch } from "gpui-base";
import { props, theme, closeOverlay, shared, setShared, layout, run } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export const FEATURES = [
  ["commitBox", "Commit message box", "Message field and Commit button in Changes"],
  ["syncBar", "Push and pull", "Branch, commits ahead and behind, Push and Pull in Changes"],
  ["loops", "Loops", "Loops button and side panel"],
  ["skills", "Skills", "Skills button and side panel"],
  ["watchers", "Watchers", "Watchers button and side panel; watchers keep checking"],
  ["needsYou", "Needs you", "Filter button at the top of the Spaces sidebar"],
  ["terminals", "Terminals in the sidebar", "Terminals listed under their space, after its agents"],
  ["companion", "Companion", "Companion at the bottom of the sidebar", {
    get: () => { const block = find(layout(), "companion"); return Boolean(block) && !block.hidden; },
    set: on => run(on ? "layout.show" : "layout.hide", { id: "companion" }),
  }],
];

const PAD = 8, HEADER = 30, ROW = 48;

export function popupSize() {
  return { width: 420, height: PAD * 2 + HEADER + ROW * FEATURES.length + 2 };
}

export default class Toggles extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  set(key, on) {
    setShared("features", { ...(shared("features") ?? {}), [key]: on });
    const body = find(layout(), "panel-body");
    if ((key === "loops" || key === "skills" || key === "watchers") && !on && body?.active === key) run("layout.hide", { id: "panel" });
  }

  render() {
    const t = theme(), features = shared("features") ?? {};
    return v_flex().id("toggles").track_focus(this.handle).size_full().min_h(0).p(PAD).overflow_y_scroll()
      .bg(t.popover).text_size(12.8).text_color(t.foreground)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); } })
      .child(h_flex().h(HEADER).flex_none().px(8).gap(8).items_center()
        .child(svg("mods/toggles/toggles.svg").size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().font_medium().child("Features")))
      .children(FEATURES.map(([key, label, hint, own]) => {
        const on = own ? own.get() : features[key] !== false;
        return Switch.new(`toggle-${key}`).checked(on).on_change((value, cx) => { own ? own.set(value) : this.set(key, value); cx.notify(); })
          .accessibility_label(label)
          .child(h_flex().h(ROW).flex_none().px(8).gap(10).rounded(6).items_center().cursor_pointer().hover(el => el.bg(t.hover))
            .child(v_flex().flex_1().min_w(0).gap(3).child(div().truncate().child(label))
              .child(div().text_size(11).text_color(t.muted).truncate().child(hint)))
            .child(div().w(30).h(18).p(2).flex_none().flex().items_center().rounded(9)
              .bg(on ? t.accent : t.raised).border_1().border_color(on ? t.accent : t.border)
              .when(on, el => el.justify_end())
              .child(div().size(12).rounded(6).bg(on ? t.accent_foreground : t.muted))));
      }));
  }
}
