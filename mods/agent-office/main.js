import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { theme, shared, setShared, settings, window, props, openOverlay, closeOverlay, watchFolder, notify, exec, checking } from "herdr";
import { track } from "./usage.js";
import { openInBrowser } from "./github.js";
import { spin, watchMotion } from "./ui.js";
import {
  SETTINGS, CORNER, CORNER_WIDTH, FAST, IDLE, SLOW,
  valid, hostOf, findAddress, want, readStatus, alive, launch, post, frameFile, watchPath,
} from "./office.js";

const ICON = "mods/agent-office/building.svg";
const BACKDROP = "#15121c";

export const openOffice = () => openOverlay({ mod: "agent-office", kind: "dialog", width: 0.9, height: 0.9, props: {} });

export default class AgentOffice extends View {
  init(_props, cx) {
    this.corner = Boolean(props()?.corner);
    this.name = this.corner ? "mini" : "modal";
    this.address = undefined;
    this.status = null;
    this.frames = [];
    this.size = null;
    this.signin = 0;
    this.reload = 0;
    this.error = null;
    this.retryAt = 0;
    this.launching = false;
    this.editing = false;
    if (!this.corner) {
      this.input = InputState.new({ placeholder: "https://office.example.com/" });
      this.input.on("submit", (_e, cx) => this.saveAddress(cx));
    }
    if (checking()) return;
    watchMotion(cx);
    if (!this.corner) track("agent-office", "open");
    this.locate(cx);
    this.watch(cx);
    cx.timer.every(3000, cx => this.beat(cx));
  }

  async close() {
    this.closed = true;
    this.watching?.cancel();
    if (!this.corner && this.address?.url) {
      await post(this.name, want({ url: this.address.url, width: 1, height: 1, shot: 1, every: SLOW, at: 0 })).catch(() => {});
    }
  }

  locate(cx) {
    this.own = shared(SETTINGS)?.url ?? null;
    cx.spawn(async cx => {
      this.address = await findAddress(this.own);
      if (!this.address && !this.corner) this.edit(cx);
      this.beat(cx);
      cx.notify();
    });
  }

  watch(cx) {
    cx.spawn(async cx => {
      await exec("mkdir", ["-p", `${watchPath()}/frames`]).catch(() => {});
      while (!this.closed) {
        this.watching = watchFolder(watchPath());
        await this.refresh(cx);
        await this.watching;
        await cx.sleep(80);
      }
    });
  }

  async refresh(cx) {
    const status = await readStatus();
    this.status = status;
    if (status?.frame && status.url === this.address?.url && status.frame !== this.frames.at(-1)) {
      this.frames = [...this.frames.slice(-1), status.frame];
    }
    cx.notify();
  }

  wanted() {
    const w = window(), features = shared("features") ?? {};
    if (w?.platform !== "macos" || !w.visible || !valid(this.address?.url)) return false;
    return !this.corner || (features.agentOffice !== false && features.agentOfficeCorner !== false);
  }

  request() {
    const zoom = settings()?.zoom ?? 1;
    if (this.corner) return { ...CORNER, shot: CORNER_WIDTH * zoom, every: SLOW };
    if (!this.size) return null;
    const width = this.size.width * zoom;
    return { width, height: this.size.height * zoom, shot: width, every: window()?.active ? FAST : IDLE };
  }

  beat(cx) {
    if (this.corner && this.own !== (shared(SETTINGS)?.url ?? null)) { this.locate(cx); return; }
    if (this.closed || this.launching || !this.wanted()) return;
    const ask = this.request();
    if (!ask) return;
    const text = want({ url: this.address.url, ...ask, signin: this.signin, reload: this.reload });
    if (alive(this.status)) { post(this.name, text).catch(() => {}); return; }
    if (Date.now() < this.retryAt) return;
    this.launching = true;
    cx.spawn(async cx => {
      try { this.error = await launch(this.name, text); }
      catch (error) { this.error = error?.message ?? String(error); }
      this.launching = false;
      if (this.error) this.retryAt = Date.now() + 60000;
      cx.notify();
    });
  }

  signIn(cx) {
    track("agent-office", "sign-in");
    this.signin = Date.now();
    this.beat(cx);
  }

