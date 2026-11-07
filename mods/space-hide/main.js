import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, Input, InputState } from "gpui-base";
import { props, spaces, theme, closeOverlay, openOverlay } from "herdr";
import { hiddenSpaces, expireSpaces, hideSpace, restoreSpace, localTime, parseLocalTime, hideChoices } from "./state.js";

export default class SpaceHide extends View {
  init(_props, cx) {
    this.at = 0;
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.mode = props()?.list ? "list" : props()?.custom ? "custom" : "choices";
    if (this.mode === "custom") {
      this.input = InputState.new({ placeholder: "YYYY-MM-DD HH:mm", value: localTime(Date.now() + 3600000) });
      this.input.on("change", (_e, cx) => { this.error = null; cx.notify(); });
      this.input.on("submit", (_e, cx) => this.submit(cx));
      this.input.focus();
    }
    cx.timer.every(1000, cx => { expireSpaces(); cx.notify(); });
  }

  list() {
    const hidden = hiddenSpaces();
    return spaces().filter(s => hidden[s.id]).map(s => ({ ...s, until: hidden[s.id] }));
  }

  hide(until, cx) {
    const id = props()?.id;
    if (!spaces().some(s => s.id === id)) {
      this.error = "This space is no longer available.";
      cx.notify();
      return;
    }
    if (hideSpace(id, until)) closeOverlay(props().overlay);
  }

  submit(cx) {
    const until = parseLocalTime(this.input.value());
    if (!Number.isFinite(until) || until <= Date.now()) {
      this.error = "Enter a future date and time as YYYY-MM-DD HH:mm.";
      cx.notify();
      return;
    }
    this.hide(until, cx);
  }

  choose(index, cx) {
    if (this.mode === "list") {
      const s = this.list()[index];
      if (s) restoreSpace(s.id);
      this.at = Math.max(0, Math.min(this.at, this.list().length - 1));
      cx.notify();
    } else if (index === 4) {
      closeOverlay(props().overlay);
      openOverlay({ mod: "space-hide", kind: "popup", width: 330, height: 250, props: { id: props().id, custom: true } });
    } else {
      const choice = hideChoices()[index];
      if (choice) this.hide(choice[1], cx);
    }
  }

  render() {
    const t = theme(), target = spaces().find(s => s.id === props()?.id);
    const list = this.mode === "list" ? this.list() : hideChoices();
    const count = this.mode === "list" ? list.length : 5;
    const root = v_flex().id("space-hide-menu").track_focus(this.handle).w_full().min_h(0).p(8)
      .bg(t.popover).text_size(12.8).text_color(t.foreground)
      .on_key_down((e, cx) => {
        if (e.key === "escape") closeOverlay(props().overlay);
        else if (this.mode === "custom" || !count) return;
        else if (e.key === "down") this.at = (this.at + 1) % count;
        else if (e.key === "up") this.at = (this.at + count - 1) % count;
        else if (e.key === "enter") this.choose(Math.min(this.at, count - 1), cx);
        else return;
        cx.stop_propagation(); cx.notify();
      })
      .child(h_flex().px(8).py(6).gap(8).items_center()
        .child(svg("mods/space-hide/eye-off.svg").size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().truncate().font_medium().child(this.mode === "list" ? "Hidden spaces" : `Hide ${target?.name ?? "space"}`)))
      .child(div().px(8).pb(8).text_size(11.5).text_color(t.muted)
        .child(this.mode === "list" ? "Choose a space to show it now." : "Returns automatically. Terminals keep running."));
    if (this.mode === "custom") return root.gap(8)
      .child(div().px(8).text_size(11.5).text_color(t.muted).child("Date and time · local time"))
      .child(h_flex().mx(8).h(34).px(8).items_center().rounded(6).border_1().border_color(t.input).bg(t.background)
        .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground)))
      .child(div().px(8).text_size(11).text_color(this.error ? t.ansi1 : t.muted)
        .child(this.error || "YYYY-MM-DD HH:mm · 24-hour clock"))
      .child(div().id("space-hide-submit").mx(8).mt(4).h(32).rounded(6).flex().items_center().justify_center()
        .bg(t.solid).text_color(t.solid_foreground).cursor_pointer().role("button").accessibility_label("Hide until then")
        .on_click((_e, cx) => this.submit(cx)).child("Hide until then"));
    if (this.mode === "list") return root
      .child(v_flex().id("hidden-space-list").h(Math.min(320, Math.max(44, list.length * 48))).flex_none().overflow_y_scrollbar()
        .children(list.map((s, i) => this.option(`hidden-space-${s.id}`, s.name, `${localTime(s.until)}${s.machine ? ` · ${s.machine}` : ""}`, i, t)))
        .when(!list.length, el => el.child(div().px(8).py(12).text_color(t.muted).child("No hidden spaces."))));
    return root
      .children(list.map(([label, until], i) => this.option(`space-hide-choice-${i}`, label, localTime(until), i, t)))
      .child(div().mx(8).my(4).h(1).bg(t.border))
      .child(this.option("space-hide-custom", "Until a date & time…", null, 4, t))
      .when(Boolean(this.error), el => el.child(div().px(8).py(6).text_size(11).text_color(t.ansi1).child(this.error)));
  }

  option(id, label, hint, i, t) {
    return h_flex().id(id).h(hint ? 48 : 34).flex_none().px(8).gap(8).rounded(6).items_center().min_w(0)
      .role("button").accessibility_label(this.mode === "list" ? `Show ${label} now, hidden until ${hint}` : label)
      .cursor_pointer().when(i === this.at, el => el.bg(t.selected)).hover(el => el.bg(t.hover))
      .on_click((_e, cx) => this.choose(i, cx))
      .child(v_flex().flex_1().min_w(0).gap(3).child(div().truncate().child(label))
        .when(Boolean(hint), el => el.child(div().text_size(11).text_color(t.muted).truncate().child(hint))))
      .when(this.mode === "list", el => el.child(div().text_size(11).text_color(t.muted).child("Show now")));
  }
}
