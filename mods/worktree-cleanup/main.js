// The repository's other worktrees, with what removing each would lose; removes the ticked ones without forcing Git.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { spaces, panes, focused, exec, theme, props, closeOverlay, checking, readTextFile, appHome, shared, home } from "herdr";
import { track } from "./usage.js";
import { STORE, annotate, removable, suggested, tags, ago, outcome } from "./model.js";

const ROW = 46;

function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  const tab = space?.tabs.find(t => t.active)?.id;
  const fallback = panes().find(p => p.tab === tab && p.cwd)?.cwd;
  return { cwd: pane?.cwd || f?.cwd || fallback || space?.folder, on };
}

export default class WorktreeCleanup extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.timer.after(300, () => this.handle.focus());
    this.scroll = ScrollHandle.new();
    this.rows = []; this.ticked = new Set(); this.at = 0; this.failed = {};
    if (checking()) return;
    track("worktree-cleanup", "open");
    const { cwd, on } = location();
    this.cwd = cwd; this.on = on ?? null;
    if (!cwd) { this.error = "No folder"; return; }
    this.load(cx, true);
  }

  async run(payload) {
    this.script ??= await readTextFile(`${appHome()}/mods/worktree-cleanup/cleanup.py`);
    const r = await exec("python3", ["-c", this.script, JSON.stringify({ cwd: this.cwd, ...payload })], { on: this.on, timeout: 120000 });
    const found = JSON.parse(r.stdout);
    if (found.error) throw new Error(found.error);
    return found;
  }

  load(cx, first = false) {
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const found = await this.run({});
        this.root = found.root; this.target = found.target; this.rows = found.rows; this.error = null;
        const rows = this.shown();
        this.ticked = new Set(rows.filter(row => first ? suggested(row) : this.ticked.has(row.path) && removable(row)).map(row => row.path));
        this.at = Math.min(this.at, Math.max(0, rows.length - 1));
      } catch (e) { this.error = String(e?.message ?? e); }
      finally { this.loading = false; cx.notify(); }
    });
    cx.notify();
  }

  shown() {
    return annotate(this.rows, shared(STORE), panes(), this.on);
  }

  toggle(row, cx) {
    if (!removable(row) || this.removing) return;
    this.ticked.has(row.path) ? this.ticked.delete(row.path) : this.ticked.add(row.path);
    this.confirming = false;
    cx.notify();
  }

  remove(cx) {
    const paths = this.shown().filter(row => this.ticked.has(row.path) && removable(row)).map(row => row.path);
    if (!paths.length || this.removing) return;
    if (!this.confirming) { this.confirming = true; return cx.notify(); }
    track("worktree-cleanup", "remove");
    this.confirming = false; this.removing = true; this.note = null;
    cx.spawn(async (cx) => {
      try {
        const { results } = await this.run({ remove: paths });
        this.failed = Object.fromEntries(results.filter(r => r.error).map(r => [r.path, r.error]));
        this.note = outcome(results);
      } catch (e) { this.note = String(e?.message ?? e); }
      this.removing = false;
      this.load(cx);
    });
    cx.notify();
  }

  move(by, cx) {
    const n = this.rows.length;
    if (!n) return;
    this.at = Math.max(0, Math.min(n - 1, this.at + by));
    this.scroll.scroll_to_item(this.at);
    cx.notify();
  }

  tag(tag, t) {
    const color = { good: t.ansi2, warn: t.blocked, bad: t.ansi1, held: t.muted }[tag.tone];
    return div().flex_none().px(6).h(20).flex().items_center().rounded(5).bg(t.raised).text_size(11).text_color(color).child(tag.text);
  }

  row(row, i, t) {
    const can = removable(row), on = this.ticked.has(row.path), short = row.path.startsWith(home() + "/") ? "~" + row.path.slice(home().length) : row.path;
    return v_flex().id(`wc-${row.path}`).flex_none().min_h(ROW).px(10).py(5).gap(2).justify_center().rounded(6)
      .when(i === this.at, el => el.bg(t.selected)).when(i !== this.at && can, el => el.hover(st => st.bg(t.hover)))
      .when(can, el => el.cursor_pointer())
      .on_click((_e, cx) => { this.at = i; this.toggle(row, cx); cx.notify(); })
      .child(h_flex().gap(10).items_center().min_w(0)
        .child(div().size(16).flex_none().flex().items_center().justify_center().rounded(4).border_1().border_color(on ? t.accent : t.border)
          .when(on, el => el.bg(t.accent).text_color(t.accent_foreground ?? t.background)).when(!can, el => el.opacity(0.35)).text_size(11).child(on ? "✓" : ""))
        .child(v_flex().flex_1().min_w(0)
          .child(div().truncate().text_size(13).when(!can, el => el.text_color(t.muted)).child(row.branch ?? "detached"))
          .child(div().truncate().text_size(11).text_color(t.muted).child(short)))
        .child(h_flex().flex_none().gap(5).items_center().children(tags(row, this.target ?? "the main checkout").map(tag => this.tag(tag, t))))
        .child(div().flex_none().w(28).text_right().text_size(11).text_color(t.dim ?? t.muted).child(ago(row.at))))
      .when(Boolean(this.failed[row.path]), el => el.child(div().pl(26).truncate().text_size(11).text_color(t.ansi1).child(this.failed[row.path])));
  }

  button(id, label, on, primary, enabled, t) {
    return div().id(id).h(30).px(12).flex().items_center().rounded(7).text_size(12).border_1().border_color(primary && enabled ? t.solid : t.border)
      .bg(primary && enabled ? t.solid : t.background).text_color(!enabled ? t.dim : primary ? t.solid_foreground : t.foreground)
      .when(enabled, el => el.cursor_pointer().on_click((_e, cx) => on(cx))).child(label);
  }

  render() {
    const t = theme(), rows = this.shown(), n = rows.filter(row => this.ticked.has(row.path) && removable(row)).length;
    const name = this.root?.split("/").pop() ?? "", held = rows.filter(row => !removable(row)).length;
    const empty = this.error ?? (this.loading && !rows.length ? "Reading worktrees…" : !rows.length ? "This repository has no other worktrees" : null);
    const hint = this.confirming ? `Their folders are deleted. A branch goes with its worktree only when it is merged.`
      : this.note ?? (held ? `${held} in use or with uncommitted files can't be ticked` : "");
    return v_flex().id("worktree-cleanup").track_focus(this.handle).size_full().min_h(0).bg(t.background).text_size(13).text_color(t.foreground)
      .on_key_down((e, cx) => {
        const k = e.key;
        if (k === "escape") { if (this.confirming) { this.confirming = false; cx.notify(); } else closeOverlay(props().overlay); }
        else if (k === "down" || k === "j") this.move(1, cx);
        else if (k === "up" || k === "k") this.move(-1, cx);
        else if (k === "space" && rows[this.at]) this.toggle(rows[this.at], cx);
        else if (k === "enter") this.remove(cx);
        else return;
        cx.stop_propagation();
      })
      .child(h_flex().h(48).flex_none().px(16).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child(`Worktrees of ${name}`))
        .when(Boolean(this.target), el => el.child(div().text_size(12).text_color(t.muted).child(`compared with ${this.target}`)))
        .child(div().flex_1())
        .child(this.button("wc-reload", "↻", cx => this.load(cx), false, !this.loading && !this.removing, t))
        .child(this.button("wc-close", "✕", () => closeOverlay(props().overlay), false, true, t)))
      .child(v_flex().id("wc-list").flex_1().min_h(0).p(6).gap(1).overflow_y_scrollbar().track_scroll(this.scroll)
        .children(rows.map((row, i) => this.row(row, i, t)))
        .when(Boolean(empty), el => el.child(div().p(10).text_size(12).text_color(this.error ? t.ansi1 : t.muted).child(empty))))
      .child(h_flex().h(52).flex_none().px(16).gap(10).items_center().border_t(1).border_color(t.border)
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(this.confirming ? t.foreground : t.muted).child(hint))
        .when(this.confirming, el => el.child(this.button("wc-cancel", "Cancel", cx => { this.confirming = false; cx.notify(); }, false, true, t)))
        .child(this.button("wc-remove", this.removing ? "Removing…" : this.confirming ? `Remove ${n}` : `Remove ${n} worktree${n === 1 ? "" : "s"}`, cx => this.remove(cx), true, n > 0 && !this.removing, t)))
      .child(h_flex().h(28).flex_none().px(16).gap(16).items_center().border_t(1).border_color(t.border).text_size(11).text_color(t.muted)
        .child("↑ ↓ move").child("Space tick").child("↵ remove the ticked").child("Esc close"));
  }
}
