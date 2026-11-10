import { View, div, svg, PathBuilder } from "gpui-kit";
import { h_flex, v_flex, Button, Input, InputState } from "gpui-base";
import { shared, setShared, theme, props, exec, nextCommand, settings, window as appWindow } from "herdr";
import { STORE, ACTIVE, MOVING, LABELS, REPOS, SPEEDS, createPipeline, migrate, reduce, activeTasks, dependencies, waitingReason, needsApproval, quotaHeld, progress, duration } from "./pipeline-model.js";
import { CARD, SUN, RING, layoutScene, samples } from "./geometry.js";

const CHROME = 50 + 46 + 36 + 32;
const COMET = ["●", "•", "·", "", "", ""];
const DRAWERS = ["picker", "queue", "review", "done", "activity", "settings", "watch", "quota"];
const icon = (name, size = 15) => svg(`mods/pipeline/${name}.svg`).size(size).flex_none();
const dot = (color, size = 6) => div().size(size).rounded(size / 2).bg(color).flex_none();
const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const stateColor = (task, t) => task.status === "failed" ? t.blocked : task.status === "done" ? t.ansi2
  : ["review", "merging"].includes(task.status) ? t.ansi5 : ACTIVE.includes(task.status) ? t.accent : t.muted;
function cardStatus(state, task) {
  if (task.status === "queued") {
    const waits = dependencies(state, task);
    if (waits.length) return `Needs ${waits.join(", ")}`;
    return { "Ready for the planner": "Next up", "Waiting for a work slot": "Waiting for a slot", "Waiting for quota above the reserve": "Held by quota reserve", "Outstanding PR limit reached": "Held by PR limit", "Intake paused": "Queued · intake paused" }[waitingReason(state, task)] ?? "Queued";
  }
  if (ACTIVE.includes(task.status)) return `${LABELS[task.status]} · slot ${task.slot + 1}`;
  if (needsApproval(task)) {
    const left = task.repos.filter(repo => !task.approvals.includes(repo)).length;
    return left === task.repos.length ? count(left, "PR") + " ready" : `${left} of ${task.repos.length} left`;
  }
  if (task.status === "review") return task.delivery === "direct" ? "Checks passed · merging next" : "Approved · next to merge";
  return LABELS[task.status];
}

