import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Button, Input, InputState } from "gpui-base";
import { spaces, panes, focused, agents, exec, home, shared, theme, window } from "herdr";
import { ITEMS, ERROR, UNTIL, active, bySpace, heading, origin, waitingFor, facts, ago, tellTarget } from "./watchers-model.js";
import { syncWatchers } from "./watchers-tracker.js";
import { moveToPaneButton, bindMoveCommand } from "./panel-actions.js";

const LEVEL = { success: "ansi2", warning: "blocked", error: "blocked", info: "accent" };

export default class Watchers extends View {
  init(_props, cx) {
    bindMoveCommand(this, "watchers", cx);
    this.kind = "pr"; this.until = "review"; this.mode = "succeeds";
    this.adding = null; this.busy = new Set(); this.problem = null; this.folded = new Map();
    this.ref = InputState.new({ placeholder: "Number or link (empty: this branch's)" });
    this.name = InputState.new({ placeholder: "What you wait for, e.g. Deploy is live" });
    this.command = InputState.new({ placeholder: "curl -sf https://example.com/health" });
    this.then = InputState.new({ placeholder: "Then tell the agent… (optional)" });
    for (const input of [this.ref, this.name, this.command, this.then]) input.on("submit", (_e, cx) => this.add(cx));
    cx.timer.every(30000, cx => cx.notify());
  }

  close() { this.ref.release(); this.name.release(); this.command.release(); this.then.release(); }

  folder() {
    const space = spaces().find(space => space.active);
    if (!space || space.machine) return null;
    const tab = space.tabs.find(tab => tab.active)?.id, at = focused();
    const members = panes().filter(pane => pane.tab === tab && pane.cwd);
    return members.find(pane => pane.pane === at?.pane)?.cwd || members[0]?.cwd || space.folder || null;
  }

  target() {
    const space = spaces().find(space => space.active);
    if (!space || space.machine) return null;
    return tellTarget(agents(), focused(), space.tabs.find(tab => tab.active)?.id);
  }

  job(key, args, cx, done) {
    if (this.busy.has(key)) return;
    this.busy.add(key); this.problem = null;
    cx.notify();
    cx.spawn(async cx => {
      try { await syncWatchers(args); done?.(); }
      catch (error) { this.problem = error.message || String(error); }
      finally { this.busy.delete(key); cx.notify(); }
    });
  }

  add(cx) {
    const cwd = this.folder() || home();
    const then = this.then.value().trim(), target = this.target();
    if (then && !target) { this.problem = "No agent here to tell. Focus the agent's terminal, then add the watcher."; cx.notify(); return; }
    const tell = then ? ["--then", then, "--terminal", target.address] : [];
    if (this.kind === "pr") {
      const ref = this.ref.value().trim();
      this.job("add", ["pr", ...(ref ? [ref] : []), "--until", this.until, "--cwd", cwd, ...tell], cx,
        () => { this.ref.set_value(""); this.then.set_value(""); this.adding = false; });
      return;
    }
    const name = this.name.value().trim(), command = this.command.value().trim();
    if (!name || !command) { this.problem = "Give the watcher a name and a command."; cx.notify(); return; }
    this.job("add", ["command", "--name", name, "--cwd", cwd, ...tell, ...(this.mode === "changes" ? ["--changes"] : []), "--", command], cx,
      () => { this.name.set_value(""); this.command.set_value(""); this.then.set_value(""); this.adding = false; });
  }

  open(url) {
    const opener = window()?.platform === "macos" ? "open" : window()?.platform === "windows" ? "explorer" : "xdg-open";
    exec(opener, [url]).catch(() => {});
  }

