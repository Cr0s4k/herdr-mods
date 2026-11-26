import { View, div, svg, image } from "gpui-kit";
import { h_flex, Button, ScrollHandle } from "gpui-base";
import { spaces, panes, focused, run, openOverlay, notify, theme, window, shared, layout, settings, nextCommand } from "herdr";
import { track } from "./usage.js";
import { ReviewPanes } from "./review.js";
import { GitHubRepo, repositoryContext } from "./github.js";
import { BriefTracker } from "./brief-tracker.js";
import { LaunchTracker } from "./linear-launches.js";
import { PipelineTracker } from "./pipeline-tracker.js";
import { WatchersTracker, watchBranch } from "./watchers-tracker.js";
import { ITEMS as WATCHERS, active as watching } from "./watchers-model.js";
import { STORE as PIPELINES, pipelineId, spaceKey } from "./pipeline-model.js";
import { ACTIVITY, REPORTS, entriesFor, unreadFor, receipt } from "./model.js";
import { brighter, spin, watchMotion } from "./ui.js";
import { popupSize as togglesSize } from "./toggles.js";
import { BLOCK as OFFICE_BLOCK, SETTINGS as OFFICE, findAddress, showOffice, sidebarWanted } from "./office.js";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// Same as the agents mod: drops a status glyph, keeps a leading bracket or quote.
const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}\p{Ps}\p{Pi}]+/u, "").replace(/^\[ [!.] \] /, "").trim();

// A tab Herdr named (unnamed, or after its program) follows its agent's live
// title, as the agents list does; a name the person gave stays.
function label(tab, lead) {
  const prog = lead?.program?.name;
  const base = tab.named ? tab.name : prog ?? "Terminal";
  if (!lead?.program?.agent) return base;
  const live = clean(lead.title);
  // clean() would strip a path's leading ~ or /: test the title with only its status glyph gone.
  const path = /^[~/]|^[A-Za-z]:\\/.test((lead.title ?? "").replace(/^[^\p{L}\p{N}~/]+/u, ""));
  const telling = live && live !== lead.terminal && live !== prog && !path && !live.includes("@") && live.toLowerCase() !== lead.program.key;
  return (tab.name === prog || !tab.named) && telling ? live : base;
}

