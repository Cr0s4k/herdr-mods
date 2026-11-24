// Workspace spaces: stable colored avatars, worktrees under their checkout,
// grouped by machine when more than one is known. After a space's name, the repo
// its first terminal is in now, only where unusual: branch, ahead/behind.
// Agents, worktrees and terminals live under their space. Click to switch, right-click
// for its menu, drag to reorder; chevrons fold without changing focus.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { spaces, machines, panes, run, openOverlay, exec, hc, theme, shared, setShared, watchFolder, window, layout, nextCommand, readTextFile, appHome, knownAgents } from "herdr";
import { AgentTree, branch } from "./agent-tree.js";
import { hiddenSpaces, expireSpaces } from "./hide-state.js";
import { ink, watchMotion } from "./ui.js";
import { spacePipeline, pipelineRow, openPipeline, taskStages } from "./pipeline-row.js";
import { spaceTerminals, terminalRow } from "./terminal-row.js";
import { touch, quietSpaces, TRACES, sessions } from "./tidy.js";
import { recentHeader, sessionRow, closedSessions, resumeArgs } from "./recent.js";

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

// Where a space is: the folder it is locked to, else its first terminal's live folder, else where it was made.
// `ps`: panes(), read once by the caller (each read copies every pane).
function place(s, ps) {
  return homes()[s.id] || live(s, ps);
}
function live(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}
const homes = () => shared("space.homes") ?? {};
// Every folder a space's terminals are in, its own place first, then where it was made.
function places(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return [...new Set([homes()[s.id], ...ps.filter((p) => tabs.has(p.tab) && p.cwd).map((p) => p.cwd), s.folder].filter(Boolean))];
}
const rowHeight = ({ tree }) => (tree ? 28 : 30);
const RAIL_CELL = 32;
// A space's name and its git tail never shrink below this, so a short one ("api")
// stays readable instead of turning into an ellipsis next to a long branch.
const SIDE_MIN = 48;
const railCell = (el) => h_flex().flex_none().justify_center().child(el);
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
const spot = (s, cwd) => JSON.stringify([s.machine ?? null, cwd]);
const base = (path) => path.replace(/\/+$/, "").split("/").pop();
// A repo's name from its git folder: the folder holding .git, a bare repo's own
// name, or the folder holding a hidden bare repo (<project>/.bare).
const repoName = (common) => {
  if (common.endsWith("/.git")) return base(common.slice(0, -5));
  const own = base(common);
  return own === ".bare" ? base(common.slice(0, -own.length - 1)) : own.replace(/\.git$/, "");
};
// Changes made outside Herdr (an editor's save, a commit in another app): looked
// for this often, in repos the list shows, while the window is in front.
const FALLBACK = 60000;
// Places looked at together (two git runs each). All at once, a few hundred spaces
// run out of the app's open files (256 when started from the Dock on macOS) or
// past a machine core's 16 running execs, and those spaces wait for FALLBACK.
const AT_ONCE = 6;

