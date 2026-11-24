// Find a file by name in the focused pane's project, like VS Code's Go to File, and open it in Files' dialog.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, ScrollHandle } from "gpui-base";
import { spaces, panes, focused, exec, theme, props, openOverlay, closeOverlay, checking } from "herdr";
import { track } from "./usage.js";
import { iconsReady, fileIcon } from "./icons.js";
import { prepare, rank, terms, highlights } from "./match.js";

const SHOWN = 100, BYTES = 4000000, RECENT = 30, ROW = 30, ROWS = 12;
const LIST = `if top=$(git rev-parse --show-toplevel 2>/dev/null); then
  cd "$top" && printf '%s\\0' "$top" && git ls-files -z --cached --others --exclude-standard | head -c ${BYTES}
else
  printf '%s\\0' "$PWD" && find . -mindepth 1 \\( -name '.*' -o -name node_modules \\) -type d -prune -o -type f -print0 2>/dev/null | head -c ${BYTES}
fi`;

function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  const tab = space?.tabs.find(t => t.active)?.id;
  const fallback = panes().find(p => p.tab === tab && p.cwd)?.cwd;
  return { cwd: pane?.cwd || f?.cwd || fallback || space?.folder, on };
}

function recentList() {
  try { return JSON.parse(localStorage.getItem("recent") ?? "{}"); } catch { return {}; }
}

function mark(code) {
  return code === "??" || code.includes("A") ? "A" : code.includes("U") ? "U" : code.includes("D") ? "D" : "M";
}

function markColor(m, t) {
  return m === "A" ? t.ansi2 : m === "D" || m === "U" ? t.ansi1 : t.blocked;
}

function runs(text, from, hits, color, t) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const hit = hits.has(from + i);
    let j = i + 1;
    while (j < text.length && hits.has(from + j) === hit) j++;
    out.push(div().flex_none().when(hit, el => el.text_color(t.accent).font_semibold()).when(!hit, el => el.text_color(color)).child(text.slice(i, j)));
    i = j;
  }
  return out;
}

