import Tickets from "./tickets.js";
import { div } from "gpui-kit";
import { v_flex, h_flex, Input, InputState, Textarea, TextareaState } from "gpui-base";
import { appHome, props, run } from "herdr";

export default class Plane extends Tickets {
  get provider() { return "plane"; }
  get service() { return "Plane"; }
  get title() { return "Tasks"; }
  get defaultScope() { return "all"; }
  get allProjectLabel() { return "Unlink repository"; }
  get clearProjectLabel() { return "Unlink"; }

  init(p, cx) {
    this.captureTitle = InputState.new({ placeholder: "What needs doing?" });
    this.captureDescription = TextareaState.new({ placeholder: "Requirements, context and acceptance criteria…", rows: 7 });
    this.captureTitle.on("change", (_e, cx) => cx.notify());
    this.captureTitle.on("submit", (_e, cx) => { if (this.capture) this.saveCapture(cx); });
    this.workspaceSlug = InputState.new({ placeholder: "Workspace slug or Plane URL" });
    this.workspaceSlug.on("change", (_e, cx) => cx.notify());
    this.workspaceSlug.on("submit", (_e, cx) => this.addWorkspace(cx));
    super.init(p, cx);
    this.loadConnection(cx);
  }

  close() {
    this.captureTitle.release(); this.captureDescription.release(); this.workspaceSlug.release();
    super.close();
  }

  read(payload) {
    const workspace = payload.op === "projects" ? this.pickerWorkspace ?? this.project?.workspace : undefined;
    return super.read({ ...payload, context: { ...this.context }, ...(workspace ? { workspace } : {}) });
  }

  back(cx) {
    if (this.pickingProject && !this.mapping) { this.pickerWorkspace = null; this.addingSlug = false; this.workspaceError = null; }
    super.back(cx);
  }

  projectLabel(project) { return project && (project.workspace ? `${project.workspace} · ${project.name}` : project.name); }

  pickWorkspace(workspace, cx) {
    this.pickerWorkspace = workspace; this.projects = []; this.projectCursor = null;
    this.loadProjects(cx); cx.notify();
  }

  addWorkspace(cx) {
    const slug = this.workspaceSlug.value().trim();
    if (!slug || this.addingWorkspace) return;
    this.addingWorkspace = true; this.workspaceError = null;
    cx.spawn(async cx => {
      try {
        const { workspace } = await this.read({ op: "add_workspace", workspace: slug });
        this.connectionData = await this.read({ op: "connection" });
        this.workspaceSlug.set_value(""); this.addingSlug = false;
        this.pickWorkspace(workspace, cx);
      } catch (error) { this.workspaceError = error.message; }
      finally { this.addingWorkspace = false; cx.notify(); }
    });
    cx.notify();
  }

  pickerTop(t) {
    const connection = this.connectionData;
    if (!connection) return [];
    const current = this.pickerWorkspace ?? this.project?.workspace ?? connection.workspace;
    return [v_flex().gap(6).flex_none()
      .child(div().text_size(11.5).text_color(t.muted).child("Workspace"))
      .child(h_flex().flex_wrap().gap(5)
        .children((connection.workspaces ?? [connection.workspace]).map(workspace =>
          this.button(`plane-workspace-${workspace}`, workspace, cx => this.pickWorkspace(workspace, cx), workspace === current, Boolean(this.mapping))))
        .child(this.button("plane-add-workspace", "Add workspace", cx => {
          this.addingSlug = !this.addingSlug; this.workspaceError = null;
          if (this.addingSlug) this.workspaceSlug.focus();
          cx.notify();
        }, Boolean(this.addingSlug), Boolean(this.mapping))))
      .when(Boolean(this.addingSlug), el => el.child(h_flex().gap(6).items_center()
        .child(Input.new(this.workspaceSlug).flex_1().min_w(0).h(30).px(9).rounded(6).border_1().border_color(t.border).bg(t.input).text_size(12)
          .accessibility_label("Plane workspace slug"))
        .child(this.button("plane-save-workspace", this.addingWorkspace ? "Checking…" : "Add", cx => this.addWorkspace(cx), true,
          Boolean(this.addingWorkspace) || !this.workspaceSlug.value().trim()))))
      .when(Boolean(this.workspaceError), el => el.child(div().text_size(12).text_color(t.blocked).whitespace_normal().child(this.workspaceError)))];
  }

