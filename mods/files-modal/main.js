// A lazy file browser for the focused pane's folder, with bounded read-only previews.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Button, Editor, EditorState } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, settings, window, props, openOverlay, closeOverlay, run, keys } from "herdr";
import { track } from "./usage.js";
import { iconsReady, fileIcon } from "./icons.js";
import { moveToPaneButton, bindMoveCommand } from "./panel-actions.js";
import { isImage, stageImage, imageView } from "./images.js";
import { Motions, target, viewTop, lineStarts, lineAt } from "./vim.js";

// The panels share data in one VM, but their host tasks belong to separate copies.
const scans = globalThis[Symbol.for("herdr.repoStatus.v2")] ??= new Map();

async function repoStatus(root, on, { after, visiting, urgent, allowInactive }, cx, current) {
  const repo = JSON.stringify([on, root]), now = Date.now();
  for (const [key, scan] of scans) {
    if (scan.pollAt <= now || (!scan.pollAt && scan.task.is_done())) scans.delete(key);
  }
  while (current()) {
    let scan = scans.get(repo);
    const pending = scan && !scan.pollAt && !scan.task.is_done();
    const reusable = scan?.status?.code === 0 && Date.now() < scan.pollAt
      && (scan.started >= after || (!urgent && Date.now() < scan.watchAt));
    if (!reusable && (!pending || (visiting && scan.started !== undefined && scan.started < after))) {
      if (!allowInactive && window()?.active === false) return null;
      const next = {};
      next.task = cx.spawn(async cx => {
        await cx.sleep(25); // Let both listeners for a watch batch join before starting Git.
        if (!allowInactive && window()?.active === false) return;
        next.started = Date.now();
        try {
          next.status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd: root, on });
        } catch (error) {
          next.error = error;
        } finally {
          const finished = Date.now(), duration = finished - next.started;
          const delay = duration < 500 ? 0 : Math.min(60000, 5 * duration);
          next.watchAt = finished + delay;
          next.pollAt = finished + Math.max(10000, delay);
          if (next.status?.code !== 0 && scans.get(repo) === next) scans.delete(repo);
        }
      });
      scans.set(repo, next);
      scan = next;
    }
    // Resume through our own host task, so another copy's close cannot cancel our follow-up work.
    while (current() && !scan.pollAt && !scan.task.is_done()) await cx.sleep(50);
    if (!current()) return null;
    if (!scan.pollAt) continue; // The scanning copy closed or reloaded.
    return scan;
  }
  return null;
}

function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  const tab = space?.tabs.find(t => t.active)?.id;
  const fallback = panes().find(p => p.tab === tab && p.cwd)?.cwd;
  return { cwd: pane?.cwd || f?.cwd || fallback || space?.folder, on, space: space?.id };
}
const key = () => JSON.stringify(location());
const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };
const PER_FOLDER = 500, TOTAL = 5000;
const lineHeight = (size) => size * 1.6;
const SYMBOL = { ctrl: "⌃", alt: "⌥", shift: "⇧", cmd: "⌘" }, ORDER = Object.keys(SYMBOL);

function findFileLabel() {
  const k = keys().find(b => b.action === "mod.open:find-file");
  const parts = k?.keys.split("-").sort((a, b) => (ORDER.indexOf(a) + 1 || 9) - (ORDER.indexOf(b) + 1 || 9));
  return parts ? `Find file  ${parts.map(p => SYMBOL[p] ?? p.toUpperCase()).join("")}` : "Find file";
}