export default class FindFile extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.scroll = ScrollHandle.new();
    this.input = InputState.new({ placeholder: "Search files by name" });
    this.input.on("change", (_e, cx) => { this.filter(); cx.notify(); });
    this.input.on("submit", () => this.open(this.at));
    this.input.focus();
    cx.timer.after(300, () => this.input.focus());
    this.entries = []; this.marks = {}; this.results = []; this.total = 0; this.at = 0;
    this.loading = true;
    cx.spawn(async (cx) => { await iconsReady; cx.notify(); });
    if (checking()) return;
    track("find-file", "open");
    const { cwd, on } = location();
    this.on = on ?? null;
    if (!cwd) { this.loading = false; this.error = "No folder"; return; }
    cx.spawn(async (cx) => {
      try { await this.load(cwd, cx); }
      catch (e) { this.error = String(e?.message ?? e); }
      finally { this.loading = false; this.filter(); cx.notify(); }
    });
  }

  async load(cwd, cx) {
    const r = await exec("sh", ["-c", LIST], { cwd, on: this.on, timeout: 20000 });
    const fields = r.stdout.split("\0");
    if (!fields[0]) throw new Error(r.stderr.trim() || "Cannot list this folder");
    this.root = fields.shift();
    this.limited = fields.pop() !== "";
    const paths = fields.map(p => p.startsWith("./") ? p.slice(2) : p);
    this.entries = prepare(paths);
    this.known = new Set(paths);
    this.loading = false;
    this.filter(); cx.notify();
    const status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd: this.root, on: this.on }).catch(() => null);
    if (status?.code !== 0) return;
    const marks = {};
    for (const entry of status.stdout.split("\0").filter(Boolean)) marks[entry.slice(3)] = mark(entry.slice(0, 2));
    this.marks = marks;
    this.entries = this.entries.filter(e => marks[e.path] !== "D");
    this.known = new Set(this.entries.map(e => e.path));
    this.last = null;
  }

  filter() {
    const query = this.input.value(), recent = recentList()[this.root] ?? [];
    if (!terms(query).length) {
      const seen = new Set();
      this.results = [...recent, ...Object.keys(this.marks).sort()].filter(p => this.known?.has(p) && !seen.has(p) && seen.add(p))
        .slice(0, SHOWN).map(path => ({ path, hits: new Set() }));
      this.total = this.results.length;
      this.last = null;
    } else {
      const pool = this.last && query.startsWith(this.last.query) ? this.last.pool : this.entries, mine = new Set(recent);
      const found = rank(pool, query, p => (mine.has(p) ? 20 : 0) + (this.marks[p] ? 8 : 0), SHOWN);
      this.last = { query, pool: found.pool };
      this.total = found.pool.length;
      this.results = found.top.map(m => ({ path: m.path, hits: highlights(query, m.path) }));
    }
    this.at = 0;
    this.scroll.scroll_to_item(0);
  }

  remember(path) {
    const all = recentList();
    all[this.root] = [path, ...(all[this.root] ?? []).filter(p => p !== path)].slice(0, RECENT);
    try { localStorage.setItem("recent", JSON.stringify(all)); } catch {}
  }

  close() {
    closeOverlay(props().overlay);
  }

  open(index) {
    const files = this.results.map(r => r.path);
    if (!files[index]) return;
    track("find-file", "pick");
    this.remember(files[index]);
    const marks = Object.fromEntries(Object.entries(this.marks).map(([p, m]) => [`${this.root}/${p}`, m]));
    this.close();
    openOverlay({ mod: "files-modal", kind: "dialog", width: 0.9, height: 0.9, props: { root: this.root, on: this.on, files, index, marks } });
  }

  move(by, cx) {
    if (!this.results.length) return;
    this.at = (this.at + by + this.results.length) % this.results.length;
    this.scroll.scroll_to_item(this.at);
    cx.notify();
  }

  row(r, i, recent, t) {
    const slash = r.path.lastIndexOf("/") + 1, hits = r.hits, m = this.marks[r.path];
    return h_flex().id(`ff-${r.path}`).h(ROW).flex_none().px(10).gap(8).items_center().rounded(6).cursor_pointer()
      .when(i === this.at, el => el.bg(t.selected)).when(i !== this.at, el => el.hover(s => s.bg(t.hover)))
      .on_click(() => this.open(i))
      .child(fileIcon(r.path, {}, t))
      .child(h_flex().flex_none().text_size(13).children(runs(r.path.slice(slash), slash, hits, t.foreground, t)))
      .child(h_flex().flex_1().min_w(0).overflow_hidden().text_size(12).children(runs(r.path.slice(0, Math.max(0, slash - 1)), 0, hits, t.muted, t)))
      .when(recent.includes(r.path), el => el.child(div().flex_none().text_size(11).text_color(t.muted).child("recent")))
      .when(Boolean(m), el => el.child(div().flex_none().w(10).text_size(11).text_color(markColor(m, t)).child(m)));
  }

  render() {
    const t = theme(), recent = recentList()[this.root] ?? [], query = terms(this.input.value()).length > 0;
    const note = this.error ?? (this.loading ? "Listing files…" : query && !this.total ? "No matching files" : !query && !this.results.length ? `Type to search ${this.entries.length.toLocaleString()} files` : null);
    const count = query ? `${this.total.toLocaleString()} of ${this.entries.length.toLocaleString()} files` : `${this.entries.length.toLocaleString()} files`;
    return v_flex().id("find-file").track_focus(this.handle).w_full().min_h(0).p(12).gap(8).bg(t.popover).text_size(13).text_color(t.foreground)
      .on_key_down((e, cx) => {
        const k = e.key, ctrl = e.modifiers.control;
        if (k === "escape") return this.close();
        if (k === "down" || (ctrl && (k === "n" || k === "j"))) this.move(1, cx);
        else if (k === "up" || (ctrl && (k === "p" || k === "k"))) this.move(-1, cx);
        else return;
        cx.stop_propagation();
      })
      .child(h_flex().h(36).flex_none().px(10).gap(8).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
        .child(svg("mods/find-file/search.svg").size(15).flex_none().text_color(t.muted))
        .child(Input.new(this.input).flex_1().h_full().text_size(13).text_color(t.foreground))
        .child(div().flex_none().max_w(200).truncate().text_size(12).text_color(t.muted).child(this.root?.split("/").pop() ?? "")))
      .when(this.results.length > 0, el => el.child(v_flex().id("ff-list").h(Math.min(ROWS, this.results.length) * ROW).flex_none().overflow_y_scrollbar().track_scroll(this.scroll)
        .children(this.results.map((r, i) => this.row(r, i, recent, t)))))
      .when(Boolean(note), el => el.child(div().px(10).py(6).text_size(12).text_color(this.error ? t.blocked : t.muted).child(note)))
      .child(h_flex().flex_none().px(4).gap(14).items_center().text_size(11).text_color(t.muted)
        .child("↑↓ select").child("↵ open").child("esc close")
        .child(div().flex_1())
        .child(this.limited ? `${count} · list cut short` : count));
  }
}
