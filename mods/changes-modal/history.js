import { div, svg, PathBuilder } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar, v_virtual_list } from "gpui-base";
import { exec, openOverlay, shared, setShared, settings, notify, window as hostWindow } from "herdr";
import { githubUrl, openRepository } from "./github.js";

const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false"];
const FORMAT = "%H%x1f%P%x1f%an%x1f%at%x1f%D%x1f%s";
const LIMIT = 1000, ROW = 44, LANE = 10, MAX_LANES = 7;
const ALL = "changes-modal.history.all";
const PALETTE = ["ansi4", "ansi5", "ansi6", "ansi2", "ansi3", "ansi1"];

export function parseRefs(text) {
  return text.split(", ").filter(Boolean).flatMap((ref) => {
    if (ref === "HEAD") return [{ kind: "head", name: "HEAD" }];
    const head = ref.startsWith("HEAD -> "), name = head ? ref.slice(8) : ref.replace(/^tag: /, "");
    if (name.startsWith("refs/heads/")) return [{ kind: head ? "head" : "branch", name: name.slice(11) }];
    if (name.startsWith("refs/remotes/")) return name.endsWith("/HEAD") ? [] : [{ kind: "remote", name: name.slice(13) }];
    if (name.startsWith("refs/tags/")) return [{ kind: "tag", name: name.slice(10) }];
    return [];
  });
}

export function parseLog(text) {
  return text.split("\n").filter(Boolean).map((line) => {
    const [hash, parents, author, time, refs, ...subject] = line.split("\x1f");
    return { hash, parents: parents ? parents.split(" ") : [], author, time: Number(time), refs: parseRefs(refs ?? ""), subject: subject.join("\x1f") };
  });
}

// Each lane waits for the commit a child named as its parent; a line is [fromLane, fromY, toLane, toY, color], y from 0 (row top) to 1.
export function graph(commits) {
  const lanes = [], colors = [];
  let next = 0, width = 1;
  const free = () => { const i = lanes.indexOf(null); return i < 0 ? lanes.length : i; };
  const rows = commits.map((c) => {
    const lines = [], tip = !lanes.includes(c.hash), col = tip ? free() : lanes.indexOf(c.hash);
    if (tip) colors[col] = next++;
    const color = colors[col];
    lanes.forEach((h, j) => { if (h !== null) lines.push(h === c.hash ? [j, 0, col, 0.5, colors[j]] : [j, 0, j, 1, colors[j]]); });
    for (let j = 0; j < lanes.length; j++) if (lanes[j] === c.hash) lanes[j] = null;
    const [first, ...rest] = c.parents;
    if (first) { lanes[col] = first; lines.push([col, 0.5, col, 1, color]); }
    for (const p of rest) {
      let k = lanes.indexOf(p);
      if (k < 0) { k = free(); lanes[k] = p; colors[k] = next++; }
      lines.push([col, 0.5, k, 1, colors[k]]);
    }
    while (lanes.length && lanes.at(-1) === null) lanes.pop();
    for (const l of lines) width = Math.max(width, l[0] + 1, l[2] + 1);
    return { col, color, lines };
  });
  return { rows, width: Math.min(width, MAX_LANES) };
}

export function matches(c, query) {
  const text = [c.subject, c.author, c.hash, ...c.refs.map((r) => r.name)].join(" ").toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((word) => text.includes(word));
}

export function commitFiles(names, stats) {
  const counts = new Map();
  for (const entry of String(stats ?? "").split("\0")) {
    const [add, del, ...parts] = entry.split("\t");
    if (parts.length) counts.set(parts.join("\t"), { add: Number(add) || 0, del: Number(del) || 0, binary: add === "-" });
  }
  const files = [], parts = String(names ?? "").split("\0");
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const kind = parts[i][0], path = parts[i + 1];
    files.push({ path, status: "AD".includes(kind) ? kind : "M", fresh: false, ...(counts.get(path) ?? { add: 0, del: 0 }) });
  }
  return files.slice(0, 1000);
}