async function directory(path, on) {
  const windowsDirectory = async () => {
    // Windows PowerShell otherwise uses the console code page; exec decodes UTF-8.
    // Links keep directory attributes even when dangling; check their target.
    // Other reparse points (OneDrive's folders) have no LinkType and are folders.
    // PowerShell reads curly single quotes as quotes too, so they're doubled like '.
    const r = await exec("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & { param($p) @(Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and (-not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or -not $_.LinkType -or ($_.Target -and [IO.Directory]::Exists(([IO.Path]::Combine([IO.Path]::GetDirectoryName($_.FullName), $_.Target[0])))))) } }) | ConvertTo-Json -Compress } '" + path.replace(/['‘’‚‛]/g, "$&$&") + "'"], { on });
    if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
    const result = JSON.parse(r.stdout || "[]");
    return Array.isArray(result) ? result : [result];
  };
  if (!on && window()?.platform === "windows") return windowsDirectory();
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  let r;
  try { r = await exec("sh", ["-c", script, "files", path], { on }); }
  catch (e) {
    if (on && String(e).includes("cannot start sh: program not found")) return windowsDirectory();
    throw e;
  }
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}

export default class Files extends View {
  init(_props, cx) {
    bindMoveCommand(this, "files", cx, () => this.paneState());
    this.handle = cx.focus_handle();
    cx.spawn(async (cx) => { await iconsReady; cx.notify(); });
    if (props()?.overlay) return this.initViewer(props(), cx);
    this.saved = new Map();
    this.moveState = props()?.panelState ?? null;
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set(); this.marks = {};
    this.refresh(cx);
    cx.timer.every(500, cx => this.refreshIfDue(cx));
  }

  refreshIfDue(cx) {
    const active = window()?.active !== false, context = this.context;
    const refocused = active && this.windowActive === false;
    this.windowActive = active;
    if (!context) return;
    if (refocused && (context.dirtyAt || !context.watch)) context.catchUp = true;
    if (!active || this.loading) return;
    const now = Date.now();
    if (context.catchUp || (context.dirtyAt && now >= context.watchAt) || now >= context.pollAt) this.refresh(cx);
  }

  watch(root, context, cx) {
    if (context.on || context.watch?.root === root) return;
    context.watch?.pending?.cancel();
    const watch = { root };
    context.watch = watch;
    cx.spawn(async cx => {
      try {
        while (this.context === context && context.watch === watch) {
          watch.pending = watchFolder(root);
          const paths = await watch.pending;
          if (paths.length && context.watch === watch && this.current(context)) {
            context.dirtyAt = Date.now() + 1;
            this.refreshIfDue(cx);
          }
        }
      } catch {
        if (context.watch === watch) context.watch = null;
      }
    });
  }

  current(context) {
    return this.context === context && key() === context.key;
  }

  async loadFolder(path, context) {
    const { on, cwd: root } = context;
    const entries = await directory(path ? `${root}/${path}` : root, on);
    if (!this.current(context) || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    this.entries.set(path, entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used))).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  refresh(cx) {
    const { cwd, on } = location(), next = key();
    const visiting = next !== this.context?.key;
    if (visiting) {
      if (this.context) {
        this.saved.set(this.context.key, { folders: this.folders });
        this.context.watch?.pending?.cancel();
      }
      const moved = this.moveState && this.moveState.root === cwd && (this.moveState.on ?? null) === (on ?? null) ? this.moveState : null;
      const saved = this.saved.get(next) ?? moved;
      this.moveState = null;
      this.context = { key: next, cwd, on, dirtyAt: 0 }; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set(saved?.folders);
      this.pending = new Set(); this.marks = {}; this.error = null; this.limited = false;
      this.loading = false;
    }
    const context = this.context;
    const now = Date.now();
    if (!cwd) {
      context.catchUp = false;
      context.dirtyAt = 0;
      context.pollAt = now + 10000;
      return;
    }
    if (this.loading) return;
    if (context.catchUp && !context.dirtyAt) context.dirtyAt = now + 1;
    const request = {
      after: visiting ? now + 1 : context.dirtyAt || (context.lastStatus ?? -1) + 1,
      visiting,
      urgent: visiting || context.catchUp,
      allowInactive: visiting,
    };
    context.catchUp = false;
    context.pollAt = context.watchAt = now + 10000;
    this.loading = true;
    this.limited = false;
    cx.spawn(async cx => {
      try {
        this.watch(cwd, context, cx);
        const dirtyAtListing = context.dirtyAt;
        for (const path of ["", ...this.folders]) {
          if (!this.current(context)) return;
          await this.loadFolder(path, context);
        }
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
        if (!this.current(context)) return;
        const marks = {};
        let covered = dirtyAtListing;
        if (top?.code === 0) {
          const root = top.stdout.trim();
          const scan = await repoStatus(root, on, request, cx, () => this.context === context);
          if (!scan || !this.current(context)) return;
          const { status, started, pollAt, watchAt } = scan;
          context.lastStatus = started;
          context.pollAt = pollAt;
          context.watchAt = watchAt;
          covered = Math.min(dirtyAtListing, started);
          if (request.urgent && request.after > started) context.catchUp = true;
          if (status?.code === 0) for (const entry of status.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) {
            const xy = entry.slice(0, 2);
            marks[`${root}/${entry.slice(3)}`] = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
          }
        } else {
          context.watchAt = Date.now();
        }
        if (!this.current(context)) return;
        if (context.dirtyAt <= covered) context.dirtyAt = 0;
        this.marks = marks; this.error = null;
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally {
        if (this.context === context) this.loading = false;
        cx.notify();
      }
    });
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path + "/")) {
        this.folders.delete(folder);
        this.entries.delete(folder);
      }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const context = this.context;
        this.pending.add(path);
        cx.spawn(async cx => {
          try { await this.loadFolder(path, context); }
          catch (e) { if (this.current(context)) this.error = String(e); }
          finally { if (this.context === context) this.pending.delete(path); cx.notify(); }
        });
      }
    }
    cx.notify();
  }

  collapseAll(cx) {
    this.folders.clear();
    for (const path of this.entries.keys()) if (path) this.entries.delete(path);
    cx.notify();
  }

  visibleFiles(prefix = "", out = []) {
    for (const entry of this.entries.get(prefix) ?? []) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (!entry.dir) out.push(path);
      else if (this.folders.has(path)) this.visibleFiles(path, out);
    }
    return out;
  }

  view(path) {
    const files = this.visibleFiles();
    openOverlay({
      mod: "files-modal", kind: "dialog", width: 0.9, height: 0.9,
      props: { root: this.root, on: this.on ?? null, files, index: Math.max(0, files.indexOf(path)), marks: this.marks },
    });
  }

  initViewer(p, cx) {
    track("files", "view");
    this.files = p.files ?? []; this.index = p.index ?? 0; this.vim = new Motions(); this.codeHeight = 0;
    this.handle.focus();
    cx.timer.after(300, () => this.handle.focus());
    this.show(this.index, cx);
  }

  show(index, cx) {
    if (index < 0 || index >= this.files.length) return;
    this.code?.release(); this.code = null; this.fileError = null; this.picture = undefined; this.index = index;
    this.line = 0; this.col = 0; this.top = 0; this.placed = 0; this.starts = [0];
    const { root, on } = props(), path = this.files[index];
    if (isImage(path)) {
      if (on) { this.fileError = "Image previews only work for local folders"; cx.notify(); return; }
      cx.spawn(async cx => {
        const pic = await stageImage(root, path).catch(() => null);
        if (this.index === index) { this.picture = pic; cx.notify(); }
      });
      return cx.notify();
    }
    cx.spawn(async cx => {
      try {
        const text = await readTextFile(`${root}/${path}`, { on });
        if (this.index !== index) return;
        if (text === null) { this.fileError = "This file is no longer available"; return; }
        if (text.includes("\0")) { this.fileError = "Binary file · no text preview"; return; }
        const t = theme(), ext = path.includes(".") ? path.split(".").pop() : "txt";
        this.code = EditorState.new({ language: LANG[ext] ?? ext, readonly: true,
          value: text.length > 400000 ? text.slice(0, 400000) + "\n… (file truncated)" : text,
          syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.muted, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } });
        const value = this.code.value();
        this.starts = lineStarts(value); this.length = value.length;
      } catch { if (this.index === index) this.fileError = "Cannot preview this file (binary, too large, or unreadable)"; }
      finally { cx.notify(); }
    });
    cx.notify();
  }

  go({ motion, count }, cx) {
    const total = this.starts.length, page = Math.floor(this.codeHeight / (lineHeight(settings().font_size) * (Number(settings().zoom) || 1))) || 30, caret = this.code.selected_range().end;
    if (caret !== this.placed) {
      this.line = lineAt(this.starts, caret); this.col = caret - this.starts[this.line];
      if (this.line < this.top || this.line >= this.top + page) this.top = Math.max(0, this.line - Math.floor(page / 2));
    }
    const at = this.line, top = this.top, to = target(motion, count, at, total, page), next = viewTop(motion, at, to, top, page, total, 0);
    const own = to < top ? to : to > top + page - 1 ? to - page + 1 : top;
    this.line = to; this.top = next;
    // The editor scrolls only as far as shows the caret, and only for the caret it has when it draws:
    // to scroll further, show the row the view should reach first and move the caret a frame later.
    if (next !== own) {
      const code = this.code;
      this.place(next > top ? Math.min(total - 1, next + page - 1) : next);
      cx.spawn(async (cx) => {
        await cx.sleep(40);
        if (this.code === code && this.line === to) { this.place(to); cx.notify(); }
      });
    } else this.place(to);
    cx.notify();
  }

  place(line) {
    const end = line + 1 < this.starts.length ? this.starts[line + 1] - 1 : this.length;
    this.placed = Math.min(this.starts[line] + this.col, end);
    this.code.set_selected_range({ start: this.placed, end: this.placed });
  }

  button(id, label, on, t, name) {
    return div().id(id).when(Boolean(name), e => e.tooltip(name).accessibility_label(name)).h(26).px(10).flex().items_center().rounded(6).cursor_pointer().text_size(12)
      .bg(t.background).border_1().border_color(t.border).hover(s => s.bg(t.hover))
      .on_click((_e, cx) => on(cx)).child(label);
  }

  renderViewer() {
    const t = theme(), p = props(), path = this.files[this.index], font = settings();
    if (!path) return div().size_full().bg(t.background);
    const parts = path.split("/"), name = parts.pop(), mark = p.marks?.[`${p.root}/${path}`];
    const step = (d, cx) => this.show(this.index + d, cx);
    return v_flex().id("files-viewer").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13).track_focus(this.handle)
      .on_key_down((e, cx) => {
        const motion = this.code ? this.vim.read(e) : null;
        if (motion?.motion) this.go(motion, cx);
        else if (motion) cx.notify();
        else if (["down", "right"].includes(e.key)) step(1, cx);
        else if (["up", "left"].includes(e.key)) step(-1, cx);
        else if (e.key === "escape") closeOverlay(p.overlay);
        else return;
        cx.stop_propagation();
      })
      .child(h_flex().h(48).flex_none().px(16).gap(10).items_center().border_b(1).border_color(t.border)
        .child(fileIcon(path, {}, t))
        .child(h_flex().min_w(0).child(div().text_color(t.muted).truncate().child(parts.length ? parts.join("/") + "/" : "")).child(div().font_semibold().flex_none().child(name)))
        .when(Boolean(mark), el => el.child(div().text_size(12).text_color(mark === "A" ? t.ansi2 : mark === "D" || mark === "U" ? t.ansi1 : t.blocked).child(mark)))
        .child(div().flex_1())
        .child(this.button("fm-prev", "↑", cx => step(-1, cx), t, "Previous file"))
        .child(div().text_size(12).text_color(t.muted).child(`${this.index + 1} / ${this.files.length}`))
        .child(this.button("fm-next", "↓", cx => step(1, cx), t, "Next file"))
        .child(div().w(8))
        .child(this.button("fm-close", "✕", () => closeOverlay(p.overlay), t, "Close")))
      .child(this.picture !== undefined ? imageView(this.picture, t) : this.code
        ? div().id("files-code").flex_1().min_h(0).on_size_change((size) => { this.codeHeight = size.height; }).child(Editor.new(this.code).font_family(font.font_family).text_size(font.font_size).size_full())
        : div().flex_1().p(16).text_color(t.muted).child(this.fileError || "Loading file…"))
      .child(h_flex().h(28).flex_none().px(16).gap(16).items_center().border_t(1).border_color(t.border).text_size(11).text_color(t.muted)
        .child("↑ ↓ file (before clicking into the text)")
        .when(Boolean(this.code), (e) => e.child("j k line, 10j").child("⌃D ⌃U half page").child("gg G top, bottom"))
        .child("Esc close")
        .child(div().flex_1())
        .when(Boolean(this.vim.typed), (e) => e.child(div().text_color(t.foreground).child(this.vim.typed)))
        .when(Boolean(this.code), (e) => e.child(`Ln ${this.line + 1} / ${this.starts.length}`)));
  }

  rows(prefix, depth, out, t) {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name, open = this.folders.has(path), mark = this.marks[`${this.root}/${path}`];
      out.push(h_flex().id(`file-${path}`).h(28).flex_none().pl(8 + depth * 18).pr(8).gap(7).items_center().rounded(7).cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => entry.dir ? this.toggle(path, cx) : this.view(path))
        .child(entry.dir ? svg(`mods/files-modal/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.muted) : div().w(12).flex_none())
        .child(fileIcon(path, { dir: entry.dir, open }, t))
        .child(div().flex_1().min_w(0).truncate().child(entry.name))
        .when(Boolean(mark), el => el.child(div().text_size(11).text_color(mark === "A" ? t.ansi2 : mark === "D" || mark === "U" ? t.ansi1 : t.blocked).child(mark))));
      if (entry.dir && open) this.rows(path, depth + 1, out, t);
    }
    return out;
  }

  paneState() {
    return { folders: [...this.folders], root: this.root, on: this.on ?? null };
  }

  render(cx) {
    if (props()?.overlay) return this.renderViewer();
    if (key() !== this.context?.key) this.refresh(cx);
    else this.refreshIfDue(cx);
    const t = theme();
    return v_flex().id("files").size_full().min_h(0).overflow_hidden().bg(t.background)
      .when(!this.embedded, el => el.rounded(10).border_1().border_color(t.border))
      .when(Boolean(this.embedded), el => el.track_focus(this.handle))
      .text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .when(!this.embedded, el => el.child(div().font_semibold().child("Files")))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.muted).child(this.root?.split(/[\\/]/).pop() ?? ""))
        .child(Button.new("files-find").size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.muted)
          .tooltip(findFileLabel()).accessibility_label("Find file").cursor_pointer().hover(s => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => run("mod.open", { name: "find-file" }))
          .child(svg("mods/find-file/search.svg").size(16)))
        .child(Button.new("files-collapse-all").size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.muted)
          .disabled(this.folders.size === 0).opacity(this.folders.size ? 1 : 0.4)
          .tooltip("Collapse all folders").accessibility_label("Collapse all folders")
          .when(this.folders.size > 0, el => el.cursor_pointer().hover(s => s.bg(t.hover).text_color(t.foreground)))
          .on_click((_e, cx) => this.collapseAll(cx))
          .child(svg("mods/files-modal/collapse-all.svg").size(16)))
        .when(!this.embedded, el => el.child(moveToPaneButton("files", this.paneState(), t))))
      .child(v_flex().id("files-tree").flex_1().min_h(0).overflow_y_scrollbar().p(6).children(this.rows("", 0, [], t))
        .when(Boolean(this.error) || !this.entries.get("")?.length, el => el.child(div().p(8).text_size(12).text_color(t.muted).child(this.error || (this.loading ? "Loading files…" : this.root ? "No files" : "No folder"))))
        .when(this.limited, el => el.child(div().p(8).text_size(11).text_color(t.muted).child("File list limited to 500 entries per folder and 5,000 total"))));
  }
}
