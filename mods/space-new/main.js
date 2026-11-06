import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, Input, InputState, v_virtual_list, VirtualListScrollHandle, Scrollbar } from "gpui-base";
import { home, spaces, panes, focused, run, theme, props, openOverlay, closeOverlay } from "herdr";
import { listProjects } from "./projects.js";
import { ReviewPanes } from "./review.js";

export default class SpaceNew extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.mode = props()?.projects ? "projects" : "menu";
    this.at = 0;
    this.projects = [];
    this.busy = false;
    this.root = `${home().replace(/[\\/]$/, "")}/Projects`;
    this.review = new ReviewPanes();
    if (this.mode !== "projects") return;
    this.scroll = VirtualListScrollHandle.new();
    this.input = InputState.new({ placeholder: "Search projects…" });
    this.input.on("change", (_e, cx) => { this.at = 0; this.scroll.scroll_to_item(0); cx.notify(); });
    this.input.on("submit", (_e, cx) => this.create(this.filtered()[this.at], cx));
    this.input.focus();
    this.load(cx);
  }

  load(cx) {
    if (this.loading || this.busy) return;
    this.loading = true;
    this.error = null;
    cx.spawn(async cx => {
      try { this.projects = await listProjects(this.root); this.at = 0; }
      catch (error) { this.error = error.message || String(error); }
      finally { this.loading = false; cx.notify(); }
    });
  }

  filtered() {
    const query = (this.input?.value() ?? "").trim().toLocaleLowerCase();
    return this.projects.filter(project => project.name.toLocaleLowerCase().includes(query));
  }

  choose(index) {
    closeOverlay(props().overlay);
    if (index === 0) run("space.new");
    else openOverlay({ mod: "space-new", kind: "popup", width: 460, height: 500, props: { projects: true } });
  }

  create(project, cx) {
    if (!project || this.busy || this.loading || this.created) return;
    this.busy = true;
    this.error = null;
    cx.notify();
    cx.spawn(async cx => {
      let created;
      try {
        const before = new Set(spaces().map(s => s.id));
        // This list is local, even when a remote space was selected before opening it.
        run("space.new", { folder: project.folder, machine: "" });
        // Native snapshots can lag the structural command until the next frame.
        for (let i = 0; i < 100; i++) {
          created = spaces().find(s => !s.machine && !before.has(s.id) && s.folder === project.folder);
          if (created) break;
          await cx.sleep(100);
        }
        if (!created) throw new Error("The space did not open. Try choosing the project again.");
        const tab = created.tabs.find(t => t.active)?.id;
        for (let i = 0; i < 100; i++) {
          if (focused()?.tab !== tab) throw new Error("Return to the new space and choose Changes + terminal to finish setup.");
          if (panes().some(p => p.tab === tab && p.terminal)) break;
          if (i === 99) throw new Error("The terminal did not open. Return to the new space and choose Changes + terminal to finish setup.");
          await cx.sleep(100);
        }
        await this.review.openInTab(cx);
        closeOverlay(props().overlay);
      } catch (error) {
        this.error = error.message || String(error);
        // Never create a second space when only its review layout needs retrying.
        if (created) this.created = created.id;
      } finally { this.busy = false; cx.notify(); }
    });
  }

  key(e, cx) {
    if (this.busy || e.modifiers.control || e.modifiers.platform || e.modifiers.alt) return;
    const count = this.mode === "menu" ? 2 : this.filtered().length;
    if (!count) return;
    if (e.key === "down") this.at = (this.at + 1) % count;
    else if (e.key === "up") this.at = (this.at + count - 1) % count;
    else if (e.key === "enter" && this.mode === "menu") this.choose(this.at);
    else return;
    if (this.mode === "projects") this.scroll.scroll_to_item(this.at);
    cx.stop_propagation();
    cx.notify();
  }

  render() {
    const t = theme();
    const root = v_flex().id("space-new-menu").track_focus(this.handle).w_full().h(this.mode === "menu" ? 114 : 500).min_h(0)
      .bg(t.popover).text_color(t.foreground).text_size(12.8).on_key_down((e, cx) => this.key(e, cx));
    if (this.mode === "menu") {
      return root.p(5).children([
        ["New space", "A terminal in the current folder", "plus"],
        ["From a project…", "Terminal, Changes + terminal", "folder"],
      ].map(([label, hint, icon], i) => h_flex().id(`space-new-option-${i}`).h(52).px(10).gap(10).items_center().rounded(7)
        .role("button").accessibility_label(label).cursor_pointer()
        .when(this.at === i, el => el.bg(t.selected)).hover(s => s.bg(t.selected))
        .on_click(() => this.choose(i))
        .child(svg(`mods/workspace-chrome/${icon}.svg`).size(15).text_color(t.muted))
        .child(v_flex().flex_1().min_w(0).gap(3).child(label).child(div().text_size(11).text_color(t.muted).child(hint)))
        .when(i === 1, el => el.child(svg("mods/workspace-chrome/chevron-right.svg").size(12).text_color(t.muted)))));
    }
    const projects = this.filtered();
    const message = this.loading ? "Loading projects…" : this.error
      || (!this.projects.length ? "No project folders in ~/Projects. Add a folder there, then refresh."
        : !projects.length ? "No projects match your search." : null);
    return root.p(14).gap(10)
      .child(h_flex().items_center().gap(10).flex_none()
        .child(div().flex_1().font_semibold().text_size(15).child("Choose a project"))
        .child(div().id("projects-refresh").size(26).flex().items_center().justify_center().rounded(5)
          .role("button").accessibility_label("Refresh projects").tooltip("Refresh projects")
          .text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground)).cursor_pointer()
          .on_click((_e, cx) => this.load(cx)).child(svg("mods/loops/loops.svg").size(14))))
      .child(div().flex_none().text_size(11.5).text_color(t.muted).child("~/Projects"))
      .child(h_flex().h(34).flex_none().px(10).gap(8).items_center().rounded(7).border_1().border_color(t.accent).bg(t.background)
        .child(svg("mods/workspace-chrome/search.svg").size(14).text_color(t.muted))
        .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground)))
      .when(Boolean(message), el => el.child(v_flex().flex_1().min_h(0).pt(12).gap(12)
        .child(div().text_size(12).text_color(this.error ? t.ansi1 : t.muted).child(message))
        .when(Boolean(this.error) && !this.created, el => el.child(div().id("projects-retry").role("button")
          .accessibility_label("Retry loading projects").text_color(t.accent).cursor_pointer().on_click((_e, cx) => this.load(cx)).child("Retry")))
        .when(Boolean(this.created), el => el.child(div().id("projects-return").role("button").text_color(t.accent).cursor_pointer()
          .on_click(() => { run("space.select", { id: this.created }); closeOverlay(props().overlay); }).child("Return to the new space")))))
      .when(!message, el => el.child(div().h(330).flex_none().min_h(0).relative().overflow_hidden()
        .child(v_virtual_list("projects-list", projects.length, 38, i => projects[i].folder,
        range => Array.from({ length: range.end - range.start }, (_, offset) => {
          const i = range.start + offset, project = projects[i];
          return h_flex().id(`project-${project.folder}`).h(38).px(10).gap(10).rounded(6).items_center()
            .role("button").accessibility_label(`Open ${project.name}`).tooltip(project.folder)
            .when(this.busy, el => el.opacity(0.5)).when(this.at === i, el => el.bg(t.selected))
            .hover(s => s.bg(t.hover)).cursor_pointer()
            .child(svg("mods/workspace-chrome/folder.svg").size(15).flex_none().text_color(t.muted))
            .child(div().flex_1().min_w(0).truncate().child(project.name));
        })).id("projects-list").track_scroll(this.scroll).size_full()
          .on_item_click((folder, cx) => this.create(this.projects.find(p => p.folder === folder), cx)))
        .child(Scrollbar.vertical("projects-list").viewport_from_layout().absolute().inset_0())))
      .child(div().flex_none().pt(4).text_size(11).text_color(t.muted)
        .child(this.busy ? "Opening space…" : "Terminal on the left · Changes + terminal on the right"));
  }
}