// Both runs, finished: a place isn't done while one of its runs still holds a slot.
async function both(a, b) {
  const done = await Promise.allSettled([a, b]);
  const failed = done.find((d) => d.status === "rejected");
  if (failed) throw failed.reason;
  return done.map((d) => d.value);
}

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
    try { this.used = JSON.parse(localStorage.getItem("spaces.lastUsed") ?? "{}"); } catch { this.used = {}; }
    this.seeding = new Set();
    if (!this.used || typeof this.used !== "object" || Array.isArray(this.used)) this.used = {};
    this.tidying = null; // { last, at }: the order Tidy asked for, until Herdr's order has it
    this.git = {}; // where() -> { name, branch, ahead, behind, repo, top, linked }, null: not a repo
    this.checked = {}; // where() -> when it was last looked at
    this.unsure = new Set(); // where()s git couldn't answer for (a machine away)
    this.pending = new Set(); // where()s to look at next
    this.busy = {}; // pane -> an agent working or a program in front of its shell
    this.ready = {}; // machine -> its layout was readable at the last look
    this.at = {}; // space -> its where() at the last look
    this.watching = new Map(); // local repos' pending folder watches
    this.naming = new Set();
    // Spaces made while this runs wait (at most a moment) for their git, so a
    // worktree appears under its repo instead of jumping there.
    this.shown = new Set(spaces().map((s) => s.id));
    this.born = {};
    this.pressed = null;
    this.over = null;
    this.hovered = null;
    this.scroll = ScrollHandle.new(); // the list's position: the active space is brought into view through it
    this.activeAt = -1; // the active space's place among the list's children (headers and rows), -1 when not drawn
    this.machines = [];
    try {
      this.reconnecting = JSON.parse(localStorage.getItem("machines.reconnecting") ?? "{}");
      if (!this.reconnecting || typeof this.reconnecting !== "object" || Array.isArray(this.reconnecting)) this.reconnecting = {};
      for (const state of Object.values(this.reconnecting)) state.busy = false;
    } catch { this.reconnecting = {}; }
    try { this.folded = new Set(JSON.parse(localStorage.getItem("machines.folded") ?? "[]")); } catch { this.folded = new Set(); }
    this.refreshMachines(cx);
    cx.timer.every(15000, cx => this.refreshMachines(cx));
    // Refresh only when the refs could have changed (see `due`).
    cx.timer.every(250, (cx) => this.checkNew(cx));
    try { this.recentOpen = new Set(JSON.parse(localStorage.getItem("spaces.recent") ?? "[]")); } catch { this.recentOpen = new Set(); }
    this.recent = {}; // space -> its folder's conversations at the last read
    cx.timer.every(5000, (cx) => this.readRecent(cx));
    this.handle = cx.focus_handle();
    this.keyboard = false;
    this.cursor = null;
    this.nav = [];
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "tidy") { this.tidy(); cx.notify(); continue; }
        if (command === "needs-you") { this.toggleAttention(cx); continue; }
        if (command !== "focus") continue;
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
        else if (item.act) item.act(cx);
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
      case "t": this.tidy(); break;
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
    const sp = spaces(), ps = panes();
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    this.use(now, sp, ps);
    this.seed(sp, ps, cx);
    const due = this.due(now, sp, ps);
    if (due.size) this.refreshGit(due, cx);
    if (sp.some((s) => !this.shown.has(s.id)) || this.orderingDue(now)) cx.notify();
  }

  // Places whose git could have changed: new ones (a new space, a cd), where a
  // command or an agent's turn just ended (a checkout, a commit, edits), those on
  // a machine that is back, and repos in view whose fallback is due.
  due(now, sp, ps) {
    // Moved there: what it knew of that place may be old.
    const at = {};
    const keys = new Set();
    for (const s of sp) {
      at[s.id] = this.home(s, ps).key;
      for (const cwd of places(s, ps)) keys.add(spot(s, cwd));
    }
    for (const k of Object.keys(this.git)) if (!keys.has(k)) {
      delete this.git[k];
      delete this.checked[k];
      this.unsure.delete(k);
    }
    const repos = new Set(Object.values(this.git).filter(Boolean).map((g) => g.repo));
    for (const [repo, pending] of this.watching) if (!repos.has(JSON.stringify([null, repo]))) {
      this.watching.delete(repo);
      pending.cancel();
    }
    const due = new Set([...keys].filter((k) => !(k in this.git)));
    for (const [id, k] of Object.entries(at)) if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane]) {
        const s = spaceOf[p.tab];
        [...this.sameRepo(at[s.id], keys), ...(p.cwd ? this.sameRepo(spot(s, p.cwd), keys) : [])].forEach((k) => due.add(k));
      }
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
        let next = 0;
        await Promise.all(Array.from({ length: Math.min(AT_ONCE, keys.length) }, async () => {
          while (next < keys.length) await this.check(keys[next++], cx);
        }));
      }
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
      // Ref-only reads avoid scanning the worktree or waking its index watch.
      // Two reads: a folder name may itself contain a newline.
      const [r, common] = await both(
        exec("git", ["rev-parse", "--path-format=absolute", "--show-toplevel"], { cwd, on }),
        exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on }),
      );
      if (r.code !== 0 || common.code !== 0) {
        // Only git's own "no" is remembered as no repo; anything else is asked again.
        if (!/not a git repository/i.test(r.code !== 0 ? r.stderr : common.stderr)) {
          this.unsure.add(key);
          this.git[key] ??= null;
        } else this.git[key] = null;
        return;
      }
      // The repo's own .git folder names it; a worktree's top differs from it.
      const top = r.stdout.replace(/\n$/, ""), repo = common.stdout.replace(/\n$/, "");
      const [branch, counts] = await both(
        exec("git", ["symbolic-ref", "-q", "HEAD"], { cwd, on }),
        exec("git", ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], { cwd, on }),
      );
      const name = repoName(repo);
      const [ahead, behind] = counts.code === 0 ? counts.stdout.trim().split(/\s+/).map(Number) : [0, 0];
      const info = { name, branch: branch.code === 0 ? branch.stdout.trim().replace(/^refs\/heads\//, "") : "(detached)", ahead, behind, repo: JSON.stringify([on, repo]), top, linked: repo !== `${top}/.git` };
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
    const pending = watchFolder(repo);
    this.watching.set(repo, pending);
    cx.spawn(async (cx) => {
      let current = pending;
      try {
        for (;;) {
          await current;
          if (this.watching.get(repo) !== current) return;
          const mine = JSON.stringify([null, repo]);
          const keys = Object.keys(this.git).filter((k) => this.git[k]?.repo === mine);
          if (!keys.length) break;
          this.refreshGit(keys, cx);
          current = watchFolder(repo);
          this.watching.set(repo, current);
        }
      } catch {}
      if (this.watching.get(repo) === current) this.watching.delete(repo);
    });
  }

  // Herdr names an unnamed space after its first terminal's folder, so a Pipeline
  // task's worktree can take it over. While one of its terminals, or the folder it
  // was made in, is in that repo's checkout, the space stays there and keeps its name.
  home(s, ps) {
    const keys = places(s, ps).map((cwd) => spot(s, cwd));
    const first = keys[0] ?? where(s, ps), g = this.git[first];
    const main = g?.linked ? keys.find((k) => this.git[k] && !this.git[k].linked && this.git[k].repo === g.repo) : null;
    const key = main ?? first;
    return { key, g: this.git[key] ?? null, name: main && !s.named ? this.git[main].name : s.name };
  }

  // Herdr names an unnamed space after its first terminal's live folder, so a cd renames it.
  // A space keeps the name and folder it first has outside home; renamed to "", it takes them anew.
  lock(sp, ps) {
    const before = homes(), ids = new Set(sp.map((s) => s.id));
    const stale = Object.keys(before).length > 200;
    const kept = stale ? Object.fromEntries(Object.entries(before).filter(([id]) => ids.has(id))) : { ...before };
    let changed = Object.keys(kept).length !== Object.keys(before).length;
    for (const s of sp) {
      if (s.named && kept[s.id]) { this.naming.delete(s.id); continue; }
      if (this.naming.has(s.id)) continue;
      if (kept[s.id]) { delete kept[s.id]; changed = true; continue; }
      if (!s.named && s.name === "~") continue;
      // A worktree terminal may be first: the checkout it belongs to is only known once git has answered.
      const keys = [live(s, ps), ...places(s, ps)].filter(Boolean).map((cwd) => spot(s, cwd));
      if (!keys.length || keys.some((k) => !(k in this.git) || this.unsure.has(k))) continue;
      const h = this.home(s, ps), folder = h.g?.top || JSON.parse(h.key)[1];
      if (!folder || (s.named && !h.g)) continue;
      kept[s.id] = folder; changed = true;
      if (!s.named && !this.naming.has(s.id)) {
        this.naming.add(s.id);
        run("space.rename", { id: s.id, name: h.name });
      }
    }
    if (changed) setShared("space.homes", kept);
  }

  // A space's agents in another worktree than the space's own go under a node per worktree.
  worktrees(w, members, home) {
    const direct = [], trees = new Map();
    const own = this.git[home]?.top;
    const cwd = new Map(this.panes.map((p) => [p.pane, p.cwd]));
    for (const a of members) {
      const g = cwd.get(a.pane) ? this.git[spot(w, cwd.get(a.pane))] : null;
      if (!g?.linked || !g.top || g.top === own) { direct.push(a); continue; }
      if (!trees.has(g.top)) trees.set(g.top, { g, agents: [] });
      trees.get(g.top).agents.push(a);
    }
    return { direct, trees: [...trees.values()] };
  }

  worktree(w, wt, n, t, agent, { prefix = "", compact = false } = {}) {
    const { g, agents } = wt;
    const row = h_flex().id(`${prefix}worktree-${w.id}-${n}`).h(28).px(5).gap(6).min_w(0).flex_none().rounded(6).items_center()
      .when(compact, el => el.justify_center())
      .cursor_pointer().hover(s => s.bg(t.hover))
      .accessibility_label(`Worktree ${g.branch}`).tooltip(`Worktree · ${g.branch} · ${g.top}`)
      .on_click(() => run("pane.focus", { pane: agents[0].pane }))
      .child(svg("mods/workspace-chrome/branch.svg").size(14).flex_none().text_color(t.muted))
      .when(!compact, el => el.child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.muted).child(g.branch)));
    return v_flex().id(`${prefix}worktree-tree-${w.id}-${n}`).min_w(0).flex_none().child(row)
      .child(compact
        ? v_flex().flex_none().children(agents.map(agent))
        : v_flex().pl(12).flex_none().children(agents.map((a, i) => branch(agent(a), i === agents.length - 1, t, `${prefix}worktree-agent-${a.address}`))));
  }

  menu(w) {
    // A popup is as tall as its items; height is only the most.
    openOverlay({ mod: "menu-pin", kind: "popup", width: 200, height: 310, props: { tab: "space", target: { id: w.id } } });
  }

  hide(w) {
    openOverlay({ mod: "space-hide", kind: "popup", width: 330, height: 350, props: { id: w.id } });
  }

  use(now, sp, ps) {
    const used = touch(this.used, sp, ps, now, window().active);
    if (used === this.used) return;
    this.used = used;
    localStorage.setItem("spaces.lastUsed", JSON.stringify(used));
  }

  // A space first seen: when its folder was last worked in, as far as the folder shows. One made now is in use.
  seed(sp, ps, cx) {
    const keep = (id, at) => {
      this.used = { [id]: at, ...this.used };
      localStorage.setItem("spaces.lastUsed", JSON.stringify(this.used));
    };
    for (const s of sp) {
      if (s.id in this.used || this.seeding.has(s.id)) continue;
      const h = this.home(s, ps);
      if (!(h.key in this.git) || this.unsure.has(h.key)) continue;
      this.seeding.add(s.id);
      if (this.born[s.id]) { keep(s.id, Date.now()); continue; }
      const [on, cwd] = JSON.parse(h.key), folder = h.g?.top || cwd;
      cx.spawn(async (cx) => {
        let at = NaN;
        try { at = Number((await exec("sh", ["-c", TRACES, "sh", folder, sessions(folder)], { on })).stdout.trim()) * 1000; } catch {}
        keep(s.id, at > 0 ? at : Date.now());
        cx.notify();
      });
    }
  }

  toggleAttention(cx) {
    this.attention = !this.attention;
    localStorage.setItem("spaces.attention", String(this.attention));
    cx.notify();
  }

  // Most recently used first, pinned ones among the pinned; spaces unused for an hour fold.
  tidy() {
    const now = Date.now(), sp = spaces();
    this.use(now, sp, panes());
    const quiet = quietSpaces(this.used, sp, now);
    this.tidying = { last: Object.fromEntries(sp.map((s) => [s.id, s.active ? now : this.used[s.id] ?? now])), at: now };
    const rows = this.ordered();
    rows.forEach((r, n) => {
      let end = n + 1;
      if (!r.tree) while (rows[end]?.tree) end++;
      if (rows.slice(n, end).every((k) => quiet.has(k.w.id))) this.expanded[r.w.id] = false;
    });
    localStorage.setItem("spaces.expanded", JSON.stringify(this.expanded));
  }

  orderingDue(now) {
    return this.ordering && now - this.ordering.at >= 1000
      && this.ordering.machines.every(name => machines().some(m => m.name === name && m.layout === "ready"));
  }

  // Spaces in order, each worktree space moved under its main checkout's.
  ordered() {
    const sp = spaces(), ps = panes();
    const ready = (w) => this.shown.has(w.id) || places(w, ps).every((cwd) => spot(w, cwd) in this.git) || Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    const list = sp.map((w, i) => { const h = this.home(w, ps); return { w, i, g: h.g, home: h.key, name: h.name }; });
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
    if (this.tidying && Date.now() - this.tidying.at > 10000) this.tidying = null;
    const last = this.tidying?.last;
    const recent = (c) => Math.max(...c.map((r) => last[r.w.id] ?? 0));
    const out = [...new Set(clusters.map((c) => c[0].w.machine ?? null))].flatMap((m) => {
      const mine = clusters.filter((c) => (c[0].w.machine ?? null) === m);
      const sort = (list) => last ? list.sort((a, b) => recent(b) - recent(a)) : list;
      const top = sort(mine.filter(isPinned)), rest = sort(mine.filter((c) => !isPinned(c)));
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
      this.tidying = null;
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
    // Where the active space lands among the children this returns: the list scrolls by its direct
    // children, and machine headers, login notes, loading rows and pin lines count too.
    this.activeAt = -1;
    let before = 0;
    const activeIn = (r) => {
      if (r.w.active) return 0;
      const at = r.kids.filter(k => !this.attention || k.summary.blocked > 0).findIndex(k => k.w.active);
      return at < 0 ? -1 : collapsed ? 1 + at : 0;
    };
    const drawAll = (list, from) => list.flatMap((r) => {
      const items = draw(r), at = activeIn(r);
      if (at >= 0) this.activeAt = from + at;
      from += items.length;
      return items;
    });
    const remote = [...new Set([...rows.map(r => r.w.machine).filter(Boolean), ...this.machines.map(m => m.name), ...Object.keys(this.reconnecting)])].sort();
    const loading = m => {
      const layout = machines().find(k => k.name === m)?.layout;
      return layout === "loading" || (!layout && this.machines.some(k => k.name === m && k.state === "connected"))
        || spaces().some(s => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    const loadingRow = m => h_flex().id(`machine-loading-${m ?? "local"}`).h(28).flex_none().px(collapsed ? 0 : 8).items_center().when(collapsed, el => el.justify_center()).text_size(12).text_color(t.muted).child(collapsed ? "…" : "Loading…");
    if (!remote.length) return loading(null) && !rows.length ? [loadingRow(null)] : drawAll(visible, 0);
    const machineNames = [null, ...remote];
    return machineNames.flatMap((m) => {
      const mine = visible.filter((r) => (r.w.machine ?? null) === m);
      if (this.attention && !mine.length) return [];
      const repair = this.reconnecting[m];
      const machine = this.machines.find(k => k.name === m) ?? repair?.machine;
      const connected = !m || machine?.state === "connected";
      const rebuilt = this.rebuilt(machine) || !!repair;
      const login = machine?.state === "needs_login" ? `hc machine login ${m}` : null;
      const folded = !this.attention && this.folded.has(m);
      const icon = svg(`mods/workspace-chrome/${m ? "server" : "monitor"}.svg`).size(13).flex_none();
      const badge = div().absolute().right(-3).bottom(-2).size(6).rounded(3).border_1().border_color(t.chrome).bg(connected ? t.ansi2 : t.dim);
      const head = h_flex().id(`machine-${m ?? "local"}`).h(26).flex_none().px(collapsed ? 0 : 8).gap(7).items_center().text_size(11).text_color(t.muted)
        .when(collapsed, el => el.mt(4).w(RAIL_CELL).justify_center().rounded(6).tooltip(login ? `${m} needs a login: run ${login}. Click for Copy.` : m ? `${m} · ${connected ? "connected" : (machine?.state ?? "asleep").replace(/_/g, " ")}` : "This computer"))
        .cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => {
          if (collapsed && login) { run("app.settings", { section: "machines" }); return; }
          folded ? this.folded.delete(m) : this.folded.add(m);
          localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
          cx.notify();
        })
        .when(machine?.keeps_running_after_logout === false, el => el.child(div().id(`machine-logout-${m}`)
          .flex_none().text_color(t.blocked).tooltip("Agents stop when you disconnect. Click for the fix.")
          .on_click((_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "machine-add", kind: "dialog", width: 560 }); }).child("⚠")))
        .when(!collapsed, el => el.child(icon))
        .when(collapsed, el => el.child(div().relative().flex_none().child(icon).when(Boolean(m), el => el.child(badge))))
        .when(!collapsed, el => el.child(div().flex_1().truncate().child(m ?? "This computer"))
          .when(!connected && !rebuilt && !login, el => el.child(div().flex_none().child((machine?.state ?? "asleep").replace(/_/g, " "))))
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
      if (!collapsed && rebuilt) { before += 1; return [head]; }
      const cell = collapsed ? railCell : (el) => el;
      const guidance = !collapsed && login ? [v_flex().px(8).pb(6).gap(3).flex_none()
        .child(div().text_size(11).text_color(t.blocked).child("needs a login: run"))
        .child(h_flex().gap(5).items_center()
          .child(div().flex_1().min_w(0).truncate().tooltip(login).text_size(11).text_color(t.muted).child(login))
          .child(div().id(`machine-login-copy-${m}`).flex_none().px(5).py(2).rounded(4)
            .text_size(11).text_color(t.foreground).bg(t.raised).cursor_pointer().hover(s => s.bg(t.hover))
            .on_click((_e, cx) => { cx.stop_propagation(); cx.write_to_clipboard(login); this.copiedLogin = login; cx.notify(); })
            .child(this.copiedLogin === login ? "Copied" : "Copy")))] : [];
      const items = [cell(head), ...guidance, ...(folded ? [] : mine.length ? drawAll(mine, before + 1 + guidance.length) : [loading(m) ? loadingRow(m) : cell(empty)])];
      before += items.length;
      return items;
    });
  }

  hoverPipeline(id, over, cx) {
    if (over) this.pipeHovered = id;
    else if (this.pipeHovered === id) this.pipeHovered = null;
    cx.notify();
  }

  folder(w) {
    const h = this.home(w, this.panes), [on, cwd] = JSON.parse(h.key);
    return { on, cwd: h.g?.top || cwd };
  }

  // Read for the spaces whose Recent row is open, again once a minute.
  readRecent(cx) {
    for (const w of spaces()) {
      if (!this.recentOpen.has(w.id)) continue;
      const { on, cwd } = this.folder(w), had = this.recent[w.id];
      if (!cwd || had?.loading || (had?.cwd === cwd && Date.now() - had.at < 60000)) continue;
      this.recent[w.id] = { rows: [], ...had, cwd, loading: true };
      cx.spawn(async (cx) => {
        let rows = had?.cwd === cwd ? had.rows : [];
        try {
          this.recentScript ??= await readTextFile(`${appHome()}/mods/spaces-pin/recent.py`);
          rows = JSON.parse((await exec("python3", ["-c", this.recentScript, JSON.stringify({ cwd })], { on, timeout: 15000 })).stdout).data ?? rows;
        } catch {}
        this.recent[w.id] = { cwd, rows, at: Date.now(), loading: false };
        cx.notify();
      });
    }
  }

  toggleRecent(w, cx) {
    this.recentOpen.has(w.id) ? this.recentOpen.delete(w.id) : this.recentOpen.add(w.id);
    localStorage.setItem("spaces.recent", JSON.stringify([...this.recentOpen]));
    this.readRecent(cx);
    cx.notify();
  }

  resume(w, session, cx) {
    const { on, cwd } = this.folder(w);
    cx.spawn(async (cx) => {
      const agent = (await knownAgents({ on })).find(a => a.key === session.agent && a.installed);
      if (!agent) return;
      run("tab.new", { space: w.id, folder: cwd, argv: resumeArgs(agent, session), name: session.title.slice(0, 28) });
      const had = this.recent[w.id];
      if (had) this.recent[w.id] = { ...had, rows: had.rows.filter(row => row.id !== session.id) };
      cx.notify();
    });
  }

  // The Recent row and, when open, the folder's closed conversations.
  recentItems(w, t, parent, prefix = "") {
    if (shared("features")?.recent === false) return [];
    const open = this.recentOpen.has(w.id), key = `recent:${w.id}`, cwd = this.recent[w.id]?.cwd;
    const here = this.agents.list.filter(a => a.space === w.id && this.panes.find(p => p.pane === a.pane)?.cwd === cwd);
    const rows = open ? closedSessions(this.recent[w.id]?.rows ?? [], here).slice(0, 8) : [];
    return [
      { id: `${prefix}recent-branch-${w.id}`, view: () => recentHeader(w, open, t, { prefix, toggle: cx => this.toggleRecent(w, cx), ring: this.navigable(key, { kind: "recent", w, parent, act: cx => this.toggleRecent(w, cx) }) }) },
      ...rows.map(session => ({ id: `${prefix}session-branch-${session.id}`, view: () => sessionRow(w, session, t, { prefix, resume: cx => this.resume(w, session, cx),
        ring: this.navigable(`session:${w.id}:${session.id}`, { kind: "session", w, parent, act: cx => this.resume(w, session, cx) }) }) })),
    ];
  }

  pipeline(w) {
    return spacePipeline(w, [w.folder, place(w, this.panes)], this.panes);
  }

  terminals(w) {
    return shared("features")?.terminals === false ? [] : spaceTerminals(w, this.panes, this.agents.list);
  }

  spaceTree(r, t, parent = null) {
    const members = this.agents.members(r.w.id, this.attention);
    const kids = r.kids.filter(k => !this.attention || k.summary.blocked > 0);
    const pipe = this.attention ? null : this.pipeline(r.w);
    const terms = this.attention ? [] : this.terminals(r.w);
    const recent = this.attention ? [] : this.recentItems(r.w, t, `space:${r.w.id}`);
    const hasChildren = members.length + kids.length + terms.length + recent.length + (pipe ? 1 : 0) > 0;
    const open = this.attention || (this.expanded[r.w.id] ?? !r.tree);
    const key = `space:${r.w.id}`;
    const cursor = this.navigable(key, { kind: "space", w: r.w, parent, open, hasChildren, toggle: (cx) => this.toggleSpace(r, cx) });
    const agent = a => this.agents.agent(a, t, this.attention, false, new Set(), { ring: this.navigable(`agent:${a.address}`, { kind: "agent", a, parent: key }) });
    const { direct, trees } = this.worktrees(r.w, members, r.home);
    const children = [
      ...(pipe ? [{ id: `pipeline-branch-${r.w.id}`, view: () => pipelineRow(r.w, pipe, t, this.agents.indicator, { hovered: this.pipeHovered === r.w.id, hover: (over, cx) => this.hoverPipeline(r.w.id, over, cx), ring: this.navigable(`pipeline:${r.w.id}`, { kind: "pipeline", w: r.w, pipe, parent: key }) }) }] : []),
      ...direct.map(a => ({ id: `agent-branch-${a.address}`, view: () => agent(a) })),
      ...trees.map((wt, n) => ({ id: `worktree-branch-${r.w.id}-${n}`, view: () => this.worktree(r.w, wt, n, t, agent) })),
      ...terms.map(term => ({ id: `term-branch-${term.p.pane}`, view: () => terminalRow(r.w, term, t, { ring: this.navigable(`term:${term.p.pane}`, { kind: "terminal", a: term.p, parent: key }) }) })),
      ...recent,
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
  // and master/main go: nearly every space is on one. When the row is full, it
  // and the name both start from their text's width and give way in proportion.
  gitTail(g, tree, name, t) {
    const raw = g.branch ?? "detached";
    const same = (a) => a.toLowerCase() === name.toLowerCase();
    const branch = same(raw) || raw === "master" || raw === "main" ? "" : raw;
    const repo = tree || same(g.name) ? "" : g.name;
    const where = [repo, branch].filter(Boolean).join(" \u00b7 ");
    return h_flex()
      .flex_auto()
      .min_w(where ? SIDE_MIN : 0)
      .gap(5)
      .justify_end()
      .items_center()
      .text_size(11.5)
      .text_color(t.muted)
      .when(Boolean(where), (el) => el.child(div().min_w(0).truncate().child(where)))
      .when(g.ahead > 0, (el) => el.child(div().flex_none().text_color(t.ansi2).child(`\u2191${g.ahead}`)))
      .when(g.behind > 0, (el) => el.child(div().flex_none().text_color(t.ansi1).child(`\u2193${g.behind}`)));
  }

  row({ w, i, g, name, tree, pinned, open, hasChildren, cursor }, t) {
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
              .accessibility_label(`${open ? "Collapse" : "Expand"} ${name}`)
              .tooltip(this.attention ? "Show all spaces to collapse branches" : `${open ? "Collapse" : "Expand"} ${name}`)
              .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
              .on_mouse_up("left", (_e, cx) => cx.stop_propagation())
              .on_click((_e, cx) => {
                cx.stop_propagation();
                if (!this.attention) this.toggleSpace({ w, tree }, cx);
              })
              .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11))))
          .when(Boolean(tree), el => el.child(svg("mods/workspace-chrome/branch.svg").size(14).flex_none().text_color(t.muted)))
          .when(!tree, el => el.child(h_flex().size(18).flex_none().rounded(5).bg(fill).items_center().justify_center().text_size(11).font_bold().text_color(ink(fill)).child([...name][0]?.toUpperCase() ?? "?")))
          .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(name))
          .when(Boolean(g), el => el.child(this.gitTail(g, tree, name, t).flex_none().max_w(65)))
          .when(this.hovered === w.id, el => el.child(div().id(`space-focus-${w.id}`).size(24).flex_none().flex().items_center().justify_center()
            .rounded(4).text_color(t.muted).cursor_pointer().hover(s => s.bg(t.hover).text_color(t.foreground))
            .accessibility_label(`Focus ${name}`).tooltip("Focus this space")
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
            .role("button").accessibility_label(`Hide ${name}`).tooltip("Hide space until…")
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

  compact({ w, i, name }, t) {
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
      .tooltip(name)
      .on_click(() => run("space.select", { id: w.id }))
      .on_mouse_down("right", () => this.menu(w))
      .child(div().text_color(w.active ? t.foreground : t.muted).child(String(i + 1)))
      .when(cursor, (el) => el.child(this.ring(t, 6))));
  }

  focusedSpace(s, sp, t, collapsed) {
    const members = this.agents.members(s.id, false);
    const pipe = this.pipeline(s);
    const terms = this.terminals(s);
    const home = this.home(s, this.panes), name = home.name;
    const { direct, trees } = this.worktrees(s, members, home.key);
    const agent = a => this.agents.agent(a, t, false, false, new Set(), { prefix: "focus-", compact: collapsed, ring: this.navigable(`agent:${a.address}`, { kind: "agent", a, parent: null }) });
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
        .tooltip(`${name}${s.machine ? ` · ${s.machine}` : ""} · Click to show this space`)
        .on_click(() => run("space.select", { id: s.id }))
        .on_mouse_down("right", () => this.menu(s))
        .child(h_flex().size(18).flex_none().rounded(5).bg(fill).items_center().justify_center().text_size(11).font_bold().text_color(ink(fill)).child([...name][0]?.toUpperCase() ?? "?"))
        .when(!collapsed, el => el.child(div().min_w(0).flex_1().truncate().font_medium().text_color(t.foreground).child(name))
          .when(Boolean(s.machine), el => el.child(div().max_w(65).truncate().text_size(11).text_color(t.muted).child(s.machine)))))
      .child(v_flex().id(`spaces-focus-list-${s.id}`).flex_1().min_h(0).px(8).pb(14).overflow_y_scrollbar().mode("always")
        .when(Boolean(pipe), el => el.child(pipelineRow(s, pipe, t, this.agents.indicator, { prefix: "focus-", compact: collapsed, hovered: this.pipeHovered === s.id, hover: (over, cx) => this.hoverPipeline(s.id, over, cx), ring: this.navigable(`pipeline:${s.id}`, { kind: "pipeline", w: s, pipe, parent: null }) })))
        .children(direct.map(agent))
        .children(trees.map((wt, n) => this.worktree(s, wt, n, t, agent, { prefix: "focus-", compact: collapsed })))
        .children(terms.map(term => terminalRow(s, term, t, { prefix: "focus-", compact: collapsed, ring: this.navigable(`term:${term.p.pane}`, { kind: "terminal", a: term.p, parent: null }) })))
        .when(!collapsed, el => el.children(this.recentItems(s, t, null, "focus-").map(item => item.view())))
        .when(!members.length && !pipe && !terms.length, el => el.child(div().id("spaces-focus-empty").px(8).pt(12).text_size(12).text_color(t.muted)
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
    this.lock(sp, this.panes);
    this.agents.update(sp, this.panes);
    this.agents.tasks = taskStages();
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
    const list = this.grouped(t, collapsed);
    // Bring the active space into view when it, or its place in the list, changes; a row already in view stays put.
    const active = sp.find(p => p.active)?.id;
    if (active !== this.revealed || this.activeAt !== this.revealedAt) {
      this.revealed = active;
      this.revealedAt = this.activeAt;
      if (this.activeAt >= 0) this.scroll.scroll_to_item(this.activeAt);
    }
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
          .on_click((_e, cx) => this.toggleAttention(cx))
          .child("Needs you").when(attentionCount > 0, el => el.child(div().text_color(t.blocked).child(String(attentionCount))))))
        .when(!collapsed, el => el.child(div().id("spaces-tidy").size(26).flex_none().flex().items_center().justify_center().rounded(6).cursor_pointer()
          .hover(s => s.bg(t.hover).text_color(t.foreground))
          .role("button").accessibility_label("Tidy spaces").tooltip("Tidy · Most recently used spaces first; fold those unused for an hour")
          .on_click((_e, cx) => { this.tidy(); cx.notify(); })
          .child(svg("mods/spaces-pin/tidy.svg").size(14))))
        .child(div().id("space-new").size(26).flex_none().flex().items_center().justify_center().rounded(6).hover(s => s.bg(t.hover).text_color(t.foreground))
          .role("button").accessibility_label("Add a space").tooltip("Add a space")
          .on_click(() => openOverlay({ mod: "space-new", kind: "popup", width: 300, height: 114 }))
          .child(svg("mods/workspace-chrome/plus.svg").size(14))))
      .child(v_flex().id("spaces-all-list").flex_1().min_h(0).px(collapsed ? 0 : 8).pb(14).overflow_y_scrollbar().mode("always").track_scroll(this.scroll)
        // A block above (another mod's) growing, or the window resizing, shrinks this list and can push the active space out.
        .on_size_change((_size, cx) => { if (this.activeAt >= 0) { this.scroll.scroll_to_item(this.activeAt); cx.notify(); } })
        .on_mouse_up("left", (_e, cx) => { this.pressed = null; cx.notify(); })
        .children(list)
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
