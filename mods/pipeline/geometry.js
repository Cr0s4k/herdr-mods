import { ACTIVE } from "./pipeline-model.js";

export const CARD = { w: 164, h: 68, review: 78 };
export const SUN = 55;
export const RING = 86;

const random = seed => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const curvePoint = (x1, y1, x2, y2, t) => {
  const mx = (x1 + x2) / 2, u = 1 - t;
  return { x: u * u * u * x1 + 3 * u * u * t * mx + 3 * u * t * t * mx + t * t * t * x2, y: u * u * u * y1 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y2 };
};
export const samples = ([x1, y1, x2, y2], count) => Array.from({ length: count }, (_, i) => curvePoint(x1, y1, x2, y2, (i + 0.5) / count));

export function layoutScene(state, width, height) {
  const slotCount = Math.max(state.parallel, ...state.tasks.filter(task => ACTIVE.includes(task.status)).map(task => task.slot + 1));
  const w = Math.max(slotCount > 3 ? 1180 : 940, width), h = Math.max(420, height);
  const center = { x: Math.round(w * 0.35), y: Math.round(h * 0.5) };
  const inner = Math.round(Math.min(300, Math.max(210, w * 0.25)));
  const outer = Math.round(Math.min(inner + 200, w - 112 - CARD.w / 2 - 24 - CARD.w / 2 - center.x));
  const reach = h / 2 - CARD.h / 2 - 20;
  const orbit = (radius, index) => {
    const spread = Math.asin(Math.min(0.78, reach / radius));
    const angle = [0, -spread, spread][index % 3];
    return { x: Math.round(center.x + radius * Math.cos(angle)), y: Math.round(center.y + radius * Math.sin(angle)), angle };
  };
  const slots = Array.from({ length: slotCount }, (_, index) => ({ ...orbit(index < 3 ? inner : outer, index), radius: index < 3 ? inner : outer }));
  const orbits = slotCount > 3 ? [inner, outer] : [inner];

  const queue = state.tasks.filter(task => task.status === "queued");
  const review = state.tasks.filter(task => ["review", "merging", "pr", "failed"].includes(task.status));
  const done = state.tasks.filter(task => task.status === "done").sort((a, b) => (b.finished ?? 0) - (a.finished ?? 0));
  const queueFits = Math.max(2, Math.floor((h - 176) / 76) + 1);
  const reviewFits = Math.max(2, Math.floor((h - 241) / 88) + 1);
  const queueShown = queue.slice(0, queue.length > queueFits ? queueFits - 1 : queueFits);
  const reviewShown = review.slice(0, review.length > reviewFits ? reviewFits - 1 : reviewFits);
  const lowest = slots.reduce((edge, slot) => slot.y > center.y ? Math.max(edge, slot.x + CARD.w / 2) : edge, center.x + SUN);
  const starFits = Math.max(1, Math.min(12, Math.floor((w - 44 - (lowest + 28)) / 30) + 1));
  const doneShown = done.slice(0, starFits);
  const wave = [0, 14, 5, 19, 9, 22, 3, 16, 7, 20, 11, 1];
  const dock = { x: w - 112 - CARD.w / 2 - 22, y: 92 + ((Math.min(review.length, reviewFits) || 1) - 1) * 44 };

  const nodes = [];
  for (const task of state.tasks) {
    let point;
    if (task.status === "queued" && queueShown.includes(task)) point = { x: 112, y: 92 + queueShown.indexOf(task) * 76, kind: "card" };
    else if (task.status === "routing") {
      const angle = -0.9 + (task.slot % 6) * 0.36;
      point = { x: Math.round(center.x + RING * Math.cos(angle)), y: Math.round(center.y + RING * Math.sin(angle)), kind: "comet" };
    }
    else if (ACTIVE.includes(task.status)) point = { ...slots[task.slot], kind: "card" };
    else if (reviewShown.includes(task)) point = { x: w - 112, y: 92 + reviewShown.indexOf(task) * 88, kind: "review" };
    else if (task.status === "done" && doneShown.includes(task)) {
      const i = doneShown.indexOf(task);
      point = { x: w - 44 - i * 30, y: h - 66 - wave[i % wave.length], kind: "star" };
    }
    if (point) nodes.push({ task, ...point });
  }

  const pick = random(Math.round(w) * 7919 + Math.round(h));
  const stars = Array.from({ length: Math.round(Math.min(70, (w * h) / 11000)) }, (_, i) => ({
    id: i, x: Math.round(pick() * w), y: Math.round(pick() * h), size: pick() < 0.18 ? 2.5 : pick() < 0.5 ? 1.8 : 1.2,
    low: 0.12 + pick() * 0.2, high: 0.45 + pick() * 0.45, period: 2200 + Math.round(pick() * 4200),
  }));

  return { w, h, center, slots, orbits, nodes, stars, dock, queue, review, done, queueShown, reviewShown, doneShown };
}
