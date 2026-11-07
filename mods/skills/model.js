export const GROUPS = [
  ["project", "Project"], ["personal", "Personal"], ["synced", "Account skills"], ["plugin", "Plugin skills"],
  ["builtin", "Built-in skills"], ["admin", "Managed skills"],
];

export function contextFor(spaceList, paneList, focus, tab, previous) {
  const space = spaceList.find(s => tab ? s.tabs.some(t => t.id === tab) : s.active);
  const activeTab = tab ?? space?.tabs.find(t => t.active)?.id;
  const members = paneList.filter(p => p.tab === activeTab);
  const target = members.find(p => p.pane === focus?.pane);
  const direct = focus?.space === space?.id && focus?.tab === activeTab && focus?.terminal ? focus.cwd : null;
  const remembered = previous?.tab === activeTab && previous?.on === (space?.machine ?? null) ? previous.cwd : null;
  return {
    space: space?.id ?? null, tab: activeTab ?? null, on: space?.machine ?? null,
    cwd: target?.cwd || direct || remembered || members.find(p => p.cwd)?.cwd || space?.folder || null,
  };
}

export function visibleSkills(skills, { scope = "here", agent = "all", query = "" } = {}) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return skills.flatMap(skill => {
    const installations = skill.installations.filter(item =>
      (scope === "library" ? !item.project : item.enabled === true) &&
      (agent === "all" || item.agent === agent));
    if (!installations.length) return [];
    const text = [skill.name, skill.description, skill.path,
      ...installations.flatMap(item => [item.path, item.plugin, item.command, item.agent])].join(" ").toLocaleLowerCase();
    if (!terms.every(term => text.includes(term))) return [];
    const group = GROUPS.find(([id]) => installations.some(item => item.origin === id))?.[0] ?? "personal";
    return [{ ...skill, installations, group }];
  });
}

export function expandedSkills(visible, { query = "", folded = new Set() } = {}) {
  return GROUPS.flatMap(([id]) => query || !folded.has(id) ? visible.filter(item => item.group === id) : []);
}

export const agentsFor = skill => ["codex", "claude"].filter(agent => skill.installations.some(item => item.agent === agent));
export const agentLabel = agent => agent === "codex" ? "Codex" : "Claude";
export const originLabel = item => item.sync_source ? item.origin === "builtin" ? "Anthropic · Built-in skills"
  : item.origin === "plugin" ? "claude.ai · Plugin skills" : "claude.ai sync"
  : item.plugin ? `${item.plugin} · ${item.project ? "Project plugin" : "Plugin"}`
  : GROUPS.find(([id]) => id === item.origin)?.[1] ?? item.origin;
export const statusLabel = item => item.enabled === false ? "Disabled" : item.enabled === null ? "Unverified" : "Discovered";
export const shortPath = (path, home) => home && (path === home || path.startsWith(home + "/")) ? "~" + path.slice(home.length) : path;
