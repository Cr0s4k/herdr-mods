export const NAMES = { claude: "Claude Code", codex: "Codex", opencode: "OpenCode" };

export const terms = query => query.toLowerCase().split(/\s+/).filter(Boolean);

// The text cut where a searched word starts or ends, so the words can be drawn marked.
export function runs(text, words) {
  const low = text.toLowerCase(), out = [];
  let at = 0;
  while (at < text.length) {
    let next = -1, length = 0;
    for (const word of words) {
      const i = low.indexOf(word, at);
      if (i >= 0 && (next < 0 || i < next || (i === next && word.length > length))) { next = i; length = word.length; }
    }
    if (next < 0) break;
    if (next > at) out.push({ text: text.slice(at, next), hit: false });
    out.push({ text: text.slice(next, next + length), hit: true });
    at = next + length;
  }
  if (at < text.length) out.push({ text: text.slice(at), hit: false });
  return out;
}

// A conversation resumes in the space opened on its folder, else in the one on screen.
export function spaceFor(spaces, session, on) {
  const here = spaces.filter(s => (s.machine ?? null) === (on ?? null));
  return (here.find(s => s.folder === session.cwd) ?? here.find(s => s.active) ?? spaces.find(s => s.active))?.id ?? null;
}
