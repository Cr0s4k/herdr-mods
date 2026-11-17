export const QUIET = 3600000;
const STEP = 60000;
const KEPT = 300;

// When each space was last used: shown in the front window, or an agent working in it.
// A program left running in a terminal (a dev server) isn't use.
export function touch(used, sp, ps, now, front) {
  const working = new Set(ps.filter((p) => p.status === "working").map((p) => p.tab));
  const ids = new Set(sp.map((s) => s.id));
  const drop = Object.keys(used).length > KEPT;
  const next = drop ? Object.fromEntries(Object.entries(used).filter(([id]) => ids.has(id))) : { ...used };
  let changed = drop && Object.keys(next).length !== Object.keys(used).length;
  for (const s of sp) {
    const live = (s.active && front) || (s.tabs ?? []).some((tab) => working.has(tab.id));
    const at = next[s.id];
    if (!live || (typeof at === "number" && now - at < STEP)) continue;
    next[s.id] = now;
    changed = true;
  }
  return changed ? next : used;
}

// Before this kept track: the folder's last commit or checkout, and its newest Claude session.
export const TRACES = 'g=$(git -C "$1" rev-parse --absolute-git-dir 2>/dev/null); for f in "$g/logs/HEAD" "$HOME/.claude/projects/$2"/*.jsonl; do stat -c %Y "$f" 2>/dev/null || stat -f %m "$f" 2>/dev/null; done | sort -n | tail -1';

export const sessions = (folder) => folder.replace(/[^a-zA-Z0-9]/g, "-");

export function quietSpaces(used, sp, now) {
  return new Set(sp.filter((s) => !s.active && now - (used[s.id] ?? now) >= QUIET).map((s) => s.id));
}
