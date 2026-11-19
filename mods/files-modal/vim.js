// Vim's way around a file, shared by the Files and Git dialogs: a count, then a motion.
const KEYS = { j: "down", k: "up", gg: "first", G: "last", "]c": "nextChange", "[c": "prevChange" };
const CTRL = { d: "halfDown", u: "halfUp", f: "pageDown", b: "pageUp" };
const PAGE = { pagedown: "pageDown", pageup: "pageUp" };
const SCROLLS = new Set(["halfDown", "halfUp", "pageDown", "pageUp"]);
const PREFIXES = new Set(["g", "]", "["]);

export class Motions {
  constructor() { this.typed = ""; }

  // { motion, count } once a motion is complete, true for a key that only started one, null for any other key.
  read(e) {
    const m = e.modifiers ?? {}, ch = m.control || m.platform ? null : e.key_char ?? null;
    const count = /^\d*/.exec(this.typed)[0], keys = this.typed.slice(count.length) + (ch ?? "");
    const motion = m.control && !m.alt && !m.platform ? CTRL[e.key] : PAGE[e.key] ?? (ch ? KEYS[keys] : null);
    if (motion) { this.typed = ""; return { motion, count: Number(count) }; }
    const pending = this.typed;
    this.typed = "";
    if (e.key === "escape") return pending ? true : null;
    if (ch && /^\d$/.test(ch) && keys === ch && (count || ch !== "0")) { this.typed = count + ch; return true; }
    if (ch && PREFIXES.has(keys)) { this.typed = count + keys; return true; }
    return null;
  }
}

const clamp = (n, low, high) => Math.max(low, Math.min(high, n));

// As in Vim, a count before ctrl-d or ctrl-u is a number of rows rather than a repeat.
export function target(motion, count, at, total, page, changes = []) {
  const last = Math.max(0, total - 1), n = count || 1;
  const half = count || Math.max(1, Math.floor(page / 2)), full = Math.max(1, page - 2) * n;
  const after = changes.filter((c) => c > at), before = changes.filter((c) => c < at);
  const to = {
    down: at + n, up: at - n, halfDown: at + half, halfUp: at - half, pageDown: at + full, pageUp: at - full,
    first: count ? count - 1 : 0, last: count ? count - 1 : last,
    nextChange: after.length ? after[Math.min(n, after.length) - 1] : at,
    prevChange: before.length ? before[Math.max(0, before.length - n)] : at,
  }[motion];
  return clamp(to ?? at, 0, last);
}

// The first row on screen after the cursor moves from `at` to `to`. The scrolls move the view as far as
// the cursor; other moves scroll only to keep `off` rows around the cursor, and centre it after a long jump.
export function viewTop(motion, at, to, top, page, total, off = 3) {
  const max = Math.max(0, total - page), keep = Math.min(off, Math.floor((page - 1) / 2));
  if (SCROLLS.has(motion)) return clamp(top + to - at, 0, max);
  if (to < top - page / 2 || to > top + page - 1 + page / 2) return clamp(to - Math.floor(page / 2), 0, max);
  if (to < top + keep) return clamp(to - keep, 0, max);
  if (to > top + page - 1 - keep) return clamp(to + keep - page + 1, 0, max);
  return top;
}

export function changeStarts(changed) {
  return changed.flatMap((c, i) => c && !changed[i - 1] ? [i] : []);
}

export function lineStarts(text) {
  const starts = [0];
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  return starts;
}

export function lineAt(starts, offset) {
  let low = 0, high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid] <= offset) low = mid; else high = mid - 1;
  }
  return low;
}
