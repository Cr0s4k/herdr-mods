import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";

const NAMES = { claude: "Claude Code", codex: "Codex", opencode: "OpenCode" };
const RESUME = { claude: id => ["--resume", id], codex: id => ["resume", id], opencode: id => ["--session", id] };
export const resumeArgs = (agent, session) => [...agent.run, ...RESUME[session.agent](session.id)];

export function ago(at, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - at) / 60000));
  return minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.round(minutes / 60)}h` : `${Math.round(minutes / 1440)}d`;
}

// An open agent is in a conversation already: for each one, its kind's newest conversation is left out.
export function closedSessions(sessions, agents) {
  const open = {};
  for (const a of agents) open[a.program?.key] = (open[a.program?.key] ?? 0) + 1;
  return sessions.filter(session => !(open[session.agent]-- > 0));
}

export function recentHeader(s, open, t, { prefix = "", ring = false, toggle }) {
  return h_flex().id(`${prefix}recent-${s.id}`).h(28).px(5).gap(6).min_w(0).flex_none().rounded(6).items_center()
    .cursor_pointer().hover(st => st.bg(t.hover)).role("button")
    .accessibility_label(`${open ? "Hide" : "Show"} recent conversations`).tooltip("Closed conversations in this folder. Click one to resume it")
    .on_click((_e, cx) => toggle(cx))
    .child(svg("mods/pipeline/clock.svg").size(14).flex_none().text_color(t.muted))
    .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.muted).child("Recent"))
    .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(10).mx(2).flex_none().text_color(t.muted))
    .when(ring, el => el.relative().child(div().absolute().inset_0().rounded(6).border_1().border_color(t.accent)));
}

export function sessionRow(s, session, t, { prefix = "", ring = false, resume, pic = null }) {
  return h_flex().id(`${prefix}session-${session.id}`).h(26).px(5).gap(6).min_w(0).flex_none().rounded(6).items_center()
    .cursor_pointer().hover(st => st.bg(t.hover)).role("button")
    .accessibility_label(`Resume ${session.title}`).tooltip(`${session.title} · ${NAMES[session.agent]} · ${ago(session.at)} ago · Click to resume in a new tab`)
    .on_click((_e, cx) => resume(cx))
    .when(Boolean(pic), el => el.child(pic))
    .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(session.title))
    .child(div().flex_none().text_size(11).text_color(t.dim ?? t.muted).child(ago(session.at)))
    .when(ring, el => el.relative().child(div().absolute().inset_0().rounded(6).border_1().border_color(t.accent)));
}
