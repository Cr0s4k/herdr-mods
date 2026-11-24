// Notes a person leaves on lines of a diff, kept until they are sent to an agent as one message.
export const NOTES = "review.notes";
const KEPT = 30 * 86400000;

export const repoKey = (root, on) => `${on ?? ""}:${root}`;
export const scopeOf = (base, head) => head ? `${base ?? ""}..${head}` : base ?? "";

// Which line of which version a diff row shows: a removed line only exists in the old one.
export function anchorOf(row) {
  const r = row && "left" in row ? (row.right ?? row.left) : row;
  if (!r || r.number === undefined) return null;
  if (r.kind === "+" || r.kind === " ") return { side: "new", line: r.number, code: r.text };
  return r.kind === "-" ? { side: "old", line: r.number, code: r.text } : null;
}

export function notesOf(store, root, on, scope, path) {
  const all = store?.[repoKey(root, on)] ?? [];
  return scope === undefined ? all : all.filter(n => n.scope === scope && (path === undefined || n.path === path));
}

export function counts(store, root, on, scope) {
  const out = {};
  for (const n of notesOf(store, root, on, scope)) out[n.path] = (out[n.path] ?? 0) + 1;
  return out;
}

// A note with no text removes the one on that line.
export function saveNote(store, root, on, note, now = Date.now()) {
  const key = repoKey(root, on), next = {};
  for (const [k, list] of Object.entries(store ?? {})) {
    const kept = list.filter(n => now - n.at < KEPT);
    if (kept.length) next[k] = kept;
  }
  const same = n => n.scope === note.scope && n.path === note.path && n.side === note.side && n.line === note.line;
  const others = (next[key] ?? []).filter(n => !same(n)), text = note.text.trim();
  const list = text ? [...others, { ...note, text, at: now }] : others;
  if (list.length) next[key] = list; else delete next[key];
  return next;
}

export function dropNotes(store, root, on, sent = null) {
  const key = repoKey(root, on), next = { ...store };
  const gone = sent && new Set(sent.map(n => JSON.stringify([n.scope, n.path, n.side, n.line])));
  const left = gone ? (next[key] ?? []).filter(n => !gone.has(JSON.stringify([n.scope, n.path, n.side, n.line]))) : [];
  if (left.length) next[key] = left; else delete next[key];
  return next;
}

// Each note's row in the diff as it is now: its line, else the nearest line that still reads the same,
// else that line number with new text. -1 when the diff no longer has it.
export function place(notes, rows) {
  const anchors = rows.map(row => row && "left" in row ? [anchorOf(row.right), row.left?.kind === "-" ? anchorOf(row.left) : null] : [anchorOf(row)]);
  return notes.map(note => {
    let near = -1, gap = Infinity, edited = -1;
    for (let i = 0; i < anchors.length; i++) {
      for (const a of anchors[i]) {
        if (!a || a.side !== note.side) continue;
        if (a.line === note.line) { if (a.code === note.code) return i; edited = i; }
        if (a.code === note.code && a.code.trim() && Math.abs(a.line - note.line) < gap) { near = i; gap = Math.abs(a.line - note.line); }
      }
    }
    return near >= 0 ? near : edited;
  });
}

// The rows to draw: each note right under its line, and the ones whose line is gone first.
export function withNotes(rows, notes) {
  if (!notes.length) return rows;
  const at = place(notes, rows), under = new Map(), out = [];
  notes.forEach((note, k) => {
    if (at[k] < 0) out.push({ kind: "note", note, lost: true });
    else under.set(at[k], [...(under.get(at[k]) ?? []), { kind: "note", note }]);
  });
  rows.forEach((row, i) => { out.push(row); if (under.has(i)) out.push(...under.get(i)); });
  return out;
}

const where = (n) => `${n.path}:${n.line}${n.side === "old" ? " (a removed line, numbered as before the change)" : ""}${n.scope.includes("..") ? ` (in commit ${n.scope.split("..")[1].slice(0, 9)})` : ""}`;

export function noteList(notes) {
  const sorted = [...notes].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line);
  return sorted.map((n, i) => [`${i + 1}. ${where(n)}`, ...(n.code?.trim() ? [`   > ${n.code.trim().slice(0, 200)}`] : []), `   ${n.text}`].join("\n")).join("\n\n");
}

export const countLabel = (n) => `${n} note${n === 1 ? "" : "s"}`;

// The agents working in this checkout, the one in front first, then the last one that did something.
export function targets(agents, panes, root, on, focused = null) {
  const machine = address => address.includes("/") ? address.split("/")[0] : null;
  const inside = cwd => cwd === root || Boolean(cwd?.startsWith(root + "/"));
  return agents
    .filter(a => machine(a.address) === (on ?? null) && inside(panes.find(p => p.terminal === a.address)?.cwd))
    .sort((a, b) => Number(b.address === focused) - Number(a.address === focused) || b.seq - a.seq);
}
