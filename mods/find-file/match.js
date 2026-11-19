// fzf-style fuzzy matching of file paths: every space-separated term must appear in order,
// and matches in the file name, at word starts and in a run score higher.

export function prepare(paths) {
  return paths.map(path => {
    const lower = path.toLowerCase(), base = path.lastIndexOf("/") + 1, name = lower.slice(base);
    return { path, lower, base, name, stem: name.replace(/\.[^.]*$/, "") };
  });
}

export function terms(query) {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

function wordStart(path, i, base) {
  if (i === base) return 24;
  const prev = path.charCodeAt(i - 1), c = path.charCodeAt(i);
  if (i === 0 || prev === 47 || prev === 95 || prev === 45 || prev === 46 || prev === 32) return 12;
  return c >= 65 && c <= 90 && !(prev >= 65 && prev <= 90) ? 10 : 0;
}

// The tightest run ending at the leftmost complete match, read back from its end.
function align(term, entry, from, hits) {
  const { path, lower, base } = entry;
  let i = from - 1;
  for (let t = 0; t < term.length; t++) if ((i = lower.indexOf(term[t], i + 1)) < 0) return null;
  let s = 0, next = -1;
  for (let t = term.length - 1; t >= 0; t--, i--) {
    i = lower.lastIndexOf(term[t], i);
    s += 16 + (i >= base ? 4 : 0) + wordStart(path, i, base);
    if (next >= 0) s += next === i + 1 ? 12 : -Math.min(10, next - i - 1);
    if (hits) hits.push(i);
    next = i;
  }
  return s;
}

export function score(list, entry, hits) {
  let total = 0;
  for (let k = 0; k < list.length; k++) {
    const s = (entry.base ? align(list[k], entry, entry.base, hits) : null) ?? align(list[k], entry, 0, hits);
    if (s === null) return null;
    total += s;
  }
  if (list.length === 1 && (entry.name === list[0] || entry.stem === list[0])) total += 60;
  return total;
}

export function highlights(query, path) {
  const hits = [];
  score(terms(query), prepare([path])[0], hits);
  return new Set(hits);
}

const before = (a, b) => b.score - a.score || a.path.length - b.path.length || (a.path < b.path ? -1 : 1);

export function rank(entries, query, boost = () => 0, limit = 100) {
  const list = terms(query), pool = [], top = [];
  let worst = -1;
  for (let k = 0; k < entries.length; k++) {
    const entry = entries[k], s = score(list, entry);
    if (s === null) continue;
    pool.push(entry);
    const m = { path: entry.path, score: s + boost(entry.path) };
    if (top.length < limit) top.push(m);
    else if (before(m, top[worst]) < 0) top[worst] = m;
    else continue;
    if (top.length === limit) {
      worst = 0;
      for (let j = 1; j < top.length; j++) if (before(top[j], top[worst]) > 0) worst = j;
    }
  }
  return { top: top.sort(before), pool };
}
