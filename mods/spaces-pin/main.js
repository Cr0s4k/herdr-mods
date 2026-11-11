// Workspace spaces: stable colored avatars, worktrees under their checkout,
// grouped by machine when more than one is known. After a space's name, the repo
// its first terminal is in now, only where unusual: branch, ahead/behind.
// Agents and worktrees live under their space. Click to switch, right-click
// for its menu, drag to reorder; chevrons fold without changing focus.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, machines, panes, run, openOverlay, exec, hc, theme, shared, setShared, watchFolder, window, layout, nextCommand } from "herdr";
import { AgentTree, branch } from "./agent-tree.js";
import { hiddenSpaces, expireSpaces } from "./hide-state.js";
import { ink, watchMotion } from "./ui.js";
import { spacePipeline, pipelineRow, openPipeline } from "./pipeline-row.js";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// Where a space is now: its first terminal's live folder, else where it was made.
// `ps`: panes(), read once by the caller (each read copies every pane).
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}
const rowHeight = ({ tree }) => (tree ? 28 : 30);
const RAIL_CELL = 32;
const railCell = (el) => h_flex().flex_none().justify_center().child(el);
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
const base = (path) => path.replace(/\/+$/, "").split("/").pop();
// Changes made outside Herdr (an editor's save, a commit in another app): looked
// for this often, in repos the list shows, while the window is in front.
const FALLBACK = 60000;

// What a stored color name looks like on an avatar (the same in every mod
// that draws space avatars): one strong color per hue, light and dark alike.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

// A space speaks up only when something in it needs you.
export function glyph(status) {
  return status === "blocked" || status === "done" ? "●" : "·";
}

export function tone(t, status) {
  return t[status] ?? t.unknown;
}

export default class Spaces extends View {
  init(_props, cx) {
    watchMotion(cx);
    this.agents = new AgentTree();
    this.expanded = JSON.parse(localStorage.getItem("spaces.expanded") ?? "{}");
    this.attention = localStorage.getItem("spaces.attention") === "true";
    this.git = {}; // where() -> { name, branch, ahead, behind, repo, linked }, null: not a repo
    this.checked = {}; // where() -> when it was last looked at
    this.unsure = new Set(); // where()s git couldn't answer for (a machine away)
    this.pending = new Set(); // where()s to look at next
    this.busy = {}; // pane -> an agent working or a program in front of its shell
    this.ready = {}; // machine -> its layout was readable at the last look
    this.at = {}; // space -> its where() at the last look
    this.watching = new Set(); // local repos' git folders
    // Spaces made while this runs wait (at most a moment) for their git, so a
    // worktree appears under its repo instead of jumping there.
    this.shown = new Set(spaces().map((s) => s.id));
    this.born = {};
    this.pressed = null;
    this.over = null;
    this.hovered = null;
    this.machines = [];
    this.reconnecting = JSON.parse(localStorage.getItem("machines.reconnecting") ?? "{}");
    for (const state of Object.values(this.reconnecting)) state.busy = false;
    this.folded = new Set(JSON.parse(localStorage.getItem("machines.folded") ?? "[]"));
    this.refreshMachines(cx);
    cx.timer.every(15000, cx => this.refreshMachines(cx));
    // `git status` walks the whole tree, on another machine a process there:
    // only when its answer could have changed (see `due`).
    cx.timer.every(250, (cx) => this.checkNew(cx));
    this.handle = cx.focus_handle();
    this.keyboard = false;
    this.cursor = null;
    this.nav = [];
    cx.spawn(async (cx) => {
      for (;;) {
        if (await nextCommand() !== "focus") continue;
        this.keyboard = true;
        this.held = false;
        if (!this.nav.some(n => n.key === this.cursor)) this.cursor = shared("spaces.focus") ? null : `space:${spaces().find(s => s.active)?.id}`;
        cx.notify();
        cx.timer.after(30, (cx) => this.takeKeyboard(cx));
      }
    });
  }

  // Herdr hands a block the keyboard only through pane.go; a key binding's
  // command reaches the mod without it, so step left until the sidebar holds it.
  takeKeyboard(cx, hops = 0) {
    this.handle.focus();
    cx.notify();
    cx.timer.after(120, (cx) => {
      if (this.handle.is_focused() || !this.keyboard) return;
      if (hops >= 6) { this.keyboard = false; cx.notify(); return; }
      run("pane.go", { direction: "left" });
      this.takeKeyboard(cx, hops + 1);
    });
  }

  navigable(key, item) {
    this.nav.push({ key, ...item });
    return this.keyboard && this.cursor === key;
  }

  ring(t, radius) {
    return div().absolute().inset_0().rounded(radius).border_1().border_color(t.accent);
  }

