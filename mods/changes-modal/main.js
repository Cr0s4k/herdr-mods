import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea, Scrollbar, v_virtual_list, VirtualListScrollHandle } from "gpui-base";
import { spaces, panes, focused, agents, exec, hc, appHome, readTextFile, watchFolder, theme, settings, window, props, openOverlay, closeOverlay, shared, setShared } from "herdr";
import { iconsReady, fileIcon, light } from "./icons.js";
import { moveToPaneButton, bindMoveCommand } from "./panel-actions.js";
import { isImage, stageImage, imageCompare } from "./images.js";
import { branchState, remoteGit } from "./sync.js";
import { History, commitHeader } from "./history.js";
import { Motions, target, viewTop, changeStarts } from "./vim.js";
import { NOTES, scopeOf, anchorOf, notesOf, counts, saveNote, dropNotes, withNotes, rangeOf, linesOf, noteList, countLabel, targets } from "./notes.js";
import { loadProcedures, procedure } from "./procedures.js";

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
const wideGlyph = /[\p{Ideographic}\p{Emoji_Presentation}\p{Extended_Pictographic}\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\ufe10-\ufe19\ufe30-\ufe6f\uff01-\uff60\uffe0-\uffe6]/gu;

// Keep room for spacing marks and give wide glyphs at least two columns.
function displayColumns(text) {
  let columns = text.length;
  for (const glyph of text.match(wideGlyph) ?? []) {
    if (glyph.length === 1) columns++;
  }
  return columns;
}

// The diff was laid out for 11px text: 20px rows, 7px characters.
const rowHeight = size => Math.ceil(size * 1.8), charWidth = size => size * 0.64;

// Text draws a tab as nothing: pad each to the next 4-column stop.
const untab = (text) => text.replace(/[^\t]*\t/g, (s) => s.slice(0, -1).padEnd((s.length - 1) - (s.length - 1) % 4 + 4));

// Numbers each diff line once, so a frame only draws the rows on screen.
function diffRows(lines) {
  let old = 0, next = 0;
  return lines.map((line) => {
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (match) { old = +match[1]; next = +match[2]; return { kind: "@", text: line }; }
    const kind = line[0];
    if (kind === "-") return { kind, number: old++, text: untab(line.slice(1)) || " " };
    if (kind === "+") return { kind, number: next++, text: untab(line.slice(1)) || " " };
    if (kind === " ") { old++; return { kind, number: next++, text: untab(line.slice(1)) || " " }; }
    return { kind: "", text: line };
  });
}

const SPLIT = "changes-modal.split";
const ASIDE = 260;

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

const bat = () => `b=$(command -v bat || command -v batcat) || exit 9; COLORTERM=truecolor "$b" --color=always --style=plain --paging=never --theme="${light() ? "Catppuccin Latte" : "Catppuccin Mocha"}" --tabs=4`;

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