export default class Pipeline extends View {
  init(_p, cx) {
    this.context = props()?.context ?? { id: "example", name: "Example project", cwd: "", on: null };
    this.id = this.context.id;
    this.drawer = null; this.selected = null; this.picked = new Set();
    this.size = { width: 1200, height: 780 };
    this.bars = new Map(); this.seen = new Set(); this.kicking = false;
    this.handle = cx.focus_handle(); this.handle.focus();
    this.search = InputState.new({ placeholder: "Search example tasks or repositories…" });
    this.search.on("change", (_e, cx) => cx.notify());
    this.title = InputState.new({ placeholder: "New task: type a title and press Enter" });
    this.title.on("change", (_e, cx) => cx.notify());
    this.title.on("submit", (_e, cx) => this.create(cx));
    this.motion = localStorage.getItem("motion") !== "false";
    this.reducedMotion = false;
    const all = shared(STORE) ?? {}, saved = all[this.id];
    if (saved?.version !== 2) setShared(STORE, { ...all, [this.id]: saved ? migrate(saved) : createPipeline(this.context) });
    if (appWindow()?.platform === "macos") cx.spawn(async cx => {
      try {
        const result = await exec("defaults", ["read", "com.apple.universalaccess", "reduceMotion"]);
        this.reducedMotion = result.code === 0 && result.stdout.trim() === "1"; cx.notify();
      } catch (_) { /* Motion stays under the local toggle when the preference can't be read. */ }
    });
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand(), state = this.state();
        if (!state) continue;
        if (command === "focus") this.handle.focus();
        else if ((command === "start" && !state.running) || (command === "pause" && state.running)) this.act({ type: "run" }, cx);
        else if (command === "new") { this.title.focus(); cx.notify(); }
        else if (command === "approve") this.act({ type: "approveAll" }, cx);
        else if (command === "retry") this.act({ type: "retry" }, cx);
        else if (DRAWERS.includes(command)) this.open(command, cx);
        else if (command === "close") this.open(null, cx);
      }
    });
  }

  close() { this.search.release(); this.title.release(); this.handle.release(); }
  state() { return shared(STORE)?.[this.id]; }
  act(action, cx) {
    const all = shared(STORE) ?? {}, state = all[this.id];
    if (!state) return;
    const next = reduce(state, action);
    if (next !== state) setShared(STORE, { ...all, [this.id]: next });
    cx.notify();
  }
  open(drawer, cx) {
    this.drawer = drawer;
    if (drawer === "picker") this.search.focus(); else if (!drawer) this.handle.focus();
    cx.notify();
  }
  inspect(id, cx) { this.selected = id; this.drawer = "task"; cx.notify(); }
  create(cx) {
    const title = this.title.value().trim();
    if (!title) { this.handle.focus(); cx.notify(); return; }
    this.act({ type: "create", title }, cx);
    this.title.set_value("");
  }
  speed(cx) {
    const current = this.state()?.speed ?? 1;
    this.act({ type: "speed", value: SPEEDS[(SPEEDS.indexOf(current) + 1) % SPEEDS.length] }, cx);
  }
  toggleMotion(cx) { this.motion = !this.motion; localStorage.setItem("motion", String(this.motion)); cx.notify(); }
  animated() { return this.motion && !this.reducedMotion && appWindow()?.active !== false; }

  button(id, label, fn, t, options = {}) {
    const small = Boolean(options.small);
    return Button.new(`pipeline-${id}`).h(small ? 24 : 32).px(options.iconOnly ? (small ? 5 : 8) : small ? 8 : 11).gap(small ? 5 : 6).flex_none().flex().items_center().justify_center()
      .rounded(6).text_size(small ? 11 : 12).border_1().border_color(options.primary ? t.accent : t.border)
      .bg(options.primary ? t.accent : options.selected ? t.selected : t.surface)
      .text_color(options.primary ? t.accent_foreground : t.foreground).disabled(Boolean(options.disabled))
      .opacity(options.disabled ? 0.45 : 1).tab_index(0).accessibility_label(options.hint ?? label)
      .when(Boolean(options.hint), el => el.tooltip(options.hint))
      .hover(el => el.bg(options.primary ? t.accent : t.hover))
      .focus(el => el.border_color(options.primary ? t.foreground : t.accent))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => fn(cx))
      .when(Boolean(options.icon), el => el.child(icon(options.icon, small ? 12 : 15)))
      .when(!options.iconOnly, el => el.child(label));
  }
  label(text, t) { return div().text_size(12).line_height(1.5).text_color(t.muted).child(text); }
  heading(text) { return div().text_size(12).font_medium().child(text); }

  render(cx) {
    const state = this.state(), t = theme();
    if (!state) return div().p(24).text_color(t.foreground).child("Loading Pipeline…");
    this.seen = new Set();
    const now = Date.now(), motion = this.animated();
    const info = {
      active: activeTasks(state).length,
      queued: state.tasks.filter(task => task.status === "queued").length,
      approvals: state.tasks.filter(needsApproval).length,
      failed: state.tasks.filter(task => task.status === "failed").length,
      done: state.tasks.filter(task => task.status === "done").length,
    };
    const held = state.running && info.queued > 0 && quotaHeld(state);
    info.status = !state.running ? (info.active ? "Intake paused · finishing active work" : "Paused")
      : held ? "Waiting for quota" : info.active ? "Pipeline running" : info.approvals ? "Waiting for your approval" : info.queued ? "Waiting" : "Watching for work";
    info.color = held || info.failed ? t.blocked : state.running ? t.accent : t.muted;
    const narrow = this.size.width < 820;
    const root = v_flex().id("pipeline-root").size_full().min_w(0).min_h(0).bg(t.canvas).text_color(t.foreground).text_size(13)
      .track_focus(this.handle)
      .on_size_change((bounds, cx) => {
        // Herdr reports painted bounds; builder lengths are multiplied by app zoom.
        const zoom = Number(settings().zoom) || 1;
        const size = { width: bounds.width / zoom, height: bounds.height / zoom };
        if (Math.abs(size.width - this.size.width) > 1 || Math.abs(size.height - this.size.height) > 1) { this.size = size; cx.notify(); }
      })
      .on_key_down((e, cx) => this.key(e, cx))
      .child(this.header(state, t, narrow))
      .child(this.commands(state, t))
      .child(this.status(state, t, info, motion))
      .child(h_flex().relative().flex_1().min_h(0).min_w(0)
        .child(div().id("pipeline-viewport").flex_1().min_w(0).h_full().overflow_scrollbar()
          .child(this.scene(state, t, info, motion, now, cx)))
        .when(Boolean(this.drawer), el => el.child(this.inspector(state, t)
          .when(this.size.width > 1180, node => node.relative())
          .when(this.size.width <= 1180, node => node.absolute().right(0).top(0).bottom(0)))))
      .child(this.footer(state, t));
    for (const key of [...this.bars.keys()]) if (!this.seen.has(key)) this.bars.delete(key);
    return root;
  }

  key(e, cx) {
    if (e.key === "escape") {
      if (this.drawer) this.open(null, cx); else { this.handle.focus(); cx.notify(); }
      cx.stop_propagation(); return;
    }
    if (!this.handle.is_focused()) return;
    const actions = {
      space: () => this.act({ type: "run" }, cx),
      n: () => { this.title.focus(); cx.notify(); },
      a: () => this.open("picker", cx),
      y: () => this.act({ type: "approveAll" }, cx),
      r: () => this.act({ type: "retry" }, cx),
      s: () => this.speed(cx),
    };
    const action = actions[e.keystroke];
    if (action) { action(); cx.stop_propagation(); }
  }

  header(state, t, narrow) {
    return h_flex().h(50).px(20).gap(10).items_center().flex_none()
      .child(icon("pipeline", 20).text_color(t.accent))
      .child(div().text_size(16).font_semibold().flex_none().child("Pipeline"))
      .child(div().px(6).py(2).rounded(4).bg(t.raised).text_size(10).text_color(t.muted).flex_none().child("Simulation"))
      .child(div().flex_1().min_w(0).text_size(12).text_color(t.muted).truncate().child(`${state.context.name} · example repositories: ${REPOS.join(", ")}`))
      .child(this.button("speed", `${state.speed}×`, cx => this.speed(cx), t, { icon: "bolt", selected: state.speed > 1, hint: `Simulation speed ${state.speed}× (S)` }))
      .when(!narrow, el => el.child(this.button("motion", "Motion", cx => this.toggleMotion(cx), t,
        { icon: "motion", iconOnly: true, selected: this.motion && !this.reducedMotion, hint: this.reducedMotion ? "System Reduce Motion is enabled" : `${this.motion ? "Turn off" : "Turn on"} animation` })))
      .child(this.button("settings", "Settings", cx => this.open(this.drawer === "settings" ? null : "settings", cx), t, { icon: "settings", iconOnly: true, selected: this.drawer === "settings", hint: "Pipeline settings" }))
      .child(this.button("run", state.running ? "Pause intake" : "Start pipeline", cx => this.act({ type: "run" }, cx), t,
        { icon: state.running ? "pause" : "play", primary: !state.running, hint: `${state.running ? "Pause intake; active work finishes" : "Start dispatching queued work"} (Space)` }));
  }

  commands(state, t) {
    const typed = this.title.value().trim();
    return h_flex().id("pipeline-controls").h(46).px(20).pb(10).gap(8).items_center().flex_none().overflow_x_scrollbar()
      .child(h_flex().flex_1().min_w(240).max_w(480).h(32).pl(10).pr(4).gap(8).items_center().rounded(6).border_1().border_color(t.border).bg(t.input)
        .child(icon("plus", 13).text_color(t.muted))
        .child(div().flex_1().min_w(0).child(Input.new(this.title).w_full().text_size(12).accessibility_label("New task title")))
        .when(Boolean(typed), el => el.child(this.button("create", "Add", cx => this.create(cx), t, { small: true, primary: true, hint: "Add to the queue (Enter)" }))))
      .child(this.button("add", "Examples", cx => this.open(this.drawer === "picker" ? null : "picker", cx), t, { icon: "plus", selected: this.drawer === "picker", hint: "Pick example tasks (A)" }))
      .child(this.button("watch", state.watch ? `Watching ${state.column}` : "Watch column", cx => this.open(this.drawer === "watch" ? null : "watch", cx), t, { icon: "eye", selected: state.watch }))
      .child(this.button("parallel", `${state.parallel} parallel`, cx => this.open(this.drawer === "settings" ? null : "settings", cx), t, { icon: "pipeline", hint: "Parallel work slots" }))
      .child(this.button("quota", `Quota ${state.quota}%`, cx => this.open(this.drawer === "quota" ? null : "quota", cx), t, { icon: "gauge", hint: "Example quota and reserve controls" }));
  }

  status(state, t, info, motion) {
    return h_flex().id("pipeline-status").h(36).px(20).gap(10).items_center().flex_none().border_y(1).border_color(t.border).text_size(11).text_color(t.muted).overflow_x_scrollbar()
      .child(dot(info.color, 7).id("pipeline-status-dot").when(motion && state.running, el => el.loop("opacity", { from: 0.35, to: 1, period: 1600 })))
      .child(div().font_medium().text_color(t.foreground).flex_none().child(info.status))
      .child(div().flex_none().child(`${info.active}/${state.parallel} active`))
      .child(div().flex_none().child(`${info.queued} queued`))
      .child(div().flex_none().child(`${info.done} done`))
      .child(div().flex_1())
      .when(info.approvals > 0, el => el.child(this.button("approve-all", `Approve ${count(info.approvals, "task")}`, cx => this.act({ type: "approveAll" }, cx), t,
        { icon: "check", primary: true, small: true, hint: "Approve every PR waiting for you (Y)" })))
      .when(info.failed > 0, el => el.child(this.button("retry-all", `Retry ${info.failed} failed`, cx => this.act({ type: "retry" }, cx), t,
        { icon: "reset", small: true, hint: "Return failed tasks to the queue (R)" })))
      .child(this.button("delivery", state.delivery === "pr" ? "PR approval" : "Auto-merge", cx => this.act({ type: "delivery", value: state.delivery === "pr" ? "direct" : "pr" }, cx), t,
        { small: true, selected: state.delivery === "direct", hint: state.delivery === "pr" ? "New changes wait for your approval. Click to merge after checks pass." : "New changes merge after checks pass. Click to require approval." }));
  }

  footer(state, t) {
    const latest = state.events[0];
    return h_flex().h(32).px(20).gap(10).items_center().border_t(1).border_color(t.border).flex_none().text_size(11)
      .child(dot(latest ? t.accent : t.muted, 4))
      .child(Button.new("pipeline-activity").flex_1().min_w(0).h(24).flex().items_center().justify_start().text_size(11).text_color(t.muted).tab_index(0)
        .accessibility_label("Open activity").tooltip("Open the activity log")
        .hover(el => el.text_color(t.foreground)).focus(el => el.text_color(t.foreground))
        .on_click((_e, cx) => this.open(this.drawer === "activity" ? null : "activity", cx))
        .child(div().min_w(0).truncate().child(latest?.message ?? "Start the pipeline to watch your first tasks enter.")))
      .when(this.size.width > 900, el => el.child(div().text_color(t.muted).flex_none().child("Space start · N new · A examples · Y approve · R retry · S speed")));
  }

  bar(task, state, width, color, motion, now, cx) {
    const key = `${task.id}-${task.status}-${Math.round(task.since)}`;
    const reached = Math.round(width * progress(state, task, now));
    const fill = div().id(`pipeline-bar-${key}`).h(2).rounded(1).bg(color);
    this.seen.add(key);
    if (!motion) { this.bars.delete(key); return fill.w(reached); }
    // A new bar renders where the stage is now, then a second render targets full width
    // so the native transition runs out the rest of the stage without script frames.
    if (!this.bars.has(key)) {
      this.bars.set(key, Math.max(16, Math.round((1 - progress(state, task, now)) * duration(state, task.status))));
      if (!this.kicking) { this.kicking = true; cx.timer.after(34, cx => { this.kicking = false; cx.notify(); }); }
      return fill.w(reached).transition("width", { duration: this.bars.get(key), easing: "linear" });
    }
    return fill.w(width).transition("width", { duration: this.bars.get(key), easing: "linear" });
  }

  scene(state, t, info, motion, now, cx) {
    const drawerWidth = this.drawer && this.size.width > 1180 ? 330 : 0;
    const g = layoutScene(state, this.size.width - drawerWidth, this.size.height - CHROME);
    const c = g.center;
    const canvas = div().id("pipeline-scene").relative().w(g.w).h(g.h).flex_none().overflow_hidden();
    const alive = motion && (state.running || state.tasks.some(task => MOVING.includes(task.status)));
    const layer = (path, color) => canvas.child(window.paint_path(path.build(), color).absolute().inset(0).size_full());

    for (const star of g.stars) canvas.child(div().id(`pipeline-star-${star.id}`).absolute().left(star.x).top(star.y).size(star.size).rounded(star.size).bg(t.muted)
      .opacity((star.low + star.high) / 2).when(alive, el => el.loop("opacity", { from: star.low, to: star.high, period: star.period })));
    for (const [radius, glow] of [[260, 0.025], [180, 0.04], [112, 0.06]]) canvas.child(div().id(`pipeline-nebula-${radius}`).absolute()
      .left(c.x - radius).top(c.y - radius).size(radius * 2).rounded(radius).bg(t.accent).opacity(glow)
      .when(motion && state.running && radius === 180, el => el.loop("opacity", { from: 0.02, to: 0.07, period: 5200 })));

    const orbits = PathBuilder.stroke(1);
    for (const radius of g.orbits) orbits.move_to(c.x + radius * Math.cos(-1.75), c.y + radius * Math.sin(-1.75))
      .arc_to(radius, radius, 0, true, true, c.x + radius * Math.cos(1.75), c.y + radius * Math.sin(1.75));
    layer(orbits.dash_array([2, 6]), t.border);
    layer(PathBuilder.stroke(1).move_to(c.x - RING, c.y).arc_to(RING, RING, 0, false, true, c.x + RING, c.y)
      .arc_to(RING, RING, 0, false, true, c.x - RING, c.y).dash_array([3, 7]), t.border);

    const idle = PathBuilder.stroke(1), live = PathBuilder.stroke(1.5), flows = [];
    let lit = 0;
    const link = (points, on, flow) => {
      const [x1, y1, x2, y2] = points, mid = (x1 + x2) / 2;
      (on ? live : idle).move_to(x1, y1).cubic_bezier_to(x2, y2, mid, y1, mid, y2);
      if (on) lit++;
      if (flow) flows.push({ points, ...flow });
    };
    const at = id => g.nodes.find(node => node.task.id === id);
    for (const task of g.queueShown) { const node = at(task.id); link([node.x + CARD.w / 2, node.y, c.x - SUN, c.y], false); }
    if (!g.queueShown.length) link([30 + CARD.w, c.y, c.x - SUN, c.y], false);
    g.slots.forEach((slot, i) => {
      const task = state.tasks.find(row => ACTIVE.includes(row.status) && row.slot === i);
      link([c.x + SUN, c.y, slot.x - CARD.w / 2, slot.y], Boolean(task), task && task.status !== "testing" && { key: `dispatch-${i}`, color: t.accent });
      link([slot.x + CARD.w / 2, slot.y, g.dock.x, g.dock.y], task?.status === "testing", task?.status === "testing" && { key: `checks-${i}`, color: t.ansi5 });
    });
    for (const task of g.reviewShown) {
      const node = at(task.id);
      link([g.dock.x, g.dock.y, node.x - CARD.w / 2, node.y], needsApproval(task));
      if (task.status === "merging") link([node.x, node.y + CARD.review / 2, g.w - 44, g.h - 66], true, { key: `merge-${task.id}`, color: t.ansi2 });
    }
    const trail = g.doneShown.map(task => at(task.id));
    trail.slice(1).forEach((node, i) => idle.move_to(trail[i].x, trail[i].y).line_to(node.x, node.y));
    layer(idle, t.border);
    if (lit) layer(live, t.accent);
    if (motion) for (const flow of flows) {
      const [x1, y1, x2, y2] = flow.points;
      const n = Math.max(6, Math.min(20, Math.round(Math.hypot(x2 - x1, y2 - y1) / 22)));
      samples(flow.points, n).forEach((point, i) => canvas.child(div().id(`pipeline-flow-${flow.key}-${i}`).absolute().left(point.x - 6).top(point.y - 8).w(12).h(16)
        .flex().items_center().justify_center().text_size(9).text_color(flow.color)
        .frames(COMET.map((_, step) => COMET[(((step - i) % COMET.length) + COMET.length) % COMET.length]), 85)));
    }

    if (motion && state.running) {
      // Native loops take raw lengths, without the app zoom that builder lengths get.
      const zoom = Number(settings().zoom) || 1, reach = SUN + 38;
      const pulse = (from, to, easing = "ease-out") => ({ from, to, period: 3200, easing });
      canvas.child(div().absolute().left(c.x - reach).top(c.y - reach).size(reach * 2).flex().items_center().justify_center()
        .child(div().id("pipeline-corona").size(SUN * 2).flex_none().rounded(reach).border_1().border_color(t.accent)
          .loop("width", pulse(SUN * 2 * zoom, reach * 2 * zoom)).loop("height", pulse(SUN * 2 * zoom, reach * 2 * zoom)).loop("opacity", pulse(0.75, 0, "linear"))));
    }
    canvas.child(svg("mods/pipeline/moon.svg").id("pipeline-moon").absolute().left(c.x - RING).top(c.y - RING).size(RING * 2).text_color(t.accent)
      .when(motion && state.running, el => el.spin(7000)));
    canvas.child(svg("mods/pipeline/moon-small.svg").id("pipeline-electron").absolute().left(c.x - SUN - 12).top(c.y - SUN - 12).size(SUN * 2 + 24).text_color(t.muted)
      .when(motion && state.running, el => el.spin(3200)));
    canvas.child(v_flex().absolute().left(c.x - SUN).top(c.y - SUN).size(SUN * 2).rounded(SUN).border_1().border_color(t.accent).bg(t.surface)
      .items_center().justify_center().gap(5).child(icon("pipeline", 24).text_color(t.accent))
      .child(div().font_medium().text_size(13).child("Planner"))
      .child(div().text_color(t.muted).text_size(10).child(!state.running ? "Paused" : info.active ? `${info.active}/${state.parallel} busy` : info.queued ? "Choosing work" : "Idle")));
    const planLeft = Math.max(30 + CARD.w + 20, c.x - 120);
    const planRight = Math.min(c.x + 90, g.slots[1] ? g.slots[1].x - CARD.w / 2 - 14 : c.x + 90);
    canvas.child(v_flex().id("pipeline-plan").absolute().left(planLeft).top(14).w(Math.max(130, planRight - planLeft)).max_h(Math.max(40, c.y - RING - 22)).overflow_hidden().gap(4)
      .child(div().text_size(11).font_medium().text_color(t.muted).child("The plan"))
      .child(div().text_size(12).line_height(1.45).child(state.plan)));

    g.slots.forEach((slot, i) => {
      const launching = state.tasks.find(task => task.status === "routing" && task.slot === i);
      canvas.child(v_flex().absolute().left(slot.x - CARD.w / 2).top(slot.y - CARD.h / 2).w(CARD.w).h(CARD.h).gap(4).items_center().justify_center()
        .rounded(9).border_1().border_dashed().border_color(t.border).bg(t.canvas)
        .child(div().text_size(11).text_color(t.muted).child(`Slot ${i + 1}`))
        .child(div().text_size(11).text_color(t.muted).child(i >= state.parallel ? "Finishing active work" : launching ? `Launching ${launching.id}` : "Available")));
    });

    canvas.child(this.button("queue", `Queue · ${g.queue.length}`, cx => this.open("queue", cx), t, { hint: "Every queued task" }).absolute().left(30).top(14));
    canvas.child(this.button("review-list", `Review · ${g.review.length}`, cx => this.open("review", cx), t, { hint: "Tasks awaiting approval, merging or failed" }).absolute().right(30).top(14));
    if (!g.queue.length) canvas.child(v_flex().absolute().left(30).top(70).w(CARD.w).gap(6)
      .child(div().text_size(13).child(state.watch ? `Watching ${state.column}` : "Queue is clear"))
      .child(div().text_size(12).line_height(1.45).text_color(t.muted).child(state.watch ? "New example tasks enter here." : "Type a task above or press A for examples.")));
    if (g.queue.length > g.queueShown.length) canvas.child(this.button("queue-more", `+${g.queue.length - g.queueShown.length} more queued`, cx => this.open("queue", cx), t)
      .absolute().left(30).top(92 + g.queueShown.length * 76 - 16).w(CARD.w));
    if (!g.review.length) canvas.child(v_flex().absolute().right(30).top(70).w(CARD.w).gap(6)
      .child(icon("check", 17).text_color(t.muted))
      .child(div().text_size(12).line_height(1.45).text_color(t.muted).child("Checked changes dock here for approval and merge.")));
    if (g.review.length > g.reviewShown.length) canvas.child(this.button("review-more", `+${g.review.length - g.reviewShown.length} more in review`, cx => this.open("review", cx), t)
      .absolute().right(30).top(92 + g.reviewShown.length * 88 - 20).w(CARD.w));

    for (const node of g.nodes) canvas.child(this.node(node, state, t, motion, now, cx, node.task === g.doneShown[0]));
    canvas.child(this.button("history", `${count(info.done, "task")} completed`, cx => this.open("done", cx), t, { icon: "check", small: true }).absolute().right(24).bottom(12));
    canvas.child(div().absolute().left(30).bottom(17).text_size(11).text_color(t.muted).child("Click any task to inspect it."));
    return canvas;
  }

  node({ task, x, y, kind }, state, t, motion, now, cx, newest) {
    const [w, h] = { card: [CARD.w, CARD.h], review: [CARD.w, CARD.review], comet: [18, 18], star: [16, 16] }[kind];
    const color = stateColor(task, t), selected = this.drawer === "task" && this.selected === task.id;
    const round = kind === "comet" || kind === "star";
    let wrap = div().id(`pipeline-node-${task.id}`).absolute().left(x - w / 2).top(y - h / 2).w(w).h(h);
    if (motion) wrap = wrap.transition("left", { duration: 850, easing: "ease-in-out" }).transition("top", { duration: 850, easing: "ease-in-out" })
      .transition("width", { duration: 450, easing: "ease-out" }).transition("height", { duration: 450, easing: "ease-out" });
    if (kind === "comet") wrap.child(div().id(`pipeline-glow-${task.id}`).absolute().left(-7).top(-7).size(32).rounded(16).bg(t.accent).opacity(0.25)
      .when(motion, el => el.loop("opacity", { from: 0.08, to: 0.45, period: 900 })));
    if (kind === "review" && needsApproval(task)) wrap.child(div().id(`pipeline-halo-${task.id}`).absolute().left(-4).top(-4).w(w + 8).h(h + 8).rounded(12)
      .border_1().border_color(t.ansi5).opacity(0.5).when(motion, el => el.loop("opacity", { from: 0.15, to: 0.85, period: 1800 })));
    if (kind === "star" && newest) wrap.child(div().id(`pipeline-nova-${task.id}`).absolute().left(-6).top(-6).size(28).rounded(14).border_1().border_color(t.ansi2)
      .opacity(0.5).when(motion, el => el.loop("opacity", { from: 0.1, to: 0.8, period: 2400 })));
    const card = Button.new(`pipeline-card-${task.id}`).size_full().rounded(round ? h / 2 : 9)
      .bg(kind === "comet" ? t.accent : kind === "star" ? t.canvas : selected ? t.selected : t.surface)
      .border_1().border_color(selected ? t.accent : task.status === "failed" ? t.blocked : kind === "star" ? t.canvas : kind === "comet" ? t.accent : t.border)
      .text_color(t.foreground).text_size(12).tab_index(0).flex().items_center().justify_center()
      .accessibility_label(`${task.id}: ${task.title}. ${LABELS[task.status]}. ${task.repos.join(", ")}`)
      .tooltip(task.status === "queued" ? `${task.title}\n${waitingReason(state, task)}` : `${task.title}\n${LABELS[task.status]}`)
      .hover(el => el.bg(round ? (kind === "comet" ? t.accent : t.hover) : t.hover).border_color(t.accent)).focus(el => el.border_color(t.accent))
      .on_click((_e, cx) => this.inspect(task.id, cx));
    if (kind === "star") card.child(div().id(`pipeline-twinkle-${task.id}`).size(newest ? 9 : 7).rounded(5).bg(color)
      .when(motion, el => el.loop("opacity", { from: 0.55, to: 1, period: 1800 + (task.finished ?? 0) % 7 * 300 })));
    else if (kind !== "comet") {
      const busy = ACTIVE.includes(task.status) && motion;
      card.child(v_flex().size_full().p(kind === "review" ? 9 : 10).gap(4)
        .child(h_flex().gap(6).items_center()
          .child(busy ? svg("mods/pipeline/satellite.svg").id(`pipeline-sat-${task.id}`).size(11).flex_none().text_color(color).spin(task.status === "testing" ? 800 : 1500) : dot(color))
          .child(div().text_size(10).font_medium().text_color(t.muted).flex_none().child(task.id))
          .child(div().flex_1())
          .child(div().text_size(10).text_color(t.muted).truncate().child(task.repos.join(" + "))))
        .child(div().text_size(12).font_medium().truncate().child(task.title))
        .child(div().text_size(10).text_color(task.status === "failed" ? t.blocked : t.muted).truncate().when(kind === "review" && (needsApproval(task) || task.status === "failed"), el => el.pr(80)).child(cardStatus(state, task))));
    }
    wrap.child(card);
    if (ACTIVE.includes(task.status) && kind === "card") wrap.child(div().absolute().left(10).bottom(6).w(CARD.w - 20).h(2).rounded(1).bg(t.raised)
      .child(this.bar(task, state, CARD.w - 20, t.accent, motion, now, cx)));
    if (task.status === "merging" && kind === "review") wrap.child(div().absolute().left(9).bottom(6).w(CARD.w - 18).h(2).rounded(1).bg(t.raised)
      .child(this.bar(task, state, CARD.w - 18, t.ansi2, motion, now, cx)));
    if (kind === "review" && needsApproval(task)) {
      const left = task.repos.filter(repo => !task.approvals.includes(repo)).length;
      wrap.child(this.button(`approve-${task.id}`, left > 1 ? `Approve ${left}` : "Approve", cx => this.act({ type: "approve", id: task.id }, cx), t,
        { icon: "check", primary: true, small: true, hint: `Approve ${task.id}'s ${count(left, "PR")}` }).absolute().right(8).bottom(8));
    }
    if (kind === "review" && task.status === "failed") wrap.child(this.button(`retry-${task.id}`, "Retry", cx => this.act({ type: "retry", id: task.id }, cx), t,
      { icon: "reset", small: true, hint: `Return ${task.id} to the queue` }).absolute().right(8).bottom(8));
    return wrap;
  }

  inspector(state, t) {
    const titles = { picker: "Example tasks", queue: "Queue", review: "Review", done: "Completed", activity: "Activity", watch: "Watch a column", quota: "Quota", settings: "Pipeline settings", task: this.selected ?? "Task" };
    const panel = v_flex().id("pipeline-inspector").w(Math.min(330, this.size.width - 16)).h_full().min_h(0).flex_none().bg(t.surface).border_l(1).border_color(t.border)
      .child(h_flex().px(18).py(12).gap(8).items_center().flex_none().border_b(1).border_color(t.border)
        .child(div().flex_1().font_semibold().text_size(14).truncate().child(titles[this.drawer]))
        .child(this.button("close-drawer", "Close inspector", cx => this.open(null, cx), t, { icon: "x", iconOnly: true, hint: "Close (Esc)" })));
    const body = v_flex().id("pipeline-inspector-scroll").flex_1().min_h(0).p(18).gap(14).overflow_y_scrollbar();
    const rows = (tasks, empty) => {
      if (!tasks.length) body.child(this.label(empty, t));
      for (const task of tasks) body.child(this.taskRow(task, state, t, cx => this.inspect(task.id, cx)));
    };
    if (this.drawer === "picker") this.picker(body, state, t);
    else if (this.drawer === "queue") rows(state.tasks.filter(task => task.status === "queued"), "Queue is clear. Type a task above or add examples.");
    else if (this.drawer === "review") {
      const approvals = state.tasks.filter(needsApproval).length;
      if (approvals) body.child(this.button("drawer-approve-all", `Approve ${count(approvals, "task")}`, cx => this.act({ type: "approveAll" }, cx), t, { icon: "check", primary: true }));
      rows(state.tasks.filter(task => ["review", "merging", "failed"].includes(task.status)), "Nothing to review. Checked changes arrive here.");
    }
    else if (this.drawer === "done") rows(state.tasks.filter(task => task.status === "done").sort((a, b) => (b.finished ?? 0) - (a.finished ?? 0)), "No completed tasks yet.");
    else if (this.drawer === "activity") {
      if (!state.events.length) body.child(this.label("Start the pipeline to see activity.", t));
      for (const item of state.events) body.child(item.task
        ? Button.new(`pipeline-event-${item.id}`).w_full().text_size(12).line_height(1.45).text_color(t.foreground).tab_index(0)
          .accessibility_label(`${item.message} Inspect ${item.task}`).hover(el => el.text_color(t.accent)).focus(el => el.text_color(t.accent))
          .on_click((_e, cx) => this.inspect(item.task, cx)).child(item.message)
        : this.label(item.message, t));
    }
    else if (this.drawer === "settings") this.settings(body, state, t);
    else if (this.drawer === "quota") this.quota(body, state, t);
    else if (this.drawer === "watch") this.watch(body, state, t);
    else if (this.drawer === "task") this.detail(body, state, t);
    return panel.child(body);
  }
  taskRow(task, state, t, fn, picked = false) {
    return Button.new(`pipeline-row-${task.id}`).w_full().p(10).rounded(6).bg(picked ? t.selected : t.surface)
      .border_1().border_color(picked ? t.accent : t.border).text_color(t.foreground).tab_index(0)
      .accessibility_label(`${task.id}: ${task.title}. ${picked ? "Selected" : LABELS[task.status]}`)
      .hover(el => el.bg(t.hover)).focus(el => el.border_color(t.accent)).on_click((_e, cx) => fn(cx))
      .child(v_flex().w_full().gap(6).child(h_flex().items_center().gap(6).child(dot(stateColor(task, t)))
        .child(div().text_size(10).text_color(t.muted).child(task.id)).child(div().flex_1())
        .when(picked, el => el.child(icon("check", 13))))
        .child(div().text_size(12).font_medium().child(task.title))
        .child(div().text_size(10).text_color(t.muted).child(`${task.repos.join(" + ")} · ${task.status === "backlog" ? task.column : cardStatus(state, task)}`)));
  }
  picker(body, state, t) {
    const query = this.search.value().trim().toLowerCase();
    const backlog = state.tasks.filter(task => task.status === "backlog");
    const tasks = backlog.filter(task => `${task.id} ${task.title} ${task.repos.join(" ")}`.toLowerCase().includes(query));
    const valid = backlog.filter(task => this.picked.has(task.id)).map(task => task.id);
    body.child(this.label("Pick example tasks for the queue. To add your own, type a title in the New task field.", t));
    body.child(h_flex().gap(8).flex_wrap()
      .child(this.button("add-picked", `Add ${count(valid.length, "task")}`, cx => { this.act({ type: "add", ids: valid }, cx); this.picked.clear(); this.open(null, cx); }, t, { primary: true, disabled: !valid.length, icon: "plus" }))
      .child(this.button("add-all", `Add all ${backlog.length}`, cx => { this.act({ type: "addAll" }, cx); this.picked.clear(); this.open(null, cx); }, t, { disabled: !backlog.length })));
    body.child(Input.new(this.search).w_full().h(34).px(9).bg(t.input).border_1().border_color(t.border).rounded(6).text_size(12).accessibility_label("Search example tasks"));
    for (const task of tasks) body.child(this.taskRow(task, state, t, cx => { this.picked.has(task.id) ? this.picked.delete(task.id) : this.picked.add(task.id); cx.notify(); }, this.picked.has(task.id)));
    if (!tasks.length) body.child(this.label(query ? "No matching example tasks." : "Every example task has joined the pipeline.", t));
    body.child(this.button("generate", "Generate 6 more examples", cx => this.act({ type: "generate", count: 6 }, cx), t, { icon: "plus", hint: "Queue six new example tasks" }));
  }
  stepper(body, title, hint, value, type, min, max, t) {
    body.child(v_flex().gap(7).child(this.heading(title)).child(this.label(hint, t))
      .child(h_flex().gap(10).items_center()
        .child(this.button(`${type}-less`, `Decrease ${title}`, cx => this.act({ type, value: value - 1 }, cx), t, { icon: "minus", iconOnly: true, disabled: value <= min }))
        .child(div().min_w(24).text_size(16).font_semibold().child(String(value)))
        .child(this.button(`${type}-more`, `Increase ${title}`, cx => this.act({ type, value: value + 1 }, cx), t, { icon: "plus", iconOnly: true, disabled: value >= max }))));
  }
  settings(body, state, t) {
    this.stepper(body, "Parallel tasks", "Lowering the limit lets active work finish.", state.parallel, "parallel", 1, 6, t);
    this.stepper(body, "Outstanding PRs", "Reserves one PR per repository, including active work.", state.reviewLimit, "reviewLimit", 1, 10, t);
    body.child(this.heading("Delivery for new changes"));
    for (const [value, label] of [["pr", "Create PRs · wait for approval"], ["direct", "Merge after checks pass"]]) body.child(this.button(`delivery-${value}`, label, cx => this.act({ type: "delivery", value }, cx), t, { selected: state.delivery === value }));
    body.child(this.label("Changes already in review keep their delivery policy. Multi-repository tasks complete after every repository merges.", t));
    body.child(this.heading("Simulation speed"));
    body.child(h_flex().gap(8).children(SPEEDS.map(value => this.button(`speed-${value}`, `${value}×`, cx => this.act({ type: "speed", value }, cx), t, { selected: state.speed === value }))));
    body.child(div().h(1).bg(t.border));
    body.child(this.button("fail-check", state.failNext ? "Next check will fail" : "Simulate a failed check", cx => this.act({ type: "fail" }, cx), t, { disabled: state.failNext }));
    body.child(this.button("motion-setting", this.motion ? "Turn animation off" : "Turn animation on", cx => this.toggleMotion(cx), t));
    body.child(this.button("reset", "Reset example pipeline", cx => { this.act({ type: "reset" }, cx); this.picked.clear(); this.selected = null; }, t, { icon: "reset" }));
    body.child(this.label("Runs while Herdr is open. You can close this tab; the pipeline keeps going.", t));
  }
  quota(body, state, t) {
    body.child(div().text_size(29).font_semibold().child(`${state.quota}%`)).child(this.label("Example quota remaining", t));
    body.child(div().h(5).rounded(3).bg(t.raised).child(div().w(`${state.quota}%`).h(5).rounded(3).bg(quotaHeld(state) ? t.blocked : t.accent)));
    body.child(this.label(`Reserve: ${state.reserve}%. Each example launch uses 8%. New work waits before crossing the reserve; active work finishes.`, t));
    body.child(this.button("quota-limit", "Simulate quota limit", cx => this.act({ type: "quota", value: state.reserve }, cx), t, { disabled: state.quota <= state.reserve }));
    body.child(this.button("quota-reset", "Reset example quota", cx => this.act({ type: "quota", value: 100 }, cx), t, { icon: "reset", primary: true }));
    this.stepper(body, "Quota reserve", "Percentage kept for your other work.", state.reserve, "reserve", 0, 50, t);
    body.child(this.label("Quota and launch costs are simulated. Live provider usage and reset times will be connected in a later milestone.", t));
  }
  watch(body, state, t) {
    body.child(this.label("A watched column feeds the same queue as picked tasks. Tasks are claimed once.", t));
    body.child(this.heading("Example board column"));
    for (const column of ["Ready", "Backlog"]) body.child(this.button(`column-${column}`, column, cx => this.act({ type: "column", value: column }, cx), t, { selected: state.column === column }));
    body.child(this.button("watch-toggle", state.watch ? "Stop watching" : `Watch ${state.column}`, cx => this.act({ type: "watch" }, cx), t, { icon: "eye", primary: !state.watch }));
    body.child(this.label(state.watch ? `Watching ${state.column}. New tasks join even while intake is paused.` : "Turn on watch to pick up matching tasks automatically.", t));
    body.child(this.button("arrival", `Move example task to ${state.column}`, cx => this.act({ type: "arrival" }, cx), t, { icon: "plus", disabled: !state.tasks.some(task => task.status === "backlog") }));
    body.child(this.label("This button simulates someone moving a task on the board. No external task service is changed.", t));
  }
  detail(body, state, t) {
    const task = state.tasks.find(task => task.id === this.selected);
    if (!task) { body.child(this.label("Select a task in the scene.", t)); return; }
    body.child(div().text_size(18).font_semibold().line_height(1.3).child(task.title));
    body.child(h_flex().gap(7).items_center().child(dot(stateColor(task, t))).child(div().text_size(12).child(LABELS[task.status])));
    body.child(div().text_size(12).line_height(1.5).text_color(t.muted).child(task.description));
    if (["queued", "backlog"].includes(task.status)) {
      body.child(this.heading("Repositories"));
      body.child(h_flex().gap(6).flex_wrap().children(REPOS.map(repo => this.button(`repo-${task.id}-${repo}`, repo, cx => this.act({ type: "repos", id: task.id, repo }, cx), t,
        { small: true, selected: task.repos.includes(repo), icon: task.repos.includes(repo) ? "check" : null, hint: task.repos.includes(repo) ? `Remove ${repo}` : `Add ${repo}` }))));
    } else body.child(this.label(`Repositories: ${task.repos.join(" + ")}`, t));
    body.child(this.label(`Board: ${task.status === "done" ? "Done" : ["review", "merging"].includes(task.status) ? "Review" : [...ACTIVE, "failed"].includes(task.status) ? "Doing" : task.column} · example`, t));
    if (task.status === "queued") body.child(this.label(waitingReason(state, task), t));
    if (task.depends.length) {
      body.child(this.heading("Dependencies"));
      for (const id of task.depends) body.child(this.button(`dep-${id}`, `${id} · ${state.tasks.find(row => row.id === id)?.status === "done" ? "Merged" : "Waiting"}`, cx => this.inspect(id, cx), t));
    }
    if (["review", "merging", "done"].includes(task.status)) {
      body.child(this.heading("Related changes"));
      if (needsApproval(task) && task.repos.length > 1) body.child(this.button(`approve-task-${task.id}`, `Approve all ${task.repos.length} PRs`, cx => this.act({ type: "approve", id: task.id }, cx), t, { icon: "check", primary: true }));
      for (const repo of task.repos) {
        const approved = task.approvals.includes(repo);
        body.child(v_flex().gap(7).py(9).border_b(1).border_color(t.border)
          .child(div().text_size(12).font_medium().child(`${repo} · example PR`))
          .child(this.label(task.status === "done" ? "Merged" : task.status === "merging" ? "Merging after checks" : approved ? "Approved" : task.delivery === "direct" ? "Checks passed · automatic merge" : "Checks passed · approval needed", t))
          .when(task.status === "review" && task.delivery !== "direct" && !approved, el => el.child(this.button(`approve-${task.id}-${repo}`, `Approve ${repo} PR`, cx => this.act({ type: "approve", id: task.id, repo }, cx), t, { icon: "check" }))));
      }
      if (task.status === "review" && task.repos.every(repo => task.approvals.includes(repo))) body.child(this.label("Approved. Waiting for this repository's active merge to finish.", t));
    }
    if (task.status === "failed") body.child(this.label(task.error, t)).child(this.button(`retry-task-${task.id}`, "Retry task", cx => this.act({ type: "retry", id: task.id }, cx), t, { primary: true, icon: "reset" }));
    if (task.status === "queued") body.child(this.button(`remove-${task.id}`, "Remove from queue", cx => { this.act({ type: "remove", id: task.id }, cx); this.open(null, cx); }, t, { disabled: state.watch && task.column === state.column, hint: state.watch && task.column === state.column ? "Stop watching this column before removing a matching task" : "Return this task to the example backlog" }));
    const events = state.events.filter(item => item.task === task.id).slice(0, 6);
    if (events.length) body.child(this.heading("Task history"));
    for (const item of events) body.child(this.label(item.message, t));
  }
}
