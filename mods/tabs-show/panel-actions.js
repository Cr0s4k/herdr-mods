import { div, svg } from "gpui-kit";
import { spaces, panes, focused, props, run, notify, nextCommand } from "herdr";

const PANELS = {
  files: { mod: "files-pane", name: "Files" },
  changes: { mod: "review-pane", name: "Changes" },
  show: { mod: "show-pane", name: "Show" },
  loops: { mod: "loops-pane", name: "Loops" },
  brief: { mod: "brief-pane", name: "Brief" },
  skills: { mod: "skills-pane", name: "Skills" },
  watchers: { mod: "watchers-pane", name: "Watchers" },
  linear: { mod: "linear-pane", name: "Linear" },
  plane: { mod: "plane-pane", name: "Tasks" },
};
const opening = new Set();

export function bindPaneFocus(view, cx) {
  view.handle ??= cx.focus_handle();
  cx.spawn(async cx => {
    for (;;) if (await nextCommand() === "focus") view.handle.focus();
  });
}

export function moveToPane(kind, state, cx) {
  const panel = PANELS[kind], space = spaces().find(s => s.active);
  const tab = space?.tabs.find(t => t.active)?.id;
  if (!panel || !tab || props()?.overlay) return;
  const key = `${tab}:${kind}`;
  if (opening.has(key)) return;
  const all = panes().filter(p => p.tab === tab), existing = all.find(p => p.mod === panel.mod);
  if (existing) {
    run("pane.focus", { pane: existing.pane });
    run("layout.hide", { id: "panel" });
    return;
  }
  const anchor = all.find(p => p.pane === focused()?.pane) ?? all.find(p => p.program?.agent) ?? all[0];
  if (!anchor) return;
  opening.add(key);
  cx.notify();
  cx.spawn(async cx => {
    try {
      run("pane.split", { pane: anchor.pane, direction: "right", mod: panel.mod,
        props: { tab, panelState: state } });
      for (let i = 0; i < 100; i++) {
        // A pane opened in the original tab must not close another tab's side panel.
        if (focused()?.tab !== tab) return;
        const created = panes().find(p => p.tab === tab && p.mod === panel.mod);
        if (created) {
          run("pane.focus", { pane: created.pane });
          run("layout.hide", { id: "panel" });
          return;
        }
        await cx.sleep(100);
      }
      throw new Error(`Could not open ${panel.name} as a pane. The side panel is still available.`);
    } catch (error) {
      notify({ title: `Move ${panel.name} to pane`, body: error.message || String(error), level: "error" });
    } finally { opening.delete(key); cx.notify(); }
  });
}

export function moveToPaneButton(kind, state, t) {
  const tab = spaces().find(s => s.active)?.tabs.find(tab => tab.active)?.id;
  const panel = PANELS[kind], busy = opening.has(`${tab}:${kind}`);
  const existing = panes().some(p => p.tab === tab && p.mod === panel.mod);
  const label = existing ? `Move to the existing ${panel.name} pane` : "Move to pane";
  return div().id(`move-${kind}-to-pane`).size(26).flex_none().flex().items_center().justify_center().rounded(6)
    .text_color(t.muted).opacity(tab && !busy ? 1 : 0.4)
    .tooltip(busy ? `Opening ${panel.name} pane…` : label).accessibility_label(`Move ${panel.name} to pane`)
    .when(Boolean(tab && !busy), el => el.cursor_pointer().hover(s => s.bg(t.hover).text_color(t.foreground)))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => { if (tab && !busy) moveToPane(kind, state, cx); })
    .child(svg("mods/tabs-show/move-to-pane.svg").size(15));
}
