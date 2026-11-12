import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, theme, run, window, keys, exec, shared } from "herdr";
import { parseBranch, remoteGit } from "./sync.js";
import { brighter } from "./ui.js";

const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false"];
const where = () => { const s = spaces().find(s => s.active); return { folder: shared("space.homes")?.[s?.id] || s?.folder, on: s?.machine ?? null }; };

export default class WorkspaceStatus extends View {
  init(_props, cx) {
    this.sync = null;
    cx.timer.every(10000, cx => this.check(cx, false));
    cx.timer.every(180000, cx => this.check(cx, true));
  }

  check(cx, fetch) {
    const { folder, on } = where(), key = JSON.stringify([folder, on]);
    if (key !== this.key) { this.key = key; this.sync = null; fetch = true; }
    if (!folder || this.checking) return;
    this.checking = true;
    cx.spawn(async cx => {
      try {
        if (fetch) await remoteGit(["fetch", "--quiet"], folder, on, 30000).catch(() => null);
        const r = await exec("git", [...READ, "status", "--porcelain=v1", "--branch", "-z", "--untracked-files=no"], { cwd: folder, on });
        if (this.key === key) this.sync = r.code === 0 ? parseBranch(r.stdout.split("\0")[0]) : null;
      } finally { this.checking = false; cx.notify(); }
    });
  }

  runSync(args, label, cx) {
    const { folder, on } = where();
    if (!folder || this.syncing) return;
    this.syncing = label; this.error = null;
    cx.spawn(async cx => {
      try {
        const r = await remoteGit(args, folder, on, 120000);
        if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n").pop());
      } catch (e) {
        const error = this.error = `${label} failed: ${e.message ?? e}`;
        cx.timer.after(15000, cx => { if (this.error === error) { this.error = null; cx.notify(); } });
      } finally { this.syncing = null; this.check(cx, false); cx.notify(); }
    });
    cx.notify();
  }

  counts(t) {
    if (this.syncing) return div().text_color(t.muted).child(`${this.syncing === "Pull" ? "Pulling" : "Pushing"}…`);
    const { ahead, behind } = this.sync;
    const count = (id, text, args, label) => div().id(id).px(4).rounded(4).cursor_pointer().hover(s => s.bg(t.hover))
      .on_click((_e, cx) => this.runSync(args, label, cx)).child(text);
    return h_flex().gap(2).text_color(t.foreground)
      .when(behind > 0, el => el.child(count("branch-pull", `↓${behind}`, ["pull"], "Pull")))
      .when(ahead > 0 && !this.sync.gone, el => el.child(count("branch-push", `↑${ahead}`, ["push"], "Push")));
  }

  // The palette key as actually bound, not a hardcoded one; without a
  // binding the hint stays useful ("commands") instead of lying.
  hint(t) {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  commands` : "commands";
  }

  render(cx) {
    if (JSON.stringify([where().folder, where().on]) !== this.key) this.check(cx, true);
    const t = theme();
    const space = spaces().find(s => s.active);
    const list = agents();
    const needs = list.filter(a => a.status === "blocked").length;
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);
    return h_flex().size_full().px(14).gap(16).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(13).text_color(brighter(t))
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
      .when(Boolean(space?.branch), el => el.child(label("branch", space.branch)))
      .when(Boolean(this.syncing || this.sync?.ahead || this.sync?.behind), el => el.child(this.counts(t)))
      .when(Boolean(this.error), el => el.child(div().min_w(0).truncate().text_color(t.ansi1).child(this.error)))
      .child(h_flex().gap(6).items_center().child(div().size(6).rounded(3).bg(t.muted)).child(`${list.length} agents`)
        .when(needs > 0, el => el.child(div().text_color(t.blocked).child(`· ${needs} needs you`))))
      .child(div().flex_1())
      .child(div().id("palette").text_color(brighter(t)).on_click(() => run("app.palette")).child(this.hint(t)));
  }
}
