import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar, v_virtual_list } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, settings, props, openOverlay, closeOverlay, shared, setShared } from "herdr";
import { iconsReady, fileIcon, light } from "./icons.js";
import { moveToPaneButton } from "./panel-actions.js";
import { isImage, stageImage, imageCompare } from "./images.js";
import { parseBranch, remoteGit } from "./sync.js";

function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  const tab = space?.tabs.find(t => t.active)?.id;
  const fallback = panes().find(p => p.tab === tab && p.cwd)?.cwd;
  return { cwd: pane?.cwd || f?.cwd || fallback || space?.folder, on };
}
const key = () => JSON.stringify(location());
// Reads write nothing under .git (no index refresh or lock, no fsmonitor cookie):
// the folder watch would see it, and every refresh would start the next one.
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
const countLines = (text) => text ? text.split("\n").length - Number(text.endsWith("\n")) : 0;

// Numbers each diff line once, so a frame only draws the rows on screen.
function diffRows(lines) {
  let old = 0, next = 0;
  return lines.map((line) => {
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (match) { old = +match[1]; next = +match[2]; return { kind: "@", text: line }; }
    const kind = line[0];
    if (kind === "-") return { kind, number: old++, text: line.slice(1) || " " };
    if (kind === "+") return { kind, number: next++, text: line.slice(1) || " " };
    if (kind === " ") { old++; return { kind, number: next++, text: line.slice(1) || " " }; }
    return { kind: "", text: line };
  });
}

const SPLIT = "changes-modal.split";

function splitRows(rows) {
  const out = [];
  let dels = [], adds = [], old = 0;
  const flush = () => {
    for (let i = 0; i < Math.max(dels.length, adds.length); i++) out.push({ left: dels[i] ?? null, right: adds[i] ?? null });
    dels = []; adds = [];
  };
  for (const r of rows) {
    if (r.kind === "-") { dels.push(r); old = r.number + 1; }
    else if (r.kind === "+") adds.push(r);
    else {
      flush();
      if (r.kind === "@") old = +(/^@@ -(\d+)/.exec(r.text)?.[1] ?? 0);
      out.push(r.kind === " " ? { left: { kind: " ", number: old++, text: r.text, spans: r.spans }, right: r } : r);
    }
  }
  flush();
  return out;
}

const bat = () => `b=$(command -v bat || command -v batcat) || exit 9; COLORTERM=truecolor "$b" --color=always --style=plain --paging=never --theme="${light() ? "Catppuccin Latte" : "Catppuccin Mocha"}" --tabs=0 "$@"`;

