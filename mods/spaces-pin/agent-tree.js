import { div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, terminals, focused, run, setAgentOrder } from "herdr";

const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
const statusName = (s) => ({ blocked: "Needs you", done: "Done", working: "Working", idle: "Idle" }[s] ?? "Unknown");
const icon = (p, t) => !p?.icon ? null : p.tint
  ? svg(p.icon).size(14).flex_none().text_color(t.foreground)
  : image(p.icon).w(14).h(14).flex_none();

// A branch spans the whole subtree; the last branch stops at its own row.
// Drawing the strokes as elements keeps them continuous at any UI scale.
export function branch(content, last, t, id) {
  return v_flex().id(id).relative().pl(12).flex_none()
    .child(div().absolute().left(0).top(0).w(1).bg(t.border)
      .when(last, el => el.h(14)).when(!last, el => el.bottom(0)))
    .child(div().absolute().left(0).top(14).h(1).w(10).bg(t.border))
    .child(content);
}

export class AgentTree {
  constructor() {
    this.expanded = new Set(JSON.parse(localStorage.getItem("agents.expanded") ?? "[]"));
    this.hovered = null;
  }

  update(spaces, panes) {
    this.list = agents();
    this.shown = focused()?.agent;
    this.bySpace = new Map();
    this.children = new Map();
    this.listed = new Map(this.list.map(a => [a.address, a]));
    // A kept subagent has its own pane and is already a top-level agent.
    for (const k of terminals()) {
      if (k.state !== "live" || !k.parent || this.listed.has(k.address)) continue;
      if (!this.children.has(k.parent)) this.children.set(k.parent, []);
      this.children.get(k.parent).push(k);
    }
    const tabs = new Map(spaces.flatMap(s => s.tabs ?? []).map(tab => [tab.id, tab]));
    const ps = new Map(panes.map(p => [p.pane, p]));
    this.labels = new Map();
    for (const a of this.list) {
      const tab = tabs.get(a.tab);
      const raw = (ps.get(a.pane)?.title || a.title || "").trim();
      const live = clean(raw);
      const telling = live && live !== a.program?.name && live.toLowerCase() !== a.program?.key
        && !/^[~/]|^[A-Za-z]:\\/.test(raw) && !/^\d+$/.test(live) && !live.includes("@");
      const label = tab?.named ? tab.name : telling ? live : a.program?.name || a.app || "Agent";
      this.labels.set(a.address, label);
      if (!this.bySpace.has(a.space)) this.bySpace.set(a.space, []);
      this.bySpace.get(a.space).push(a);
    }
    for (const members of this.bySpace.values()) {
      const counts = new Map();
      for (const a of members) {
        const label = this.labels.get(a.address);
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
      const original = new Map(this.labels);
      for (const a of members) if (counts.get(original.get(a.address)) > 1) {
        const sameTab = members.filter(b => b.tab === a.tab && original.get(b.address) === original.get(a.address)).length > 1;
        // The address is also stable when split panes share a named tab.
        this.labels.set(a.address, `${this.labels.get(a.address)} · ${sameTab ? a.address : a.tab_index}`);
      }
      members.sort((a, b) => Number(b.pinned) - Number(a.pinned));
    }
  }

  descendants(address, seen = new Set()) {
    if (seen.has(address)) return [];
    seen.add(address);
    return (this.children.get(address) ?? []).flatMap(k => [k, ...this.descendants(k.address, seen)]);
  }

  state(a) {
    if (this.listed.has(a.address)) return a.status;
    // Subagents report completion to their parent; only the parent is unread.
    return a.status === "error" ? "blocked" : a.status === "done" ? "idle" : a.status;
  }

  states(a) {
    return [this.state(a), ...this.descendants(a.address).map(k => this.state(k))];
  }

  needs(a) { return this.states(a).includes("blocked"); }

  summary(ids) {
    const counts = {};
    for (const id of ids) for (const a of this.bySpace.get(id) ?? []) {
      for (const s of this.states(a)) counts[s] = (counts[s] ?? 0) + 1;
    }
    const status = Object.keys(RANK).find(s => counts[s]) ?? null;
    return { status, count: counts[status] ?? 0, blocked: counts.blocked ?? 0 };
  }

  order(rows) {
    // Folded branches stay in the keyboard cycle, so hiding a branch never
    // makes a running agent unreachable with agent.next / agent.prev.
    setAgentOrder(rows.flatMap(r => (this.bySpace.get(r.w.id) ?? []).map(a => a.address)));
  }

  indicator(t, status, compact = false) {
    const color = t[status] ?? t.dim;
    if (status === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(color).spin(900);
    if (status === "blocked") return div().flex_none().px(compact ? 4 : 6).h(18).rounded(4)
      .bg(color + "26").text_color(color).text_size(10.5).font_semibold()
      .flex().items_center().child(compact ? "!" : "Needs you");
    return div().size(7).mx(3).flex_none().rounded(4)
      .when(status === "idle", el => el.border(1.5).border_color(color))
      .when(status !== "idle", el => el.bg(color));
  }

  toggle(address, cx) {
    this.expanded.has(address) ? this.expanded.delete(address) : this.expanded.add(address);
    localStorage.setItem("agents.expanded", JSON.stringify([...this.expanded]));
    cx.notify();
  }

  agent(a, t, attention, sub = false, seen = new Set(), options = {}) {
    const { prefix = "", compact = false } = options;
    const visited = new Set(seen);
    visited.add(a.address);
    const kids = (this.children.get(a.address) ?? []).filter(k => !visited.has(k.address) && (!attention || this.needs(k)));
    // Subagents default to folded. A filter reveals matches without changing
    // the user's saved expansion choices.
    const open = attention || this.expanded.has(a.address);
    const state = this.states(a).reduce((best, s) => (RANK[s] > (RANK[best] ?? 0) ? s : best), null);
    const name = sub ? a.name || a.template || a.program?.name || a.address : this.labels.get(a.address);
    const on = sub ? a.address === this.shown : a.focused;
    const pic = icon(a.program, t);
    const row = h_flex().id(`${prefix}ag-${a.address}`).h(28).px(5).gap(6).min_w(0).flex_none().rounded(6).items_center()
      .when(compact, el => el.justify_center())
      .cursor_pointer().accessibility_label(`${name}, ${statusName(state)}`)
      .tooltip(`${name} · ${a.program?.name || "Agent"} · ${statusName(state)} · ${a.address}`)
      .when(on, el => el.bg(t.selected))
      .when(!on, el => el.hover(s => s.bg(t.hover)))
      .on_hover((over, cx) => {
        if (over) this.hovered = a.address;
        else if (this.hovered === a.address) this.hovered = null;
        cx.notify();
      })
      .on_click(() => run(sub ? "terminal.peek" : "pane.focus", sub ? { terminal: a.address } : { pane: a.pane }))
      .when(Boolean(pic), el => el.child(pic))
      .when(!compact, el => el.child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(state === "idle" && !on ? t.muted : t.foreground).child(name)))
      .when(!compact && kids.length > 0, el => el.child(div().id(`${prefix}agent-fold-${a.address}`).h(22).px(2).gap(2).flex_none().flex().items_center()
        .text_size(10.5).text_color(t.muted).rounded(4).hover(s => s.bg(t.hover).text_color(t.foreground))
        .accessibility_label(`${open ? "Collapse" : "Expand"} subagents of ${name}`)
        .tooltip(`${open ? "Hide" : "Show"} ${kids.length} subagents`)
        .on_click((_e, cx) => { cx.stop_propagation(); this.toggle(a.address, cx); })
        .child(String(kids.length)).child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(10))))
      .when(!compact && !sub && (a.pinned || this.hovered === a.address), el => el.child(div().id(`${prefix}agent-pin-${a.address}`).p(2).flex_none().rounded(4)
        .text_color(t.dim).hover(s => s.text_color(t.foreground)).tooltip(a.pinned ? "Unpin agent" : "Pin agent in this space")
        .on_click((_e, cx) => { cx.stop_propagation(); run("terminal.pin", { terminal: a.address, pinned: !a.pinned }); this.hovered = null; cx.notify(); })
        .child(svg(`mods/workspace-chrome/${a.pinned ? "pin-off" : "pin"}.svg`).size(12))))
      .child(this.indicator(t, state, true));
    return v_flex().min_w(0).flex_none().child(row)
      .when(!compact && open && kids.length > 0, el => el.child(v_flex().pl(12).flex_none()
        .children(kids.map((k, i) => branch(this.agent(k, t, attention, true, visited, options), i === kids.length - 1, t, `${prefix}agent-branch-${k.address}`)))));
  }

  members(id, attention) {
    return (this.bySpace.get(id) ?? []).filter(a => !attention || this.needs(a));
  }
}