  retry(cx) {
    track("agent-office", "reload");
    this.reload = Date.now();
    this.error = null;
    this.retryAt = 0;
    this.beat(cx);
    cx.notify();
  }

  browse() {
    track("agent-office", "browser");
    const url = this.address?.url;
    if (!url) return;
    openInBrowser(url, window()?.platform)
      .catch(error => notify({ title: "Cannot open Agent Office", body: error.message || String(error), level: "error" }));
  }

  edit(cx) {
    this.editing = true;
    this.invalid = false;
    this.input.set_value(this.own ?? "");
    this.input.focus();
    cx.notify();
  }

  saveAddress(cx) {
    const text = this.input.value().trim();
    if (text && !valid(text)) { this.invalid = true; cx.notify(); return; }
    setShared(SETTINGS, { ...(shared(SETTINGS) ?? {}), url: text || null });
    this.editing = false;
    this.frames = [];
    this.locate(cx);
  }

  phase() {
    const status = alive(this.status) && this.status.url === this.address?.url ? this.status : null;
    if (this.error) return "error";
    if (!status) return this.frames.length ? "ready" : "starting";
    if (status.state === "loading" && this.frames.length) return "ready";
    return status.state;
  }

  render() {
    return this.corner ? this.renderCorner() : this.renderDialog();
  }

  renderCorner() {
    const t = theme();
    if (!this.wanted()) return div();
    const height = Math.round(CORNER_WIDTH * CORNER.height / CORNER.width);
    const phase = this.phase();
    const box = div().id("agent-office-corner").w(CORNER_WIDTH).h(height).relative().rounded(6).overflow_hidden().cursor_pointer()
      .tooltip("Open Agent Office").accessibility_label("Open Agent Office")
      .on_click(() => { track("agent-office", "corner"); openOffice(); });
    if (phase === "ready" && this.frames.length) {
      return box.bg(BACKDROP).children(this.frames.map(f => image(frameFile(f)).absolute().top(0).left(0).size_full()));
    }
    const words = { signin: "Sign in to see it", "signing-in": "Signing in…", offline: "Can't reach it", error: "Viewer didn't start" }[phase] ?? "Opening…";
    return box.bg(t.background).hover(s => s.bg(t.hover)).child(v_flex().size_full().items_center().justify_center().gap(6)
      .child(svg(ICON).size(18).text_color(t.muted))
      .child(div().text_size(12).text_color(t.foreground).child("Agent Office"))
      .child(div().text_size(11).text_color(t.muted).child(words)));
  }

  renderDialog() {
    const t = theme(), phase = this.phase(), url = this.address?.url;
    const stop = (_e, cx) => cx.stop_propagation();
    const button = (id, label, action, primary = false) => h_flex().id(id).h(28).px(10).gap(6).flex_none().items_center().rounded(6)
      .text_size(12).border_1().border_color(primary ? t.accent : t.border).bg(primary ? t.accent : t.raised)
      .text_color(primary ? t.accent_foreground : t.foreground).cursor_pointer()
      .hover(s => s.bg(primary ? t.accent : t.hover)).on_mouse_down("left", stop).on_click(action).child(label);
    const icon = (id, path, hint, action) => div().id(id).size(28).flex_none().flex().items_center().justify_center().rounded(6)
      .text_color(t.muted).cursor_pointer().tooltip(hint).accessibility_label(hint)
      .hover(s => s.bg(t.hover).text_color(t.foreground)).on_mouse_down("left", stop).on_click(action)
      .child(svg(path).size(15));
    const [label, color] = {
      ready: ["Live", t.ansi2], signin: ["Sign in needed", t.blocked], "signing-in": ["Signing in", t.blocked],
      offline: ["Can't reach it", t.blocked], error: ["Viewer didn't start", t.blocked],
    }[phase] ?? ["Opening", t.muted];
    const header = h_flex().h(46).flex_none().px(14).gap(10).items_center().border_b(1).border_color(t.border)
      .child(svg(ICON).size(16).flex_none().text_color(t.muted))
      .child(div().flex_none().text_size(13).font_semibold().child("Agent Office"))
      .when(Boolean(url), el => el.child(div().min_w(0).truncate().text_size(11).text_color(t.muted).child(hostOf(url))))
      .when(Boolean(url), el => el.child(h_flex().flex_none().gap(5).items_center().text_size(11).text_color(t.muted)
        .child(div().size(6).rounded(3).bg(color)).child(label)))
      .child(div().flex_1())
      .when(Boolean(url), el => el
        .child(icon("office-reload", "mods/agent-office/reload.svg", "Reload the office", (_e, cx) => this.retry(cx)))
        .child(button("office-browser", "Open in browser", () => this.browse())))
      .child(button("office-address", "Address", (_e, cx) => this.edit(cx)))
      .child(icon("office-close", "mods/pane/close.svg", "Close", () => closeOverlay(props().overlay)));
    const view = div().id("office-view").flex_1().min_h(0).relative().overflow_hidden().bg(BACKDROP)
      .on_size_change((size, cx) => { this.size = size; this.beat(cx); cx.notify(); })
      .when(phase === "ready", el => el.children(this.frames.map(f => image(frameFile(f)).absolute().top(0).left(0).size_full())));
    const message = this.editing || this.address === null ? this.addressForm(t, button) : this.message(t, phase, button);
    return v_flex().size_full().bg(t.background).text_color(t.foreground)
      .child(header)
      .child(message ? view.child(div().absolute().top(0).left(0).size_full().flex().items_center().justify_center().bg(t.background).child(message)) : view);
  }

