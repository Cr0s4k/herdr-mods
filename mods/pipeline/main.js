import { View, div, svg, PathBuilder } from "gpui-kit";
import { h_flex, v_flex, Button, Input, InputState } from "gpui-base";
import { shared, setShared, theme, props, exec, nextCommand, settings, window as appWindow } from "herdr";
import { STORE, ACTIVE, LABELS, createPipeline, reduce, activeTasks, dependencies, waitingReason } from "./pipeline-model.js";
import { layoutScene } from "./geometry.js";

const icon = (name, size = 15) => svg(`mods/pipeline/${name}.svg`).size(size).flex_none();
const dot = (color, size = 6) => div().size(size).rounded(size / 2).bg(color).flex_none();
const stateColor = (task, t) => task.status === "failed" ? t.blocked : task.status === "done" ? t.ansi2
  : ["review", "merging"].includes(task.status) ? t.ansi5 : ACTIVE.includes(task.status) ? t.accent : t.muted;

export default class Pipeline extends View {
  init(_p, cx) {
    this.context = props()?.context ?? { id: "example", name: "Example project", cwd: "", on: null };
    this.id = this.context.id;
    this.drawer = null; this.selected = null; this.picked = new Set();
    this.size = { width: 1200, height: 780 };
    this.handle = cx.focus_handle(); this.handle.focus();
    this.search = InputState.new({ placeholder: "Search example tasks or repositories…" });
    this.search.on("change", (_e, cx) => cx.notify());
    this.motion = localStorage.getItem("motion") !== "false";
    this.reducedMotion = false;
    if (!this.state()) setShared(STORE, { ...(shared(STORE) ?? {}), [this.id]: createPipeline(this.context) });
    if (appWindow()?.platform === "macos") cx.spawn(async cx => {
      const result = await exec("defaults", ["read", "com.apple.universalaccess", "reduceMotion"]);
      this.reducedMotion = result.code === 0 && result.stdout.trim() === "1"; cx.notify();
    });
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command === "focus") this.handle.focus();
        else if (command === "start" && !this.state().running) this.act({ type: "run" }, cx);
        else if (command === "pause" && this.state().running) this.act({ type: "run" }, cx);
        else if (command === "picker") { this.drawer = "picker"; cx.notify(); }
        else if (command === "queue") { this.drawer = "queue"; cx.notify(); }
        else if (command === "settings") { this.drawer = "settings"; cx.notify(); }
        else if (command === "watch") { this.drawer = "watch"; cx.notify(); }
        else if (command === "quota") { this.drawer = "quota"; cx.notify(); }
        else if (command === "review") {
          const task = this.state().tasks.find(task => ["review", "failed", "merging"].includes(task.status));
          if (task) this.inspect(task.id, cx);
        }
        else if (command === "close") { this.drawer = null; cx.notify(); }
      }
    });
  }

  close() { this.search.release(); this.handle.release(); }
  state() { return shared(STORE)?.[this.id]; }
  act(action, cx) {
    const all = shared(STORE) ?? {}, state = all[this.id];
    if (!state) return;
    setShared(STORE, { ...all, [this.id]: reduce(state, action) }); cx.notify();
  }
  inspect(id, cx) { this.selected = id; this.drawer = "task"; cx.notify(); }
  button(id, label, fn, t, options = {}) {
    return Button.new(`pipeline-${id}`).h(32).px(options.iconOnly ? 8 : 11).gap(6).flex_none().flex().items_center().justify_center()
      .rounded(6).text_size(12).border_1().border_color(options.primary ? t.accent : t.border)
      .bg(options.primary ? t.accent : options.selected ? t.selected : t.surface)
      .text_color(options.primary ? t.accent_foreground : t.foreground).disabled(Boolean(options.disabled))
      .opacity(options.disabled ? 0.45 : 1).tab_index(0).accessibility_label(options.hint ?? label)
      .when(Boolean(options.hint), el => el.tooltip(options.hint))
      .hover(el => el.bg(options.primary ? t.accent : t.hover))
      .focus(el => el.border_color(t.accent))
      .on_click((_e, cx) => fn(cx))
      .when(Boolean(options.icon), el => el.child(icon(options.icon)))
      .when(!options.iconOnly, el => el.child(label));
  }
  label(text, t) { return div().text_size(12).font_medium().text_color(t.muted).child(text); }

  render(cx) {
    const state = this.state(), t = theme();
    if (!state) return div().p(24).text_color(t.foreground).child("Loading Pipeline…");
    const active = activeTasks(state).length;
    const queue = state.tasks.filter(task => task.status === "queued").length;
    const reviews = state.tasks.filter(task => task.status === "review").length;
    const failed = state.tasks.filter(task => task.status === "failed").length;
    const quotaHeld = state.quota - 8 < state.reserve;
    const status = !state.running ? "Intake paused" : quotaHeld ? "Waiting for quota" : active ? "Pipeline running" : reviews ? "Waiting for review" : "Watching for work";
    const narrow = this.size.width < 790;
    return v_flex().id("pipeline-root").size_full().min_w(0).min_h(0).bg(t.canvas).text_color(t.foreground).text_size(13)
      .track_focus(this.handle)
      .on_size_change((bounds, cx) => {
        // Herdr reports painted bounds; builder lengths are multiplied by app zoom.
        const zoom = Number(settings().zoom) || 1;
        const size = { width: bounds.width / zoom, height: bounds.height / zoom };
        if (Math.abs(size.width - this.size.width) > 1 || Math.abs(size.height - this.size.height) > 1) { this.size = size; cx.notify(); }
      })
      .on_key_down((e, cx) => {
        if (e.key === "escape" && this.drawer) { this.drawer = null; this.handle.focus(); cx.notify(); cx.stop_propagation(); }
        else if (this.handle.is_focused() && e.key === "space") { this.act({ type: "run" }, cx); cx.stop_propagation(); }
        else if (this.handle.is_focused() && e.key === "a") { this.drawer = "picker"; this.search.focus(); cx.notify(); }
      })
      .child(h_flex().h(86).px(24).pt(20).pb(14).gap(12).items_center().flex_none()
        .child(icon("pipeline", 24).text_color(t.accent))
        .child(v_flex().flex_1().min_w(0).gap(4)
          .child(h_flex().gap(10).items_center().child(div().text_size(23).font_semibold().child("Pipeline"))
            .child(div().px(7).py(3).rounded(4).bg(t.raised).text_size(10).text_color(t.muted).child("Simulation")))
          .child(div().text_size(12).text_color(t.muted).truncate().child(`${state.context.name} · example repositories: api, web, contracts, docs`)))
        .when(!narrow, el => el.child(this.button("motion", "Motion", cx => { this.motion = !this.motion; localStorage.setItem("motion", String(this.motion)); cx.notify(); }, t,
          { icon: "motion", iconOnly: true, selected: this.motion && !this.reducedMotion, hint: this.reducedMotion ? "System Reduce Motion is enabled" : `${this.motion ? "Disable" : "Enable"} task motion` }))))
      .child(h_flex().id("pipeline-controls").h(52).px(24).pb(16).gap(8).items_center().overflow_x_scrollbar().flex_none()
        .child(this.button("add", "Add tasks", cx => { this.drawer = "picker"; this.search.focus(); cx.notify(); }, t, { icon: "plus" }))
        .child(this.button("watch", state.watch ? `Watching ${state.column}` : "Watch column", cx => { this.drawer = "watch"; cx.notify(); }, t, { icon: "eye", selected: state.watch }))
        .child(this.button("parallel", `${state.parallel} parallel`, cx => { this.drawer = "settings"; cx.notify(); }, t, { icon: "pipeline" }))
        .child(this.button("quota", `Quota ${state.quota}%`, cx => { this.drawer = "quota"; cx.notify(); }, t, { icon: "gauge", hint: "Example quota and reserve controls" }))
        .child(div().flex_1())
        .child(this.button("settings", "Settings", cx => { this.drawer = "settings"; cx.notify(); }, t, { icon: "settings", iconOnly: true }))
        .child(this.button("run", state.running ? "Pause intake" : "Start pipeline", cx => this.act({ type: "run" }, cx), t, { icon: state.running ? "pause" : "play", primary: !state.running })))
      .child(h_flex().h(37).px(24).gap(9).items_center().flex_none().border_y(1).border_color(t.border).text_size(11).text_color(t.muted).overflow_x_scrollbar()
        .child(dot(quotaHeld && state.running ? t.blocked : state.running ? t.accent : t.muted))
        .child(div().font_medium().text_color(t.foreground).child(status))
        .child(div().ml(12).child(`${active}/${state.parallel} active`)).child(div().child(`${queue} queued`))
        .child(div().child(`${reviews} awaiting approval`))
        .when(failed > 0, el => el.child(div().text_color(t.foreground).child(`${failed} need attention`)))
        .child(div().flex_1()).child(div().child(state.delivery === "pr" ? "Delivery: PR approval" : "Delivery: direct merge")))
      .child(h_flex().relative().flex_1().min_h(0).min_w(0)
        .child(div().id("pipeline-viewport").flex_1().min_w(0).h_full().overflow_scrollbar()
          .child(this.scene(state, t)))
        .when(Boolean(this.drawer), el => el.child(this.inspector(state, t)
          .when(this.size.width > 1180, node => node.relative())
          .when(this.size.width <= 1180, node => node.absolute().right(0).top(0).bottom(0)))))
      .child(this.activity(state, t));
  }

  scene(state, t) {
    const drawerWidth = this.drawer && this.size.width > 1180 ? 330 : 0;
    const g = layoutScene(state, this.size.width - drawerWidth, this.size.height - 219);
    const motion = this.motion && !this.reducedMotion && appWindow()?.active !== false;
    const canvas = div().id("pipeline-scene").relative().w(g.w).h(g.h).flex_none().overflow_hidden();
    // Real geometry is derived from the same task and slot positions as the hit targets.
    const path = PathBuilder.stroke(1);
    const curve = (x1, y1, x2, y2) => path.move_to(x1, y1).cubic_bezier_to(x2, y2, (x1 + x2) / 2, y1, (x1 + x2) / 2, y2);
    for (const point of g.nodes.filter(node => node.task.status === "queued")) curve(point.x + 82, point.y, g.center.x - 55, g.center.y);
    if (!g.queue.length) curve(180, g.center.y, g.center.x - 55, g.center.y);
    for (const point of g.slots) {
      curve(g.center.x + 55, g.center.y, point.x - 82, point.y);
      curve(point.x + 82, point.y, g.w - 195, g.h * 0.49);
    }
    canvas.child(window.paint_path(path.build(), t.border).absolute().inset(0).size_full());
    const ring = PathBuilder.stroke(1).move_to(g.center.x - 86, g.center.y)
      .arc_to(86, 86, 0, false, true, g.center.x + 86, g.center.y)
      .arc_to(86, 86, 0, false, true, g.center.x - 86, g.center.y).dash_array([3, 7]);
    canvas.child(window.paint_path(ring.build(), t.border).absolute().inset(0).size_full());
    canvas.child(this.button("queue", `Queue · ${g.queue.length}`, cx => { this.drawer = "queue"; cx.notify(); }, t).absolute().left(30).top(18));
    canvas.child(this.label(`Work slots · ${state.parallel}`, t).absolute().left(g.w * 0.61 - 82).top(27));
    canvas.child(this.button("review-list", `Review · ${g.review.length}`, cx => { this.drawer = "history"; cx.notify(); }, t).absolute().right(30).top(18));
    for (let i = 0; i < g.slots.length; i++) {
      const point = g.slots[i], occupied = state.tasks.some(task => ACTIVE.includes(task.status) && task.slot === i);
      canvas.child(v_flex().absolute().left(point.x - 82).top(point.y - 34).w(164).h(68).gap(7).items_center().justify_center()
        .rounded(9).border_1().border_color(t.border).bg(t.canvas)
        .child(div().text_size(11).text_color(t.muted).child(`Slot ${i + 1}`))
        .when(!occupied, el => el.child(div().text_size(11).text_color(t.muted).child(i >= state.parallel ? "Finishing active work" : "Available"))));
    }
    canvas.child(v_flex().absolute().left(g.center.x - 55).top(g.center.y - 55).size(110).rounded(55).border_1().border_color(t.accent).bg(t.surface)
      .items_center().justify_center().gap(7).child(icon("pipeline", 27).text_color(t.accent))
      .child(div().font_medium().text_size(13).child("Planner"))
      .child(div().text_color(t.muted).text_size(10).child(state.running ? "Choosing work" : "Ready when you are")));
    canvas.child(v_flex().absolute().left(g.center.x - 128).top(g.center.y + 102).w(256).gap(7)
      .child(div().text_size(12).font_medium().child("The plan"))
      .child(div().text_size(12).line_height(1.5).text_color(t.muted).child(state.plan)));
    if (!g.queue.length) canvas.child(v_flex().absolute().left(30).top(88).w(164).gap(8)
      .child(div().text_size(13).child(state.watch ? `Watching ${state.column}` : "Queue is clear"))
      .child(div().text_size(12).text_color(t.muted).child(state.watch ? "New example tasks enter here." : "Add tasks to give the planner more work.")));
    if (g.queue.length > 5) canvas.child(this.button("queue-more", `View all ${g.queue.length} queued tasks`, cx => { this.drawer = "queue"; cx.notify(); }, t).absolute().left(30).top(470));
    if (!g.review.length) canvas.child(v_flex().absolute().right(30).top(92).w(164).gap(8)
      .child(icon("check", 19).text_color(t.muted))
      .child(div().text_size(12).text_color(t.muted).child("Checked changes arrive here for approval and merge.")));
    for (const { task, x, y } of g.nodes) {
      const color = stateColor(task, t), done = task.status === "done", routing = task.status === "routing";
      const compact = done || routing;
      const selected = this.drawer === "task" && this.selected === task.id;
      let node = Button.new(`pipeline-node-${task.id}`).absolute().left(x - (compact ? 10 : 82)).top(y - (compact ? 10 : 34))
        .w(compact ? 20 : 164).h(compact ? 20 : 68).rounded(compact ? 10 : 9).bg(routing ? t.accent : selected ? t.selected : t.surface)
        .border_1().border_color(selected ? t.accent : t.border).text_color(t.foreground).text_size(12).tab_index(0)
        .accessibility_label(`${task.id}: ${task.title}. ${LABELS[task.status]}. ${task.repos.join(", ")}`)
        .tooltip(task.status === "queued" ? `${task.title}\n${waitingReason(state, task)}` : `${task.title}\n${LABELS[task.status]}`)
        .hover(el => el.bg(t.hover).border_color(t.accent)).focus(el => el.border_color(t.accent))
        .on_click((_e, cx) => this.inspect(task.id, cx));
      if (motion) node = node.transition("left", { duration: 750, easing: "ease-out" }).transition("top", { duration: 750, easing: "ease-out" })
        .transition("width", { duration: 400, easing: "ease-out" }).transition("height", { duration: 400, easing: "ease-out" });
      if (done) node.child(icon("check", 12).text_color(t.foreground));
      else if (!routing) node.child(v_flex().size_full().p(10).gap(5)
        .child(h_flex().gap(6).items_center().child(dot(color)).child(div().text_size(10).font_medium().text_color(t.muted).child(task.id))
          .child(div().flex_1()).child(div().text_size(9).text_color(t.muted).truncate().child(task.repos.join(" + "))))
        .child(div().text_size(12).font_medium().truncate().child(task.title))
        .child(h_flex().gap(5).items_center()
          .when(ACTIVE.includes(task.status) && motion, el => el.child(div().id(`pulse-${task.id}`).size(3).rounded(2).bg(t.accent).loop("opacity", { from: 0.35, to: 1, period: 1400 })))
          .child(div().text_size(10).text_color(t.muted).truncate().child(task.status === "queued" && dependencies(state, task).length ? "Waiting for dependency" : LABELS[task.status]))));
      canvas.child(node);
    }
    canvas.child(this.button("history", `${state.tasks.filter(task => task.status === "done").length} completed`, cx => { this.drawer = "history"; cx.notify(); }, t, { icon: "check" }).absolute().right(28).bottom(12));
    canvas.child(div().absolute().left(30).bottom(23).text_size(11).text_color(t.muted).child("Select a task to follow its work across repositories."));
    return canvas;
  }

  inspector(state, t) {
    const titles = { picker: "Add tasks", queue: "Queued tasks", watch: "Watch a column", quota: "Quota", settings: "Pipeline settings", history: "Task activity", task: this.selected ?? "Task" };
    const panel = v_flex().id("pipeline-inspector").w(Math.min(330, this.size.width - 16)).h_full().min_h(0).flex_none().bg(t.surface).border_l(1).border_color(t.border)
      .child(h_flex().px(18).py(14).gap(8).items_center().flex_none().border_b(1).border_color(t.border)
        .child(div().flex_1().font_semibold().text_size(14).child(titles[this.drawer]))
        .child(this.button("close-drawer", "Close inspector", cx => { this.drawer = null; this.handle.focus(); cx.notify(); }, t, { icon: "x", iconOnly: true })));
    const body = v_flex().id("pipeline-inspector-scroll").flex_1().min_h(0).p(18).gap(16).overflow_y_scrollbar();
    if (this.drawer === "picker") this.picker(body, state, t);
    else if (this.drawer === "queue") {
      const tasks = state.tasks.filter(task => task.status === "queued");
      if (!tasks.length) body.child(this.label("Queue is clear. Add tasks or watch a column.", t));
      for (const task of tasks) body.child(this.taskRow(task, t, cx => this.inspect(task.id, cx)));
    }
    else if (this.drawer === "settings") this.settings(body, state, t);
    else if (this.drawer === "quota") this.quota(body, state, t);
    else if (this.drawer === "watch") this.watch(body, state, t);
    else if (this.drawer === "task") this.detail(body, state, t);
    else for (const task of state.tasks.filter(task => !["backlog", "queued"].includes(task.status))) body.child(this.taskRow(task, t, cx => this.inspect(task.id, cx)));
    if (this.drawer === "history" && !state.tasks.some(task => !["backlog", "queued"].includes(task.status))) body.child(this.label("Start the pipeline to see task activity.", t));
    return panel.child(body);
  }
  taskRow(task, t, fn, picked = false) {
    return Button.new(`pipeline-row-${task.id}`).w_full().p(10).rounded(6).bg(picked ? t.selected : t.surface)
      .border_1().border_color(picked ? t.accent : t.border).text_color(t.foreground).tab_index(0)
      .accessibility_label(`${task.id}: ${task.title}. ${picked ? "Selected" : LABELS[task.status]}`)
      .hover(el => el.bg(t.hover)).focus(el => el.border_color(t.accent)).on_click((_e, cx) => fn(cx))
      .child(v_flex().w_full().gap(6).child(h_flex().items_center().gap(6).child(dot(stateColor(task, t)))
        .child(div().text_size(10).text_color(t.muted).child(task.id)).child(div().flex_1())
        .when(picked, el => el.child(icon("check", 13))))
        .child(div().text_size(12).font_medium().child(task.title))
        .child(div().text_size(10).text_color(t.muted).child(`${task.repos.join(" + ")} · ${LABELS[task.status]}`)));
  }
  picker(body, state, t) {
    body.child(this.label("Choose from the example backlog. Existing queue entries are kept once.", t));
    body.child(Input.new(this.search).w_full().h(34).px(9).bg(t.input).border_1().border_color(t.border).rounded(6).text_size(12).accessibility_label("Search example tasks"));
    const query = this.search.value().trim().toLowerCase();
    const tasks = state.tasks.filter(task => task.status === "backlog" && `${task.id} ${task.title} ${task.repos.join(" ")}`.toLowerCase().includes(query));
    for (const task of tasks) body.child(this.taskRow(task, t, cx => { this.picked.has(task.id) ? this.picked.delete(task.id) : this.picked.add(task.id); cx.notify(); }, this.picked.has(task.id)));
    if (!tasks.length) body.child(this.label(query ? "No matching example tasks." : "All example tasks have joined the pipeline.", t));
    const valid = state.tasks.filter(task => task.status === "backlog" && this.picked.has(task.id)).map(task => task.id);
    body.child(this.button("add-picked", `Add ${valid.length} task${valid.length === 1 ? "" : "s"}`, cx => { this.act({ type: "add", ids: valid }, cx); this.picked.clear(); this.drawer = null; cx.notify(); }, t, { primary: true, disabled: !valid.length, icon: "plus" }));
  }
  stepper(body, title, hint, value, type, min, max, t) {
    body.child(v_flex().gap(7).child(div().font_medium().text_size(12).child(title)).child(this.label(hint, t))
      .child(h_flex().gap(10).items_center()
        .child(this.button(`${type}-less`, `Decrease ${title}`, cx => this.act({ type, value: value - 1 }, cx), t, { icon: "minus", iconOnly: true, disabled: value <= min }))
        .child(div().min_w(24).text_size(16).font_semibold().child(String(value)))
        .child(this.button(`${type}-more`, `Increase ${title}`, cx => this.act({ type, value: value + 1 }, cx), t, { icon: "plus", iconOnly: true, disabled: value >= max }))));
  }
  settings(body, state, t) {
    this.stepper(body, "Parallel tasks", "Lowering the limit lets active work finish.", state.parallel, "parallel", 1, 6, t);
    this.stepper(body, "Outstanding PRs", "Reserves one PR per repository, including active work.", state.reviewLimit, "reviewLimit", 1, 10, t);
    body.child(div().font_medium().text_size(12).child("Delivery for new changes"));
    for (const [value, label] of [["pr", "Create PRs · wait for approval"], ["direct", "Merge after checks pass"]]) body.child(this.button(`delivery-${value}`, label, cx => this.act({ type: "delivery", value }, cx), t, { selected: state.delivery === value }));
    body.child(this.label("Changes already in review keep their delivery policy. Multi-repository tasks complete after every repository merges.", t));
    body.child(div().h(1).bg(t.border));
    body.child(this.button("fail-check", state.failNext ? "Next check will fail" : "Simulate a failed check", cx => this.act({ type: "fail" }, cx), t, { disabled: state.failNext }));
    body.child(this.button("motion-setting", this.motion ? "Turn motion off" : "Turn motion on", cx => { this.motion = !this.motion; localStorage.setItem("motion", String(this.motion)); cx.notify(); }, t));
    body.child(this.button("reset", "Reset example pipeline", cx => { this.act({ type: "reset" }, cx); this.picked.clear(); this.selected = null; }, t, { icon: "reset" }));
    body.child(this.label("Runs while Herdr is open. The scene can close while the pipeline continues.", t));
  }
  quota(body, state, t) {
    body.child(div().text_size(29).font_semibold().child(`${state.quota}%`)).child(this.label("Example quota remaining", t));
    body.child(div().h(5).rounded(3).bg(t.raised).child(div().w(`${state.quota}%`).h(5).rounded(3).bg(t.accent)));
    body.child(this.label(`Reserve: ${state.reserve}%. Each example launch uses 8%. New work waits before crossing the reserve; active work finishes.`, t));
    body.child(this.button("quota-limit", "Simulate quota limit", cx => this.act({ type: "quota", value: state.reserve }, cx), t, { disabled: state.quota <= state.reserve }));
    body.child(this.button("quota-reset", "Reset example quota", cx => this.act({ type: "quota", value: 100 }, cx), t, { icon: "reset", primary: true }));
    this.stepper(body, "Quota reserve", "Percentage kept for your other work.", state.reserve, "reserve", 0, 50, t);
    body.child(this.label("Quota and launch costs are simulated. Live provider usage and reset times will be connected in a later milestone.", t));
  }
  watch(body, state, t) {
    body.child(this.label("A watched column feeds the same queue as picked tasks. Tasks are claimed once.", t));
    body.child(div().font_medium().text_size(12).child("Example board column"));
    for (const column of ["Ready", "Backlog"]) body.child(this.button(`column-${column}`, column, cx => this.act({ type: "column", value: column }, cx), t, { selected: state.column === column }));
    body.child(this.button("watch-toggle", state.watch ? "Stop watching" : `Watch ${state.column}`, cx => this.act({ type: "watch" }, cx), t, { icon: "eye", primary: !state.watch }));
    body.child(this.label(state.watch ? `Watching ${state.column}. New tasks join even while intake is paused.` : "Turn on watch to pick up matching tasks automatically.", t));
    body.child(this.button("arrival", `Move example task to ${state.column}`, cx => this.act({ type: "arrival" }, cx), t, { icon: "plus", disabled: !state.tasks.some(task => task.status === "backlog") }));
    body.child(this.label("This button simulates someone moving a task on the board. No external task service is changed.", t));
  }
  detail(body, state, t) {
    const task = state.tasks.find(task => task.id === this.selected);
    if (!task) { body.child(this.label("Select a task in the scene.", t)); return; }
    body.child(div().text_size(18).font_semibold().child(task.title));
    body.child(h_flex().gap(7).items_center().child(dot(stateColor(task, t))).child(div().text_size(12).child(LABELS[task.status])));
    body.child(div().text_size(12).line_height(1.5).text_color(t.muted).child(task.description));
    body.child(this.label(`Repositories: ${task.repos.join(" + ")}`, t));
    body.child(this.label(`Board: ${task.status === "done" ? "Done" : ["review", "merging"].includes(task.status) ? "Review" : [...ACTIVE, "failed"].includes(task.status) ? "Doing" : task.column} · example`, t));
    if (task.status === "queued") body.child(this.label(waitingReason(state, task), t));
    if (task.depends.length) {
      body.child(div().text_size(12).font_medium().child("Dependencies"));
      for (const id of task.depends) body.child(this.button(`dep-${id}`, `${id} · ${state.tasks.find(row => row.id === id)?.status === "done" ? "Merged" : "Waiting"}`, cx => this.inspect(id, cx), t));
    }
    if (["review", "merging", "done"].includes(task.status)) {
      body.child(div().text_size(12).font_medium().child("Related changes"));
      for (const repo of task.repos) {
        const approved = task.approvals.includes(repo);
        body.child(v_flex().gap(7).py(9).border_b(1).border_color(t.border)
          .child(div().text_size(12).font_medium().child(`${repo} · example PR`))
          .child(this.label(task.status === "done" ? "Merged" : task.status === "merging" ? "Merging after checks" : approved ? "Approved" : task.delivery === "direct" ? "Checks passed · automatic merge" : "Checks passed · approval needed", t))
          .when(task.status === "review" && task.delivery !== "direct" && !approved, el => el.child(this.button(`approve-${task.id}-${repo}`, `Approve ${repo} PR`, cx => this.act({ type: "approve", id: task.id, repo }, cx), t, { icon: "check", primary: true }))));
      }
      if (task.status === "review" && task.repos.every(repo => task.approvals.includes(repo))) body.child(this.label("Approved. Waiting for this repository's active merge to finish.", t));
    }
    if (task.status === "failed") body.child(this.label(task.error, t)).child(this.button(`retry-${task.id}`, "Retry task", cx => this.act({ type: "retry", id: task.id }, cx), t, { primary: true, icon: "reset" }));
    if (task.status === "queued") body.child(this.button(`remove-${task.id}`, "Remove from queue", cx => { this.act({ type: "remove", id: task.id }, cx); this.drawer = null; cx.notify(); }, t, { disabled: state.watch && task.column === state.column, hint: state.watch && task.column === state.column ? "Stop watching this column before removing a matching task" : "Return this task to the example backlog" }));
    const events = state.events.filter(item => item.task === task.id).slice(0, 5);
    if (events.length) body.child(div().text_size(12).font_medium().child("Task history"));
    for (const item of events) body.child(this.label(item.message, t));
  }
  activity(state, t) {
    const latest = state.events[0];
    return h_flex().h(44).px(24).py(12).gap(12).items_center().border_t(1).border_color(t.border).flex_none().text_size(11)
      .child(dot(latest ? t.accent : t.muted, 4))
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(latest?.message ?? "Start the pipeline to watch your first tasks enter."))
      .when(this.size.width > 800, el => el.child(div().text_color(t.muted).child("Example tasks · simulated execution")));
  }
}
