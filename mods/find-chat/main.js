// Find a past Claude Code, Codex or OpenCode conversation by what was said in it, and resume it in a new tab.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, ScrollHandle } from "gpui-base";
import { spaces, panes, focused, exec, run, theme, props, closeOverlay, checking, readTextFile, appHome, knownAgents } from "herdr";
import { resumeArgs, ago } from "./recent.js";
import { NAMES, terms, runs, spaceFor } from "./model.js";

const ROW = 48, ROWS = 9, LIMIT = 40;

function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  const tab = space?.tabs.find(t => t.active)?.id;
  const fallback = panes().find(p => p.tab === tab && p.cwd)?.cwd;
  return { cwd: pane?.cwd || f?.cwd || fallback || space?.folder, on };
}

function marked(text, words, color, t) {
  return runs(text, words).map(r => div().flex_none().when(r.hit, el => el.text_color(t.accent).font_semibold()).when(!r.hit, el => el.text_color(color)).child(r.text));
}

export default class FindChat extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.scroll = ScrollHandle.new();
    this.input = InputState.new({ placeholder: "Search what you or an agent said" });
    this.input.on("change", (_e, cx) => this.search(cx));
    this.input.on("submit", (_e, cx) => this.resume(this.at, cx));
    this.input.focus();
    cx.timer.after(300, () => this.input.focus());
    this.results = []; this.at = 0; this.seq = 0; this.words = [];
    this.everywhere = localStorage.getItem("everywhere") === "1";
    if (checking()) return;
    const { cwd, on } = location();
    this.on = on ?? null;
    if (!cwd) { this.error = "No folder"; return; }
    this.loading = true;
    cx.spawn(async (cx) => {
      const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on: this.on }).catch(() => null);
      this.root = top?.code === 0 ? top.stdout.trim() : cwd;
      this.search(cx);
    });
  }

  search(cx) {
    if (!this.root) return;
    const seq = ++this.seq, query = this.input.value(), everywhere = this.everywhere;
    this.loading = true; this.note = null;
    cx.spawn(async (cx) => {
      await cx.sleep(terms(query).length ? 200 : 0);
      if (seq !== this.seq) return;
      let found = null;
      try {
        this.script ??= await readTextFile(`${appHome()}/mods/find-chat/recent.py`);
        const r = await exec("python3", ["-c", this.script, JSON.stringify({ cwd: this.root, query, everywhere, limit: LIMIT })], { on: this.on, timeout: 30000 });
        found = JSON.parse(r.stdout);
      } catch (e) { found = { error: String(e?.message ?? e) }; }
      if (seq !== this.seq) return;
      this.loading = false;
      this.error = found.error ? "Cannot read the conversations here (it needs Python 3)" : null;
      this.results = found.data ?? []; this.cut = Boolean(found.cut); this.words = terms(query);
      this.at = 0; this.scroll.scroll_to_item(0);
      cx.notify();
    });
    cx.notify();
  }

  toggle(cx) {
    this.everywhere = !this.everywhere;
    try { localStorage.setItem("everywhere", this.everywhere ? "1" : "0"); } catch {}
    this.input.focus();
    this.search(cx);
  }

  close() {
    closeOverlay(props().overlay);
  }

  resume(index, cx) {
    const session = this.results[index], on = this.on;
    if (!session || this.resuming) return;
    if (session.gone) { this.note = `Its folder is gone, so it can't be resumed: ${session.cwd}`; return cx.notify(); }
    this.resuming = true;
    cx.spawn(async (cx) => {
      const agent = (await knownAgents({ on }).catch(() => [])).find(a => a.key === session.agent && a.installed);
      const space = spaceFor(spaces(), session, on);
      if (!agent || !space) {
        this.resuming = false; this.note = agent ? "No space to open it in" : `${NAMES[session.agent]} isn't installed here`;
        return cx.notify();
      }
      if (!spaces().find(s => s.id === space)?.active) run("space.select", { id: space });
      run("tab.new", { space, folder: session.cwd, argv: resumeArgs(agent, session), name: session.title.slice(0, 28) });
      this.close();
    });
  }

  move(by, cx) {
    if (!this.results.length) return;
    this.at = (this.at + by + this.results.length) % this.results.length;
    this.scroll.scroll_to_item(this.at);
    cx.notify();
  }

  row(s, i, t) {
    const where = s.branch ?? s.folder ?? null;
    const second = s.snippet ? `${s.who === "you" ? "You" : NAMES[s.agent]}: ${s.snippet}` : s.gone ? `${s.cwd} is gone` : s.cwd;
    return v_flex().id(`fc-${s.agent}-${s.id}`).h(ROW).flex_none().px(10).justify_center().gap(2).rounded(6).cursor_pointer()
      .when(i === this.at, el => el.bg(t.selected)).when(i !== this.at, el => el.hover(st => st.bg(t.hover)))
      .when(Boolean(s.gone), el => el.opacity(0.6))
      .on_click((_e, cx) => this.resume(i, cx))
      .child(h_flex().gap(8).items_center().min_w(0)
        .child(h_flex().flex_1().min_w(0).overflow_hidden().text_size(13).children(marked(s.title, this.words, t.foreground, t)))
        .when(Boolean(where), el => el.child(h_flex().flex_none().max_w(220).gap(4).items_center().text_size(11).text_color(t.muted)
          .when(Boolean(s.branch), el => el.child(svg("mods/workspace-chrome/branch.svg").size(11).flex_none())).child(div().min_w(0).truncate().child(where))))
        .child(div().flex_none().text_size(11).text_color(t.muted).child(NAMES[s.agent]))
        .child(div().flex_none().w(26).text_right().text_size(11).text_color(t.dim ?? t.muted).child(ago(s.at))))
      .child(h_flex().min_w(0).overflow_hidden().text_size(12).children(marked(second, s.snippet ? this.words : [], t.muted, t)));
  }

  render() {
    const t = theme(), typed = terms(this.input.value()).length > 0, n = this.results.length;
    const note = this.note ?? this.error ?? (this.loading && !n ? (typed ? "Searching…" : "Reading conversations…") : !n ? (typed ? "Nothing said matches" : "No conversations here yet") : null);
    const count = `${n === LIMIT ? `latest ${n}` : n} conversation${n === 1 ? "" : "s"}${this.loading && n ? " · searching…" : this.cut ? " · stopped early, add a word" : ""}`;
    return v_flex().id("find-chat").track_focus(this.handle).w_full().min_h(0).p(12).gap(8).bg(t.popover).text_size(13).text_color(t.foreground)
      .on_key_down((e, cx) => {
        const k = e.key, ctrl = e.modifiers.control;
        if (k === "escape") return this.close();
        if (k === "down" || (ctrl && (k === "n" || k === "j"))) this.move(1, cx);
        else if (k === "up" || (ctrl && (k === "p" || k === "k"))) this.move(-1, cx);
        else if (k === "tab") this.toggle(cx);
        else return;
        cx.stop_propagation();
      })
      .child(h_flex().h(36).flex_none().px(10).gap(8).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
        .child(svg("mods/find-file/search.svg").size(15).flex_none().text_color(t.muted))
        .child(Input.new(this.input).flex_1().h_full().text_size(13).text_color(t.foreground))
        .child(div().id("fc-scope").flex_none().max_w(240).truncate().px(7).h(22).flex().items_center().rounded(5).bg(t.raised).text_size(12).text_color(t.muted)
          .cursor_pointer().hover(st => st.text_color(t.foreground)).tooltip(this.everywhere ? "Search only this repository and its worktrees" : "Search every folder's conversations")
          .on_click((_e, cx) => this.toggle(cx))
          .child(this.everywhere ? "Everywhere" : this.root?.split("/").pop() ?? "")))
      .when(n > 0, el => el.child(v_flex().id("fc-list").h(Math.min(ROWS, n) * ROW).flex_none().overflow_y_scrollbar().track_scroll(this.scroll)
        .children(this.results.map((s, i) => this.row(s, i, t)))))
      .when(Boolean(note), el => el.child(div().px(10).py(6).text_size(12).text_color(this.note || this.error ? t.blocked : t.muted).child(note)))
      .child(h_flex().flex_none().px(4).gap(14).items_center().text_size(11).text_color(t.muted)
        .child("↑↓ select").child("↵ resume in a new tab").child(`⇥ ${this.everywhere ? "this repository" : "everywhere"}`).child("esc close")
        .child(div().flex_1())
        .child(count));
  }
}