  message(t, phase, button) {
    const card = (title, body, ...actions) => v_flex().w(420).gap(10).items_center()
      .child(svg(ICON).size(26).text_color(t.muted))
      .child(div().text_size(14).font_semibold().child(title))
      .when(Boolean(body), el => el.child(div().text_size(12).text_color(t.muted).text_center().line_height(1.5).child(body)))
      .when(actions.length > 0, el => el.child(h_flex().gap(8).pt(4).children(actions)));
    const host = hostOf(this.address?.url);
    if (this.address === undefined) return card("Agent Office", "Looking for your office…");
    if (phase === "error") return card("The office viewer didn't start", this.error, button("office-retry", "Try again", (_e, cx) => this.retry(cx), true));
    if (phase === "offline") return card(`Can't reach ${host}`, this.status?.detail || "It will try again in a few seconds.",
      button("office-retry", "Try again", (_e, cx) => this.retry(cx), true));
    if (phase === "signin") return card("Sign in to see the office", `${host} wants you to sign in. A window opens for it, and the office shows here once you're in.`,
      button("office-sign-in", "Sign in", (_e, cx) => this.signIn(cx), true));
    if (phase === "signing-in") return card("Finish signing in", "Sign in in the window that opened. The office shows here once you're in.",
      button("office-sign-in-again", "Show that window", (_e, cx) => this.signIn(cx)));
    if (phase === "ready" && this.frames.length) return null;
    return h_flex().gap(8).items_center().text_size(12).text_color(t.muted)
      .child(spin(svg("mods/workspace-chrome/spinner.svg").size(14))).child(`Opening ${host || "the office"}…`);
  }

  addressForm(t, button) {
    const hint = this.invalid ? "Use an address that starts with https://."
      : this.address?.from === "hook" ? `Leave it empty to keep ${hostOf(this.address.url)}, where Claude Code's office hook reports.`
      : "The office's web address. With Claude Code's office hook set up, it's found by itself.";
    return v_flex().w(460).gap(10)
      .child(h_flex().gap(8).items_center().child(svg(ICON).size(18).text_color(t.muted))
        .child(div().text_size(14).font_semibold().child("Office address")))
      .child(div().text_size(12).text_color(this.invalid ? t.blocked : t.muted).line_height(1.5).child(hint))
      .child(div().id("office-address-input").h(34).px(9).flex().items_center().rounded(6).border_1()
        .border_color(this.invalid ? t.blocked : t.accent).bg(t.input).cursor_text()
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(Input.new(this.input).flex_1().h_full().text_size(12).text_color(t.foreground)))
      .child(h_flex().gap(8).justify_end()
        .when(Boolean(this.address), el => el.child(button("office-address-cancel", "Cancel", (_e, cx) => { this.editing = false; cx.notify(); })))
        .child(button("office-address-save", "Save", (_e, cx) => this.saveAddress(cx), true)));
  }
}