async function highlighted({ root, on, hasHead, base, head }, file) {
  const run = async (script, args) => {
    const r = await exec("sh", ["-c", script, "sh", ...args], { cwd: root, on }).catch(() => null);
    return r?.code === 0 && r.stdout.length < 2000000 ? parseAnsi(r.stdout) : null;
  };
  const [old, now] = await Promise.all([
    hasHead && !file.fresh && file.status !== "A" ? run(`git show "$2:$1" | { ${bat()} --file-name "$1"; }`, [file.path, base ?? "HEAD"]) : null,
    file.status === "D" ? null : head ? run(`git show "$2:$1" | { ${bat()} --file-name "$1"; }`, [file.path, head]) : run(`${bat()} -- "$1"`, [file.path]),
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
    bindMoveCommand(this, "changes", cx, () => ({ message: this.message, context: this.context?.key, tab: this.tab }));
    this.files = []; this.rows = []; this.longest = 0; this.gutterChars = 4; this.message = ""; this.handle = cx.focus_handle();
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
    this.tab = "changes";
    if (props()?.panelState?.tab === "history") this.select("history", cx);
    this.refresh(cx);
    const draft = props()?.panelState;
    if (draft?.message && (!draft.context || draft.context === this.context?.key)) {
      this.message = draft.message;
      this.input.set_value(this.message);
    }
    cx.timer.every(500, cx => this.refreshIfDue(cx));
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
      } catch (e) { if (this.current(context)) this.note = `${label} failed: ${e.message ?? e}`; }
      finally { this.syncing = null; this.refresh(cx, true); cx.notify(); }
    });
    cx.notify();
  }

  syncBar(t) {
    const s = this.sync, busy = Boolean(this.syncing || this.busy);
    const action = (id, label, args, name) => div().id(id).h(24).px(8).flex().items_center().rounded(6).text_size(11)
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
      .when(!this.syncing && Boolean(s.upstream) && !s.gone, (e) => e.child(div().id("sync-fetch").size(24).tooltip("Check the remote for new commits").accessibility_label("Check the remote for new commits").flex().items_center().justify_center().rounded(6).text_color(t.muted)
        .when(!this.fetching, (e) => e.cursor_pointer().hover((st) => st.bg(t.hover)).on_click((_e, cx) => { this.fetch(cx); cx.notify(); }))
        .child("↻")));
  }

  refreshIfDue(cx) {
    const active = window()?.active !== false, context = this.context;
    const refocused = active && this.windowActive === false;
    this.windowActive = active;
    if (!context) return;
    if (refocused && (context.dirtyAt || !context.watch)) context.catchUp = true;
    if (!active || this.loading || this.busy) return;
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

  // One visit to a folder: results from an earlier visit to the same folder are stale too.
  current(context) {
    return this.context === context && key() === context.key;
  }

  refresh(cx, force = false) {
    const { cwd, on } = location(), next = key();
    const visiting = next !== this.context?.key;
    if (visiting) {
      this.context?.watch?.pending?.cancel();
      this.context = { key: next, on, dirtyAt: 0 }; this.root = null; this.sync = null; this.files = []; this.open = null;
      this.setLines([]); this.message = ""; this.input.set_value(""); this.error = null; this.note = null; this.closed = false; this.limited = false;
      this.loading = false;
      this.history?.reset();
    }
    // A load left behind in another folder (a slow git, a read that never ends) must not hold this one.
    const context = this.context;
    const now = Date.now();
    if (!cwd) {
      context.catchUp = false;
      context.dirtyAt = 0;
      context.pollAt = now + 10000;
      return;
    }
    if (this.loading || this.busy) return;
    if (force || (context.catchUp && !context.dirtyAt)) context.dirtyAt = now + 1;
    const request = {
      after: visiting ? now + 1 : context.dirtyAt || (context.lastStatus ?? -1) + 1,
      visiting,
      urgent: force || visiting || context.catchUp,
      allowInactive: force || visiting,
    };
    context.catchUp = false;
    context.pollAt = context.watchAt = now + 10000;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
        if (!this.current(context)) return;
        if (top.code !== 0) { this.root = null; this.sync = null; this.files = []; this.setLines([]); this.open = null; this.error = "Not a git repository"; return; }
        const root = top.stdout.trim(), git = (args) => exec("git", [...READ, ...args], { cwd: root, on });
        this.watch(root, context, cx);
        const scan = await repoStatus(root, on, request, cx, () => this.context === context);
        if (!scan || !this.current(context)) return;
        const { status, started, pollAt, watchAt } = scan;
        context.lastStatus = started;
        context.pollAt = pollAt;
        context.watchAt = watchAt;
        // A failed scan still answers the edit that asked for it: retrying at once would spin.
        if (context.dirtyAt <= started) context.dirtyAt = 0;
        if (scan.error) throw scan.error;
        if (status.code !== 0) throw new Error(status.stderr);
        if (request.urgent && request.after > started) context.catchUp = true;
        const entries = status.stdout.split("\0").filter(Boolean), shown = entries.slice(0, 1000);
        const tracked = shown.some(entry => !entry.startsWith("??"));
        const hasHead = tracked && (await git(["rev-parse", "--verify", "HEAD"])).code === 0;
        const stats = {};
        const results = !tracked ? [] : hasHead ? [await git(["diff", "HEAD", "--numstat", "-z", "--no-renames"])] : [await git(["diff", "--cached", "--numstat", "-z", "--no-renames"]), await git(["diff", "--numstat", "-z", "--no-renames"])];
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
        const sync = await branchState(git);
        for (const entry of shown) {
          const xy = entry.slice(0, 2), path = entry.slice(3), fresh = xy === "??";
          const conflict = xy.includes("U") || xy === "AA" || xy === "DD";
          const s = conflict ? "U" : xy.includes("D") ? "D" : fresh || xy.includes("A") ? "A" : "M";
          const stat = stats[path] ?? { add: 0, del: 0 };
          files.push({ path, status: s, fresh, ...stat });
        }
        if (!this.current(context)) return;
        this.root = root; this.on = on; this.sync = sync; this.hasHead = hasHead; this.files = files; this.limited = entries.length > 1000; this.error = null;
        if (this.fetchedRoot !== root) this.fetch(cx);
        if (this.tab === "history") this.history.load(cx);
        if (this.open && !files.some((f) => f.path === this.open)) { this.open = null; this.setLines([]); }
        if (this.open) {
          try { await this.load(this.open, context); }
          catch { if (this.current(context)) this.setLines(["Cannot preview this diff (too large or unreadable)"]); }
        }
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally {
        if (this.context === context) this.loading = false;
        cx.notify();
      }
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
      const r = await exec("git", [...READ, "diff", ...(this.hasHead ? [this.base ?? "HEAD"] : []), ...(this.head ? [this.head] : []), "--no-ext-diff", "--no-textconv", "--no-color", "--", path], { cwd: root, on });
      if (r.code !== 0) throw new Error(r.stderr);
      const all = r.stdout.replace(/\n$/, "").split("\n"), first = all.findIndex((l) => l.startsWith("@@"));
      lines = first < 0 ? [file.binary ? "Binary file changed" : "No text diff available"] : all.slice(first);
    }
    if (this.current(context) && this.open === path) this.setLines(lines.slice(0, 5000).map(line => line.length > 4000 ? line.slice(0, 4000) + "… (line truncated)" : line));
  }

  setLines(lines) {
    this.rows = diffRows(lines);
    this.longest = Math.max(0, ...this.rows.map(row => displayColumns(row.text)));
    this.gutterChars = Math.max(4, String(Math.max(0, ...this.rows.map(row => row.number ?? 0))).length);
  }

  pick(path, cx) {
    this.open = this.open === path ? null : path; this.setLines([]); this.note = null;
    this.closed = !this.open;
    const context = this.context;
    if (this.open) cx.spawn(async (cx) => {
      try { await this.load(path, context); }
      catch (e) { if (this.current(context) && this.open === path) this.note = `Cannot preview this diff (too large or unreadable): ${e}`; }
      cx.notify();
    });
    cx.notify();
  }

  commit(cx) {
    if (!this.message.trim() || !this.root || this.busy || this.loading || this.context?.key !== key()) return;
    const root = this.root, on = this.on, context = this.context, message = this.message.trim();
    this.busy = true; this.note = null;
    cx.spawn(async (cx) => {
      try {
        for (const args of [["add", "-A"], ["commit", "-m", message]]) {
          const r = await exec("git", args, { cwd: root, on });
          if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
        }
        if (this.current(context)) { this.message = ""; this.input.set_value(""); }
      } catch (e) { if (this.current(context)) this.note = `Commit failed: ${e}`; }
      finally { this.busy = false; this.refresh(cx, true); cx.notify(); }
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
    this.files = p.files ?? []; this.root = p.root; this.on = p.on; this.hasHead = p.hasHead; this.base = p.base ?? null; this.head = p.head ?? null; this.commit = p.commit ?? null; this.index = p.index ?? 0;
    this.vim = new Motions(); this.scroll = VirtualListScrollHandle.new(); this.fileScroll = VirtualListScrollHandle.new(); this.bodyHeight = 0;
    this.handle.focus();
    cx.timer.after(300, () => this.handle.focus());
    this.scope = scopeOf(this.base, this.head);
    this.noteInput = TextareaState.new({ placeholder: "What should the agent change here?", rows: 1 });
    this.noteInput.set_auto_grow(1, 8);
    this.noteInput.on("submit", (_e, cx) => this.keepNote(cx));
    this.show(this.index, cx);
  }

  fileNotes() {
    return this.loadingDiff || this.pictures ? [] : notesOf(shared(NOTES), this.root, this.on, this.scope, this.open);
  }

  shown(split) {
    if (split && !this.split) this.split = splitRows(this.rows);
    const base = split ? this.split : this.rows, notes = this.fileNotes(), sig = JSON.stringify(notes);
    if (this.drawn?.base !== base || this.drawn.sig !== sig) this.drawn = { base, sig, rows: withNotes(base, notes) };
    return this.drawn.rows;
  }

  noteOn(row) {
    if (row?.kind === "note") return row.note;
    const a = anchorOf(row);
    return a ? this.fileNotes().find((n) => n.side === a.side && n.line === a.line) ?? null : null;
  }

  // With lines picked (V), the note is on all of them; otherwise on the cursor's line, or the note already there.
  startNote(rows, cursor, cx) {
    const row = rows[cursor], picked = this.mark === null || this.mark === undefined ? null : rows.slice(Math.min(this.mark, cursor), Math.max(this.mark, cursor) + 1);
    const note = picked ? null : this.noteOn(row), a = note ?? (picked ? rangeOf(picked, row) : anchorOf(row));
    if (!a) return;
    this.noting = { side: a.side, line: a.line, code: a.code, ...(a.to ? { to: a.to, quote: a.quote } : {}) };
    this.mark = null; this.noteStatus = null; this.clearing = false;
    this.noteInput.set_value(note?.text ?? "");
    this.noteInput.focus();
    cx.notify();
  }

  endNote(cx) {
    this.noting = null;
    this.handle.focus();
    cx.notify();
  }

  writeNote(at, text) {
    setShared(NOTES, saveNote(shared(NOTES), this.root, this.on, { scope: this.scope, path: this.open, ...at, text }));
  }

  keepNote(cx) {
    if (this.noting) this.writeNote(this.noting, this.noteInput.value());
    this.endNote(cx);
  }

  removeNote(row, cx) {
    const note = this.noteOn(row);
    if (!note) return;
    this.writeNote({ side: note.side, line: note.line }, "");
    cx.notify();
  }

  noteTarget() {
    const list = targets(agents(), panes(), this.root, this.on, focused()?.terminal ?? null);
    return { list, agent: list.find((a) => a.address === this.picked) ?? list[0] ?? null };
  }

  // Sends every note of this checkout as one message, or copies that message when there is no agent to take it.
  deliver(copy, cx) {
    const root = this.root, on = this.on, notes = notesOf(shared(NOTES), root, on), agent = copy ? null : this.noteTarget().agent;
    if (!notes.length || this.delivering) return;
    this.clearing = false;
    if (!copy && !agent) { this.noteStatus = { text: "No agent is working in this folder. Copy the notes instead.", bad: true }; return cx.notify(); }
    this.delivering = true; this.noteStatus = { text: copy ? "Copying…" : `Sending to ${agent.program.name}…` };
    cx.spawn(async (cx) => {
      try {
        await loadProcedures((path) => readTextFile(`${appHome()}/${path}`));
        const text = procedure("review-notes", { count: countLabel(notes.length), notes: noteList(notes) });
        if (copy) cx.write_to_clipboard(text);
        else {
          const sent = await hc(["send", agent.address, text]);
          if (sent.code !== 0) throw new Error(`${agent.program.name} did not take the notes${agent.status === "blocked" ? ": it is waiting for an answer in its terminal" : ""}. They are kept here.`);
          setShared(NOTES, dropNotes(shared(NOTES), root, on, notes));
        }
        this.noteStatus = { text: copy ? `Copied ${countLabel(notes.length)}. They stay here until you clear them.` : `Sent ${countLabel(notes.length)} to ${agent.program.name}` };
      } catch (e) { this.noteStatus = { text: String(e?.message ?? e), bad: true }; }
      finally { this.delivering = false; cx.notify(); }
    });
    cx.notify();
  }

  clearNotes(cx) {
    if (this.clearing) { setShared(NOTES, dropNotes(shared(NOTES), this.root, this.on)); this.noteStatus = null; }
    this.clearing = !this.clearing;
    cx.notify();
  }

  noteRow({ note, part, text, lost }, t, here, size) {
    const label = lost ? `line ${note.line} left this diff` : note.to > note.line ? `note on ${linesOf(note)}` : "note";
    return h_flex().w_full().h(rowHeight(size)).flex_none().relative().gap(8).pl(this.margin(size) + 22).pr(12).items_center().bg(t.accent + "14")
      .when(here, (e) => e.child(this.cursorMark(t)))
      .child(div().flex_none().px(5).rounded(4).when(part === 0, (e) => e.bg(t.accent + "33")).text_color(part === 0 ? t.accent : t.accent + "00").child(label))
      .child(div().flex_1().min_w(0).truncate().child(text));
  }

  notesBar(total, t) {
    const { list, agent } = this.noteTarget(), status = this.noteStatus, busy = Boolean(this.delivering);
    const next = (cx) => { this.picked = list[(list.indexOf(agent) + 1) % list.length].address; cx.notify(); };
    return h_flex().h(40).flex_none().px(16).gap(8).items_center().border_b(1).border_color(t.border).bg(t.raised).text_size(12)
      .when(total > 0, (e) => e.child(div().flex_none().font_semibold().child(`${countLabel(total)} for the agent`)))
      .child(div().flex_1().min_w(0).truncate().text_color(status?.bad ? t.ansi1 : t.muted).child(status?.text ?? (total > 0 && !agent ? "No agent is working in this folder" : "")))
      .when(total > 0 && Boolean(agent), (e) => e
        .child(div().id("cm-notes-agent").flex_none().max_w(280).truncate().text_color(t.muted)
          .when(list.length > 1, (e) => e.cursor_pointer().tooltip("Send to another agent in this folder").on_click((_e, cx) => next(cx)))
          .child(`${list.length > 1 ? "⇄ " : ""}${agent?.program.name}${agent?.tab_name ? ` · ${agent.tab_name}` : ""}`))
        .child(this.button("cm-notes-send", busy ? "Sending…" : "Send  ⌘↵", (cx) => this.deliver(false, cx), true, t, "Send every note to this agent as one message")))
      .when(total > 0, (e) => e
        .child(this.button("cm-notes-copy", "Copy", (cx) => this.deliver(true, cx), false, t, "Copy the message instead of sending it"))
        .child(this.button("cm-notes-clear", this.clearing ? "Clear them all?" : "Clear", (cx) => this.clearNotes(cx), false, t, "Remove every note without sending")));
  }

  noteEditor(name, t) {
    const n = this.noting;
    return h_flex().flex_none().px(16).py(8).gap(10).items_start().border_t(1).border_color(t.border).text_size(12)
      .child(div().flex_none().h(30).flex().items_center().text_color(t.muted).child(`Note on ${name}:${linesOf(n)}${n.side === "old" ? " (removed)" : ""}`))
      .child(div().id("cm-note-input").flex_1().min_w(0).px(10).py(5).rounded(7).border_1().border_color(t.accent)
        .child(Textarea.new(this.noteInput).w_full().text_size(12).text_color(t.foreground)))
      .child(div().flex_none().h(30).flex().items_center().text_size(11).text_color(t.muted).child("↵ save   ⇧↵ new line   Esc cancel   empty removes"));
  }

  show(index, cx) {
    if (index < 0 || index >= this.files.length) return;
    const file = this.files[index], context = this.context = { key: key() };
    this.index = index; this.open = file.path; this.setLines([]); this.split = null; this.loadingDiff = true; this.pictures = null;
    if (this.noting) this.handle.focus();
    this.cursor = 0; this.top = 0; this.mark = null; this.noting = null; this.scroll.scroll_to_item(0); this.fileScroll.scroll_to_item(index);
    if (isImage(file.path) && !this.on) {
      cx.spawn(async (cx) => {
        const stage = (rev) => stageImage(this.root, file.path, rev).catch(() => null);
        const [before, after] = await Promise.all([
          this.hasHead && !file.fresh && file.status !== "A" ? stage(this.base ?? "HEAD") : undefined,
          file.status !== "D" ? stage(this.head ?? undefined) : undefined,
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

  cursorMark(t) {
    return div().absolute().inset_0().bg(t.accent + "1f").border_l(2).border_color(t.accent);
  }

  margin(size) { return Math.max(40, this.gutter(size)); }

  pickedMark(t) {
    return div().absolute().inset_0().bg(t.accent + "26");
  }

  row(r, t, here, size, picked = false) {
    if (r.kind === "note") return this.noteRow(r, t, here, size);
    const { kind, number, text, spans } = r;
    if (kind === "@") return div().w_full().px(12).h(rowHeight(size)).flex_none().relative().flex().items_center().truncate().bg(t.raised).text_color(t.muted)
      .when(here, (e) => e.child(this.cursorMark(t))).child(text);
    return h_flex().w_full().h(rowHeight(size)).flex_none().relative().gap(12).when(kind === "+", (e) => e.bg(t.ansi2 + "18")).when(kind === "-", (e) => e.bg(t.ansi1 + "18"))
      .when(picked, (e) => e.child(this.pickedMark(t)))
      .when(here, (e) => e.child(this.cursorMark(t)))
      .child(div().w(this.margin(size)).flex_none().text_right().text_color(here ? t.foreground : t.dim).child(number === undefined ? "" : String(number)))
      .child(div().w(10).flex_none().text_color(kind === "+" ? t.ansi2 : kind === "-" ? t.ansi1 : t.dim).child(kind === " " ? "" : kind))
      .child(this.code(text, spans, t));
  }

  half(side, t, here, size) {
    return h_flex().flex_1().min_w(0).h_full().gap(12).overflow_hidden()
      .when(!side, (e) => e.bg(t.raised + "80"))
      .when(side?.kind === "+", (e) => e.bg(t.ansi2 + "18")).when(side?.kind === "-", (e) => e.bg(t.ansi1 + "18"))
      .when(Boolean(side), (e) => e
        .child(div().w(this.margin(size)).flex_none().text_right().text_color(here ? t.foreground : t.dim).child(String(side.number)))
        .child(this.code(side.text, side.spans, t)));
  }

  splitRow(r, t, here, size, picked = false) {
    if (!("left" in r)) return this.row(r, t, here, size, picked);
    return h_flex().w_full().h(rowHeight(size)).flex_none().relative()
      .child(this.half(r.left, t, here, size))
      .child(div().w(1).h_full().flex_none().bg(t.border))
      .child(this.half(r.right, t, here, size))
      .when(picked, (e) => e.child(this.pickedMark(t)))
      .when(here, (e) => e.child(this.cursorMark(t)));
  }

  go({ motion, count }, rows, split, cx) {
    const total = rows.length, page = Math.floor(this.bodyHeight / (rowHeight(settings().font_size) * (Number(settings().zoom) || 1))) || 30;
    if (!total) return;
    const top = Math.min(this.top, total - 1), at = Math.max(top, Math.min(top + page, this.cursor));
    const changed = rows.map((r) => split ? r.left?.kind === "-" || r.right?.kind === "+" : r.kind === "-" || r.kind === "+");
    rows.forEach((r, i) => { if (r.kind === "note" && i) changed[i] = changed[i - 1]; });
    const to = target(motion, count, at, total, page, changeStarts(changed)), next = viewTop(motion, at, to, top, page, total);
    if (next > top) this.scroll.scroll_to_item(Math.min(total - 1, next + page - 1));
    else if (next < top) this.scroll.scroll_to_item(next);
    this.cursor = to; this.top = next;
    cx.notify();
  }

  setSplit(on, cx) {
    const r = this.shown(!on)[this.cursor], to = this.shown(on), line = r && "left" in r ? r.right ?? r.left : r;
    this.mark = null;
    const same = (s) => r.kind === "note" ? s.kind === "note" && s.note.side === r.note.side && s.note.line === r.note.line && s.part === r.part
      : on ? s === r || s.left === r || s.right === r : s === line;
    this.cursor = r ? Math.max(0, to.findIndex(same)) : 0;
    this.scroll.scroll_to_item(this.cursor);
    setShared(SPLIT, on);
    cx.notify();
  }

  fileRow(f, current, t, noted = 0) {
    const parts = f.path.split("/"), name = parts.pop();
    return h_flex().w_full().h(28).flex_none().px(10).gap(6).items_center().cursor_pointer().text_size(12)
      .when(current, (e) => e.bg(t.selected)).when(!current, (e) => e.hover((s) => s.bg(t.hover)))
      .child(div().w(12).flex_none().text_size(11).text_color(statusColor(f.status, t)).child(f.status))
      .child(fileIcon(f.path, {}, t))
      .child(div().min_w(0).truncate().when(current, (e) => e.font_semibold()).child(name))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.muted).child(parts.join("/")))
      .when(noted > 0, (e) => e.child(this.noteCount(noted, t)))
      .when(f.add > 0, (e) => e.child(div().flex_none().text_size(11).text_color(t.ansi2).child(`+${f.add}`)))
      .when(f.del > 0, (e) => e.child(div().flex_none().text_size(11).text_color(t.ansi1).child(`−${f.del}`)));
  }

  noteCount(n, t) {
    return div().flex_none().px(5).rounded(4).bg(t.accent + "33").text_size(11).text_color(t.accent).child(countLabel(n));
  }

  fileList(t) {
    const noted = counts(shared(NOTES), this.root, this.on, this.scope);
    return div().w(ASIDE).h_full().flex_none().relative().py(6).border_r(1).border_color(t.border)
      .child(v_virtual_list("changes-modal-files", this.files.length, 28, (i) => String(i),
        (range) => this.files.slice(range.start, range.end).map((f, k) => this.fileRow(f, range.start + k === this.index, t, noted[f.path])))
        .track_scroll(this.fileScroll).size_full().on_item_click((i, cx) => this.show(Number(i), cx)))
      .child(Scrollbar.vertical("changes-modal-files").viewport_from_layout().absolute().inset_0());
  }

  select(tab, cx) {
    this.tab = tab;
    if (tab === "history") { this.history ??= new History(this); this.history.load(cx); }
    cx.notify();
  }

  tabButton(id, label, count, t) {
    const on = this.tab === id;
    return h_flex().id(`git-tab-${id}`).h(26).px(9).gap(6).flex_none().items_center().rounded(6).cursor_pointer().text_size(12)
      .bg(on ? t.selected : t.background).text_color(on ? t.foreground : t.muted).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => this.select(id, cx)).child(label)
      .when(count !== null, (e) => e.child(div().text_size(11).text_color(t.muted).child(String(count))));
  }

  button(id, label, on, active, t, name) {
    return div().id(id).when(Boolean(name), (e) => e.tooltip(name).accessibility_label(name)).h(26).px(10).flex().items_center().rounded(6).cursor_pointer().text_size(12)
      .bg(active ? t.selected : t.background).border_1().border_color(t.border).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => on(cx)).child(label);
  }

  renderViewer(cx) {
    const t = theme(), file = this.files[this.index], split = shared(SPLIT) !== false;
    if (!file) return div().size_full().bg(t.background);
    const rows = this.shown(split), cursor = Math.min(this.cursor, Math.max(0, rows.length - 1));
    const total = notesOf(shared(NOTES), this.root, this.on).length, plain = (e) => !e.modifiers?.control && !e.modifiers?.platform && !e.modifiers?.alt;
    const parts = file.path.split("/"), name = parts.pop(), aside = this.files.length > 1;
    const step = (d, cx) => this.show(this.index + d, cx);
    return v_flex().id("changes-viewer").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13).track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (this.noting) {
          if (e.key === "escape") this.endNote(cx);
          else if (e.key === "enter" && e.modifiers?.shift) { this.noteInput.replace("\n"); cx.notify(); }
          else if (e.key === "enter") this.keepNote(cx);
          else return;
          return cx.stop_propagation();
        }
        const motion = this.pictures ? null : this.vim.read(e);
        if (motion?.motion) this.go(motion, rows, split, cx);
        else if (motion) cx.notify();
        else if (e.key === "enter" && e.modifiers?.platform) this.deliver(false, cx);
        else if (e.key === "c" && plain(e) && !this.pictures) this.startNote(rows, cursor, cx);
        else if (e.key === "v" && plain(e) && !this.pictures) { this.mark = this.mark === null || this.mark === undefined ? cursor : null; cx.notify(); }
        else if (e.key === "escape" && this.mark !== null && this.mark !== undefined) { this.mark = null; cx.notify(); }
        else if (e.key === "x" && plain(e) && !this.pictures) this.removeNote(rows[cursor], cx);
        else if (["down", "right"].includes(e.key)) step(1, cx);
        else if (["up", "left"].includes(e.key)) step(-1, cx);
        else if (e.key === "s" && !this.pictures) this.setSplit(!split, cx);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.stop_propagation();
      })
      .when(Boolean(this.commit), (e) => e.child(commitHeader(this.commit, t)))
      .child(h_flex().h(48).flex_none().px(16).gap(10).items_center().border_b(1).border_color(t.border)
        .child(div().w(14).text_size(12).text_color(statusColor(file.status, t)).child(file.status))
        .child(fileIcon(file.path, {}, t))
        .child(h_flex().min_w(0).child(div().text_color(t.muted).truncate().child(parts.length ? parts.join("/") + "/" : "")).child(div().font_semibold().flex_none().child(name)))
        .when(file.add > 0, (e) => e.child(div().text_size(12).text_color(t.ansi2).child(`+${file.add}`)))
        .when(file.del > 0, (e) => e.child(div().text_size(12).text_color(t.ansi1).child(`−${file.del}`)))
        .child(div().flex_1())
        .when(!this.pictures, (e) => e.child(h_flex().gap(4)
          .child(this.button("cm-unified", "Unified", (cx) => split && this.setSplit(false, cx), !split, t))
          .child(this.button("cm-split", "Split", (cx) => !split && this.setSplit(true, cx), split, t))))
        .child(div().w(8))
        .child(this.button("cm-prev", "↑", (cx) => step(-1, cx), false, t, "Previous file"))
        .child(div().text_size(12).text_color(t.muted).child(`${this.index + 1} / ${this.files.length}`))
        .child(this.button("cm-next", "↓", (cx) => step(1, cx), false, t, "Next file"))
        .child(div().w(8))
        .child(this.button("cm-close", "✕", () => closeOverlay(props().overlay), false, t, "Close")))
      .when(total > 0 || Boolean(this.noteStatus), (e) => e.child(this.notesBar(total, t)))
      .child(div().flex().flex_1().min_h(0)
        .when(aside, (e) => e.child(this.fileList(t)))
        .child(v_flex().flex_1().min_w(0).h_full()
          .when(Boolean(this.pictures), (e) => e.child(imageCompare(this.pictures.before, this.pictures.after, t, aside ? ASIDE : 0)))
          .when(!this.pictures, (e) => e.child(this.diff(rows, split, cursor, t)))))
      .when(Boolean(this.noting), (e) => e.child(this.noteEditor(name, t)))
      .child(h_flex().h(28).flex_none().px(16).gap(16).items_center().border_t(1).border_color(t.border).text_size(11).text_color(t.muted)
        .child("↑ ↓ file")
        .when(!this.pictures, (e) => e.child("j k line, 10j").child("⌃D ⌃U half page").child("gg G top, bottom").child("]c [c change").child("S split / unified").child("C note, X removes it").child("V picks lines"))
        .child("Esc close")
        .child(div().flex_1())
        .when(Boolean(this.vim.typed), (e) => e.child(div().text_color(t.foreground).child(this.vim.typed))));
  }

  diff(rows, split, cursor, t) {
    const size = settings().font_size;
    const list = (draw) => v_virtual_list("changes-modal-diff", rows.length, rowHeight(size), (i) => String(i), (range) => {
      this.top = range.start;
      const from = this.mark ?? -1, low = Math.min(from, cursor), high = Math.max(from, cursor);
      return rows.slice(range.start, range.end).map((r, k) => draw(r, range.start + k === cursor, from >= 0 && range.start + k >= low && range.start + k <= high));
    }).track_scroll(this.scroll).size_full().on_item_click((i, cx) => { this.cursor = Number(i); cx.notify(); });
    return div().id("changes-modal-body").flex_1().min_h(0).relative().font_family(settings().font_family ?? "JetBrains Mono").text_size(size)
      .on_size_change((size) => { this.bodyHeight = size.height; })
      .when(split, (e) => e.child(list((r, here, picked) => this.splitRow(r, t, here, size, picked))))
      .when(!split, (e) => e.child(div().id("changes-modal-x").size_full().overflow_x_scrollbar()
        .child(div().w_full().min_w(Math.max(300, this.longest * charWidth(size) + this.margin(size) + 50)).h_full().child(list((r, here, picked) => this.row(r, t, here, size, picked))))))
      .child(Scrollbar.vertical("changes-modal-diff").viewport_from_layout().absolute().inset_0())
      .when(this.loadingDiff, (e) => e.child(div().absolute().top(8).px(16).text_size(12).text_color(t.muted).child("Loading…")));
  }

  gutter(size) { return Math.ceil(this.gutterChars * charWidth(size)) + 2; }

  diffRow({ kind, number, text }, t, size) {
    const height = rowHeight(size);
    if (kind === "@") return div().w_full().px(12).h(height).flex_none().truncate().bg(t.raised).text_color(t.muted).child(text);
    return h_flex().w_full().h(height).flex_none().gap(10).when(kind === "+", (e) => e.bg(t.ansi2 + "18")).when(kind === "-", (e) => e.bg(t.ansi1 + "18"))
      .child(div().w(this.gutter(size)).flex_none().text_right().text_color(t.dim).child(number === undefined ? "" : String(number)))
      .child(div().flex_1().min_w(0).truncate().child(text));
  }

  render(cx) {
    if (props()?.overlay) return this.renderViewer(cx);
    if (key() !== this.context?.key) this.refresh(cx);
    else this.refreshIfDue(cx);
    const t = theme(), add = this.files.reduce((n, f) => n + f.add, 0), del = this.files.reduce((n, f) => n + f.del, 0);
    const enabled = Boolean(this.message.trim() && this.root && !this.busy && !this.loading);
    const noted = this.root ? counts(shared(NOTES), this.root, this.on ?? null, "") : {};
    return v_flex().id("changes").size_full().min_h(0).overflow_hidden().bg(t.background)
      .when(!this.embedded, el => el.rounded(10).border_1().border_color(t.border))
      .text_color(t.foreground).text_size(13).track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape" && this.typing) { this.typing = false; this.handle.focus(); cx.stop_propagation(); cx.notify(); }
      })
      .child(h_flex().h(this.embedded ? 38 : 42).flex_none().px(this.embedded ? 8 : 14).gap(4).items_center().border_b(1).border_color(t.border)
        .when(!this.embedded, el => el.child(div().font_semibold().mr(6).child("Git")))
        .child(this.tabButton("changes", "Changes", this.files.length, t))
        .child(this.tabButton("history", "History", null, t))
        .child(div().flex_1())
        .when(this.tab === "changes" && !this.embedded, el => el.child(h_flex().gap(8).mr(4).text_size(11).child(div().text_color(t.ansi2).child(`+${add}`)).child(div().text_color(t.ansi1).child(`−${del}`))))
        .when(!this.embedded, el => el.child(moveToPaneButton("changes", { message: this.message, context: this.context?.key, tab: this.tab }, t))))
      .when(this.tab === "history", el => el.child(this.history.render(t)))
      // Keep flex sizing on the panel child; the scroll region fills its bounds.
      .when(this.tab === "changes", el => el.child(div().flex_1().min_h(0).relative()
        .child(v_flex().id("changes-list").absolute().inset_0().overflow_y_scroll().p(6).children(this.files.map((f, i) => {
        const parts = f.path.split("/"), name = parts.pop();
        return h_flex().id(`change-${f.path}`).h(28).flex_none().px(8).gap(8).items_center().rounded(7).cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => this.view(i))
          .child(div().w(14).text_size(11).text_color(statusColor(f.status, t)).child(f.status))
          .child(fileIcon(f.path, {}, t))
          .child(h_flex().flex_1().min_w(0).child(div().text_color(t.muted).truncate().child(parts.length ? parts.join("/") + "/" : "")).child(div().max_w(260).min_w(0).truncate().child(name)))
          .when(noted[f.path] > 0, (e) => e.child(this.noteCount(noted[f.path], t)))
          .when(f.add > 0, (e) => e.child(div().text_size(11).text_color(t.ansi2).child(`+${f.add}`))).when(f.del > 0, (e) => e.child(div().text_size(11).text_color(t.ansi1).child(`−${f.del}`)));
      })).when(!this.files.length, (e) => e.child(div().p(8).text_color(t.muted).child(this.error || (this.loading ? "Loading changes…" : this.root ? "No uncommitted changes" : "No folder")))))
        .child(Scrollbar.vertical("changes-list").absolute().inset_0())))
      .when(this.tab === "changes" && this.limited, el => el.child(div().px(12).py(4).text_size(11).text_color(t.muted).child("Showing the first 1,000 changed files")))
      .when(Boolean(this.note), (e) => e.child(div().px(10).pb(8).text_size(11).text_color(t.ansi1).child(this.note)))
      .when(Boolean(this.sync) && shared("features")?.syncBar !== false, el => el.child(this.syncBar(t)))
      .when(this.tab === "changes" && shared("features")?.commitBox !== false, el => el.child(h_flex().flex_none().p(10).gap(8).border_t(1).border_color(t.border)
        .child(div().id("commit-message").flex_1().min_w(0).h(32).px(10).flex().items_center().rounded(8).border_1().border_color(this.typing ? t.accent : t.border).cursor_text().on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.input).h_full().text_size(12).text_color(t.foreground)))
        .child(div().id("commit").h(32).px(14).flex().items_center().rounded(8).bg(enabled ? t.solid : t.raised).text_color(enabled ? t.solid_foreground : t.dim).text_size(12).when(enabled, (e) => e.cursor_pointer()).on_click((_e, cx) => this.commit(cx)).child(this.busy ? "Committing…" : "Commit"))));
  }
}