  render() {
    const t = theme(), items = shared(ITEMS) ?? [], now = Date.now();
    const waiting = active(items), finished = items.filter(item => item.fired);
    const groups = bySpace(items, spaces(), panes());
    const adding = this.adding ?? !items.length, folder = this.folder(), target = adding ? this.target() : null;
    const stop = (_e, cx) => cx.stop_propagation();
    const button = (id, label, action, selected = false) => Button.new(id).h(26).px(8).flex_none()
      .flex().items_center().justify_center().rounded(6).text_size(11.5)
      .bg(selected ? t.selected : t.raised).text_color(selected ? t.foreground : t.muted)
      .hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click((_e, cx) => action(cx)).child(label);
    const field = (state, label) => div().h(32).px(9).flex().items_center().rounded(6).border_1().border_color(t.border).bg(t.input)
      .cursor_text().on_mouse_down("left", stop)
      .child(Input.new(state).w_full().h_full().text_size(12).text_color(t.foreground).accessibility_label(label));
    const choice = (id, label, hint, on, pick) => button(id, label, cx => { pick(); cx.notify(); }, on).selected(on).tooltip(hint);

    const form = v_flex().flex_none().px(14).py(12).gap(9).border_b(1).border_color(t.border)
      .child(h_flex().gap(4)
        .child(choice("watch-kind-pr", "Pull request", "Wait on a GitHub pull request", this.kind === "pr", () => { this.kind = "pr"; }))
        .child(choice("watch-kind-command", "Command", "Wait until a shell command exits 0, or its output changes", this.kind === "command", () => { this.kind = "command"; })))
      .when(this.kind === "pr", el => el
        .child(field(this.ref, "Pull request number or link"))
        .child(h_flex().gap(4).flex_wrap().children(UNTIL.map(([id, label, hint]) =>
          choice(`watch-until-${id}`, label, hint, this.until === id, () => { this.until = id; }))))
        .child(div().text_size(11).text_color(t.muted).whitespace_normal()
          .child(`${UNTIL.find(([id]) => id === this.until)[2]}. ${folder ? `Checked from ${folder.split("/").pop()}.` : "No local project here: paste the pull request's link."}`)))
      .when(this.kind === "command", el => el
        .child(field(this.name, "Watcher name"))
        .child(field(this.command, "Shell command"))
        .child(h_flex().gap(4)
          .child(choice("watch-mode-succeeds", "Exits 0", "Tell me when the command succeeds", this.mode === "succeeds", () => { this.mode = "succeeds"; }))
          .child(choice("watch-mode-changes", "Output changes", "Tell me when the command prints something different", this.mode === "changes", () => { this.mode = "changes"; })))
        .child(div().text_size(11).text_color(t.muted).whitespace_normal()
          .child(`Runs with sh every minute${folder ? ` in ${folder.split("/").pop()}` : ""}, stopped after a minute.`)))
      .child(field(this.then, "Message for the agent when it happens"))
      .child(div().text_size(11).text_color(t.muted).whitespace_normal()
        .child(target ? `Sent to ${target.program?.name ?? "the agent"} in this tab with the outcome, so it can carry on.`
          : "No agent in this tab to tell. Focus an agent's terminal to send it a follow-up."))
      .child(h_flex().gap(6)
        .child(button("watch-add", this.busy.has("add") ? "Checking…" : "Watch", cx => this.add(cx)).bg(t.solid).text_color(t.solid_foreground))
        .when(Boolean(items.length), el => el.child(button("watch-cancel", "Cancel", cx => { this.adding = false; this.problem = null; cx.notify(); }))));

    const row = item => {
      const fired = item.fired, color = fired ? LEVEL[fired.level] ?? "accent" : item.error ? "blocked" : "working";
      const label = fired ? fired.title : item.error ? "Can't check" : waitingFor(item);
      return v_flex().id(`watch-${item.id}`).flex_none().py(14).gap(8).border_b(1).border_color(t.border)
        .child(h_flex().items_center().gap(6)
          .child(div().size(6).rounded(3).flex_none().bg(t[color]))
          .child(div().flex_1().min_w(0).truncate().text_size(11.5).font_medium().text_color(t[color]).child(label))
          .child(div().flex_none().max_w(140).truncate().text_size(11.5).text_color(t.muted).tooltip(item.cwd).child(origin(item))))
        .child(div().text_size(12.5).whitespace_normal().child(heading(item)))
        .when(item.kind === "command", el => el.child(div().text_size(11).text_color(t.muted).whitespace_normal().child(item.command)))
        .when(Boolean(fired?.body) && fired.body !== item.title, el => el.child(div().text_size(11.5).text_color(t.muted).whitespace_normal().child(fired.body)))
        .when(!fired, el => el.child(v_flex().gap(3).children(facts(item).map(([text, tone]) => h_flex().gap(6).items_start()
          .child(div().size(5).mt(6).rounded(3).flex_none().bg(t[tone]))
          .child(div().flex_1().min_w(0).text_size(11.5).text_color(tone === "muted" ? t.muted : t.foreground).whitespace_normal().child(text))))))
        .when(Boolean(item.error) && !fired, el => el.child(div().text_size(11.5).text_color(t.blocked).whitespace_normal().child(item.error)))
        .when(Boolean(item.then), el => el.child(div().text_size(11).text_color(t.muted).whitespace_normal()
          .child(fired ? (item.told === true ? `Told ${item.terminal}: ${item.then}` : `Could not tell ${item.terminal}: ${item.told ?? "not sent"}`)
            : `Then tells ${item.terminal}: ${item.then}`)))
        .child(h_flex().items_center().gap(6)
          .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.muted)
            .tooltip(new Date(fired?.at ?? item.checked ?? item.created).toLocaleString())
            .child(fired ? ago(fired.at, now) : `Checked ${ago(item.checked, now)} · every ${item.every}s`))
          .when(item.kind === "pr" && /^https:\/\//.test(item.ref ?? ""), el => el.child(button(`watch-open-${item.id}`, "Open", () => this.open(item.ref)).tooltip("Open the pull request on GitHub")))
          .when(!fired, el => el.child(button(`watch-check-${item.id}`, this.busy.has(item.id) ? "Checking…" : "Check now",
            cx => this.job(item.id, ["tick", "--force", "--only", item.id], cx))))
          .child(button(`watch-remove-${item.id}`, fired ? "Remove" : "Stop", cx => this.job(`remove-${item.id}`, ["remove", item.id], cx))));
    };
    const problem = this.problem || shared(ERROR);