function parseAnsi(text) {
  return text.replace(/\n$/, "").split("\n").map((line) => {
    const spans = [], re = /\x1b\[([\d;]*)m/g;
    let color = null, last = 0, m;
    const push = (text) => {
      if (!text) return;
      const prev = spans[spans.length - 1];
      if (prev && prev.color === color) prev.text += text; else spans.push({ text, color });
    };
    while ((m = re.exec(line))) {
      push(line.slice(last, m.index));
      last = re.lastIndex;
      const codes = m[1] ? m[1].split(";").map(Number) : [0];
      for (let i = 0; i < codes.length; i++) {
        const c = codes[i];
        if (c === 0 || c === 39) color = null;
        else if (c >= 30 && c <= 37) color = c - 30;
        else if (c >= 90 && c <= 97) color = c - 82;
        else if (c === 38 && codes[i + 1] === 5) { color = codes[i + 2] < 16 ? codes[i + 2] : null; i += 2; }
        else if (c === 38 && codes[i + 1] === 2) { color = "#" + codes.slice(i + 2, i + 5).map((n) => n.toString(16).padStart(2, "0")).join(""); i += 4; }
      }
    }
    push(line.slice(last));
    return spans;
  });
}

async function highlighted({ root, on, hasHead }, file) {
  const run = async (script, args) => {
    const r = await exec("sh", ["-c", script, "sh", ...args], { cwd: root, on }).catch(() => null);
    return r?.code === 0 && r.stdout.length < 2000000 ? parseAnsi(r.stdout) : null;
  };
  const [old, now] = await Promise.all([
    hasHead && !file.fresh && file.status !== "A" ? run(`git show "HEAD:$1" | { ${bat()} --file-name "$1"; }`, [file.path]) : null,
    file.status !== "D" ? run(`${bat()} -- "$1"`, [file.path]) : null,
  ]);
  return { old, now };
}

function paint(rows, { old, now }) {
  for (const r of rows) {
    if (r.kind !== "-" && r.kind !== "+" && r.kind !== " ") continue;
    const spans = (r.kind === "-" ? old : now)?.[r.number - 1];
    if (spans && spans.map((s) => s.text).join("") === r.text) r.spans = spans;
  }
}

const statusColor = (s, t) => s === "A" ? t.ansi2 : s === "D" || s === "U" ? t.ansi1 : t.blocked;

export default class Changes extends View {
  init(_props, cx) {
    this.files = []; this.rows = []; this.diffWidth = 0; this.message = ""; this.handle = cx.focus_handle();
    cx.spawn(async (cx) => { await iconsReady; cx.notify(); });
    if (props()?.overlay) return this.initViewer(props(), cx);
    this.input = InputState.new({ placeholder: "Commit message" });
    this.input.on("change", (_e, cx) => {
      const hadMessage = Boolean(this.message.trim());
      this.message = this.input.value();
      if (hadMessage !== Boolean(this.message.trim())) cx.notify();
    });
    this.input.on("submit", (_e, cx) => this.commit(cx));
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.refresh(cx);
    const draft = props()?.panelState;
    if (draft?.message && (!draft.context || draft.context === this.context)) {
      this.message = draft.message;
      this.input.set_value(this.message);
    }
    cx.timer.every(10000, (cx) => this.refresh(cx));
    cx.timer.every(180000, (cx) => this.fetch(cx));
  }

  fetch(cx) {
    if (!this.root || this.fetching || this.syncing || !this.sync?.upstream) return;
    const root = this.root, on = this.on;
    this.fetching = true; this.fetchedRoot = root;
    cx.spawn(async (cx) => {
      await remoteGit(["fetch", "--quiet"], root, on, 30000).catch(() => null);
      this.fetching = false;
      this.refresh(cx);
    });
  }

  runSync(args, label, cx) {
    if (!this.root || this.syncing || this.busy) return;
    const root = this.root, on = this.on, context = this.context;
    this.syncing = label; this.note = null;
    cx.spawn(async (cx) => {
      try {
        const r = await remoteGit(args, root, on, 120000);
        if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
      } catch (e) { if (key() === context) this.note = `${label} failed: ${e.message ?? e}`; }
      finally { this.syncing = null; this.refresh(cx); cx.notify(); }
    });
    cx.notify();
  }

  syncBar(t) {
    const s = this.sync, busy = Boolean(this.syncing || this.busy);
    const action = (id, label, args, name) => div().id(id).h(22).px(8).flex().items_center().rounded(6).text_size(11)
      .border_1().border_color(t.border).when(!busy, (e) => e.cursor_pointer().hover((st) => st.bg(t.hover)).on_click((_e, cx) => this.runSync(args, name, cx)))
      .text_color(busy ? t.dim : t.foreground).child(label);
    const status = this.syncing ? `${this.syncing === "Push" ? "Pushing" : this.syncing === "Pull" ? "Pulling" : "Publishing"}…`
      : !s.upstream ? "Not published" : s.gone ? "Upstream gone" : !s.ahead && !s.behind ? (this.fetching ? "Checking…" : "Up to date") : "";
    return h_flex().flex_none().h(36).px(12).gap(6).items_center().border_t(1).border_color(t.border).text_size(11)
      .child(div().text_color(t.muted).child("⎇"))
      .child(div().min_w(0).truncate().text_color(t.muted).child(s.branch))
      .child(div().flex_1())
      .when(Boolean(status), (e) => e.child(div().flex_none().text_color(t.muted).child(status)))
      .when(!this.syncing && s.behind > 0, (e) => e.child(action("sync-pull", `↓${s.behind} Pull`, ["pull"], "Pull")))
      .when(!this.syncing && s.ahead > 0 && !s.gone, (e) => e.child(action("sync-push", `↑${s.ahead} Push`, ["push"], "Push")))
      .when(!this.syncing && (!s.upstream || s.gone), (e) => e.child(action("sync-publish", "Publish", ["push", "-u", "origin", "HEAD"], "Publish")))
      .when(!this.syncing && Boolean(s.upstream) && !s.gone, (e) => e.child(div().id("sync-fetch").size(22).flex().items_center().justify_center().rounded(6).text_color(t.muted)
        .when(!this.fetching, (e) => e.cursor_pointer().hover((st) => st.bg(t.hover)).on_click((_e, cx) => { this.fetch(cx); cx.notify(); }))
        .child("↻")));
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    cx.spawn(async (cx) => {
      try {
        while (this.watched === root) {
          await watchFolder(root);
          if (this.watched === root) this.refresh(cx);
        }
      } catch { this.watched = null; }
    });
  }

  refresh(cx) {
    if (this.loading || this.busy) return;
    const { cwd, on } = location(), context = key();
    if (context !== this.context) {
      this.context = context; this.root = null; this.sync = null; this.files = []; this.open = null;
      this.setLines([]); this.message = ""; this.input.set_value(""); this.error = null; this.note = null; this.watched = null; this.closed = false; this.limited = false;
    }
    if (!cwd) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
        if (key() !== context) return;
        if (top.code !== 0) { this.root = null; this.sync = null; this.files = []; this.setLines([]); this.open = null; this.error = "Not a git repository"; return; }
        const root = top.stdout.trim(), git = (args) => exec("git", [...READ, ...args], { cwd: root, on });
        const status = await git(["status", "--porcelain=v1", "--branch", "-z", "--no-renames", "--untracked-files=all"]);
        if (status.code !== 0) throw new Error(status.stderr);
        const head = await git(["rev-parse", "--verify", "HEAD"]);
        const stats = {};
        const results = head.code === 0 ? [await git(["diff", "HEAD", "--numstat", "-z", "--no-renames"])] : [await git(["diff", "--cached", "--numstat", "-z", "--no-renames"]), await git(["diff", "--numstat", "-z", "--no-renames"])];
        for (const result of results) {
          if (result.code !== 0) throw new Error(result.stderr);
          for (const entry of result.stdout.split("\0")) {
            const [a, d, ...parts] = entry.split("\t");
            if (!parts.length) continue;
            const path = parts.join("\t"), old = stats[path] ?? { add: 0, del: 0 };
            stats[path] = { add: old.add + (Number(a) || 0), del: old.del + (Number(d) || 0), binary: a === "-" };
          }
        }
        const files = [];
        const [header, ...entries] = status.stdout.split("\0").filter(Boolean);
        for (const entry of entries.slice(0, 1000)) {
          const xy = entry.slice(0, 2), path = entry.slice(3), fresh = xy === "??";
          const conflict = xy.includes("U") || xy === "AA" || xy === "DD";
          const s = conflict ? "U" : xy.includes("D") ? "D" : fresh || xy.includes("A") ? "A" : "M";
          const stat = stats[path] ?? { add: 0, del: 0 };
          files.push({ path, status: s, fresh, ...stat });
        }
        if (key() !== context) return;
        this.root = root; this.on = on; this.sync = parseBranch(header); this.hasHead = head.code === 0; this.files = files; this.limited = entries.length > 1000; this.error = null;
        this.watch(root, cx);
        if (this.fetchedRoot !== root) this.fetch(cx);
        if (this.open && !files.some((f) => f.path === this.open)) { this.open = null; this.setLines([]); }
        if (this.open) {
          try { await this.load(this.open, context); }
          catch { if (key() === context) this.setLines(["Cannot preview this diff (too large or unreadable)"]); }
        }
      } catch (e) { if (key() === context) this.error = String(e); }
      finally { this.loading = false; cx.notify(); }
    });
  }

  async load(path, context) {
    const file = this.files.find((f) => f.path === path), root = this.root, on = this.on;
    if (!file) return;
    let lines;
    if (file.fresh || (!this.hasHead && file.status === "A")) {
      const text = await readTextFile(`${root}/${path}`, { on }).catch(() => null);
      if (text === null) lines = ["Cannot preview this file (binary, too large, or unreadable)"];
      else if (text.includes("\0")) lines = ["Binary file · no text diff"];
      else {
        file.add = countLines(text);
        lines = [`@@ -0,0 +1,${file.add} @@`, ...text.slice(0, 400000).replace(/\n$/, "").split("\n").slice(0, 5000).map(l => `+${l}`)];
      }
    } else {
      const r = await exec("git", [...READ, "diff", ...(this.hasHead ? ["HEAD"] : []), "--no-ext-diff", "--no-textconv", "--no-color", "--", path], { cwd: root, on });
      if (r.code !== 0) throw new Error(r.stderr);
      const all = r.stdout.replace(/\n$/, "").split("\n"), first = all.findIndex((l) => l.startsWith("@@"));
      lines = first < 0 ? [file.binary ? "Binary file changed" : "No text diff available"] : all.slice(first);
    }
    if (key() === context && this.open === path) this.setLines(lines.slice(0, 5000).map(line => line.length > 4000 ? line.slice(0, 4000) + "… (line truncated)" : line));
  }

  setLines(lines) {
    this.rows = diffRows(lines);
    this.diffWidth = Math.max(300, ...lines.map(line => line.length * 7 + 50));
  }

  pick(path, cx) {
    this.open = this.open === path ? null : path; this.setLines([]); this.note = null;
    this.closed = !this.open;
    const context = this.context;
    if (this.open) cx.spawn(async (cx) => {
      try { await this.load(path, context); }
      catch (e) { if (key() === context && this.open === path) this.note = `Cannot preview this diff (too large or unreadable): ${e}`; }
      cx.notify();
    });
    cx.notify();
  }

  commit(cx) {
    if (!this.message.trim() || !this.root || this.busy || this.loading || this.context !== key()) return;
    const root = this.root, on = this.on, context = this.context, message = this.message.trim();
    this.busy = true; this.note = null;
    cx.spawn(async (cx) => {
      try {
        for (const args of [["add", "-A"], ["commit", "-m", message]]) {
          const r = await exec("git", args, { cwd: root, on });
          if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
        }
        if (key() === context) { this.message = ""; this.input.set_value(""); }
      } catch (e) { if (key() === context) this.note = `Commit failed: ${e}`; }
      finally { this.busy = false; this.refresh(cx); cx.notify(); }
    });
    cx.notify();
  }

  view(index) {
    openOverlay({
      mod: "changes-modal", kind: "dialog", width: 0.9, height: 0.9,
      props: { root: this.root, on: this.on ?? null, hasHead: this.hasHead, files: this.files, index },
    });
  }

  initViewer(p, cx) {
    this.files = p.files ?? []; this.root = p.root; this.on = p.on; this.hasHead = p.hasHead; this.index = p.index ?? 0;
    this.handle.focus();
    cx.timer.after(300, () => this.handle.focus());
    this.show(this.index, cx);
  }

  show(index, cx) {
    if (index < 0 || index >= this.files.length) return;
    const file = this.files[index], context = key();
    this.index = index; this.open = file.path; this.setLines([]); this.split = null; this.loadingDiff = true; this.pictures = null;
    if (isImage(file.path) && !this.on) {
      cx.spawn(async (cx) => {
        const stage = (rev) => stageImage(this.root, file.path, rev).catch(() => null);
        const [before, after] = await Promise.all([
          this.hasHead && !file.fresh && file.status !== "A" ? stage("HEAD") : undefined,
          file.status !== "D" ? stage() : undefined,
        ]);
        if (this.index !== index) return;
        this.pictures = { before, after }; this.loadingDiff = false;
        cx.notify();
      });
      return cx.notify();
    }
    cx.spawn(async (cx) => {
      try { await this.load(file.path, context); }
      catch (e) { this.setLines([`Cannot preview this diff (too large or unreadable): ${e}`]); }
      if (this.index !== index) return;
      this.diffWidth = Math.max(300, ...this.rows.map((r) => r.text.length * 7.5 + 80));
      this.loadingDiff = false; this.split = null;
      cx.notify();
      if (this.rows.length > 3000) return;
      const colors = await highlighted(props(), file);
      if (this.index !== index) return;
      paint(this.rows, colors); this.split = null;
      cx.notify();
    });
    cx.notify();
  }

  code(text, spans, t) {
    if (!spans) return div().flex_1().min_w(0).truncate().child(text);
    return h_flex().flex_1().min_w(0).overflow_hidden()
      .children(spans.map((s) => div().flex_none().when(s.color !== null, (e) => e.text_color(typeof s.color === "string" ? s.color : t[`ansi${s.color}`])).child(s.text)));
  }

  row({ kind, number, text, spans }, t) {
    if (kind === "@") return div().w_full().px(12).h(22).flex_none().flex().items_center().truncate().bg(t.raised).text_color(t.muted).child(text);
    return h_flex().w_full().h(22).flex_none().gap(12).when(kind === "+", (e) => e.bg(t.ansi2 + "18")).when(kind === "-", (e) => e.bg(t.ansi1 + "18"))
      .child(div().w(40).flex_none().text_right().text_color(t.dim).child(number === undefined ? "" : String(number)))
      .child(div().w(10).flex_none().text_color(kind === "+" ? t.ansi2 : kind === "-" ? t.ansi1 : t.dim).child(kind === " " ? "" : kind))
      .child(this.code(text, spans, t));
  }

  half(side, t) {
    return h_flex().flex_1().min_w(0).h_full().gap(12).overflow_hidden()
      .when(!side, (e) => e.bg(t.raised + "80"))
      .when(side?.kind === "+", (e) => e.bg(t.ansi2 + "18")).when(side?.kind === "-", (e) => e.bg(t.ansi1 + "18"))
      .when(Boolean(side), (e) => e
        .child(div().w(40).flex_none().text_right().text_color(t.dim).child(String(side.number)))
        .child(this.code(side.text, side.spans, t)));
  }

  splitRow(r, t) {
    if (!("left" in r)) return this.row(r, t);
    return h_flex().w_full().h(22).flex_none()
      .child(this.half(r.left, t))
      .child(div().w(1).h_full().flex_none().bg(t.border))
      .child(this.half(r.right, t));
  }

  button(id, label, on, active, t) {
    return div().id(id).h(26).px(10).flex().items_center().rounded(6).cursor_pointer().text_size(12)
      .bg(active ? t.selected : t.background).border_1().border_color(t.border).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => on(cx)).child(label);
  }

  renderViewer(cx) {
    const t = theme(), file = this.files[this.index], split = shared(SPLIT) !== false;
    if (!file) return div().size_full().bg(t.background);
    if (split && !this.split) this.split = splitRows(this.rows);
    const rows = split ? this.split : this.rows;
    const parts = file.path.split("/"), name = parts.pop();
    const step = (d, cx) => this.show(this.index + d, cx);
    return v_flex().id("changes-viewer").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13).track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (["down", "right", "j"].includes(e.key)) step(1, cx);
        else if (["up", "left", "k"].includes(e.key)) step(-1, cx);
        else if (e.key === "s") { setShared(SPLIT, !split); cx.notify(); }
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.stop_propagation();
      })
      .child(h_flex().h(48).flex_none().px(16).gap(10).items_center().border_b(1).border_color(t.border)
        .child(div().w(14).text_size(12).text_color(statusColor(file.status, t)).child(file.status))
        .child(fileIcon(file.path, {}, t))
        .child(h_flex().min_w(0).child(div().text_color(t.muted).truncate().child(parts.length ? parts.join("/") + "/" : "")).child(div().font_semibold().flex_none().child(name)))
        .when(file.add > 0, (e) => e.child(div().text_size(12).text_color(t.ansi2).child(`+${file.add}`)))
        .when(file.del > 0, (e) => e.child(div().text_size(12).text_color(t.ansi1).child(`−${file.del}`)))
        .child(div().flex_1())
        .when(!this.pictures, (e) => e.child(h_flex().gap(4)
          .child(this.button("cm-unified", "Unified", () => setShared(SPLIT, false), !split, t))
          .child(this.button("cm-split", "Split", () => setShared(SPLIT, true), split, t))))
        .child(div().w(8))
        .child(this.button("cm-prev", "↑", (cx) => step(-1, cx), false, t))
        .child(div().text_size(12).text_color(t.muted).child(`${this.index + 1} / ${this.files.length}`))
        .child(this.button("cm-next", "↓", (cx) => step(1, cx), false, t))
        .child(div().w(8))
        .child(this.button("cm-close", "✕", () => closeOverlay(props().overlay), false, t)))
      .when(Boolean(this.pictures), (e) => e.child(imageCompare(this.pictures.before, this.pictures.after, t)))
      .when(!this.pictures, (e) => e.child(div().flex_1().min_h(0).relative().font_family(settings().font_family ?? "JetBrains Mono").text_size(12)
        .when(split, (e) => e.child(v_virtual_list("changes-modal-diff", rows.length, 22, (i) => String(i),
          (range) => rows.slice(range.start, range.end).map((r) => this.splitRow(r, t))).size_full()))
        .when(!split, (e) => e.child(div().id("changes-modal-x").size_full().overflow_x_scrollbar()
          .child(div().w_full().min_w(this.diffWidth).h_full().child(v_virtual_list("changes-modal-diff", rows.length, 22, (i) => String(i),
            (range) => rows.slice(range.start, range.end).map((r) => this.row(r, t))).size_full()))))
        .child(Scrollbar.vertical("changes-modal-diff").viewport_from_layout().absolute().inset_0())
        .when(this.loadingDiff, (e) => e.child(div().absolute().top(8).px(16).text_color(t.muted).child("Loading…")))))
      .child(h_flex().h(28).flex_none().px(16).gap(16).items_center().border_t(1).border_color(t.border).text_size(11).text_color(t.muted)
        .child("↑ ↓ file").when(!this.pictures, (e) => e.child("S split / unified")).child("Esc close"));
  }

  diffRow({ kind, number, text }, t) {
    if (kind === "@") return div().w_full().px(12).h(20).flex_none().truncate().bg(t.raised).text_color(t.muted).child(text);
    return h_flex().w_full().h(20).flex_none().gap(10).when(kind === "+", (e) => e.bg(t.ansi2 + "18")).when(kind === "-", (e) => e.bg(t.ansi1 + "18"))
      .child(div().w(30).flex_none().text_right().text_color(t.dim).child(number === undefined ? "" : String(number)))
      .child(div().flex_1().min_w(0).truncate().child(text));
  }

  render(cx) {
    if (props()?.overlay) return this.renderViewer(cx);
    if (key() !== this.context) this.refresh(cx);
    const t = theme(), add = this.files.reduce((n, f) => n + f.add, 0), del = this.files.reduce((n, f) => n + f.del, 0);
    const enabled = Boolean(this.message.trim() && this.root && !this.busy && !this.loading);
    return v_flex().id("changes").size_full().min_h(0).overflow_hidden().bg(t.background)
      .when(!this.embedded, el => el.rounded(10).border_1().border_color(t.border))
      .text_color(t.foreground).text_size(13).track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape" && this.typing) { this.typing = false; this.handle.focus(); cx.stop_propagation(); cx.notify(); }
      })
      .when(!this.embedded, el => el.child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Changes"))
        .child(div().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(`${this.files.length} files`))
        .child(div().flex_1()).child(div().text_size(11).text_color(t.ansi2).child(`+${add}`)).child(div().text_size(11).text_color(t.ansi1).child(`−${del}`))
        .child(moveToPaneButton("changes", { message: this.message, context: this.context }, t))))
      // Keep flex sizing on the panel child; the scroll region fills its bounds.
      .child(div().flex_1().min_h(0).relative()
        .child(v_flex().id("changes-list").absolute().inset_0().overflow_y_scroll().p(6).children(this.files.map((f, i) => {
        const parts = f.path.split("/"), name = parts.pop();
        return h_flex().id(`change-${f.path}`).h(28).flex_none().px(8).gap(8).items_center().rounded(7).cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => this.view(i))
          .child(div().w(14).text_size(11).text_color(statusColor(f.status, t)).child(f.status))
          .child(fileIcon(f.path, {}, t))
          .child(h_flex().flex_1().min_w(0).child(div().text_color(t.muted).truncate().child(parts.length ? parts.join("/") + "/" : "")).child(div().max_w(260).min_w(0).truncate().child(name)))
          .when(f.add > 0, (e) => e.child(div().text_size(11).text_color(t.ansi2).child(`+${f.add}`))).when(f.del > 0, (e) => e.child(div().text_size(11).text_color(t.ansi1).child(`−${f.del}`)));
      })).when(!this.files.length, (e) => e.child(div().p(8).text_color(t.muted).child(this.error || (this.loading ? "Loading changes…" : this.root ? "No uncommitted changes" : "No folder")))))
        .child(Scrollbar.vertical("changes-list").absolute().inset_0()))
      .when(this.limited, el => el.child(div().px(12).py(4).text_size(11).text_color(t.muted).child("Showing the first 1,000 changed files")))
      .when(Boolean(this.note), (e) => e.child(div().px(10).pb(8).text_size(11).text_color(t.ansi1).child(this.note)))
      .when(Boolean(this.sync) && shared("features")?.syncBar !== false, el => el.child(this.syncBar(t)))
      .when(shared("features")?.commitBox !== false, el => el.child(h_flex().flex_none().p(10).gap(8).border_t(1).border_color(t.border)
        .child(div().id("commit-message").flex_1().min_w(0).h(32).px(10).flex().items_center().rounded(8).border_1().border_color(this.typing ? t.accent : t.border).cursor_text().on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.input).h_full().text_size(12).text_color(t.foreground)))
        .child(div().id("commit").h(32).px(14).flex().items_center().rounded(8).bg(enabled ? t.solid : t.raised).text_color(enabled ? t.solid_foreground : t.dim).text_size(12).when(enabled, (e) => e.cursor_pointer()).on_click((_e, cx) => this.commit(cx)).child(this.busy ? "Committing…" : "Commit"))));
  }
}
