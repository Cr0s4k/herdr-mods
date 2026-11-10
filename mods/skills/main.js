import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Button, Input, InputState, TextView, Editor, EditorState } from "gpui-base";
import { appHome, spaces, panes, focused, props, exec, readTextFile, theme, settings, openOverlay, closeOverlay } from "herdr";
import { moveToPaneButton } from "./panel-actions.js";
import { GROUPS, contextFor, visibleSkills, expandedSkills, agentsFor, agentLabel, originLabel, statusLabel, shortPath } from "./model.js";

const ICON = "mods/skills/skills.svg";
const basename = path => path?.replace(/[\\/]$/, "").split(/[\\/]/).pop() || path || "No working folder";
const bodyOf = text => text.replace(/^\ufeff?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/, "");

export default class Skills extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    if (props()?.overlay && props()?.skill) return this.initReader(props(), cx);
    const state = props()?.panelState ?? {};
    this.scope = state.scope ?? localStorage.getItem("scope") ?? "here";
    this.agent = state.agent ?? localStorage.getItem("agent") ?? "all";
    this.query = state.query ?? "";
    this.folded = new Set(state.folded ?? ["plugin", "builtin", "admin"]);
    this.items = []; this.warnings = []; this.selected = 0;
    this.search = InputState.new({ placeholder: "Search skills…", value: this.query });
    this.search.on("change", (_e, cx) => { this.query = this.search.value(); this.selected = 0; cx.notify(); });
    this.search.on("submit", () => {
      const item = expandedSkills(this.visible(), this)[this.selected];
      if (item) this.open(item);
    });
    this.search.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.search.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.refresh(cx);
    cx.timer.every(15000, cx => this.refresh(cx));
  }

  close() { this.search?.release(); this.source?.release(); }

  location() { return contextFor(spaces(), panes(), focused(), props()?.tab, this.context); }
  visible() { return visibleSkills(this.items, this); }
  state() { return { scope: this.scope, agent: this.agent, query: this.query, folded: [...this.folded] }; }

  refresh(cx, force = false) {
    const context = this.location(), key = JSON.stringify(context);
    if (!force && this.loading && key === this.key) return;
    const changed = key !== this.key;
    if (changed) { this.items = []; this.warnings = []; this.error = null; this.selected = 0; }
    this.context = context; this.key = key;
    this.loading = true;
    const request = this.request = (this.request ?? 0) + 1;
    cx.spawn(async cx => {
      try {
        this.script ??= await readTextFile(`${appHome()}/mods/skills/discover.py`);
        if (!this.script) throw new Error("The skill reader is missing. Reinstall the Herdr mods, then refresh.");
        const args = ["-c", this.script];
        if (context.cwd) args.push("--cwd", context.cwd);
        const result = await exec("python3", args, { on: context.on });
        if (this.request !== request) return;
        let data;
        try { data = JSON.parse(result.stdout); }
        catch { throw new Error("Cannot read the skill inventory. Check Python 3 on this machine, then refresh."); }
        if (result.code !== 0 || data.error || !Array.isArray(data.skills)) throw new Error(data.error || "Cannot read skills. Try refreshing.");
        this.items = data.skills; this.home = data.home; this.warnings = data.warnings ?? []; this.error = null;
      } catch (error) {
        if (this.request === request) this.error = `${context.on ?? "This computer"}: ${error.message || error}`;
      } finally {
        if (this.request === request) { this.loading = false; cx.notify(); }
      }
    });
  }

  open(skill) {
    openOverlay({ mod: "skills", kind: "dialog", width: 0.9, height: 0.9,
      props: { skill: this.items.find(item => item.id === skill.id) ?? skill, on: this.context.on, home: this.home } });
  }

  button(id, label, action, selected = false) {
    const t = theme();
    return Button.new(id).h(27).px(9).flex_none().rounded(6).text_size(11.5)
      .bg(selected ? t.selected : t.raised).text_color(selected ? t.foreground : t.muted)
      .hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => action(cx)).child(label);
  }

  choose(field, value, cx) {
    this[field] = value; this.selected = 0;
    localStorage.setItem(field, value); cx.notify();
  }

  row(skill, index, t) {
    const disabled = skill.installations.every(item => item.enabled !== true);
    const agents = agentsFor(skill).map(agentLabel).join(" · ");
    const origins = [...new Set(skill.installations.map(originLabel))].join(" · ");
    return Button.new(`skill-${skill.id}`).w_full().flex_none().px(10).py(10).rounded(6)
      .bg(!this.typing && index === this.selected ? t.selected : t.background)
      .text_color(t.foreground).hover(s => s.bg(t.hover)).cursor_pointer()
      .accessibility_label(`${skill.name}. ${agents}. ${origins}. Read skill`)
      .tooltip(`${skill.name}\n${origins}\n${shortPath(skill.path, this.home)}`)
      .on_click(() => { this.selected = index; this.open(skill); })
      .child(v_flex().w_full().gap(5)
        .child(h_flex().gap(8).items_center()
          .child(div().flex_1().min_w(0).font_medium().truncate().child(skill.name))
          .child(div().flex_none().text_size(11).text_color(t.muted).child(agents)))
        .when(Boolean(skill.description), el => el.child(div().text_size(11.5).text_color(t.muted).whitespace_normal()
          .child(skill.description.length > 150 ? skill.description.slice(0, 147) + "…" : skill.description)))
        .when(skill.group === "plugin" || disabled, el => el.child(div().text_size(11).text_color(t.muted).truncate()
          .child(disabled ? [...new Set(skill.installations.map(statusLabel))].join(" · ") + " · " + origins : origins))));
  }

  render(cx) {
    if (props()?.overlay && props()?.skill) return this.renderReader();
    if (JSON.stringify(this.location()) !== this.key) this.refresh(cx);
    const t = theme(), visible = this.visible();
    const expanded = expandedSkills(visible, this);
    this.selected = Math.min(this.selected, Math.max(0, expanded.length - 1));
    const group = ([id, label]) => {
      const items = visible.filter(item => item.group === id);
      if (!items.length) return null;
      const folded = this.folded.has(id) && !this.query;
      return v_flex().flex_none().gap(3).mb(10)
        .child(Button.new(`skills-group-${id}`).h(29).w_full().px(10).rounded(5).text_color(t.muted).text_size(11)
          .hover(s => s.bg(t.hover)).accessibility_label(`${folded ? "Expand" : "Collapse"} ${label}, ${items.length} skills`)
          .on_click((_e, cx) => { if (this.folded.has(id)) this.folded.delete(id); else this.folded.add(id); cx.notify(); })
          .child(h_flex().w_full().items_center().gap(7)
            .child(svg(`mods/files-modal/chevron-${folded ? "right" : "down"}.svg`).size(12))
            .child(div().flex_1().child(label)).child(String(items.length))))
        .when(!folded, el => el.children(items.map(item => this.row(item, expanded.indexOf(item), t))));
    };
    const folder = this.context?.cwd, on = this.context?.on;
    return v_flex().id("skills").size_full().min_w(0).min_h(0).overflow_hidden().bg(t.background)
      .when(!this.embedded, el => el.rounded(10).border_1().border_color(t.border))
      .text_size(13).text_color(t.foreground).track_focus(this.handle)
      .on_key_down((event, cx) => {
        if (this.typing) return;
        if (event.key === "down" || event.key === "up") {
          this.selected = Math.max(0, Math.min(expanded.length - 1, this.selected + (event.key === "down" ? 1 : -1)));
        } else if (event.key === "enter" && expanded[this.selected]) this.open(expanded[this.selected]);
        else return;
        cx.stop_propagation(); cx.notify();
      })
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(svg(ICON).size(15).text_color(t.muted))
        .child(div().font_semibold().flex_1().child("Skills"))
        .child(this.button("skills-refresh", this.loading ? "Reading…" : "Refresh", cx => { if (!this.loading) this.refresh(cx, true); })
          .disabled(this.loading).accessibility_label("Refresh skills"))
        .when(!this.embedded, el => el.child(moveToPaneButton("skills", this.state(), t))))
      .child(v_flex().flex_none().px(14).py(12).gap(9)
        .child(div().text_size(11.5).text_color(t.muted).truncate().tooltip(`${folder || "Personal skills only"}\n${on || "This computer"}`)
          .child(`${basename(folder)} · ${on || "This computer"}`))
        .child(h_flex().gap(5)
          .child(this.button("skills-here", "Available here", cx => this.choose("scope", "here", cx), this.scope === "here"))
          .child(this.button("skills-library", "Personal library", cx => this.choose("scope", "library", cx), this.scope === "library")))
        .child(h_flex().gap(5)
          .children([["all", "All agents"], ["codex", "Codex"], ["claude", "Claude"]].map(([id, label]) =>
            this.button(`skills-agent-${id}`, label, cx => this.choose("agent", id, cx), this.agent === id))))
        .child(Input.new(this.search).w_full().text_size(12)))
      .child(v_flex().id("skills-list").flex_1().min_h(0).overflow_y_scrollbar().px(4)
        .when(Boolean(this.error), el => el.child(div().px(10).py(12).text_size(12).text_color(t.blocked).whitespace_normal().child(this.error)))
        .when(!visible.length && !this.error, el => el.child(v_flex().px(10).py(20).gap(8)
          .child(div().font_medium().child(this.loading ? "Looking for skills…" : this.query ? "No matching skills" : "No skills discovered"))
          .child(div().text_size(12).text_color(t.muted).whitespace_normal().child(this.query
            ? "Try a skill name, description, plugin, or source path."
            : "Project and personal skills appear here when found. Personal library also includes disabled and unverified plugin copies."))))
        .children(GROUPS.map(group).filter(Boolean))
        .when(this.warnings.length > 0, el => el.child(v_flex().px(10).py(12).gap(6)
          .children(this.warnings.map(warning => div().text_size(11).text_color(t.blocked).whitespace_normal().child(warning))))))
      .child(div().flex_none().px(14).py(10).border_t(1).border_color(t.border).text_size(11).text_color(t.muted).whitespace_normal()
        .tooltip("Lists discovered files and configured plugins. A running agent may have different settings or session context.")
        .child(`${visible.length} ${visible.length === 1 ? "skill" : "skills"} · Discovered on disk; session loading unverified.`));
  }

  initReader(p, cx) {
    this.raw = false; this.copied = null;
    this.handle.focus();
    cx.timer.after(200, () => this.handle.focus());
    cx.spawn(async cx => {
      try {
        const text = await readTextFile(p.skill.path, { on: p.on });
        if (text === null) throw new Error("This skill is no longer available. Close this reader and refresh the list.");
        if (text.includes("\0")) throw new Error("This skill is not a text file.");
        this.text = text.length > 260000 ? text.slice(0, 260000) + "\n\n… Preview truncated." : text;
        this.markdown = bodyOf(this.text);
        this.source = EditorState.new({ value: this.text, language: "md", readonly: true,
          font_family: settings().font_family, font_size: 13 });
      } catch (error) { this.readerError = `Cannot read skill: ${error.message || error}`; }
      finally { cx.notify(); }
    });
  }

  renderReader() {
    const p = props(), skill = p.skill, t = theme();
    const commands = [...new Set(skill.installations.filter(item => item.enabled === true).map(item => item.command).filter(Boolean))];
    const copy = (id, text, cx) => {
      cx.write_to_clipboard(text); this.copied = id; cx.notify();
      cx.timer.after(1800, cx => { this.copied = null; cx.notify(); });
    };
    return v_flex().id("skills-reader").size_full().min_w(0).min_h(0).bg(t.background).text_color(t.foreground).text_size(13).track_focus(this.handle)
      .on_key_down((event, cx) => { if (event.key === "escape") { closeOverlay(p.overlay); cx.stop_propagation(); } })
      .child(h_flex().h(48).flex_none().px(18).gap(10).items_center().border_b(1).border_color(t.border)
        .child(svg(ICON).size(17).text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().font_semibold().child(skill.name))
        .child(this.button("skill-preview", "Read", cx => { this.raw = false; cx.notify(); }, !this.raw))
        .child(this.button("skill-source", "Source", cx => { this.raw = true; cx.notify(); }, this.raw))
        .child(this.button("skill-close", "Close", () => closeOverlay(p.overlay))))
      .child(v_flex().flex_none().px(22).py(14).gap(10).border_b(1).border_color(t.border)
        .when(Boolean(skill.description), el => el.child(div().text_color(t.muted).whitespace_normal().child(skill.description)))
        .child(h_flex().gap(8).items_center()
          .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.muted).tooltip(skill.path).child(shortPath(skill.path, p.home)))
          .child(this.button("skill-copy-path", this.copied === "path" ? "Copied" : "Copy path", cx => copy("path", skill.path, cx))))
        .child(h_flex().flex_wrap().gap(6).items_center()
          .children(commands.map(command => this.button(`copy-${command}`, this.copied === command ? "Copied" : `Copy ${command}`, cx => copy(command, command, cx))))))
      .child(v_flex().flex_1().min_h(0)
        .when(this.raw && Boolean(this.source), el => el.child(Editor.new(this.source).flex_1().min_h(0)))
        .when(!this.raw || !this.source, el => el.child(v_flex().id("skill-reader-scroll").flex_1().min_h(0).overflow_y_scrollbar().px(22).py(18).gap(18)
          .when(Boolean(this.readerError) || this.text === undefined, el => el.child(div().text_color(this.readerError ? t.blocked : t.muted).whitespace_normal().child(this.readerError || "Loading instructions…")))
          .when(this.text !== undefined, el => el.child(TextView.markdown(`skill-body-${skill.id}`, this.markdown)))
          .child(v_flex().gap(9).pt(14).border_t(1).border_color(t.border)
            .child(div().font_semibold().child("Discovery locations"))
            .children(skill.installations.map((item, index) => v_flex().id(`installation-${index}`).gap(4).py(5)
              .child(div().font_medium().text_size(12).child(`${agentLabel(item.agent)} · ${originLabel(item)} · ${statusLabel(item)}`))
              .child(div().text_size(11.5).text_color(t.muted).whitespace_normal().child(shortPath(item.path, p.home)))
              .when(Boolean(item.note), el => el.child(div().text_size(11.5).text_color(t.muted).whitespace_normal().child(item.note)))))))))
      .child(div().flex_none().px(22).py(9).border_t(1).border_color(t.border).text_size(11).text_color(t.muted)
        .child(`${p.on || "This computer"} · Reading instructions does not invoke the skill. · Esc closes`));
  }
}