export default class Tabs extends View {
  init(_props, cx) {
    watchMotion(cx);
    this.pressed = null;
    this.scroll = ScrollHandle.new();
    try { this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}"); } catch { this.panels = {}; }
    if (!this.panels || typeof this.panels !== "object" || Array.isArray(this.panels)) this.panels = {};
    this.swipe = { acc: 0, steps: 0, at: 0, last: 0 };
    this.review = new ReviewPanes();
    this.github = new GitHubRepo();
    this.brief = new BriefTracker();
    this.brief.start(cx);
    this.launches = new LaunchTracker();
    this.launches.start(cx);
    this.pipeline = new PipelineTracker();
    this.pipeline.start(cx);
    this.watchers = new WatchersTracker();
    this.watchers.start(cx);
    this.office = { own: undefined, found: undefined, at: 0 };
    cx.spawn(async cx => {
      for (;;) {
        const own = shared(OFFICE)?.url ?? null;
        if (own !== this.office.own || Date.now() - this.office.at > 60000) {
          Object.assign(this.office, { own, at: Date.now(), found: Boolean(await findAddress(own).catch(() => null)) });
          cx.notify();
        }
        await cx.sleep(2000);
      }
    });
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command === "review") { track("review-panes", "open"); this.review.open(cx); }
        else if (command === "github") track("github", "open"), this.github.open(cx, repositoryContext(spaces(), panes(), focused()), window()?.platform);
        else if (command === "pipeline") this.openPipeline();
        else if (command === "agent-office") this.openOffice(cx);
        else if (command.startsWith("pipeline-")) this.pipelineCommand(command.slice("pipeline-".length), cx);
        else if ((command === "loops" || command === "skills" || command === "watchers") && shared("features")?.[command] === false) continue;
        else if (command === "watch-pr" && shared("features")?.watchers === false) continue;
        else if (command === "watch-pr") { track("watchers", "watch-branch"); watchBranch(repositoryContext(spaces(), panes(), focused())); }
        else if (["files", "changes", "show", "loops", "brief", "skills", "watchers", "linear", "plane"].includes(command)) this.togglePanel(command);
      }
    });
  }

  togglePanel(id) {
    const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body");
    if (panel && !panel.hidden && body?.active === id) run("layout.hide", { id: "panel" });
    else { track(id, "panel"); run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
  }

  openPipeline() {
    track("pipeline", "open");
    const space = spaces().find(space => space.active);
    if (!space) return;
    const existing = panes().find(pane => pane.mod === "pipeline" && space.tabs.some(tab => tab.id === pane.tab));
    if (existing) { run("tab.select", { id: existing.tab }); run("pane.focus", { pane: existing.pane }); return; }
    const context = repositoryContext(spaces(), panes(), focused());
    const cwd = context.cwd || space.folder || "", on = context.on || null;
    const all = shared(PIPELINES) ?? {}, key = spaceKey(all, on, cwd, space.id);
    run("tab.new", { space: space.id, name: "Pipeline", mod: "pipeline", props: {
      context: key ? { ...all[key].context, space: space.id }
        : { id: pipelineId(on, cwd, space.id), cwd, on, name: cwd.replace(/\\/g, "/").split("/").filter(Boolean).pop() || space.name, space: space.id },
    } });
  }

  openOffice(cx) {
    if (shared("features")?.agentOffice === false || window()?.platform !== "macos") return;
    track("agent-office", "tab-bar");
    cx.spawn(async () => {
      const found = await findAddress(shared(OFFICE)?.url ?? null).catch(() => null);
      if (!found) { openOverlay({ mod: "agent-office", kind: "dialog", width: 520, height: 230, props: {} }); return; }
      const error = await showOffice(found.url).catch(error => error?.message ?? String(error));
      if (error) notify({ title: "Agent Office didn't open", body: error, level: "error" });
    });
  }

  // The office at the bottom of the sidebar has a fixed height, so it's hidden, not emptied, when it has nothing to show.
  syncOffice(root, sidebar, w) {
    const block = find(root, OFFICE_BLOCK), office = this.office;
    if (!block || office?.found === undefined) return;
    const want = sidebarWanted({ sidebar, features: shared("features") ?? {}, found: office.found, platform: w?.platform });
    if (want === !block.hidden || (office.asked === want && Date.now() - office.askedAt < 1000)) return;
    Object.assign(office, { asked: want, askedAt: Date.now() });
    run(want ? "layout.show" : "layout.hide", { id: OFFICE_BLOCK });
  }

  // Pipeline hears commands only while it's on screen, and a new one only once it has started.
  pipelineCommand(command, cx) {
    const here = () => panes().some(pane => pane.mod === "pipeline" && pane.tab === focused()?.tab);
    if (here()) { run(`pipeline.${command}`); return; }
    this.openPipeline();
    cx.spawn(async cx => {
      for (let tries = 0; tries < 50 && !here(); tries++) await cx.sleep(100);
      await cx.sleep(300);
      if (here()) run(`pipeline.${command}`);
    });
  }

  // One tab per wheel notch. A touchpad or smooth-scrolling mouse sends many
  // small events per gesture: a short swipe or one smoothed notch (about
  // 25 px) switches one tab, a longer swipe keeps going a tab per 60 px, at
  // most one every 100 ms so each shows.
  wheel(e) {
    if (e.delta_lines) {
      if (e.delta_lines.y) run(e.delta_lines.y > 0 ? "tab.prev" : "tab.next");
      return;
    }
    const s = this.swipe, now = Date.now();
    // Phases often arrive only as moves (a macOS touchpad included): a pause
    // or a turn starts a new gesture.
    if (e.touch_phase === "started" || now - s.at > 250 || e.delta.y * s.acc < 0) Object.assign(s, { acc: 0, steps: 0 });
    s.at = now;
    s.acc += e.delta.y;
    const need = s.steps ? 60 : 20;
    if (Math.abs(s.acc) < need || now - s.last < 100) return;
    s.acc -= Math.sign(s.acc) * need;
    s.steps++;
    s.last = now;
    run(e.delta.y > 0 ? "tab.prev" : "tab.next");
  }

  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const stored = this.panels[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          if (want) { run("layout.select", { stack: "panel-body", child: want }); run("layout.show", { id: "panel" }); }
          else run("layout.hide", { id: "panel" });
          return;
        }
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  render() {
    this.brief.observe();
    const t = theme();
    const space = spaces().find(p => p.active);
    const shown = space?.tabs ?? [];
    const active = shown.findIndex(tab => tab.active);
    const selected = shown[active]?.id;
    if (selected !== this.selected || active !== this.selectedIndex) {
      this.selected = selected;
      this.selectedIndex = active;
      if (active >= 0) this.scroll.scroll_to_item(active);
    }
    const stop = (_e, cx) => cx.stop_propagation();
    const button = (id, label, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(label);
    const item = (c, i) => {
      const lead = panes().find(p => p.tab === c.id && p.program?.agent) ?? panes().find(p => p.tab === c.id);
      const program = lead?.program;
      const name = label(c, lead);
      return h_flex().id(`tab-${c.id}`).h(29).px(10).gap(7).rounded(7).items_center().flex_none().text_size(12.8)
        // A rename or status dot on this or an earlier tab can push the active one out.
        .when(i <= active, el => el.on_size_change((_size, cx) => { this.scroll.scroll_to_item(active); cx.notify(); }))
        .border(1).border_color(c.active ? t.border : t.chrome).bg(c.active ? t.raised : t.chrome).text_color(c.active ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(14)))
        .child(div().max_w(170).truncate().child(c.zoomed ? `${name} Z` : name))
        .when(c.status === "working", el => el.child(spin(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working))))
        .when(c.status === "blocked" || c.status === "done", el => el.child(div().size(6).rounded(3).bg(t[c.status])))
        .when(c.active, el => el.child(div().id(`close-${c.id}`).text_color(t.muted).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child(svg("mods/pane/close.svg").size(12))));
    };
    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 10;
    const panel = find(root, "panel"), body = find(root, "panel-body");
    this.syncOffice(root, sidebar, w);
    const loopsOn = shared("features")?.loops !== false;
    const skillsOn = shared("features")?.skills !== false;
    const watchersOn = shared("features")?.watchers !== false;
    const enabled = [...(shared("workspace.panels") ?? ["files", "changes"]), "show", ...(loopsOn ? ["loops"] : []), "brief", ...(skillsOn ? ["skills"] : []), ...(watchersOn ? ["watchers"] : []), "linear", "plane"];
    this.syncPanel(space, panel, body, enabled);
    const tab = shown.find(tab => tab.active)?.id;
    const review = panes().find(pane => pane.tab === tab && pane.mod === "review-pane");
    const panelButton = (id, label, icon) => {
      const on = panel && !panel.hidden && body?.active === id;
      return h_flex().id(`panel-${id}`).h(26).px(8).gap(5).flex_none().items_center().rounded(6)
        .text_size(13).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : brighter(t))
        .tooltip(`${on ? "Hide" : "Show"} ${label} side panel`)
        .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
        .on_click(() => this.togglePanel(id)).child(svg(icon).size(14)).child(label);
    };
    const opening = this.review.opening.has(tab);
    const reviewLabel = opening ? "Opening…" : review ? "Focus changes" : "Changes + terminal";
    const reviewHint = review ? "Focus the Changes pane in this tab. Your terminal keeps running."
      : "Open Changes with a terminal underneath in this tab. Both use normal pane shortcuts.";
    const reviewButton = h_flex().id("review-changes").h(27).px(9).gap(6).flex_none().items_center().rounded(6)
      .border_1().border_color(t.border).bg(review ? t.selected : t.chrome)
      .text_size(13).text_color(tab && !opening ? t.foreground : t.dim)
      .tooltip(opening ? "Opening Changes and a terminal in this tab…" : reviewHint)
      .accessibility_label(`${reviewLabel}. ${reviewHint}`)
      .hover(s => s.bg(tab && !opening ? t.hover : t.chrome)).on_mouse_down("left", stop)
      .on_click((_e, cx) => { if (tab && !opening) { track("review-panes", "open"); this.review.open(cx); } })
      .child(svg("mods/tabs-show/review.svg").size(15)).child(reviewLabel);
    const repository = repositoryContext(spaces(), panes(), focused());
    const githubEnabled = Boolean(repository.cwd) && !this.github.opening;
    const githubButton = Button.new("open-github").h(26).px(8).gap(5).flex_none().flex().items_center().rounded(6)
      .text_size(13).text_color(githubEnabled ? brighter(t) : t.dim).disabled(!githubEnabled)
      .accessibility_label("Open GitHub repository in a new Firefox tab")
      .tooltip(this.github.opening ? "Opening GitHub in Firefox…" : repository.cwd
        ? `Open this repository in a new Firefox tab\n${repository.cwd}` : "Select a project to open its GitHub repository")
      .hover(s => s.bg(githubEnabled ? t.hover : t.chrome)).on_mouse_down("left", stop)
      .on_click((_e, cx) => { track("github", "open"); this.github.open(cx, repository, w?.platform); })
      .child(svg("mods/tabs-show/github.svg").size(14)).child("GitHub");
    const togglesButton = Button.new("open-toggles").h(26).px(8).flex_none().flex().items_center().rounded(6)
      .text_color(t.muted).tooltip("Feature toggles").accessibility_label("Feature toggles")
      .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
      .on_click(() => openOverlay({ mod: "toggles", kind: "popup", ...togglesSize() }))
      .child(svg("mods/toggles/toggles.svg").size(14));
    const pipelines = shared(PIPELINES) ?? {};
    const ownKey = space && spaceKey(pipelines, repository.on || null, repository.cwd || space.folder || "", space.id);
    const questions = !space ? 0 : Object.entries(pipelines)
      .filter(([key, state]) => state?.live && (key === ownKey || state.space === space.id))
      .reduce((n, [, state]) => n + (state.tasks ?? []).filter(task => task.status === "input").length, 0);
    const pipelineButton = Button.new("open-pipeline").h(26).px(8).gap(5).flex_none().flex().items_center().rounded(6)
      .text_size(12).text_color(questions ? t.foreground : t.muted).disabled(!space)
      .accessibility_label(questions ? `Open Pipeline, ${questions} waiting for you` : "Open Pipeline")
      .tooltip(questions ? `${questions} ${questions === 1 ? "task in this space's Pipeline needs" : "tasks in this space's Pipeline need"} you in its terminal` : "Open this space's Pipeline in its own tab")
      .hover(el => el.bg(t.hover)).on_mouse_down("left", stop).on_click(() => this.openPipeline())
      .child(svg("mods/pipeline/pipeline.svg").size(14)).child("Pipeline")
      .when(questions > 0, el => el.child(div().px(5).h(18).rounded(4).bg(t.blocked + "26").text_color(t.blocked).text_size(11).font_semibold()
        .flex().items_center().child(`Needs you ${questions}`)));
    const officeOn = shared("features")?.agentOffice !== false && w?.platform === "macos";
    const officeButton = Button.new("open-agent-office").h(26).px(8).flex_none().flex().items_center().rounded(6)
      .text_color(t.muted).tooltip("Agent Office").accessibility_label("Open Agent Office")
      .hover(s => s.bg(t.hover)).on_mouse_down("left", stop).on_click((_e, cx) => this.openOffice(cx))
      .child(svg("mods/agent-office/building.svg").size(14));
    return h_flex().size_full().min_w(0).px(10).pl(lightsPadding).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => this.wheel(e))
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar().track_scroll(this.scroll)
        .on_size_change((_size, cx) => { if (active >= 0) { this.scroll.scroll_to_item(active); cx.notify(); } })
        .children(shown.map(item)))
      .child(button("tab-new", "+", () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 })))
      .child(githubButton)
      .child(pipelineButton)
      .when(officeOn, el => el.child(officeButton))
      .child(togglesButton)
      .when(enabled.includes("changes"), el => el.child(reviewButton)
        .child(div().w(1).h(16).mx(7).flex_none().bg(t.border)))
      .when(enabled.includes("files"), el => el.child(panelButton("files", "Files", "mods/files/file.svg")))
      .when(enabled.includes("changes"), el => el.child(panelButton("changes", "Git", "mods/changes-modal/git.svg")))
      .child(panelButton("show", "Show", "mods/show/show.svg"))
      .when(loopsOn, el => el.child(panelButton("loops", "Loops", "mods/loops/loops.svg")))
      .when(skillsOn, el => el.child(panelButton("skills", "Skills", "mods/skills/skills.svg")))
      .when(watchersOn, el => el.child(panelButton("watchers", (() => {
        const count = watching(shared(WATCHERS)).length;
        return count ? `Watchers (${count})` : "Watchers";
      })(), "mods/watchers/watchers.svg")))
      .child(panelButton("plane", "Tasks", "mods/plane/plane.svg"))
      .child(panelButton("brief", (() => {
        const count = unreadFor(entriesFor(space?.id, shared(ACTIVITY) ?? [], shared(REPORTS) ?? []), shared(receipt(space?.id))).length;
        return count ? `Brief (${count})` : "Brief";
      })(), "mods/brief/brief.svg"))
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/tabs-show/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/tabs-show/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/tabs-show/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"))));
  }
}
