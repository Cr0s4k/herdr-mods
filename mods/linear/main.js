import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Button, Input, InputState, TextView, v_virtual_list, VirtualListScrollHandle, Scrollbar } from "gpui-base";
import { appHome, spaces, panes, agents, focused, props, exec, hc, readTextFile, theme, knownAgents, run } from "herdr";
import { moveToPaneButton } from "./panel-actions.js";
import { contextFor, issueKey, issueId, priorityName, statusName, assigneeName, projectName, statusColor, taskFor, targetsFor, startArgs, descriptionBlocks } from "./model.js";

const nameOf = path => path?.split(/[\\/]/).filter(Boolean).pop() || "Choose a working folder";

export default class Linear extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.scroll = VirtualListScrollHandle.new();
    const state = props()?.panelState ?? {};
    this.scope = state.scope ?? localStorage.getItem("scope") ?? "mine";
    this.project = state.project ?? null;
    this.includeDone = state.includeDone ?? localStorage.getItem("includeDone") === "true";
    this.items = []; this.projects = []; this.installed = []; this.selected = 0;
    this.descriptionOpen = new Set();
    this.query = state.query ?? "";
    this.search = InputState.new({ placeholder: "Search tickets…", value: this.query });
    this.projectSearch = InputState.new({ placeholder: "Find a Linear project…" });
    this.note = InputState.new({ placeholder: "Extra instructions (optional)…" });
    this.search.on("change", (_e, cx) => {
      this.query = this.search.value();
      const revision = this.searchRevision = (this.searchRevision ?? 0) + 1;
      // Invalidate in-flight results immediately, before the debounce finishes.
      this.request = (this.request ?? 0) + 1; this.loading = false;
      this.items = []; this.cursor = null; this.hasMore = false; this.waiting = true;
      cx.timer.after(450, cx => { if (revision === this.searchRevision) this.refresh(cx, true); });
      cx.notify();
    });
    this.search.on("submit", (_e, cx) => this.refresh(cx, true));
    this.search.on("focus", () => { this.typing = true; });
    this.search.on("blur", () => { this.typing = false; });
    this.projectSearch.on("change", (_e, cx) => {
      const revision = this.projectRevision = (this.projectRevision ?? 0) + 1;
      this.projectRequest = (this.projectRequest ?? 0) + 1; this.projectLoading = false;
      cx.timer.after(450, cx => { if (revision === this.projectRevision) this.loadProjects(cx); });
      cx.notify();
    });
    this.context = this.location();
    this.restoreProject();
    this.refresh(cx);
    cx.timer.every(60000, cx => { if (!this.detail && !this.setup && !this.pickingProject && !this.waiting) this.refresh(cx); });
  }

  close() {
    this.request = (this.request ?? 0) + 1; this.detailRequest = (this.detailRequest ?? 0) + 1;
    this.search.release(); this.projectSearch.release(); this.note.release();
    this.scroll.release();
  }
  location() { return contextFor(spaces(), panes(), focused(), props()?.tab, this.context); }
  state() { return { scope: this.scope, project: this.project, query: this.query, includeDone: this.includeDone }; }
  visible() { return this.items.filter(issue => this.includeDone || !["completed", "canceled", "duplicate"].includes(issue.statusType)); }
  restoreProject() {
    if (props()?.panelState?.project !== undefined && !this.restored) { this.restored = true; return; }
    try { this.project = JSON.parse(localStorage.getItem(`project:${this.context.space}`) ?? "null"); }
    catch { this.project = null; }
  }

  async read(payload) {
    this.script ??= await readTextFile(`${appHome()}/mods/linear/herdr-linear`);
    if (!this.script) throw new Error("The Linear reader is missing. Reinstall the mods and refresh.");
    // Account access stays on this computer, even when the destination agent is remote.
    const result = await exec("python3", ["-c", this.script, "--home", appHome(), "request", JSON.stringify(payload)]);
    let response;
    try { response = JSON.parse(result.stdout); }
    catch { throw new Error("Cannot read Linear. Check Python 3 on this computer, then refresh."); }
    if (response.error || result.code !== 0) {
      const error = new Error(response.error || "Cannot load Linear. Try refreshing.");
      error.kind = response.kind; throw error;
    }
    this.source = response.source;
    return response.data;
  }

  refresh(cx, reset = false, more = false) {
    if (this.loading && !reset) return;
    if (reset) { this.items = []; this.cursor = null; this.hasMore = false; this.selected = 0; this.scroll.scroll_to_item(0); }
    this.waiting = false; this.loading = true; this.error = null;
    const request = this.request = (this.request ?? 0) + 1;
    const payload = { op: "issues", scope: this.scope, query: this.query.trim(), project: this.project?.id,
      ...(more && this.cursor ? { cursor: this.cursor } : {}) };
    cx.spawn(async cx => {
      try {
        const data = await this.read(payload);
        if (this.request !== request) return;
        this.items = [...new Map([...(more ? this.items : []), ...data.issues].map(item => [issueId(item), item])).values()];
        this.cursor = data.cursor; this.hasMore = Boolean(data.hasNextPage && data.cursor);
        this.authError = false; this.updated = Date.now();
      } catch (error) {
        if (this.request === request) { this.error = error.message; this.authError = error.kind === "auth"; }
      } finally { if (this.request === request) { this.loading = false; cx.notify(); } }
    });
  }

  loadProjects(cx, more = false) {
    this.projectLoading = true; this.projectError = null;
    const request = this.projectRequest = (this.projectRequest ?? 0) + 1;
    const query = this.projectSearch.value().trim();
    cx.spawn(async cx => {
      try {
        const data = await this.read({ op: "projects", query, ...(more ? { cursor: this.projectCursor } : {}) });
        if (request !== this.projectRequest) return;
        this.projects = [...new Map([...(more ? this.projects : []), ...data.projects].map(item => [item.id, item])).values()];
        this.projectCursor = data.hasNextPage ? data.cursor : null;
      } catch (error) { if (request === this.projectRequest) this.projectError = error.message; }
      finally { if (request === this.projectRequest) { this.projectLoading = false; cx.notify(); } }
    });
  }

  open(issue, cx) {
    this.detail = issue; this.detailLoading = true; this.detailError = null; this.handoff = false;
    this.sent = null; this.sending = false; this.copied = false; this.note.set_value("");
    this.descriptionOpen = new Set(); this.descriptionSource = null;
    const request = this.detailRequest = (this.detailRequest ?? 0) + 1;
    cx.spawn(async cx => {
      try {
        const data = await this.read({ op: "detail", id: issueId(issue) });
        if (request === this.detailRequest) this.detail = { ...issue, ...data };
      } catch (error) { if (request === this.detailRequest) this.detailError = error.message; }
      finally { if (request === this.detailRequest) { this.detailLoading = false; cx.notify(); } }
    });
    cx.notify();
  }

  prepare(cx) {
    this.handoff = true; this.destination = { ...this.location() }; this.target = null;
    this.installed = []; this.agentLoading = true; this.sendError = null;
    const destination = this.destination;
    cx.spawn(async cx => {
      try {
        const choices = await knownAgents({ on: destination.on });
        if (this.destination !== destination) return;
        this.installed = choices.filter(agent => agent.installed);
        if (this.installed.length) this.target = { kind: "new", key: this.installed[0].key };
      } catch { this.sendError = "Could not discover installed agents. Go back and try again, or copy the task."; }
      finally { if (this.destination === destination) { this.agentLoading = false; cx.notify(); } }
    });
  }

  send(cx) {
    if (this.sending || this.sent || this.detailLoading || this.detailError || !this.target) return;
    const issue = this.detail, destination = this.destination, target = this.target;
    if (!spaces().some(space => space.id === destination.space) || !destination.cwd) {
      this.sendError = "The destination is no longer available. Go back and choose an agent again."; cx.notify(); return;
    }
    const task = taskFor(issue, this.note.value());
    this.sending = true; this.sendError = null; cx.notify();
    cx.spawn(async cx => {
      try {
        if (target.kind === "existing") {
          const agent = targetsFor(agents(), destination).find(agent => agent.address === target.key);
          const pane = panes().find(pane => pane.terminal === target.key);
          if (!agent || pane?.cwd !== destination.cwd) throw new Error("That agent is no longer idle in this folder. Choose another agent.");
          const result = await hc(["send", target.key, task, "--if", "idle"]);
          if (result.code !== 0) throw new Error("The agent did not accept the task. Check its terminal before retrying.");
          this.sent = { terminal: target.key, label: agent.program.name };
        } else {
          const agent = this.installed.find(agent => agent.key === target.key);
          const args = startArgs(issue, agent, destination, this.note.value());
          if (!args) throw new Error("Choose an installed agent and a working folder first.");
          const before = new Set(spaces().find(space => space.id === destination.space)?.tabs.map(tab => tab.id));
          run("tab.new", args);
          // Record acceptance immediately; a delayed snapshot must never create a second agent.
          this.sent = { label: agent.name };
          for (let i = 0; i < 50; i++) {
            const created = spaces().find(space => space.id === destination.space)?.tabs.find(tab => !before.has(tab.id) && tab.name === args.name);
            if (created) { this.sent.tab = created.id; break; }
            await cx.sleep(100);
          }
          if (!this.sent.tab) this.sendError = "The start request was sent. Check your tabs before starting another agent.";
        }
      } catch (error) { this.sendError = error.message || "Could not hand off the ticket. Try again."; }
      finally { this.sending = false; cx.notify(); }
    });
  }

  button(id, label, action, selected = false, disabled = false) {
    const t = theme();
    return Button.new(id).h(28).px(9).flex_none().rounded(6).text_size(11.5)
      .bg(selected ? t.selected : t.raised).text_color(selected ? t.foreground : t.muted)
      .disabled(disabled).when(!disabled, el => el.hover(s => s.bg(t.hover).text_color(t.foreground)))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { if (!disabled) action(cx); }).child(label);
  }

  back(cx) {
    if (this.sending) return;
    if (this.handoff) { this.handoff = false; this.destination = null; }
    else { this.detail = null; this.detailRequest = (this.detailRequest ?? 0) + 1; this.detailLoading = false; this.setup = false; this.pickingProject = false; }
    cx.notify();
  }

  message(title, body, t) {
    return v_flex().px(14).py(24).gap(9).flex_none()
      .child(div().font_medium().child(title))
      .child(div().text_size(12).text_color(t.muted).whitespace_normal().child(body));
  }

  render(cx) {
    const context = this.location();
    if (context.space !== this.context.space) {
      this.context = context;
      if (!this.embedded) {
        this.restoreProject(); this.detail = null; this.handoff = false; this.destination = null;
        this.detailRequest = (this.detailRequest ?? 0) + 1; this.refresh(cx, true);
      }
    } else this.context = context;
    const t = theme();
    const visible = this.visible();
    this.selected = Math.min(this.selected, Math.max(0, visible.length - 1));
    const root = v_flex().id("linear").size_full().min_w(0).min_h(0).overflow_hidden().bg(t.background)
      .text_color(t.foreground).text_size(13).track_focus(this.handle)
      .when(!this.embedded, el => el.rounded(10).border_1().border_color(t.border))
      .on_key_down((event, cx) => {
        if (event.key === "escape" && (this.detail || this.setup || this.pickingProject)) { this.back(cx); cx.stop_propagation(); }
        else if (!this.typing && !this.detail && !this.setup && !this.pickingProject) {
          if (event.key === "down" || event.key === "up") {
            this.selected = Math.max(0, Math.min(visible.length - 1, this.selected + (event.key === "down" ? 1 : -1)));
            this.keyboardSelection = true;
            this.scroll.scroll_to_item(this.selected, "center");
          }
          else if (event.key === "enter" && visible[this.selected]) this.open(visible[this.selected], cx);
          else return;
          cx.stop_propagation(); cx.notify();
        }
      })
      .child(h_flex().h(42).px(14).gap(8).items_center().flex_none().border_b(1).border_color(t.border)
        .child(svg("mods/linear/linear.svg").size(15).text_color(t.muted))
        .child(div().font_semibold().flex_1().child("Linear"))
        .child(Button.new("linear-connection").size(26).flex_none().rounded(6).text_color(t.muted)
          .hover(s => s.bg(t.hover)).tooltip("Linear connection").accessibility_label("Linear connection")
          .on_click((_e, cx) => { this.setup = !this.setup; cx.notify(); })
          .child(svg("mods/workspace-chrome-minimal/settings.svg").size(14)))
        .child(this.button("linear-refresh", this.loading ? "Syncing…" : "Refresh", cx => this.refresh(cx), false, this.loading))
        .when(!this.embedded, el => el.child(moveToPaneButton("linear", this.state(), t))));
    if (this.setup || (this.authError && !this.items.length)) return root.child(this.connection(t));
    if (this.detail) return root.child(this.renderDetail(t));
    if (this.pickingProject) return root.child(this.projectPicker(t));
    return root
      .child(v_flex().px(14).py(12).gap(10).flex_none()
        .child(h_flex().gap(5).children([["mine", "My tickets"], ["unassigned", "Unassigned"], ["all", "All"]].map(([id, label]) =>
          this.button(`linear-scope-${id}`, label, cx => { this.scope = id; localStorage.setItem("scope", id); this.refresh(cx, true); }, this.scope === id))))
        .child(Input.new(this.search).w_full().h(32).px(9).rounded(6).border_1().border_color(t.border).bg(t.input).text_size(12).accessibility_label("Search Linear tickets"))
        .child(h_flex().items_center().gap(6)
          .child(Button.new("linear-project").flex_1().min_w(0).h(28).px(8).rounded(6).text_color(t.muted).text_size(11.5)
            .hover(s => s.bg(t.hover)).tooltip(this.project?.name || "Filter by a Linear project")
            .on_click((_e, cx) => { this.pickingProject = true; this.loadProjects(cx); cx.notify(); })
            .child(h_flex().w_full().items_center().gap(6)
              .child(svg("mods/workspace-chrome/folder.svg").size(13).flex_none())
              .child(div().flex_1().min_w(0).truncate().child(this.project?.name || "All projects"))
              .child(svg("mods/files-modal/chevron-down.svg").size(11).flex_none())))
          .when(Boolean(this.project), el => el.child(this.button("linear-clear-project", "Clear", cx => this.chooseProject(null, cx))))))
      .when(Boolean(this.error), el => el.child(div().flex_none().px(14).py(10).text_size(12).text_color(t.blocked).whitespace_normal().child(this.error)))
      .when(!visible.length && !this.error, el => el.child(this.message(
          this.loading || this.waiting ? "Loading tickets…" : "No tickets here",
          this.loading || this.waiting ? "Getting the latest from Linear." : this.items.length ? "The loaded tickets are closed. Include done or load more tickets below." : this.query ? "Try another search or project." : "Choose All or another project to find work to pick up.", t)))
      .child(div().flex_1().min_h(0).relative().overflow_hidden().px(5).role("list_box").accessibility_label("Linear tickets")
        .child(v_virtual_list("linear-list", visible.length, 96, index => issueId(visible[index]),
          range => visible.slice(range.start, range.end).map((issue, offset) => this.issueRow(issue, t, range.start + offset)))
          .size_full().track_scroll(this.scroll)
          .on_item_click((id, cx) => {
            const issue = this.visible().find(issue => issueId(issue) === id);
            if (issue) this.open(issue, cx);
          }))
        .child(Scrollbar.vertical("linear-list").viewport_from_layout().absolute().inset_0()))
      .when(this.hasMore, el => el.child(div().flex_none().px(14).py(8)
        .child(this.button("linear-more", this.loading ? "Loading…" : "Load more tickets", cx => this.refresh(cx, false, true), false, this.loading))))
      .child(h_flex().items_center().gap(6).flex_none().px(14).py(8).border_t(1).border_color(t.border).text_size(10.5).text_color(t.muted)
        .child(div().flex_1().min_w(0).truncate().tooltip(`${this.source || "Linear"} · ${this.items.length} loaded${this.hasMore ? "; more available" : ""}`)
          .child(`${visible.length} shown · ${this.items.length}${this.hasMore ? "+" : ""} loaded`))
        .child(this.button("linear-include-done", "Include done", cx => {
          this.includeDone = !this.includeDone; this.selected = 0; this.scroll.scroll_to_item(0);
          localStorage.setItem("includeDone", String(this.includeDone)); cx.notify();
        }, this.includeDone)));
  }

  issueRow(issue, t, index) {
    const priority = priorityName(issue);
    const selected = Boolean(this.keyboardSelection && index === this.selected);
    return div().id(`linear-issue-${issueId(issue)}`).w_full().h(96).flex_none().px(9).py(10).rounded(6)
      .role("list_box_option").aria_selected(selected).when(selected, el => el.aria_active_descendant().bg(t.selected))
      .text_color(t.foreground).hover(s => s.bg(t.hover)).cursor_pointer()
      .accessibility_label(`${issueKey(issue)}: ${issue.title}. Open ticket`).tooltip(issue.title)
      .child(v_flex().w_full().min_w(0).gap(6)
        .child(h_flex().gap(7).items_center().text_size(10.5).text_color(t.muted)
          .child(div().size(6).rounded(3).flex_none().bg(t[statusColor(issue)]))
          .child(div().flex_none().child(issueKey(issue)))
          .child(div().flex_1().min_w(0).truncate().child(statusName(issue)))
          .when(priority === "Urgent" || priority === "High", el => el.child(div().flex_none().text_color(priority === "Urgent" ? t.blocked : t.muted).child(priority))))
        .child(div().h(34).max_h(34).overflow_hidden().text_size(12.5).font_medium().whitespace_normal().child(issue.title))
        .child(div().text_size(10.5).text_color(t.muted).truncate().child(`${projectName(issue)} · ${assigneeName(issue)}`)));
  }

  chooseProject(project, cx) {
    this.project = project; this.pickingProject = false;
    localStorage.setItem(`project:${this.context.space}`, JSON.stringify(project)); this.refresh(cx, true);
  }

  projectPicker(t) {
    return v_flex().flex_1().min_h(0).gap(12).p(14)
      .child(h_flex().items_center().gap(10).flex_none()
        .child(this.button("linear-project-back", "Back", cx => this.back(cx)))
        .child(div().font_medium().child("Choose a project")))
      .child(Input.new(this.projectSearch).w_full().flex_none().text_size(12).accessibility_label("Search Linear projects"))
      .child(v_flex().id("linear-project-list").flex_1().min_h(0).overflow_y_scrollbar().gap(4)
        .child(this.button("linear-all-projects", "All projects", cx => this.chooseProject(null, cx)))
        .when(Boolean(this.projectError), el => el.child(div().text_color(t.blocked).whitespace_normal().child(this.projectError)))
        .children(this.projects.map(project => Button.new(`linear-project-${project.id}`).w_full().flex_none().px(9).py(10).rounded(6)
          .text_color(t.foreground).hover(s => s.bg(t.hover)).on_click((_e, cx) => this.chooseProject(project, cx))
          .child(div().w_full().whitespace_normal().text_size(12).child(project.name))))
        .when(this.projectLoading, el => el.child(div().py(10).text_color(t.muted).child("Loading projects…")))
        .when(!this.projectLoading && !this.projects.length && !this.projectError, el => el.child(div().py(10).text_color(t.muted).child("No matching projects.")))
        .when(Boolean(this.projectCursor) && !this.projectLoading, el => el.child(this.button("linear-more-projects", "Load more projects", cx => this.loadProjects(cx, true)))));
  }

  connection(t) {
    return v_flex().flex_1().min_h(0).overflow_y_scrollbar().p(14).gap(16)
      .child(div().font_semibold().text_size(16).child(this.authError ? "Connect Linear" : "Your Linear connection"))
      .child(div().text_size(12).text_color(t.muted).whitespace_normal().child(this.authError ? this.error
        : `Connected using ${this.source || "your saved login"}. Tickets refresh every minute while you browse.`))
      .child(div().text_size(12).text_color(t.muted).whitespace_normal()
        .child("Use your existing Claude Linear login, or connect once with a personal API key. The key is entered privately in a terminal and saved on this computer."))
      .child(this.button("linear-connect", "Connect with API key", () => {
        const args = { name: "Connect Linear", argv: ["python3", `${appHome()}/mods/linear/herdr-linear`, "--home", appHome(), "connect"] };
        if (this.context.on) run("space.new", { ...args, machine: "" });
        else run("tab.new", { ...args, space: this.context.space });
      }))
      .child(this.button("linear-key-settings", "Open Linear key settings", cx => cx.open_url("https://linear.app/settings/account/security")))
      .child(div().text_size(11.5).text_color(t.muted).whitespace_normal().child("Create a key with Read permission. After connecting, return here and refresh. LINEAR_API_KEY is also supported. Existing Claude logins stay managed by Claude; reconnect there with /mcp if they expire."))
      .child(this.button("linear-connection-back", "Back to tickets", cx => { this.setup = false; this.authError = false; this.refresh(cx); cx.notify(); }));
  }

  renderDetail(t) {
    const issue = this.detail;
    return v_flex().flex_1().min_h(0)
      .child(h_flex().px(14).py(10).gap(8).flex_none().items_center()
        .child(this.button("linear-back", "Back", cx => this.back(cx), false, this.sending))
        .child(div().flex_1().text_size(11).text_color(t.muted).child(issueKey(issue)))
        .child(this.button("linear-open-browser", "Open in Linear", cx => { if (/^https:\/\/linear\.app\//.test(issue.url || "")) cx.open_url(issue.url); })))
      .child(v_flex().id("linear-detail").flex_1().min_h(0).overflow_y_scrollbar().px(14).pb(14).gap(14)
        .child(div().font_semibold().text_size(17).whitespace_normal().child(issue.title))
        .child(div().text_size(11.5).text_color(t.muted).whitespace_normal().child(`${statusName(issue)} · ${priorityName(issue)} · ${assigneeName(issue)}`))
        .child(div().text_size(11.5).text_color(t.muted).whitespace_normal().child(projectName(issue)))
        .when(this.detailLoading, el => el.child(div().text_color(t.muted).child("Loading ticket details…")))
        .when(Boolean(this.detailError), el => el.child(v_flex().gap(10)
          .child(div().text_color(t.blocked).whitespace_normal().child(this.detailError))
          .child(this.button("linear-detail-retry", "Retry", cx => this.open(issue, cx)))))
        .when(!this.handoff, el => el.child(this.renderDescription(issue, t)))
        .when(Boolean(this.handoff), el => el.child(this.renderHandoff(t))))
      .when(!this.handoff, el => el.child(h_flex().px(14).py(12).gap(7).flex_none().border_t(1).border_color(t.border)
        .child(this.button("linear-assign", "Assign to agent…", cx => this.prepare(cx), true, this.detailLoading || Boolean(this.detailError)))
        .child(this.button("linear-copy-task", "Copy task", cx => { cx.write_to_clipboard(taskFor(issue)); this.copied = true; cx.notify(); }, false, this.detailLoading || Boolean(this.detailError)))
        .when(Boolean(this.copied), el => el.child(div().text_size(11).text_color(t.done).child("Copied")))));
  }

  renderDescription(issue, t) {
    if (this.descriptionSource !== issue.description || !this.descriptionParts) {
      this.descriptionSource = issue.description;
      this.descriptionParts = descriptionBlocks(issue.description);
    }
    const render = blocks => v_flex().w_full().min_w(0).gap(10).flex_none().children(blocks.map(block => {
      const id = `linear-description-${issueId(issue)}-${block.id}`;
      if (block.kind === "markdown") return TextView.markdown(id, block.text).selectable().text_size(12);
      const open = this.descriptionOpen.has(block.id);
      return v_flex().w_full().min_w(0).gap(10).flex_none()
        .child(Button.new(id).w_full().px(8).py(8).rounded(6).text_color(t.foreground)
          .hover(s => s.bg(t.hover)).accessibility_label(`${open ? "Collapse" : "Expand"} ${block.title}`)
          .on_click((_e, cx) => {
            if (this.descriptionOpen.has(block.id)) this.descriptionOpen.delete(block.id);
            else this.descriptionOpen.add(block.id);
            cx.notify();
          })
          .child(h_flex().w_full().items_center().gap(7)
            .child(svg(`mods/files-modal/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.muted))
            .child(div().flex_1().min_w(0).font_medium().text_size(12).whitespace_normal().child(block.title))))
        .when(open, el => el.child(div().pl(12).child(render(block.blocks))));
    }));
    return render(this.descriptionParts);
  }

  renderHandoff(t) {
    const destination = this.destination;
    const existing = targetsFor(agents(), destination).filter(agent => panes().some(pane => pane.terminal === agent.address && pane.cwd === destination.cwd));
    return v_flex().gap(12).flex_none()
      .child(div().h(1).bg(t.border))
      .child(div().font_medium().child("Assign to agent"))
      .child(div().text_size(11.5).text_color(t.muted).whitespace_normal().tooltip(destination.cwd || "No folder available")
        .child(`${nameOf(destination.cwd)} · ${destination.on || "This computer"}`))
      .child(div().text_size(11).text_color(t.muted).child("Start a new agent"))
      .children(this.installed.map(agent => this.button(`linear-agent-${agent.key}`, agent.name, cx => {
        this.target = { kind: "new", key: agent.key }; cx.notify();
      }, this.target?.kind === "new" && this.target.key === agent.key, this.sending || Boolean(this.sent))))
      .when(this.agentLoading, el => el.child(div().text_size(12).text_color(t.muted).child("Checking installed agents…")))
      .when(!this.agentLoading && !this.installed.length, el => el.child(div().text_size(12).text_color(t.muted).whitespace_normal().child("No installed agents found. You can copy the task below.")))
      .when(existing.length > 0, el => el.child(div().mt(4).text_size(11).text_color(t.muted).child("Or an idle agent in this folder")))
      .children(existing.map(agent => this.button(`linear-existing-${agent.address}`, `${agent.title || agent.program.name} · ${agent.address}`, cx => {
        this.target = { kind: "existing", key: agent.address }; cx.notify();
      }, this.target?.kind === "existing" && this.target.key === agent.address, this.sending || Boolean(this.sent))))
      .when(!this.sent, el => el.child(Input.new(this.note).w_full().text_size(12).accessibility_label("Additional instructions for the agent")))
      .child(div().text_size(11.5).text_color(t.muted).whitespace_normal()
        .child("The agent receives the full description, ticket link and your instructions. Linear status and assignee stay as they are."))
      .when(Boolean(this.sendError), el => el.child(div().text_size(12).text_color(t.blocked).whitespace_normal().child(this.sendError)))
      .when(Boolean(this.sent), el => el.child(v_flex().gap(10)
        .child(div().text_color(t.done).whitespace_normal().child(`Task handed to ${this.sent.label}.`))
        .when(Boolean(this.sent.tab || this.sent.terminal), el => el.child(this.button("linear-show-agent", "Open agent", () => {
          if (this.sent.terminal) run("agent.focus", { terminal: this.sent.terminal });
          else { run("space.select", { id: destination.space }); run("tab.select", { id: this.sent.tab }); }
        })))))
      .when(!this.sent, el => el.child(this.button("linear-send", this.sending ? "Sending…" : this.target?.kind === "existing" ? "Send task to agent" : "Start agent with ticket",
        cx => this.send(cx), true, this.sending || !this.target || !destination.cwd || this.detailLoading || Boolean(this.detailError))))
      .child(this.button("linear-copy-handoff", this.copied ? "Task copied" : "Copy task", cx => {
        cx.write_to_clipboard(taskFor(this.detail, this.note.value())); this.copied = true; cx.notify();
      }));
  }
}
