import { ACTIVE } from "./pipeline-model.js";

export function layoutScene(state, width, height) {
  const slotCount = Math.max(state.parallel, ...state.tasks.filter(task => ACTIVE.includes(task.status)).map(task => task.slot + 1));
  const w = Math.max(slotCount > 3 ? 1200 : 900, width), h = Math.max(540, height);
  const center = { x: w * 0.37, y: h * 0.49 };
  const slots = Array.from({ length: slotCount }, (_, index) => ({
    x: w * (index < 3 ? 0.61 : 0.76), y: h * ([0.26, 0.50, 0.74][index % 3]),
  }));
  const queue = state.tasks.filter(task => task.status === "queued");
  const review = state.tasks.filter(task => ["review", "merging", "failed"].includes(task.status));
  const done = state.tasks.filter(task => task.status === "done").slice(-3);
  const nodes = [];
  for (const task of state.tasks) {
    let point;
    if (task.status === "queued" && queue.indexOf(task) < 5) point = { x: 112, y: 100 + queue.indexOf(task) * 80 };
    else if (task.status === "routing") point = { x: center.x + (task.slot % 2 ? 30 : -30), y: center.y - 105 + task.slot * 32 };
    else if (ACTIVE.includes(task.status)) point = slots[task.slot];
    else if (["review", "merging", "failed"].includes(task.status) && review.indexOf(task) < 4) point = { x: w - 112, y: 110 + review.indexOf(task) * 91 };
    else if (task.status === "done" && done.includes(task)) point = { x: w - 112 - done.indexOf(task) * 32, y: h - 54 };
    if (point) nodes.push({ task, ...point });
  }
  return { w, h, center, slots, nodes, queue, review, done };
}
