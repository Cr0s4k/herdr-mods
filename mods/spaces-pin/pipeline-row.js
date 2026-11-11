import { svg, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { run, shared, openOverlay } from "herdr";
import { STORE, LIVE } from "./pipeline-model.js";

const unfinished = state => state.running || (state.tasks ?? []).some(task => task.status !== "done" && !task.discard);

// A space's pipeline is the one the toolbar's Pipeline button opens there. It is
// listed while its tab is open, it is started, or it has work that isn't merged.
export function spacePipeline(s, folders, ps) {
  const tabs = new Set((s.tabs ?? []).map(tab => tab.id));
  const pane = ps.find(p => p.mod === "pipeline" && tabs.has(p.tab)) ?? null;
  const all = shared(STORE) ?? {};
  const keyed = [...new Set(folders.filter(Boolean))].map(cwd => LIVE + JSON.stringify([s.machine ?? null, cwd])).filter(key => all[key]);
  const key = keyed.find(key => all[key].running) ?? keyed.find(key => unfinished(all[key])) ?? null;
  return pane || key ? { pane, state: key ? all[key] : null, key } : null;
}

export function pipelineSummary(state) {
  const count = (...statuses) => (state?.tasks ?? []).filter(task => statuses.includes(task.status)).length;
  const working = count("routing", "working", "input", "testing", "merging"), queued = count("queued"), review = count("review", "pr"), failed = count("failed");
  return [state?.running ? "Started" : "Not started", working && `${working} working`, queued && `${queued} queued`,
    review && `${review} to review`, failed && `${failed} stopped`].filter(Boolean).join(" · ");
}

export function openPipeline(s, { pane, state }) {
  run("space.select", { id: s.id });
  if (pane) { run("tab.select", { id: pane.tab }); run("pane.focus", { pane: pane.pane }); }
  else run("tab.new", { space: s.id, name: "Pipeline", mod: "pipeline", props: { context: state.context } });
}

export function closePipeline(s, { pane, key }) {
  openOverlay({ mod: "pipeline-close", kind: "dialog", width: 380, height: 270, props: { space: s.id, key, tab: pane?.tab ?? null } });
}

export function pipelineRow(s, pipe, t, indicator, { prefix = "", compact = false, ring = false, hovered = false, hover = null } = {}) {
  const on = s.active && Boolean(pipe.pane?.focused), started = Boolean(pipe.state?.running), summary = pipelineSummary(pipe.state);
  return h_flex().id(`${prefix}pipeline-${s.id}`).h(28).px(5).gap(6).min_w(0).flex_none().rounded(6).items_center()
    .when(compact, el => el.justify_center())
    .cursor_pointer().accessibility_label(`Pipeline, ${summary}`).tooltip(`Pipeline · ${summary}`)
    .when(on, el => el.bg(t.selected))
    .when(!on, el => el.hover(s => s.bg(t.hover)))
    .when(Boolean(hover), el => el.on_hover((over, cx) => hover(over, cx)))
    .on_click(() => openPipeline(s, pipe))
    .child(svg("mods/pipeline/pipeline.svg").size(14).flex_none().text_color(started || on ? t.foreground : t.muted))
    .when(!compact, el => el.child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(started || on ? t.foreground : t.muted).child("Pipeline")))
    .when(!compact && hovered, el => el.child(div().id(`${prefix}pipeline-close-${s.id}`).p(2).flex_none().rounded(4)
      .text_color(t.muted).hover(s => s.text_color(t.foreground)).cursor_pointer()
      .role("button").accessibility_label("Close pipeline").tooltip("Close pipeline…")
      .on_click((_e, cx) => { cx.stop_propagation(); closePipeline(s, pipe); })
      .child(svg("mods/pipeline/x.svg").size(12))))
    .child(started ? div().size(7).mx(3).flex_none().rounded(4).bg(t.working ?? t.dim) : indicator(t, "idle", true))
    .when(ring, el => el.relative().child(div().absolute().inset_0().rounded(6).border_1().border_color(t.accent)));
}