  key(e, cx) {
    if (e.modifiers.control || e.modifiers.platform || e.modifiers.alt) return;
    const nav = this.nav;
    if (!nav.length) return;
    const at = nav.findIndex(n => n.key === this.cursor);
    if (at === -1 && ["down", "up", "j", "k", "home", "end", "left", "right"].includes(e.key)) {
      this.cursor = nav[Math.max(0, nav.findIndex(n => n.w?.active))].key;
      cx.stop_propagation();
      cx.notify();
      return;
    }
    const item = nav[Math.max(0, at)];
    const move = (to) => { this.cursor = nav[Math.max(0, Math.min(nav.length - 1, to))].key; };
    const space = item.kind === "space";
    switch (e.key) {
      case "down": case "j": move(at + 1); break;
      case "up": case "k": move(at - 1); break;
      case "home": move(0); break;
      case "end": move(nav.length - 1); break;
      case "enter": case "space":
        if (space) run("space.select", { id: item.w.id });
        else if (item.kind === "pipeline") openPipeline(item.w, item.pipe);
        else run("pane.focus", { pane: item.a.pane });
        break;
      case "right":
        if (space && item.hasChildren && !item.open && !this.attention) item.toggle(cx);
        else if (space && item.hasChildren) move(at + 1);
        break;
      case "left":
        if (space && item.hasChildren && item.open && !this.attention) item.toggle(cx);
        else if (item.parent) this.cursor = item.parent;
        break;
      case "p": {
        if (!space) return;
        const pins = shared("space.pinned") ?? [];
        setShared("space.pinned", pins.includes(item.w.id) ? pins.filter(id => id !== item.w.id) : [...pins, item.w.id]);
        break;
      }
      case "h": if (!space) return; this.hide(item.w); break;
      case "m": if (!space) return; this.menu(item.w); break;
      case "f":
        if (!space) return;
        setShared("spaces.focus", item.w.id);
        run("space.select", { id: item.w.id });
        this.cursor = null;
        break;
      case "n": openOverlay({ mod: "space-new", kind: "popup", width: 300, height: 114 }); break;
      case "escape":
        if (shared("spaces.focus")) { setShared("spaces.focus", null); this.cursor = null; }
        else { this.keyboard = false; run("pane.go", { direction: "right" }); }
        break;
      default: return;
    }
    cx.stop_propagation();
    cx.notify();
  }

  checkNew(cx) {
    const now = Date.now();
    expireSpaces(now);
    const sp = spaces();
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    const due = this.due(now, sp, panes());
    if (due.size) this.refreshGit(due, cx);
    if (sp.some((s) => !this.shown.has(s.id)) || this.orderingDue(now)) cx.notify();
  }

