import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { run } from "herdr";

const base = (path) => path.replace(/\/+$/, "").split("/").pop() || "/";

// A space's terminals that aren't agents: those already have their own rows.
export function spaceTerminals(s, ps, agents) {
  const tabs = new Map((s.tabs ?? []).map((tab, i) => [tab.id, { tab, index: i + 1 }]));
  const taken = new Set(agents.map(a => a.pane));
  const rows = ps.filter(p => p.terminal && tabs.has(p.tab) && !taken.has(p.pane)).map(p => {
    const { tab, index } = tabs.get(p.tab);
    const running = p.program && !p.program.shell ? p.program.name : null;
    return { p, tab, index, running, label: tab.named ? tab.name : p.cwd ? base(p.cwd) : running || "Terminal" };
  });
  const counts = new Map();
  for (const r of rows) counts.set(r.label, (counts.get(r.label) ?? 0) + 1);
  return rows.map(r => {
    if (counts.get(r.label) === 1) return r;
    const sameTab = rows.filter(o => o.label === r.label && o.p.tab === r.p.tab).length > 1;
    return { ...r, label: `${r.label} · ${sameTab ? r.p.terminal : r.index}` };
  });
}

export function terminalRow(s, { p, tab, running, label }, t, { prefix = "", compact = false, ring = false } = {}) {
  const on = Boolean(s.active && tab.active !== false && p.focused);
  const pic = svg("mods/workspace-chrome/terminal.svg").size(14).flex_none().text_color(on ? t.foreground : t.muted);
  const detail = [running ?? p.program?.name ?? "Terminal", p.cwd, p.terminal].filter(Boolean).join(" · ");
  return h_flex().id(`${prefix}term-${p.pane}`).h(28).px(5).gap(6).min_w(0).flex_none().rounded(6).items_center()
    .when(compact, el => el.justify_center())
    .cursor_pointer().accessibility_label(`Terminal ${label}`).tooltip(`${label} · ${detail}`)
    .when(on, el => el.bg(t.selected))
    .when(!on, el => el.hover(st => st.bg(t.hover)))
    .on_click(() => run("pane.focus", { pane: p.pane }))
    .child(pic)
    .when(!compact, el => el.child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(on ? t.foreground : t.muted).child(label)))
    .when(!compact && Boolean(running), el => el.child(div().flex_none().max_w(80).truncate().text_size(11).text_color(t.muted).child(running)))
    .when(ring, el => el.relative().child(div().absolute().inset_0().rounded(6).border_1().border_color(t.accent)));
}