  loadConnection(cx) {
    cx.spawn(async cx => {
      try { this.connectionData = await this.read({ op: "connection" }); }
      catch { this.connectionData = null; }
      cx.notify();
    });
  }

  restoreProject() {
    this.project = !this.restored ? props()?.panelState?.project ?? null : null;
    this.restored = true; this.needsProject = false;
  }

  received(data) {
    this.needsProject = Boolean(data.needsProject);
    if (data.project) this.project = data.project;
    else if (data.needsProject) this.project = null;
  }

  emptyHint() {
    if (this.hasMore && !this.items.length) return "No matches in the tasks checked so far. Load more tickets to continue searching this project.";
    if (!this.items.length && this.scope === "mine") return "No tasks assigned to you. Choose All to see this project's backlog.";
    return null;
  }

  chooseProject(project, cx) {
    if (this.mapping) return;
    const context = { ...this.context };
    this.mapping = true; this.projectError = null;
    this.request = (this.request ?? 0) + 1;
    cx.spawn(async cx => {
      try {
        await this.read({ op: "map", project: project?.id, ...(project?.workspace ? { workspace: project.workspace } : {}) });
        if (context.space !== this.context.space || context.cwd !== this.context.cwd || context.on !== this.context.on) return;
        this.project = project; this.pickingProject = false; this.pickerWorkspace = null; this.picked.clear(); this.selecting = false;
        this.mapping = false;
        this.refresh(cx, true);
      } catch (error) {
        if (context.space === this.context.space && context.cwd === this.context.cwd && context.on === this.context.on) {
          this.projectError = error.message; this.error = error.message;
        }
      } finally {
        this.mapping = false;
        if (context.space !== this.context.space || context.cwd !== this.context.cwd || context.on !== this.context.on) {
          this.restoreProject(); this.refresh(cx, true);
        }
        cx.notify();
      }
    });
    cx.notify();
  }

  listActions() {
    return [this.button("plane-new-task", "New task", cx => {
      if (!this.project) { this.pickingProject = true; this.loadProjects(cx); cx.notify(); return; }
      this.capture = true; this.capturePriority = "none"; this.captureError = null; this.captureUncertain = false;
      this.captureTitle.set_value(""); this.captureDescription.set_value("");
      this.captureDestination = { ...this.context }; this.captureProject = { ...this.project };
      this.setup = false; this.detail = null; this.pickingProject = false;
      this.captureTitle.focus(); cx.notify();
    }, false, Boolean(this.capture || this.draft || this.launchId || this.launchHistory || this.mapping || this.loading))];
  }

  renderCustom(t) {
    if (this.capture) return this.renderCapture(t);
    if (!this.needsProject || this.pickingProject || this.detail) return null;
    return this.message("Link this repository to Plane", "Choose the Plane project for this working folder. Its tasks will follow you into subfolders and local Git worktrees.", t)
      .child(this.button("plane-link-project", "Choose a project", cx => { this.pickingProject = true; this.loadProjects(cx); cx.notify(); }));
  }

  saveCapture(cx) {
    if (this.captureSaving || this.captureUncertain || !this.captureTitle.value().trim()) return;
    const destination = this.captureDestination;
    if (destination.space !== this.context.space || destination.cwd !== this.context.cwd || destination.on !== this.context.on) {
      this.captureError = "The working folder changed. Go back and create the task in its project."; cx.notify(); return;
    }
    this.captureSaving = true; this.captureError = null;
    const payload = { op: "create", project: this.captureProject.id, title: this.captureTitle.value(),
      description: this.captureDescription.value(), priority: this.capturePriority };
    cx.spawn(async cx => {
      try {
        const issue = await this.read(payload);
        if (destination.space !== this.context.space || destination.cwd !== this.context.cwd || destination.on !== this.context.on) return;
        this.capture = false; this.items = [issue, ...this.items];
        this.captureSaving = false;
        this.open(issue, cx);
      } catch (error) { this.captureError = error.message; this.captureUncertain = error.kind === "uncertain"; }
      finally { this.captureSaving = false; cx.notify(); }
    });
    cx.notify();
  }