  // Places whose git could have changed: new ones (a new space, a cd), where a
  // command or an agent's turn just ended (a checkout, a commit, edits), those on
  // a machine that is back, and repos in view whose fallback is due.
  due(now, sp, ps) {
    // Moved there: what it knew of that place may be old.
    const at = {};
    for (const s of sp) at[s.id] = where(s, ps);
    const keys = new Set(Object.values(at).filter((k) => JSON.parse(k)[1]));
    const due = new Set([...keys].filter((k) => !(k in this.git)));
    for (const [id, k] of Object.entries(at)) if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane]) this.sameRepo(at[spaceOf[p.tab].id], keys).forEach((k) => due.add(k));
    }
    this.busy = busy;
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name] === false) for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k);
      this.ready[m.name] = ready;
    }
    if (window().active) {
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k);
        if (asks && !this.folded.has(JSON.parse(k)[0]) && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
      }
    }
    return due;
  }

  // `key` and the other places in its repo (a commit there moves their ahead/behind).
  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : [])];
  }

  refreshMachines(cx) {
    cx.spawn(async cx => {
      try { const r = await hc(["machine", "ls", "--json"]); if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary); } catch {}
      cx.notify();
    });
  }

  rebuilt(machine) {
    return machine?.state === "unreachable" && /^a different core answers there \("[^"]+"\)$/.test(machine.why ?? "");
  }

  reconnect(machine, cx) {
    const name = machine.name;
    if (this.reconnecting[name]?.busy) return;
    const state = this.reconnecting[name] ??= { machine, removed: false };
    state.busy = true;
    state.error = null;
    localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
    cx.notify();
    cx.spawn(async cx => {
      try {
        const ask = async args => {
          const r = await hc([...args, "--json"]);
          if (r.code !== 0) {
            let error;
            try { error = JSON.parse(r.stdout || r.stderr).error?.message; } catch {}
            throw new Error(error || r.stderr || r.stdout || "Couldn't connect.");
          }
        };
        if (!state.removed) {
          await ask(["machine", "rm", name]);
          state.removed = true;
          localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
        }
        const args = ["machine", "add"];
        if (machine.via) args.push("--via", machine.target);
        else args.push(machine.target);
        args.push("--name", name);
        if (machine.session) args.push("--session", machine.session);
        if (machine.temporary) args.push("--temp");
        await ask(args);
        this.folded.delete(name);
        localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
        delete this.reconnecting[name];
      } catch (e) {
        state.error = String(e.message ?? e);
        state.busy = false;
      }
      localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
      this.refreshMachines(cx);
      cx.notify();
    });
  }

  // One look at a time, each place once however often it was asked for meanwhile.
  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        for (const key of keys) await this.check(key, cx);
      }
      const used = new Set(Object.values(this.git).filter(Boolean).map((g) => JSON.parse(g.repo)).filter(([on]) => !on).map(([, repo]) => repo));
      for (const repo of this.watching) if (!used.has(repo)) this.watching.delete(repo);
      this.refreshing = false;
      cx.notify();
    });
  }

  // One place's git: branch, ahead/behind, its repo.
  async check(key, cx) {
    const [on, cwd] = JSON.parse(key);
    this.checked[key] = Date.now();
    this.unsure.delete(key);
    try {
      // No optional locks: a status that touched the index would wake the watch again.
      // Writes nothing under .git (index lock, fsmonitor cookie): watch() would wake on it.
      const r = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v2", "--branch"], { cwd, on });
      if (r.code !== 0) {
        // Only git's own "no" is remembered as no repo; anything else is asked again.
        if (!/not a git repository/i.test(r.stderr)) this.unsure.add(key);
        this.git[key] = null;
        return;
      }
      // The repo's own .git folder names it; a worktree's top differs from it.
      const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
      const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on });
      const repo = common.stdout.trim();
      const name = repo.endsWith("/.git") ? base(repo.slice(0, -5)) : base(repo).replace(/\.git$/, "");
      const info = { name, branch: null, ahead: 0, behind: 0, repo: JSON.stringify([on, repo]), linked: repo !== `${top.stdout.trim()}/.git` };
      for (const line of r.stdout.split("\n")) {
        if (line.startsWith("# branch.head ")) info.branch = line.slice(14);
        else if (line.startsWith("# branch.ab ")) {
          const [a, b] = line.slice(12).split(" ");
          info.ahead = Math.abs(parseInt(a, 10)) || 0;
          info.behind = Math.abs(parseInt(b, 10)) || 0;
        }
      }
      this.git[key] = info;
      if (!on) this.watch(repo, cx);
    } catch {
      // Couldn't ask (the machine is away): keep what it showed, look again later.
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }

  watch(repo, cx) {
    if (this.watching.has(repo)) return;
    this.watching.add(repo);
    cx.spawn(async (cx) => {
      try {
        while (this.watching.has(repo)) {
          await watchFolder(repo);
          const mine = JSON.stringify([null, repo]);
          if (this.watching.has(repo)) this.refreshGit(Object.keys(this.git).filter((k) => this.git[k]?.repo === mine), cx);
        }
      } catch { this.watching.delete(repo); }
    });
  }

  menu(w) {
    // A popup is as tall as its items; height is only the most.
    openOverlay({ mod: "menu-pin", kind: "popup", width: 200, height: 310, props: { tab: "space", target: { id: w.id } } });
  }

  hide(w) {
    openOverlay({ mod: "space-hide", kind: "popup", width: 330, height: 350, props: { id: w.id } });
  }

  orderingDue(now) {
    return this.ordering && now - this.ordering.at >= 1000
      && this.ordering.machines.every(name => machines().some(m => m.name === name && m.layout === "ready"));
  }

  // Spaces in order, each worktree space moved under its main checkout's.
  ordered() {
    const sp = spaces(), ps = panes();
    const ready = (w) => this.shown.has(w.id) || where(w, ps) in this.git || Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    const list = sp.map((w, i) => ({ w, i, g: this.git[where(w, ps)] ?? null }));
    const mains = new Set(list.filter((r) => r.g && !r.g.linked).map((r) => r.g.repo));
    const nested = (r) => r.g?.linked && mains.has(r.g.repo);
    const listed = [];
    const placed = new Set(); // repos whose worktrees are listed (under the first of its spaces)
    for (const r of list) {
      if (nested(r)) continue;
      listed.push({ ...r, tree: null });
      if (!r.g || r.g.linked || placed.has(r.g.repo)) continue;
      placed.add(r.g.repo);
      const kids = list.filter((k) => nested(k) && k.g.repo === r.g.repo);
      kids.forEach((k, n) => listed.push({ ...k, tree: n === kids.length - 1 ? "└─" : "├─" }));
    }
    const pins = new Set(shared("space.pinned") ?? []);
    const clusters = [];
    for (const r of listed) r.tree && clusters.length ? clusters.at(-1).push(r) : clusters.push([r]);
    const isPinned = (c) => c.some((r) => pins.has(r.w.id));
    const out = [...new Set(clusters.map((c) => c[0].w.machine ?? null))].flatMap((m) => {
      const mine = clusters.filter((c) => (c[0].w.machine ?? null) === m);
      const top = mine.filter(isPinned), rest = mine.filter((c) => !isPinned(c));
      top.flat().forEach((r) => (r.pinned = true));
      if (top.length && rest.length) top.at(-1).at(-1).lastPinned = true;
      return [...top, ...rest].flat();
    });
    // Simulate the batch so later indexes include earlier moves. An attempted
    // write can lose a sync conflict: allow the echo to settle before retrying.
    const order = sp.map(w => w.id);
    const target = out.map(r => r.w.id);
    const key = JSON.stringify([order, target, machines()]);
    if (order.every((id, i) => id === target[i])) {
      this.ordering = null;
    } else if (this.ordering?.key !== key || this.orderingDue(Date.now())) {
      const moved = new Set();
      this.ordering = { key, at: Date.now(), machines: [] };
      for (let i = 0; i < out.length; i++) {
        const from = order.indexOf(out[i].w.id);
        if (from === i) continue;
        run("space.move", { id: out[i].w.id, index: i + 1 });
        moved.add(out[i].w.machine ?? null);
        order.splice(i, 0, order.splice(from, 1)[0]);
      }
      this.ordering.machines = [...moved];
    }
    return out.filter(r => this.shown.has(r.w.id));
  }

  // The rows, under a header per machine once one isn't this computer.
  grouped(t, collapsed) {
    // Filter after computing model order so hiding never moves other spaces.
    // A visible worktree becomes a root while its checkout is hidden.
    const hidden = hiddenSpaces();
    let parentHidden = false;
    const rows = this.ordered().flatMap(r => {
      if (!r.tree) parentHidden = Boolean(hidden[r.w.id]);
      return hidden[r.w.id] ? [] : [{ ...r, tree: parentHidden ? null : r.tree }];
    });
    this.agents.order(rows);
    const clusters = [];
    for (const r of rows) {
      if (r.tree && clusters.length) clusters.at(-1).kids.push(r);
      else clusters.push({ ...r, kids: [] });
    }
    for (const r of clusters) {
      r.summary = this.agents.summary([r.w.id, ...r.kids.map(k => k.w.id)]);
      for (const k of r.kids) { k.kids = []; k.summary = this.agents.summary([k.w.id]); }
    }
    const visible = clusters.filter(r => !this.attention || r.summary.blocked > 0);
    const draw = (r) => {
      const line = r.lastPinned || r.kids.some(k => k.lastPinned);
      return [...(collapsed ? [this.compact(r, t), ...r.kids.filter(k => !this.attention || k.summary.blocked > 0).map(k => this.compact(k, t))] : [this.spaceTree(r, t)]),
        ...(line ? [div().id(`pin-line-${r.w.id}`).flex_none().mx(8).my(4).h(1).bg(t.border)] : [])];
    };
    const remote = [...new Set([...rows.map(r => r.w.machine).filter(Boolean), ...this.machines.map(m => m.name), ...Object.keys(this.reconnecting)])].sort();
    const loading = m => {
      const layout = machines().find(k => k.name === m)?.layout;
      return layout === "loading" || (!layout && this.machines.some(k => k.name === m && k.state === "connected"))
        || spaces().some(s => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    const loadingRow = m => h_flex().id(`machine-loading-${m ?? "local"}`).h(28).flex_none().px(collapsed ? 0 : 8).items_center().when(collapsed, el => el.justify_center()).text_size(12).text_color(t.muted).child(collapsed ? "…" : "Loading…");
    if (!remote.length) return loading(null) && !rows.length ? [loadingRow(null)] : visible.flatMap(draw);
    const machineNames = [null, ...remote];
    return machineNames.flatMap((m) => {
      const mine = visible.filter((r) => (r.w.machine ?? null) === m);
      if (this.attention && !mine.length) return [];
      const repair = this.reconnecting[m];
      const machine = this.machines.find(k => k.name === m) ?? repair?.machine;
      const connected = !m || machine?.state === "connected";
      const rebuilt = this.rebuilt(machine) || !!repair;
      const folded = !this.attention && this.folded.has(m);
      const icon = svg(`mods/workspace-chrome/${m ? "server" : "monitor"}.svg`).size(13).flex_none();
      const badge = div().absolute().right(-3).bottom(-2).size(6).rounded(3).border_1().border_color(t.chrome).bg(connected ? t.ansi2 : t.dim);
      const head = h_flex().id(`machine-${m ?? "local"}`).h(26).flex_none().px(collapsed ? 0 : 8).gap(7).items_center().text_size(11).text_color(t.muted)
        .when(collapsed, el => el.mt(4).w(RAIL_CELL).justify_center().rounded(6).tooltip(m ? `${m} · ${connected ? "connected" : (machine?.state ?? "asleep").replace(/_/g, " ")}` : "This computer"))
        .cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => {
          folded ? this.folded.delete(m) : this.folded.add(m);
          localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
          cx.notify();
        })
        .when(!collapsed, el => el.child(icon))
        .when(collapsed, el => el.child(div().relative().flex_none().child(icon).when(Boolean(m), el => el.child(badge))))
        .when(!collapsed, el => el.child(div().flex_1().truncate().child(m ?? "This computer"))
          .when(!connected && !rebuilt, el => el.child(div().flex_none().child((machine?.state ?? "asleep").replace(/_/g, " "))))
          .when(rebuilt, el => el.child(h_flex().flex_none().gap(3).items_center()
            .child(div().max_w(140).truncate().child(repair?.error || "rebuilt ·"))
            .child(div().id(`machine-connect-${m}`).text_color(repair?.error ? t.blocked : t.muted)
              .hover(s => s.text_color(t.foreground))
              .tooltip(repair?.error || "This machine was rebuilt or replaced. Click to connect to the new one.")
              .on_click((_e, cx) => { cx.stop_propagation(); this.reconnect(machine, cx); })
              .child(repair?.busy ? "Connecting…" : "Connect"))))
          .when(connected, el => el.child(div().id(`machine-add-${m ?? "local"}`).flex_none().px(4).rounded(4).hover(s => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => { cx.stop_propagation(); run("space.new", { machine: m ?? "" }); }).child("+")))
          .child(div().size(6).rounded(3).flex_none().bg(connected ? t.ansi2 : t.dim))
          .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(11).flex_none()));
      const empty = h_flex().id(`machine-new-${m ?? "local"}`).h(28).flex_none().px(collapsed ? 0 : 8).gap(7).items_center().rounded(7)
        .text_size(12).text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => run("space.new", { machine: m ?? "" }))
        .when(collapsed, el => el.w(RAIL_CELL).rounded(6).justify_center().tooltip(`New space on ${m ?? "this computer"}`)
          .child(h_flex().size(18).rounded(5).border_1().border_color(t.muted).items_center().justify_center()
            .child(svg("mods/workspace-chrome/plus.svg").size(10))))
        .when(!collapsed, el => el.child(svg("mods/workspace-chrome/plus.svg").size(12)).child("New space there"));
      if (!collapsed && rebuilt) return [head];
      const cell = collapsed ? railCell : (el) => el;
      return [cell(head), ...(folded ? [] : mine.length ? mine.flatMap(draw) : [loading(m) ? loadingRow(m) : cell(empty)])];
    });
  }

  hoverPipeline(id, over, cx) {
    if (over) this.pipeHovered = id;
    else if (this.pipeHovered === id) this.pipeHovered = null;
    cx.notify();
  }

  pipeline(w) {
    return spacePipeline(w, [w.folder, place(w, this.panes)], this.panes);
  }

  spaceTree(r, t, parent = null) {
    const members = this.agents.members(r.w.id, this.attention);
    const kids = r.kids.filter(k => !this.attention || k.summary.blocked > 0);
    const pipe = this.attention ? null : this.pipeline(r.w);
    const hasChildren = members.length + kids.length + (pipe ? 1 : 0) > 0;
    const open = this.attention || (this.expanded[r.w.id] ?? !r.tree);
    const key = `space:${r.w.id}`;
    const cursor = this.navigable(key, { kind: "space", w: r.w, parent, open, hasChildren, toggle: (cx) => this.toggleSpace(r, cx) });
    const children = [
      ...(pipe ? [{ id: `pipeline-branch-${r.w.id}`, view: () => pipelineRow(r.w, pipe, t, this.agents.indicator, { hovered: this.pipeHovered === r.w.id, hover: (over, cx) => this.hoverPipeline(r.w.id, over, cx), ring: this.navigable(`pipeline:${r.w.id}`, { kind: "pipeline", w: r.w, pipe, parent: key }) }) }] : []),
      ...members.map(a => ({ id: `agent-branch-${a.address}`, view: () => this.agents.agent(a, t, this.attention, false, new Set(), { ring: this.navigable(`agent:${a.address}`, { kind: "agent", a, parent: key }) }) })),
      ...kids.map(k => ({ id: `space-branch-${k.w.id}`, view: () => this.spaceTree(k, t, key) })),
    ];
    return v_flex().id(`space-tree-${r.w.id}`).flex_none().min_w(0)
      .child(this.row({ ...r, open, hasChildren, cursor }, t))
      .when(open && hasChildren, el => el.child(v_flex().pl(r.tree ? 17 : 35).pr(3).flex_none().min_w(0)
        .children(children.map((c, i) => branch(c.view(), i === children.length - 1, t, c.id)))));
  }

  toggleSpace(r, cx) {
    this.expanded[r.w.id] = !(this.expanded[r.w.id] ?? !r.tree);
    localStorage.setItem("spaces.expanded", JSON.stringify(this.expanded));
    cx.notify();
  }

  toggleSidebar() {
    const width = find(layout(), "sidebar")?.size?.px;
    if (!narrow()) setShared("sidebar.width", width);
    setShared("sidebar.collapsed", !narrow());
    run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
  }

  // Only what's unusual, after the name: "herdr \u00b7 spike \u21912 \u21931". The repo or
  // branch goes when the name already says it (a worktree is named after its branch),
  // and master/main go: nearly every space is on one.
  gitTail(g, tree, name, t) {
    const raw = g.branch ?? "detached";
    const same = (a) => a.toLowerCase() === name.toLowerCase();
    const branch = same(raw) || raw === "master" || raw === "main" ? "" : raw;
    const repo = tree || same(g.name) ? "" : g.name;
    const where = [repo, branch].filter(Boolean).join(" \u00b7 ");
    return h_flex()
      .flex_1()
      .min_w(0)
      .gap(5)
      .justify_end()
      .items_center()
      .text_size(11.5)
      .text_color(t.muted)
      .when(Boolean(where), (el) => el.child(div().min_w(0).truncate().child(where)))
      .when(g.ahead > 0, (el) => el.child(div().flex_none().text_color(t.ansi2).child(`\u2191${g.ahead}`)))
      .when(g.behind > 0, (el) => el.child(div().flex_none().text_color(t.ansi1).child(`\u2193${g.behind}`)));
  }

  row({ w, i, g, tree, pinned, open, hasChildren, cursor }, t) {
    const on = w.active;
    const isPinned = (shared("space.pinned") ?? []).includes(w.id);
    const fromIndex = this.pressed === null ? -1 : spaces().findIndex(s => s.id === this.pressed);
    const colors = shared("space.colors") ?? {};
    const color = colors[w.id] ?? "ansi6";
    const fill = color.startsWith("#") ? color : (MARK[color] ?? t[color]);
    return v_flex()
      .relative()
      .id(`space-${w.id}`)
      .px(8)
      .h(rowHeight({ tree }))
      .flex_none()
      .justify_center()
      .rounded(8)
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .on_hover((on, cx) => {
        if (on) this.hovered = w.id;
        else if (this.hovered === w.id) this.hovered = null;
        cx.notify();
      })
      .when(this.pressed === w.id && this.over !== w.id, (el) => el.opacity(0.5))
      .when(this.pressed !== null && this.over === w.id && this.pressed !== w.id, (el) => el.child(
        div().absolute().left(0).right(0).h(2).bg(t.accent)
          .when(fromIndex < i, line => line.bottom(0))
          .when(fromIndex > i, line => line.top(0)),
      ))
      .on_mouse_down("left", () => {
        this.pressed = w.id;
        this.over = w.id;
      })
      .on_mouse_move((_e, cx) => {
        const source = spaces().find(s => s.id === this.pressed);
        const over = source && (source.machine ?? null) === (w.machine ?? null) ? w.id : null;
        if (this.pressed !== null && this.over !== over) {
          this.over = over;
          cx.notify();
        }
      })
      .on_mouse_up("left", (_e, cx) => {
        const from = this.pressed;
        const over = this.over;
        this.pressed = null;
        this.over = null;
        if (from !== null && over === w.id && from !== w.id) {
          const pins = shared("space.pinned") ?? [];
          if (pinned !== pins.includes(from)) setShared("space.pinned", pinned ? [...pins, from] : pins.filter((id) => id !== from));
          const index = spaces().findIndex(s => s.id === w.id);
          if (index !== -1) run("space.move", { id: from, index: index + 1 });
        } else if (from === w.id) run("space.select", { id: w.id });
        cx.notify();
      })
      .on_mouse_down("right", () => this.menu(w))
      .child(
        h_flex()
          .gap(6)
          .min_w(0)
          .items_center()
          .child(div().id(`space-fold-${w.id}`).w(12).h(24).flex_none().flex().items_center().justify_center().rounded(4)
            .when(hasChildren, el => el.cursor_pointer().text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
              .accessibility_label(`${open ? "Collapse" : "Expand"} ${w.name}`)
              .tooltip(this.attention ? "Show all spaces to collapse branches" : `${open ? "Collapse" : "Expand"} ${w.name}`)
              .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
              .on_mouse_up("left", (_e, cx) => cx.stop_propagation())
              .on_click((_e, cx) => {
                cx.stop_propagation();
                if (!this.attention) this.toggleSpace({ w, tree }, cx);
              })
              .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11))))
          .when(Boolean(tree), el => el.child(svg("mods/workspace-chrome/branch.svg").size(14).flex_none().text_color(t.muted)))
          .when(!tree, el => el.child(h_flex().size(18).flex_none().rounded(5).bg(fill).items_center().justify_center().text_size(11).font_bold().text_color(ink(fill)).child([...w.name][0]?.toUpperCase() ?? "?")))
          .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(w.name))
          .when(Boolean(g), el => el.child(this.gitTail(g, tree, w.name, t).flex_none().max_w(65)))
          .when(this.hovered === w.id, el => el.child(div().id(`space-focus-${w.id}`).size(24).flex_none().flex().items_center().justify_center()
            .rounded(4).text_color(t.muted).cursor_pointer().hover(s => s.bg(t.hover).text_color(t.foreground))
            .accessibility_label(`Focus ${w.name}`).tooltip("Focus this space")
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .on_mouse_up("left", (_e, cx) => cx.stop_propagation())
            .on_click((_e, cx) => {
              cx.stop_propagation();
              this.pressed = null; this.over = null; this.hovered = null;
              setShared("spaces.focus", w.id);
              run("space.select", { id: w.id });
              cx.notify();
            })
            .child(svg("mods/menu-pin/focus.svg").size(14))))
          .when(this.hovered === w.id, el => el.child(div().id(`space-hide-${w.id}`).size(24).flex_none().flex().items_center().justify_center()
            .rounded(4).text_color(t.muted).cursor_pointer().hover(s => s.bg(t.hover).text_color(t.foreground))
            .role("button").accessibility_label(`Hide ${w.name}`).tooltip("Hide space until…")
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .on_mouse_up("left", (_e, cx) => cx.stop_propagation())
            .on_click((_e, cx) => {
              cx.stop_propagation();
              this.pressed = null; this.over = null; this.hovered = null;
              this.hide(w); cx.notify();
            })
            .child(svg("mods/space-hide/eye-off.svg").size(14))))
          .when(isPinned || this.hovered === w.id, el => el.child(
            div().id(`space-pin-${w.id}`).size(24).flex_none().flex().items_center().justify_center().rounded(4).text_color(t.muted).cursor_pointer()
              .hover(s => s.bg(t.hover).text_color(t.foreground))
              .tooltip(isPinned ? "Unpin" : "Pin to the top")
              .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
              .on_mouse_up("left", (_e, cx) => cx.stop_propagation())
              .on_click((_e, cx) => {
                cx.stop_propagation();
                const pins = shared("space.pinned") ?? [];
                setShared("space.pinned", pins.includes(w.id) ? pins.filter(id => id !== w.id) : [...pins, w.id]);
                // Reordering can move the row without a hover-out event.
                this.hovered = null;
                cx.notify();
              })
              .child(svg(`mods/workspace-chrome/${isPinned && this.hovered === w.id ? "pin-off" : "pin"}.svg`).size(13)))),
      )
      .when(Boolean(cursor), (el) => el.child(this.ring(t, 8)));
  }

  compact({ w, i }, t) {
    const cursor = this.navigable(`space:${w.id}`, { kind: "space", w, parent: null, open: false, hasChildren: false });
    return railCell(h_flex()
      .id(`space-${w.id}`)
      .relative()
      .w(RAIL_CELL)
      .h(26)
      .rounded(6)
      .justify_center()
      .items_center()
      .when(w.active, (el) => el.bg(t.selected))
      .when(!w.active, (el) => el.hover((s) => s.bg(t.hover)))
      .tooltip(w.name)
      .on_click(() => run("space.select", { id: w.id }))
      .on_mouse_down("right", () => this.menu(w))
      .child(div().text_color(w.active ? t.foreground : t.muted).child(String(i + 1)))
      .when(cursor, (el) => el.child(this.ring(t, 6))));
  }

  focusedSpace(s, sp, t, collapsed) {
    const members = this.agents.members(s.id, false);
    const pipe = this.pipeline(s);
    const elsewhere = this.agents.summary(sp.filter(other => other.id !== s.id).map(other => other.id)).blocked;
    const color = (shared("space.colors") ?? {})[s.id] ?? "ansi6";
    const fill = color.startsWith("#") ? color : MARK[color] ?? t[color];
    return v_flex().id("spaces-focus-view").absolute().inset_0().min_h(0).bg(t.chrome).text_size(13)
      .child(h_flex().id("spaces-unfocus").h(35).px(collapsed ? 8 : 16).gap(6).flex_none().items_center()
        .cursor_pointer().text_color(t.muted).hover(el => el.bg(t.hover).text_color(t.foreground))
        .role("button").accessibility_label(`All spaces${elsewhere ? `, ${elsewhere} agents elsewhere need you` : ""}`)
        .tooltip(`Back to all spaces${elsewhere ? ` · ${elsewhere} need you elsewhere` : ""}`)
        .on_click(() => setShared("spaces.focus", null))
        .child(svg("mods/workspace-chrome/chevron-left.svg").size(13).flex_none())
        .when(!collapsed, el => el.child(div().flex_1().child("All spaces")))
        .when(elsewhere > 0, el => el.child(div().id("spaces-focus-elsewhere").flex_none().text_size(11).text_color(t.blocked)
          .child(collapsed ? String(elsewhere) : `${elsewhere} elsewhere`))))
      .child(h_flex().id("spaces-focus-title").h(36).px(16).gap(8).flex_none().items_center().min_w(0)
        .when(collapsed, el => el.justify_center())
        .tooltip(`${s.name}${s.machine ? ` · ${s.machine}` : ""} · Click to show this space`)
        .on_click(() => run("space.select", { id: s.id }))
        .on_mouse_down("right", () => this.menu(s))
        .child(h_flex().size(18).flex_none().rounded(5).bg(fill).items_center().justify_center().text_size(11).font_bold().text_color(ink(fill)).child([...s.name][0]?.toUpperCase() ?? "?"))
        .when(!collapsed, el => el.child(div().min_w(0).flex_1().truncate().font_medium().text_color(t.foreground).child(s.name))
          .when(Boolean(s.machine), el => el.child(div().max_w(65).truncate().text_size(11).text_color(t.muted).child(s.machine)))))
      .child(v_flex().id(`spaces-focus-list-${s.id}`).flex_1().min_h(0).px(8).pb(14).overflow_y_scrollbar().mode("always")
        .when(Boolean(pipe), el => el.child(pipelineRow(s, pipe, t, this.agents.indicator, { prefix: "focus-", compact: collapsed, hovered: this.pipeHovered === s.id, hover: (over, cx) => this.hoverPipeline(s.id, over, cx), ring: this.navigable(`pipeline:${s.id}`, { kind: "pipeline", w: s, pipe, parent: null }) })))
        .children(members.map(a => this.agents.agent(a, t, false, false, new Set(), { prefix: "focus-", compact: collapsed, ring: this.navigable(`agent:${a.address}`, { kind: "agent", a, parent: null }) })))
        .when(!members.length && !pipe, el => el.child(div().id("spaces-focus-empty").px(8).pt(12).text_size(12).text_color(t.muted)
          .tooltip("No agents in this space.").child(collapsed ? "0" : "No agents in this space."))))
      .when(collapsed, el => el.child(div().id("spaces-focus-expand-sidebar").h(28).flex_none().flex().items_center().justify_center()
        .text_color(t.muted).hover(el => el.bg(t.hover).text_color(t.foreground)).cursor_pointer().tooltip("Expand sidebar")
        .on_click(() => this.toggleSidebar()).child(svg("mods/spaces-pin/expand.svg").size(15))));
  }

  render() {
    const t = theme();
    this.nav = [];
    if (this.keyboard && this.handle.is_focused()) this.held = true;
    else if (this.keyboard && this.held) this.keyboard = false;
    const collapsed = narrow();
    const needsYouOn = shared("features")?.needsYou !== false;
    if (!needsYouOn) this.attention = false;
    const palette = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
    const sp = spaces();
    const focusId = shared("spaces.focus");
    const hidden = hiddenSpaces();
    const visible = sp.filter(s => !hidden[s.id]);
    const hiddenCount = sp.length - visible.length;
    const focus = visible.find(s => s.id === focusId);
    if (focusId && !focus) setShared("spaces.focus", null);
    this.panes = panes();
    this.agents.update(sp, this.panes);
    const attentionCount = this.agents.summary(visible.map(s => s.id)).blocked;
    const ids = new Set(sp.map(p => p.id));
    const kept = Object.fromEntries(Object.entries(shared("space.colors") ?? {}).filter(([id]) => ids.has(id)));
    let changed = Object.keys(kept).length !== Object.keys(shared("space.colors") ?? {}).length;
    for (const p of sp) {
      if (kept[p.id] || p.name === "~") continue;
      const uses = c => Object.values(kept).filter(v => v === c).length;
      kept[p.id] = palette.reduce((best, c) => uses(c) < uses(best) ? c : best);
      changed = true;
    }
    if (changed) setShared("space.colors", kept);
    // Keep the full view laid out beneath focus mode. Its native scroll region
    // retains its offset and bounds; returning doesn't rebuild a shorter list
    // or clamp the old offset against the focused space's agent count.
    const all = v_flex().id("spaces-all-view").size_full().min_h(0).bg(t.chrome).text_size(13)
      .when(Boolean(focus), el => el.invisible())
      .child(h_flex().h(35).flex_none().pl(16).pr(10).gap(6).items_center().text_size(11.5).text_color(t.muted)
        .when(collapsed, el => el.pl(0).pr(0).justify_center())
        .when(!collapsed, el => el.child(div().flex_1().child("Spaces")))
        .when(!collapsed && needsYouOn, el => el.child(div().id("spaces-needs-you").h(23).px(6).rounded(5).flex_none().flex().gap(4).items_center().cursor_pointer()
          .text_size(11).text_color(this.attention ? t.blocked : t.muted)
          .when(this.attention, el => el.bg(t.blocked + "26"))
          .hover(s => s.bg(t.hover).text_color(t.foreground))
          .accessibility_label(this.attention ? "Show all spaces" : `Show agents needing you, ${attentionCount}`)
          .tooltip(this.attention ? "Show all spaces" : "Show only agents that need you")
          .on_click((_e, cx) => { this.attention = !this.attention; localStorage.setItem("spaces.attention", String(this.attention)); cx.notify(); })
          .child("Needs you").when(attentionCount > 0, el => el.child(div().text_color(t.blocked).child(String(attentionCount))))))
        .child(div().id("space-new").size(26).flex_none().flex().items_center().justify_center().rounded(6).hover(s => s.bg(t.hover).text_color(t.foreground))
          .role("button").accessibility_label("Add a space").tooltip("Add a space")
          .on_click(() => openOverlay({ mod: "space-new", kind: "popup", width: 300, height: 114 }))
          .child(svg("mods/workspace-chrome/plus.svg").size(14))))
      .child(v_flex().id("spaces-all-list").flex_1().min_h(0).px(collapsed ? 0 : 8).pb(14).overflow_y_scrollbar().mode("always")
        .on_mouse_up("left", (_e, cx) => { this.pressed = null; cx.notify(); })
        .children(this.grouped(t, collapsed))
        .when(this.attention && attentionCount === 0, el => el.child(v_flex().px(8).pt(12).gap(8).text_size(12)
          .child(div().text_color(t.muted).child("No agents need you."))
          .child(div().id("spaces-show-all").text_color(t.accent).cursor_pointer().on_click((_e, cx) => {
            this.attention = false; localStorage.setItem("spaces.attention", "false"); cx.notify();
          }).child("Show all spaces"))))
        .when(!sp.length && !this.attention, el => el.child(div().px(8).pt(12).text_size(12).text_color(t.muted).child("Create a space to start working."))))
      .when(hiddenCount > 0, el => el.child(h_flex().id("spaces-hidden").h(32).flex_none().px(collapsed ? 8 : 16).gap(7).items_center()
        .when(collapsed, el => el.justify_center())
        .text_size(11.5).text_color(t.muted).cursor_pointer().hover(s => s.bg(t.hover).text_color(t.foreground))
        .role("button").accessibility_label(`Hidden spaces, ${hiddenCount}`).tooltip("Hidden spaces · Show a space early")
        .on_click(() => openOverlay({ mod: "space-hide", kind: "popup", width: 350, height: 420, props: { list: true } }))
        .child(svg("mods/space-hide/eye-off.svg").size(14).flex_none())
        .when(!collapsed, el => el.child(div().flex_1().child("Hidden spaces")))
        .child(String(hiddenCount))))
      .when(collapsed, el => el.child(div().id("spaces-expand-sidebar").h(28).flex_none().flex().items_center().justify_center()
        .text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground)).cursor_pointer().tooltip("Expand sidebar")
        .on_click(() => this.toggleSidebar()).child(svg("mods/spaces-pin/expand.svg").size(15))));
    if (focus) this.nav = [];
    return v_flex().id("spaces-views").relative().size_full().min_h(0)
      .when(this.keyboard, (el) => el.track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx)))
      .child(all)
      .when(Boolean(focus), el => el.child(this.focusedSpace(focus, visible, t, collapsed)));
  }
}
