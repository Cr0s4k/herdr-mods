import { shared, setShared } from "herdr";

// Absolute local deadlines survive reloads; expired entries never hide a space.
export function hiddenSpaces(now = Date.now()) {
  const stored = shared("spaces.hidden");
  return Object.fromEntries(Object.entries(stored && typeof stored === "object" ? stored : {})
    .filter(([, until]) => typeof until === "number" && Number.isFinite(until) && until > now));
}

export function expireSpaces(now = Date.now()) {
  const stored = shared("spaces.hidden");
  const live = hiddenSpaces(now);
  if (stored && JSON.stringify(stored) !== JSON.stringify(live)) setShared("spaces.hidden", live);
}

export function hideSpace(id, until, now = Date.now()) {
  if (!id || !Number.isFinite(until) || until <= now) return false;
  setShared("spaces.hidden", { ...hiddenSpaces(now), [id]: until });
  if (shared("spaces.focus") === id) setShared("spaces.focus", null);
  return true;
}

export function restoreSpace(id) {
  const live = hiddenSpaces();
  delete live[id];
  setShared("spaces.hidden", live);
}

const pad = n => String(n).padStart(2, "0");
export function localTime(until) {
  const d = new Date(until);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function parseLocalTime(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return NaN;
  const [, year, month, day, hour, minute] = match.map(Number);
  const d = new Date(year, month - 1, day, hour, minute);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day
    && d.getHours() === hour && d.getMinutes() === minute ? d.getTime() : NaN;
}

export function hideChoices(now = Date.now()) {
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  return [["For 30 minutes", now + 30 * 60000], ["For 1 hour", now + 3600000],
    ["For 4 hours", now + 4 * 3600000], ["Until tomorrow, 09:00", tomorrow.getTime()]];
}