  renderCapture(t) {
    const input = state => Input.new(state).w_full().h(34).px(9).rounded(6).border_1().border_color(t.border).bg(t.input).text_size(12);
    return v_flex().flex_1().min_h(0)
      .child(h_flex().px(14).py(10).gap(10).flex_none().items_center()
        .child(this.button("plane-capture-back", "Back", cx => this.back(cx), false, this.captureSaving))
        .child(div().font_medium().child("New task")))
      .child(v_flex().id("plane-capture").flex_1().min_h(0).overflow_y_scrollbar().px(14).pb(14).gap(12)
        .child(div().text_size(11.5).text_color(t.muted).whitespace_normal().child(this.captureProject.name))
        .child(div().text_size(12).font_medium().child("Title"))
        .child(input(this.captureTitle).accessibility_label("Task title"))
        .child(div().text_size(12).font_medium().mt(4).child("Description"))
        .child(Textarea.new(this.captureDescription).w_full().h(170).px(9).py(8).rounded(6).border_1().border_color(t.border).bg(t.input)
          .text_size(12).accessibility_label("Task description"))
        .child(div().text_size(12).font_medium().mt(4).child("Priority"))
        .child(h_flex().flex_wrap().gap(5).children(["none", "low", "medium", "high", "urgent"].map(priority =>
          this.button(`plane-priority-${priority}`, priority === "none" ? "No priority" : priority[0].toUpperCase() + priority.slice(1), cx => {
            this.capturePriority = priority; cx.notify();
          }, this.capturePriority === priority, this.captureSaving))))
        .when(Boolean(this.captureError), el => el.child(div().text_size(12).text_color(t.blocked).whitespace_normal().child(this.captureError)))
        .when(Boolean(this.captureUncertain), el => el.child(this.button("plane-check-save", "Check project in Plane", cx => this.openProject(cx)))))
      .child(h_flex().flex_none().px(14).py(12).border_t(1).border_color(t.border)
        .child(this.button("plane-create-task", this.captureSaving ? "Saving…" : "Create task", cx => this.saveCapture(cx), true,
          this.captureSaving || this.captureUncertain || !this.captureTitle.value().trim()).bg(t.solid).text_color(t.solid_foreground)));
  }

  openProject(cx) {
    const connection = this.connectionData;
    if (connection && this.project) cx.open_url(`${connection.baseUrl}/${this.project.workspace ?? connection.workspace}/projects/${this.project.id}/issues/`);
  }

  openBrowser(issue, cx) {
    if (this.connectionData && issue.url?.startsWith(this.connectionData.baseUrl + "/")) cx.open_url(issue.url);
  }

  connection(t) {
    const connection = this.connectionData;
    return v_flex().flex_1().min_h(0).overflow_y_scrollbar().p(14).gap(16)
      .child(div().font_semibold().text_size(16).child(this.authError ? "Connect Plane" : "Task sources"))
      .child(div().text_size(12).text_color(t.muted).whitespace_normal().child(this.authError ? this.error
        : connection ? `${connection.baseUrl}\n${(connection.workspaces ?? []).length > 1 ? "Workspaces" : "Workspace"}: ${(connection.workspaces ?? [connection.workspace]).join(", ")}` : "Connect your Plane instance to browse and capture tasks."))
      .child(this.button("plane-connect", connection ? "Change Plane connection" : "Connect Plane", () => {
        const args = { name: "Connect Plane", argv: ["python3", `${appHome()}/mods/plane/herdr-plane`, "--home", appHome(), "connect"] };
        if (this.context.on || !this.context.space) run("space.new", { ...args, machine: "" });
        else run("tab.new", { ...args, space: this.context.space });
      }))
      .child(div().text_size(12).text_color(t.muted).whitespace_normal()
        .child("Enter your instance URL, a workspace slug and personal access token in the connection terminal. Credentials stay on this computer. Return here and refresh after connecting. Add more workspaces from the project picker; each repository links to a project in any of them."))
      .when(Boolean(connection), el => el.child(this.button("plane-token-settings", "Manage Plane access tokens", cx => cx.open_url(`${connection.baseUrl}/settings/profile/api-tokens/`))))
      .child(this.button("plane-connection-back", "Back to tasks", cx => {
        this.setup = false; this.authError = false; this.detail = null; this.capture = false; this.picked.clear(); this.selecting = false;
        this.restoreProject(); this.loadConnection(cx); this.refresh(cx, true); cx.notify();
      }))
      .child(div().h(1).bg(t.border))
      .child(div().text_size(12).text_color(t.muted).whitespace_normal().child("For projects already using Linear, open the existing Linear panel."))
      .child(this.button("plane-open-linear", "Open Linear", () => {
        run("layout.select", { stack: "panel-body", child: "linear" }); run("layout.show", { id: "panel" });
      }));
  }
}
