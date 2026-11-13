import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, shared, setShared, closeOverlay, theme } from "herdr";
import { STORE, reduce, forgettable } from "./pipeline-model.js";

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function closeDetail(state) {
  const tasks = state?.tasks ?? [], count = (...statuses) => tasks.filter(task => statuses.includes(task.status) && !task.discard).length;
  const queued = count("queued"), work = tasks.filter(task => !task.discard && !["queued", "merging", "pr", "done"].includes(task.status)).length, prs = count("pr", "merging");
  const lines = [state?.running ? "Stops the pipeline, so no new task starts." : null,
    work ? `Stops ${plural(work, "agent")} and deletes ${work === 1 ? "its" : "their"} worktrees and branches. Unmerged work is lost.` : null,
    queued ? `Removes ${plural(queued, "queued task")}.` : null,
    prs ? `Leaves ${plural(prs, "task")} that ${prs === 1 ? "is" : "are"} merging or waiting on a pull request.` : null,
    state?.schedule ? "Clears its schedule." : null].filter(Boolean);
  return lines.length ? lines : ["Closes the Pipeline tab. Nothing is running."];
}

// Closing leaves nothing to finish when no agent, worktree or pull request is left; only then can the saved pipeline go too.
export const canForget = state => Boolean(state?.live && forgettable(reduce(state, { type: "close" })));

export function closePipeline({ key, tab }, forget = false) {
  const all = shared(STORE) ?? {}, state = key ? all[key] : null;
  if (state) {
    const next = reduce(state, { type: "close" });
    if (forget && forgettable(next)) { const rest = { ...all }; delete rest[key]; setShared(STORE, rest); }
    else if (next !== state) setShared(STORE, { ...all, [key]: next });
  }
  if (tab) try { run("tab.close", { id: tab, confirmed: true }); } catch { /* Already closed. */ }
}

export default class PipelineClose extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  yes(forget = false) {
    const p = props();
    closeOverlay(p.overlay);
    closePipeline(p, forget);
  }

  render() {
    const t = theme(), p = props() ?? {}, state = p.key ? (shared(STORE) ?? {})[p.key] : null;
    const button = (id, label, bg, fg, onClick) =>
      h_flex().id(id).h(32).px(14).items_center().rounded(8).border_1().border_color(id === "no" ? t.input : bg).bg(bg).text_color(fg)
        .cursor_pointer().role("button").accessibility_label(label).hover(s => s.opacity(0.88)).on_click(onClick).child(label);
    return v_flex().id("pipeline-close").track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "enter") this.yes();
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.stop_propagation();
      })
      .size_full().min_h(0).p(18).gap(12).rounded(8).bg(t.popover).text_size(13)
      .child(h_flex().gap(8).items_center()
        .child(svg("mods/pipeline/pipeline.svg").size(16).flex_none().text_color(t.muted))
        .child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child(`Close ${state?.context?.name ? `${state.context.name}'s pipeline` : "pipeline"}?`))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(v_flex().id("pipeline-close-detail").flex_1().min_h(0).gap(6).overflow_y_scrollbar().text_color(t.muted).line_height(1.45)
        .children(closeDetail(state).map(line => div().child(line))))
      .when(canForget(state), el => el.child(div().text_size(11).line_height(1.4).text_color(t.dim).child("Close and forget also removes this space's saved pipeline and its history. The project's settings stay while another of its pipelines is saved.")))
      .child(h_flex().justify_end().gap(8).text_size(12)
        .child(button("no", "Cancel", t.raised, t.foreground, () => closeOverlay(props().overlay)))
        .when(canForget(state), el => el.child(button("forget", "Close and forget", t.raised, t.blocked, () => this.yes(true))))
        .child(button("yes", "Close pipeline", t.blocked, t.solid_foreground, () => this.yes())));
  }
}