export function ago(time, now = Date.now() / 1000) {
  const s = Math.max(0, now - time);
  for (const [n, unit] of [[31536000, "y"], [2592000, "mo"], [604800, "w"], [86400, "d"], [3600, "h"], [60, "m"]]) if (s >= n) return `${Math.floor(s / n)}${unit}`;
  return "now";
}

export function dateTime(time) {
  const d = new Date(time * 1000), two = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

export function commitHeader(c, t) {
  return h_flex().h(36).flex_none().px(16).gap(10).items_center().border_b(1).border_color(t.border).bg(t.raised).text_size(12)
    .child(div().flex_none().text_color(t.muted).font_family(settings().font_family ?? "JetBrains Mono").child(c.hash.slice(0, 7)))
    .child(div().flex_1().min_w(0).truncate().font_semibold().child(c.subject))
    .child(div().flex_none().text_color(t.muted).child(`${c.author} · ${dateTime(c.time)}`));
}

export class History {
  constructor(view) {
    this.view = view; this.commits = []; this.graph = { rows: [], width: 1 }; this.unpushed = new Set();
    this.query = ""; this.selected = null; this.clicked = null; this.confirm = null; this.copied = null;
    this.search = InputState.new({ placeholder: "Search message, author, hash or branch" });
    this.search.on("change", (_e, cx) => { this.query = this.search.value(); cx.notify(); });
    this.search.on("focus", (_e, cx) => { this.view.typing = true; cx.notify(); });
    this.search.on("blur", (_e, cx) => { this.view.typing = false; cx.notify(); });
  }

  reset() {
    this.commits = []; this.graph = { rows: [], width: 1 }; this.unpushed = new Set();
    this.stamp = null; this.error = null; this.selected = null; this.confirm = null; this.github = null;
  }

  load(cx) {
    const root = this.view.root, on = this.view.on, all = shared(ALL) !== false;
    if (!root) return;
    if (this.loading) { this.again = true; return; }
    this.loading = true; this.again = false;
    cx.spawn(async (cx) => {
      try {
        const git = (args) => exec("git", [...READ, ...args], { cwd: root, on });
        const [head, refs] = await Promise.all([git(["rev-parse", "-q", "--verify", "HEAD"]),
          git(["for-each-ref", "--format=%(objectname) %(refname)", "refs/heads", "refs/remotes", "refs/tags"])]);
        const stamp = [root, all, head.stdout, refs.stdout].join("\n");
        if (stamp === this.stamp || this.view.root !== root) return;
        if (head.code !== 0) { this.reset(); this.stamp = stamp; return; }
        const [log, ahead, remotes] = await Promise.all([
          git(["log", "--decorate=full", "--date-order", `--max-count=${LIMIT}`, `--format=${FORMAT}`, ...(all ? ["HEAD", "--branches", "--remotes", "--tags"] : ["HEAD"]), "--"]),
          git(["rev-list", `--max-count=${LIMIT}`, "HEAD", "--not", "--remotes"]),
          git(["remote", "-v"]),
        ]);
        if (log.code !== 0) throw new Error(log.stderr.trim());
        if (this.view.root !== root) return;
        const urls = remotes.stdout.split("\n").map((line) => line.split(/\s+/)[1]).filter(Boolean);
        this.commits = parseLog(log.stdout); this.graph = graph(this.commits);
        this.unpushed = new Set(urls.length && ahead.code === 0 ? ahead.stdout.split("\n").filter(Boolean) : []);
        this.github = urls.some((url) => githubUrl(url));
        this.limited = this.commits.length >= LIMIT; this.error = null; this.stamp = stamp;
      } catch (e) { if (this.view.root === root) this.error = String(e.message ?? e); }
      finally {
        this.loading = false;
        if (this.again) this.load(cx);
        cx.notify();
      }
    });
  }

  open(c, cx) {
    const view = this.view, root = view.root, on = view.on ?? null;
    view.note = null;
    cx.spawn(async (cx) => {
      try {
        const git = (args) => exec("git", [...READ, ...args], { cwd: root, on });
        const base = c.parents[0] ?? (await git(["hash-object", "-t", "tree", "/dev/null"])).stdout.trim();
        const [names, stats] = await Promise.all([git(["diff", base, c.hash, "--name-status", "-z", "--no-renames"]), git(["diff", base, c.hash, "--numstat", "-z", "--no-renames"])]);
        if (names.code !== 0) throw new Error(names.stderr.trim());
        const files = commitFiles(names.stdout, stats.stdout);
        if (!files.length) { view.note = `${c.hash.slice(0, 7)} changes no files`; return; }
        openOverlay({ mod: "changes-modal", kind: "dialog", width: 0.9, height: 0.9,
          props: { root, on, hasHead: true, base, head: c.hash, files, index: 0, commit: { hash: c.hash, subject: c.subject, author: c.author, time: c.time } } });
      } catch (e) { view.note = `Cannot open ${c.hash.slice(0, 7)}: ${e.message ?? e}`; }
      finally { cx.notify(); }
    });
  }

  copy(c, cx) {
    cx.write_to_clipboard(c.hash);
    this.copied = c.hash;
    cx.notify();
    cx.spawn(async (cx) => {
      await cx.sleep(1500);
      if (this.copied === c.hash) { this.copied = null; cx.notify(); }
    });
  }

  openOnGitHub(c, cx) {
    const context = { cwd: this.view.root, on: this.view.on ?? null };
    cx.spawn(async () => {
      try { await openRepository(context, hostWindow()?.platform, `/commit/${c.hash}`); }
      catch (e) { notify({ title: "Cannot open GitHub", body: e.message || String(e), level: "error" }); }
    });
  }

  ask(c, cx) {
    const view = this.view, root = view.root, on = view.on;
    view.note = null;
    cx.spawn(async (cx) => {
      const r = await exec("git", [...READ, "merge-base", "--is-ancestor", c.hash, "HEAD"], { cwd: root, on }).catch(() => null);
      if (r?.code === 0) this.confirm = c.hash;
      else view.note = `${c.hash.slice(0, 7)} is not on the current branch, so there is nothing to revert here.`;
      cx.notify();
    });
  }

  revert(c, cx) {
    const view = this.view, root = view.root, on = view.on;
    this.confirm = null; this.reverting = c.hash; view.note = null;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("git", ["revert", "--no-edit", c.hash], { cwd: root, on });
        if (r.code !== 0) {
          await exec("git", ["revert", "--abort"], { cwd: root, on }).catch(() => null);
          throw new Error((r.stderr || r.stdout).trim());
        }
      } catch (e) { view.note = `Revert failed: ${e.message ?? e}`; }
      finally { this.reverting = null; view.refresh(cx, true); cx.notify(); }
    });
    cx.notify();
  }

  lanes(row, head, t) {
    const width = this.graph.width, x = (lane) => 6 + Math.min(lane, width - 1) * LANE + LANE / 2;
    const paths = new Map();
    for (const [x1, y1, x2, y2, color] of row.lines) {
      if (Math.max(x1, x2) >= width) continue;
      const key = color % PALETTE.length, ax = x(x1), ay = y1 * ROW, bx = x(x2), by = y2 * ROW, mid = (ay + by) / 2;
      const path = (paths.get(key) ?? PathBuilder.stroke(1.5)).move_to(ax, ay);
      paths.set(key, ax === bx ? path.line_to(bx, by) : path.cubic_bezier_to(bx, by, ax, mid, bx, mid));
    }
    const color = t[PALETTE[row.color % PALETTE.length]], size = head ? 10 : 8;
    return div().relative().w(width * LANE + 12).h(ROW).flex_none().overflow_hidden()
      .children([...paths].map(([key, path]) => globalThis.window.paint_path(path.build(), t[PALETTE[key]]).absolute().inset_0().size_full()))
      .child(div().absolute().left(x(row.col) - size / 2).top(ROW / 2 - size / 2).size(size).rounded(size)
        .when(head, (e) => e.border_2().border_color(color).bg(t.background)).when(!head, (e) => e.bg(color)));
  }

  chip(ref, t) {
    const color = ref.kind === "head" ? t.accent : ref.kind === "tag" ? t.ansi3 : ref.kind === "remote" ? t.muted : t.ansi4;
    return div().flex_none().max_w(150).h(18).px(5).flex().items_center().rounded(4).text_size(10).bg(color + "22").text_color(color)
      .when(ref.kind === "head", (e) => e.font_semibold()).child(div().truncate().child(ref.name));
  }

  click(hash, cx) {
    const c = this.commits.find((c) => c.hash === hash), now = Date.now();
    if (!c) return;
    const double = this.clicked?.hash === hash && now - this.clicked.at < 400;
    this.clicked = { hash, at: now };
    if (double) { this.selected = hash; this.open(c, cx); }
    else { this.selected = this.selected === hash ? null : hash; this.confirm = null; this.view.note = null; }
    cx.notify();
  }

  row(index, filtering, t) {
    const c = this.commits[index], refs = c.refs.slice(0, 2), more = c.refs.length - refs.length;
    return h_flex().w_full().h(ROW).flex_none().pr(8).items_center().rounded(7).cursor_pointer()
      .when(this.selected === c.hash, (e) => e.bg(t.selected)).when(this.selected !== c.hash, (e) => e.hover((s) => s.bg(t.hover)))
      .child(filtering ? div().w(10).flex_none() : this.lanes(this.graph.rows[index], c.refs.some((r) => r.kind === "head"), t))
      .child(v_flex().flex_1().min_w(0).gap(3)
        .child(h_flex().min_w(0).gap(5).items_center()
          .children(refs.map((ref) => this.chip(ref, t)))
          .when(more > 0, (e) => e.child(div().flex_none().text_size(10).text_color(t.muted).child(`+${more}`)))
          .child(div().flex_1().min_w(0).truncate().text_size(12).child(c.subject)))
        .child(h_flex().min_w(0).gap(6).text_size(11).text_color(t.muted)
          .child(div().flex_none().font_family(settings().font_family ?? "JetBrains Mono").child(c.hash.slice(0, 7)))
          .child(div().min_w(0).truncate().child(c.author))
          .child(div().flex_none().text_color(t.dim).child(ago(c.time)))
          .when(this.unpushed.has(c.hash), (e) => e.child(div().flex_none().text_color(t.accent).child("↑ not pushed")))));
  }

  button(id, label, tip, enabled, run, t, icon, strong) {
    return h_flex().id(id).h(26).px(8).gap(5).flex_none().items_center().rounded(6).text_size(12).border_1().border_color(strong ? t.solid : t.border)
      .bg(strong ? t.solid : t.background).text_color(strong ? t.solid_foreground : enabled ? t.foreground : t.dim).opacity(enabled ? 1 : 0.55)
      .tooltip(tip).accessibility_label(tip)
      .when(enabled, (e) => e.cursor_pointer().hover((s) => strong ? s.opacity(0.88) : s.bg(t.hover)).on_click((_e, cx) => run(cx)))
      .when(Boolean(icon), (e) => e.child(svg(icon).size(13))).child(label);
  }

  details(c, t) {
    const dirty = this.view.files.some((f) => !f.fresh), merge = c.parents.length > 1, pushed = !this.unpushed.has(c.hash), copied = this.copied === c.hash;
    const revertTip = this.reverting ? "Reverting…" : merge ? "Merge commits can't be reverted from here" : dirty ? "Commit or stash your changes before reverting" : "Make a new commit that undoes this one";
    const box = v_flex().flex_none().px(12).py(10).gap(6).border_t(1).border_color(t.border).bg(t.raised)
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(12).font_semibold().child(c.subject))
        .child(div().id("history-close").size(20).flex_none().flex().items_center().justify_center().rounded(5).text_color(t.muted).cursor_pointer()
          .tooltip("Close").accessibility_label("Close").hover((s) => s.bg(t.hover)).on_click((_e, cx) => { this.selected = null; this.confirm = null; cx.notify(); }).child("✕")))
      .child(div().min_w(0).truncate().text_size(11).text_color(t.muted).child(`${c.hash.slice(0, 10)} · ${c.author} · ${dateTime(c.time)}`));
    if (this.confirm === c.hash) return box
      .child(div().text_size(12).child("Revert this commit? Git makes a new commit that undoes it."))
      .child(h_flex().gap(6)
        .child(this.button("revert-cancel", "Cancel", "Keep the commit", true, (cx) => { this.confirm = null; cx.notify(); }, t))
        .child(this.button("revert-confirm", "Revert", "Revert this commit", true, (cx) => this.revert(c, cx), t, null, true)));
    return box.child(h_flex().gap(6).flex_wrap()
      .child(this.button("history-view", "View changes", "Open this commit's files and diffs (or double-click it)", true, (cx) => this.open(c, cx), t, null, true))
      .child(this.button("history-copy", copied ? "Copied" : "Copy hash", copied ? "Copied to the clipboard" : `Copy ${c.hash}`, true, (cx) => this.copy(c, cx), t, "mods/changes-modal/copy.svg"))
      .when(Boolean(this.github), (e) => e.child(this.button("history-github", "GitHub", pushed ? "Open this commit on GitHub" : "Not on GitHub yet: push it first", pushed, (cx) => this.openOnGitHub(c, cx), t, "mods/tabs-show/github.svg")))
      .child(this.button("history-revert", this.reverting ? "Reverting…" : "Revert", revertTip, !merge && !dirty && !this.reverting, (cx) => this.ask(c, cx), t, "mods/changes-modal/revert.svg")));
  }

  render(t) {
    const all = shared(ALL) !== false, query = this.query.trim();
    const shown = query ? this.commits.flatMap((c, i) => matches(c, query) ? [i] : []) : this.commits.map((_c, i) => i);
    const selected = this.selected && this.commits.find((c) => c.hash === this.selected);
    const empty = this.error || (this.loading && !this.stamp ? "Loading history…" : !this.view.root ? "No folder" : query ? "No commits match" : "No commits yet");
    return v_flex().flex_1().min_h(0)
      .child(h_flex().flex_none().px(8).py(8).gap(6).items_center()
        .child(div().id("history-search").flex_1().min_w(0).h(28).px(8).flex().items_center().rounded(7).border_1().border_color(this.view.typing ? t.accent : t.border)
          .cursor_text().on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.search).h_full().text_size(12).text_color(t.foreground)))
        .child(div().id("history-all").h(28).px(8).flex_none().flex().items_center().rounded(7).border_1().border_color(t.border).text_size(12).cursor_pointer()
          .bg(all ? t.selected : t.background).text_color(all ? t.foreground : t.muted).hover((s) => s.bg(t.hover))
          .tooltip(all ? "Showing every branch. Click to show only this one" : "Showing this branch only. Click to show every branch")
          .on_click((_e, cx) => { setShared(ALL, !all); this.stamp = null; this.load(cx); cx.notify(); })
          .child("All branches")))
      .child(div().flex_1().min_h(0).relative().px(6)
        .when(shown.length > 0, (e) => e
          .child(v_virtual_list("history-list", shown.length, ROW, (i) => this.commits[shown[i]].hash,
            (range) => shown.slice(range.start, range.end).map((index) => this.row(index, Boolean(query), t)))
            .size_full().on_item_click((hash, cx) => this.click(hash, cx)))
          .child(Scrollbar.vertical("history-list").viewport_from_layout().absolute().inset_0()))
        .when(!shown.length, (e) => e.child(div().p(8).text_color(t.muted).child(empty))))
      .when(this.limited, (e) => e.child(div().px(12).py(4).text_size(11).text_color(t.muted).child("Showing the latest 1,000 commits")))
      .when(Boolean(selected), (e) => e.child(this.details(selected, t)));
  }
}
