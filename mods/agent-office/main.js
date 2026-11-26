import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { theme, shared, setShared, settings, window, props, layout, closeOverlay, watchFolder, notify, exec, checking } from "herdr";
import { track } from "./usage.js";
import {
  SETTINGS, BLOCK, MINI_VIEW, EVERY,
  valid, hostOf, findAddress, want, readStatus, alive, launch, post, showOffice, frameFile, watchPath,
} from "./office.js";

const ICON = "mods/agent-office/building.svg";
const BACKDROP = "#15121c";
const MINI = "want-mini.json";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

async function open(url) {
  const error = await showOffice(url).catch(error => error?.message ?? String(error));
  if (error) notify({ title: "Agent Office didn't open", body: error, level: "error" });
}

export default class AgentOffice extends View {
  init(_props, cx) {
    this.mini = Boolean(props()?.mini);
    this.address = undefined;
    this.status = null;
    this.frames = [];
    this.size = null;
    this.error = null;
    this.retryAt = 0;
    this.launching = false;
    if (!this.mini) {
      this.input = InputState.new({ placeholder: "https://office.example.com/", value: shared(SETTINGS)?.url ?? "" });
      this.input.on("submit", (_e, cx) => this.save(cx));
      this.input.focus();
    }
    if (checking()) return;
    if (!this.mini) track("agent-office", "address");
    this.locate(cx);
    if (!this.mini) return;
    this.watch(cx);
    cx.timer.every(3000, cx => this.beat(cx));
  }

  async close() {
    this.closed = true;
    this.watching?.cancel();
  }

  locate(cx) {
    this.own = shared(SETTINGS)?.url ?? null;
    cx.spawn(async cx => {
      this.address = await findAddress(this.own);
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
        await cx.sleep(30);
      }
    });
  }

  async refresh(cx) {
    const status = await readStatus();
    const seen = `${status?.state}|${status?.url}|${alive(status)}`;
    let changed = seen !== this.seen;
    this.status = status;
    this.seen = seen;
    if (status?.frame && status.url === this.address?.url && status.frame !== this.frames.at(-1)) {
      this.frames = [...this.frames.slice(-1), status.frame];
      changed = true;
    }
    if (changed) cx.notify();
  }

  wanted() {
    const w = window(), features = shared("features") ?? {}, block = find(layout(), BLOCK);
    return this.mini && w?.platform === "macos" && Boolean(w.visible) && valid(this.address?.url) && Boolean(block) && !block.hidden
      && features.agentOffice !== false && features.agentOfficeSidebar !== false;
  }

  beat(cx) {
    if (!this.mini) return;
    if (this.own !== (shared(SETTINGS)?.url ?? null)) { this.locate(cx); return; }
    if (this.closed || this.launching || !this.size || !this.wanted()) return;
    const { width, height } = this.size;
    const text = want({ url: this.address.url, width: MINI_VIEW * width / height, height: MINI_VIEW, shot: width * (settings()?.zoom ?? 1), every: EVERY });
    if (alive(this.status)) { post(MINI, text).catch(() => {}); return; }
    if (Date.now() < this.retryAt) return;
    this.launching = true;
    cx.spawn(async cx => {
      try { this.error = await launch(MINI, text); }
      catch (error) { this.error = error?.message ?? String(error); }
      this.launching = false;
      if (this.error) this.retryAt = Date.now() + 60000;
      cx.notify();
    });
  }

  phase() {
    const status = alive(this.status) && this.status.url === this.address?.url ? this.status : null;
    if (this.error) return "error";
    if (!status) return this.frames.length ? "ready" : "starting";
    if (status.state === "loading" && this.frames.length) return "ready";
    return status.state;
  }

  save(cx) {
    const text = this.input.value().trim();
    if (text && !valid(text)) { this.invalid = true; cx.notify(); return; }
    setShared(SETTINGS, { ...(shared(SETTINGS) ?? {}), url: text || null });
    const overlay = props().overlay;
    cx.spawn(async () => {
      const found = await findAddress(text || null);
      if (found) await open(found.url);
      closeOverlay(overlay);
    });
  }

  render() {
    return this.mini ? this.renderMini() : this.renderAddress();
  }

  renderMini() {
    const t = theme(), phase = this.phase();
    const live = phase === "ready" && this.frames.length > 0;
    const words = { signin: "Sign in to see it", offline: "Can't reach it", error: "Viewer didn't start" }[phase] ?? "Opening…";
    const box = div().id("agent-office-mini").size_full().relative().rounded(8).overflow_hidden().border_1().border_color(t.border)
      .cursor_pointer().tooltip(phase === "signin" ? "Open Agent Office to sign in" : "Open Agent Office").accessibility_label("Open Agent Office")
      .on_size_change((size, cx) => { this.size = size; this.beat(cx); cx.notify(); })
      .on_click(() => {
        track("agent-office", "sidebar");
        if (this.error) notify({ title: "Agent Office didn't open", body: this.error, level: "error" });
        else if (this.address?.url) open(this.address.url);
      })
      .when(live, el => el.bg(BACKDROP).children(this.frames.map(f => image(frameFile(f)).absolute().top(0).left(0).size_full())))
      .when(!live, el => el.bg(t.background).hover(s => s.bg(t.hover)).child(v_flex().size_full().items_center().justify_center().gap(6)
        .child(svg(ICON).size(18).text_color(t.muted))
        .child(div().text_size(12).text_color(t.foreground).child("Agent Office"))
        .child(div().text_size(11).text_color(t.muted).child(words))));
    return div().size_full().px(10).pt(4).pb(10).child(box);
  }

  renderAddress() {
    const t = theme();
    const hint = this.invalid ? "Use an address that starts with https://."
      : this.address?.from === "hook" ? `Leave it empty to keep ${hostOf(this.address.url)}, where Claude Code's office hook reports.`
      : "The office's web address. With Claude Code's office hook set up, it's found by itself.";
    const button = (id, label, action, primary = false) => h_flex().id(id).h(28).px(10).flex_none().items_center().rounded(6)
      .text_size(12).border_1().border_color(primary ? t.accent : t.border).bg(primary ? t.accent : t.raised)
      .text_color(primary ? t.accent_foreground : t.foreground).cursor_pointer()
      .hover(s => s.bg(primary ? t.accent : t.hover)).on_click(action).child(label);
    return v_flex().size_full().p(18).gap(12).bg(t.background).text_color(t.foreground)
      .child(h_flex().gap(8).items_center()
        .child(svg(ICON).size(16).text_color(t.muted))
        .child(div().flex_1().text_size(14).font_semibold().child("Agent Office address"))
        .child(div().id("office-close").size(26).flex().items_center().justify_center().rounded(6).text_color(t.muted)
          .cursor_pointer().tooltip("Close").hover(s => s.bg(t.hover)).on_click(() => closeOverlay(props().overlay))
          .child(svg("mods/pane/close.svg").size(13))))
      .child(div().text_size(12).text_color(this.invalid ? t.blocked : t.muted).line_height(1.5).child(hint))
      .child(div().id("office-address-input").h(34).px(9).flex().items_center().rounded(6).border_1()
        .border_color(this.invalid ? t.blocked : t.accent).bg(t.input).cursor_text()
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(Input.new(this.input).flex_1().h_full().text_size(12).text_color(t.foreground)))
      .child(h_flex().gap(8).justify_end()
        .child(button("office-address-save", "Save and open", (_e, cx) => this.save(cx), true)));
  }
}
