// What the mods tell agents is Markdown in skills/herdr-pipeline/procedures (linked into mods/pipeline); {{name}} marks a value the caller fills in.
export const PROCEDURES = ["summary", "pull-request", "evidence", "evidence-later", "walkthrough", "implementer", "ticket", "check-failed", "merge-refused", "uncommitted", "adopt-ask", "adopt-moved", "ticket-launch", "demo-task"];
let texts = {};
export const loadProcedures = read => Promise.all(PROCEDURES.map(name => read(`mods/pipeline/procedures/${name}.md`)))
  .then(read => { texts = Object.fromEntries(PROCEDURES.map((name, at) => [name, String(read[at] ?? "").trim()])); });
export function procedure(name, values = {}) {
  if (!texts[name]) throw new Error("A Herdr helper file is missing. Reinstall the mods.");
  return texts[name].replace(/\{\{([\w-]+)\}\}/g, (_match, key) => values[key] ?? "");
}
