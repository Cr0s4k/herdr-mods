import { svg, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { run, shared } from "herdr";
import { STORE, LIVE } from "./pipeline-model.js";

const unfinished = state => state.running || (state.tasks ?? []).some(task => task.status !== "done");

// A space's pipeline is the one the toolbar's Pipeline button opens there. It is
// listed while its tab is open, it is started, or it has work that isn't merged.
export function spacePipeline(s, folders, ps) {
  const tabs = new Set((s.tabs ?? []).map(tab => tab.id));
  const pane = ps.find(p => p.mod === "pipeline" && tabs.has(p.tab)) ?? null;
  const all = shared(STORE) ?? {};
  const states = [...new Set(folders.filter(Boolean))].map(cwd => all[LIVE + JSON.stringify([s.machine ?? null, cwd])]).filter(Boolean);
  const state = states.find(state => state.running) ?? states.find(unfinished) ?? null;
  return pane || state ? { pane, state } : null;
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

export function pipelineRow(s, pipe, t, indicator, { prefix = "", compact = false, ring = false } = {}) {
  const on = s.active && Boolean(pipe.pane?.focused), started = Boolean(pipe.state?.running), summary = pipelineSummary(pipe.state);
  return h_flex().id(`${prefix}pipeline-${s.id}`).h(28).px(5).gap(6).min_w(0).flex_none().rounded(6).items_center()
    .when(compact, el => el.justify_center())
    .cursor_pointer().accessibility_label(`Pipeline, ${summary}`).tooltip(`Pipeline · ${summary}`)
    .when(on, el => el.bg(t.selected))
    .when(!on, el => el.hover(s => s.bg(t.hover)))
    .on_click(() => openPipeline(s, pipe))
    .child(svg("mods/pipeline/pipeline.svg").size(14).flex_none().text_color(started || on ? t.foreground : t.muted))
    .when(!compact, el => el.child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(started || on ? t.foreground : t.muted).child("Pipeline")))
    .child(indicator(t, started ? "working" : "idle", true))
    .when(ring, el => el.relative().child(div().absolute().inset_0().rounded(6).border_1().border_color(t.accent)));
}
