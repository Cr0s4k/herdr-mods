import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";

const NAMES = { claude: "Claude Code", codex: "Codex", opencode: "OpenCode" };
const RESUME = { claude: id => ["--resume", id], codex: id => ["resume", id], opencode: id => ["--session", id] };
export const resumeArgs = (agent, session) => [...agent.run, ...RESUME[session.agent](session.id)];

export function ago(at, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - at) / 60000));
  return minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.round(minutes / 60)}h` : `${Math.round(minutes / 1440)}d`;
}

const inTerminal = (session, t) => Boolean(t) && t.state === "live" && ((Boolean(session.pid) && t.foreground?.pid === session.pid) || (t.foreground?.argv ?? []).includes(session.id));

// The terminal a conversation is open in: the one running its Claude Code process, or an agent started with its id.
export function openIn(session, terminals, on) {
  const machine = address => address.includes("/") ? address.split("/")[0] : null;
  return terminals.find(t => machine(t.address) === (on ?? null) && inTerminal(session, t))?.address ?? null;
}

// An open agent is in a conversation already, and that one is left out: the one its terminal has open when that is known,
// else its kind's newest in its folder. Claude Code's are known whenever the reader says which process holds each.
export function closedSessions(sessions, agents, terminals = []) {
  const taken = new Set(), guess = {}, key = (agent, cwd) => `${agent}\n${cwd ?? ""}`;
  const known = sessions.some(session => session.agent === "claude" && "pid" in session);
  for (const a of agents) {
    const terminal = a.address ? terminals.find(t => t.address === a.address) : null;
    const exact = sessions.find(session => !taken.has(session) && inTerminal(session, terminal));
    if (exact) taken.add(exact);
    else if (!(known && terminal && a.program?.key === "claude")) guess[key(a.program?.key, a.cwd)] = (guess[key(a.program?.key, a.cwd)] ?? 0) + 1;
  }
  return sessions.filter(session => !taken.has(session) && !(guess[key(session.agent, session.cwd)]-- > 0));
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
    .accessibility_label(`Resume ${session.title}`).tooltip(`${session.title} · ${NAMES[session.agent]}${session.branch ? ` · in the worktree of ${session.branch}` : ""} · ${ago(session.at)} ago · Click to resume in a new tab`)
    .on_click((_e, cx) => resume(cx))
    .when(Boolean(pic), el => el.child(pic))
    .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(session.title))
    .when(Boolean(session.branch), el => el.child(svg("mods/workspace-chrome/branch.svg").id(`${prefix}session-branch-mark-${session.id}`).size(11).flex_none().text_color(t.dim ?? t.muted)))
    .child(div().flex_none().text_size(11).text_color(t.dim ?? t.muted).child(ago(session.at)))
    .when(ring, el => el.relative().child(div().absolute().inset_0().rounded(6).border_1().border_color(t.accent)));
}