    return v_flex().id("watchers").size_full().min_h(0).overflow_hidden().bg(t.background)
      .when(!this.embedded, el => el.rounded(10).border_1().border_color(t.border))
      .when(Boolean(this.embedded), el => el.track_focus(this.handle))
      .text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().flex_1().min_w(0).truncate().font_semibold().child(this.embedded ? `${waiting.length} waiting` : "Watchers"))
        .when(!adding, el => el.child(button("watch-new", "New watcher", cx => { this.adding = true; cx.notify(); })))
        .when(!this.embedded, el => el.child(moveToPaneButton("watchers", {}, t))))
      .when(adding, el => el.child(form))
      .when(Boolean(problem), el => el.child(div().flex_none().px(14).py(10).text_size(11.5).text_color(t.blocked).whitespace_normal().child(problem)))
      .child(v_flex().id("watchers-list").flex_1().min_h(0).overflow_y_scrollbar().px(14)
        .when(!items.length, el => el.child(v_flex().py(20).gap(8).text_size(12)
          .child(div().font_medium().child("Nothing is being watched."))
          .child(div().text_color(t.muted).whitespace_normal()
            .child("Watch a pull request for its review, checks or merge, or a command for the moment it succeeds. You get a notification when it happens. Agents can set one with herdr-watch."))))
        .children(groups.flatMap(group => {
          const folded = this.folded.get(group.key) ?? !(group.current || groups.length === 1);
          const left = active(group.items).length, done = group.items.length - left;
          const head = h_flex().id(`watch-group-${group.key}`).flex_none().h(34).mt(6).gap(6).items_center().cursor_pointer()
            .text_size(11.5).text_color(group.current ? t.foreground : t.muted).hover(s => s.text_color(t.foreground))
            .tooltip(folded ? "Show these watchers" : "Hide these watchers")
            .on_click((_e, cx) => { this.folded.set(group.key, !folded); cx.notify(); })
            .child(div().w(10).flex_none().child(folded ? "›" : "⌄"))
            .child(div().flex_1().min_w(0).truncate().font_medium().child(group.current ? `${group.name} · this space` : group.name))
            .child(div().flex_none().text_color(t.muted).child([left ? `${left} waiting` : null, done ? `${done} finished` : null].filter(Boolean).join(" · ")));
          return folded ? [head] : [head, ...group.items.map(row)];
        })))
      .child(h_flex().h(34).flex_none().px(14).gap(8).items_center().text_size(11).text_color(t.muted)
        .child(div().flex_1().min_w(0).truncate().child("Checked from this computer while Herdr is open"))
        .when(Boolean(finished.length), el => el.child(button("watch-clear", `Clear finished (${finished.length})`,
          cx => this.job("clear", ["remove", "--fired"], cx)).tooltip("Remove every finished watcher, in all spaces"))));
  }
}
