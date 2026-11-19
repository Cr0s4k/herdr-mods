import { View, div, svg, image, PathBuilder } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, hc, home, appHome, spaces, panes, agents, theme, run, props, openOverlay, closeOverlay, notify, watchFolder } from "herdr";
import * as fs from "fs/promises";
import { moveToPaneButton, bindMoveCommand } from "./panel-actions.js";
import { ink, spin, watchMotion } from "./ui.js";

const ITEMS = () => `${appHome()}/show/items`;
const CLI = () => `${home()}/.local/bin/herdr-show`;
const COLORS = ["#e5484d", "#f5c518", "#3b82f6", "#22c55e", "#ffffff"];
const COLOR_NAMES = { "#e5484d": "Red", "#f5c518": "Yellow", "#3b82f6": "Blue", "#22c55e": "Green", "#ffffff": "White" };
const TOOLS = [["pen", "Pen"], ["arrow", "Arrow"], ["ellipse", "Circle"], ["box", "Box"], ["text", "Text"], ["pin", "Pin"]];
const HEADER = 50, FOOTER = 58, PAD = 24;

async function loadItems() {
  const names = (await fs.readdir(ITEMS())).filter((n) => n.endsWith(".json") && !n.startsWith("."));
  const out = [];
  for (const n of names) {
    try { out.push(JSON.parse(await fs.readFile(`${ITEMS()}/${n}`, "utf8"))); } catch {}
  }
  return out.sort((a, b) => a.time - b.time);
}

async function readItem(id) {
  return JSON.parse(await fs.readFile(`${ITEMS()}/${id}.json`, "utf8"));
}

async function writeItem(item) {
  await fs.writeFile(`${ITEMS()}/${item.id}.json`, JSON.stringify(item, null, 2));
}

function clock(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function targetFor(item) {
  const live = agents();
  if (item.terminal && live.some((a) => a.address === item.terminal)) return item.terminal;
  const space = spaces().find((s) => s.active);
  const here = live.filter((a) => a.space === space?.id);
  return (here.find((a) => a.focused) ?? here[0])?.address ?? null;
}

async function sendBack(item) {
  const target = targetFor(item);
  if (!target) {
    notify({ title: "No agent to send to", body: "Start an agent in this space, then send again.", level: "warning" });
    return false;
  }
  const note = item.note?.trim() ? ` Notes: ${item.note.trim()}` : "";
  const message = `Marked-up screenshot from the Show panel: ${item.path} — read the image and fix what the markup points at.${note}` +
    ` When it's fixed, take a new screenshot of the same view and post it with: herdr-show <screenshot.png> --fixes ${item.id}`;
  const r = await hc(["send", target, message]);
  if (r.code !== 0) {
    notify({ title: `Couldn't send to ${target}`, body: (r.stderr || r.stdout).trim(), level: "error" });
    return false;
  }
  await writeItem({ ...item, sent: true, sentTo: target, sentAt: Date.now() });
  notify({ title: `Sent to ${target}`, body: item.name, level: "success", timeout: 3000 });
  return true;
}

function circle(cx, cy, rx, ry) {
  const pts = [];
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return pts;
}

function paintShape(shape, s, key) {
  const P = shape.pts.map(([x, y]) => [x * s, y * s]);
  const at = (el) => el.absolute().top(0).left(0).size_full();
  const w = Math.max(1.5, (shape.w ?? 4) * s);
  switch (shape.t) {
    case "pen": {
      if (P.length < 2) return null;
      let b = PathBuilder.stroke(w).move_to(P[0][0], P[0][1]);
      for (const p of P.slice(1)) b = b.line_to(p[0], p[1]);
      return at(window.paint_path(b.build(), shape.c));
    }
    case "arrow": {
      const [a, b] = P, ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const head = Math.max(w * 4, 14 * s), spread = Math.PI / 6.5;
      const path = PathBuilder.stroke(w).move_to(a[0], a[1]).line_to(b[0], b[1])
        .move_to(b[0] - head * Math.cos(ang - spread), b[1] - head * Math.sin(ang - spread)).line_to(b[0], b[1])
        .line_to(b[0] - head * Math.cos(ang + spread), b[1] - head * Math.sin(ang + spread)).build();
      return at(window.paint_path(path, shape.c));
    }
    case "ellipse": {
      const [a, b] = P;
      const pts = circle((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2, Math.abs(b[1] - a[1]) / 2);
      return at(window.paint_path(PathBuilder.stroke(w).add_polygon(pts, true).build(), shape.c));
    }
    case "box": {
      const [a, b] = P;
      const pts = [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]];
      return at(window.paint_path(PathBuilder.stroke(w).add_polygon(pts, true).build(), shape.c));
    }
    case "pin": {
      const r = shape.size * s, [x, y] = P[0];
      return div().id(key).absolute().left(x - r).top(y - r).size(r * 2).rounded(r).bg(shape.c)
        .flex().items_center().justify_center().text_size(r * 1.15).font_bold().text_color(ink(shape.c)).child(String(shape.n));
    }
    case "text": {
      const [x, y] = P[0];
      return div().id(key).absolute().left(x).top(y).whitespace_nowrap().text_size(shape.size * s).font_bold()
        .text_color(shape.c).child(shape.text);
    }
  }
  return null;
}

export default class Show extends View {
  init(_props, cx) {
    watchMotion(cx);
    this.mode = props()?.editor ? "editor" : "panel";
    if (this.mode === "panel") bindMoveCommand(this, "show", cx, () => ({ all: this.all }));
    this.size = { width: 360, height: 600 };
    if (this.mode === "editor") return this.initEditor(cx);
    this.items = [];
    this.all = props()?.panelState?.all ?? false;
    this.removing = false;
    this.seen = null;
    const reload = async (cx) => {
      try { this.arrived(await loadItems()); } catch (e) { this.error = String(e); }
      cx.notify();
    };
    cx.spawn(async (cx) => {
      await fs.mkdir(ITEMS(), { recursive: true });
      await reload(cx);
      for (;;) { await watchFolder(ITEMS()); await reload(cx); }
    });
    cx.timer.every(15000, (cx) => { cx.spawn(reload); });
  }

  arrived(items) {
    if (this.seen && !this.embedded) {
      for (const i of items) {
        if (this.seen.has(i.id) || i.kind === "marked") continue;
        notify({ title: i.kind === "fixed" ? "Fix arrived" : "New image to review", body: i.name, level: "info", timeout: 5000,
          action: { name: "layout.show", args: { id: "panel" } } });
      }
    }
    this.seen = new Set(items.map((i) => i.id));
    this.items = items;
  }

  initEditor(cx) {
    this.tool = "pen";
    this.color = COLORS[0];
    this.shapes = [];
    this.drawing = null;
    this.textAt = null;
    this.busy = false;
    this.handle = cx.focus_handle();
    this.note = InputState.new({ value: "", placeholder: "What should change? (sent with the image)" });
    this.text = InputState.new({ value: "", placeholder: "Label, Enter to place" });
    this.text.on("submit", (_e, cx) => this.placeText(cx));
    cx.spawn(async (cx) => {
      const item = await readItem(props().editor);
      if (item.kind === "marked" && item.parent && item.shapes) {
        this.base = await readItem(item.parent);
        this.shapes = item.shapes.map((s) => ({ ...s, pts: s.pts.map((p) => [...p]) }));
        this.note.set_value(item.note ?? "");
      } else this.base = item;
      this.handle.focus();
      cx.notify();
    });
  }

  render(cx) {
    return this.mode === "editor" ? this.renderEditor(cx) : this.renderPanel(cx);
  }

  scope() {
    const space = spaces().find((s) => s.active);
    if (!space || this.all) return { space, items: this.items };
    const tabs = new Set(space.tabs.map((t) => t.id));
    const terms = new Set(panes().filter((p) => tabs.has(p.tab) && p.terminal).map((p) => p.terminal));
    return { space, items: this.items.filter((i) => terms.has(i.terminal) || i.project === space.name) };
  }

  groups(items) {
    const byRoot = new Map();
    for (const i of items) {
      const k = i.root ?? i.id;
      if (!byRoot.has(k)) byRoot.set(k, []);
      byRoot.get(k).push(i);
    }
    return [...byRoot.values()].sort((a, b) => b[b.length - 1].time - a[a.length - 1].time);
  }

  openEditor(item) {
    openOverlay({ mod: "show", kind: "dialog", modal: true, width: 0.94, height: 0.94, props: { editor: item.id } });
  }

  remove(item, cx) {
    this.removeItems([item], cx);
  }

  clear(cx) {
    this.removeItems(this.scope().items, cx);
  }

  removeItems(items, cx) {
    if (this.removing || !items.length) return;
    this.removing = true;
    cx.spawn(async (cx) => {
      const removed = new Set();
      let failed = 0;
      for (const item of items) {
        try {
          for (const path of [item.path, `${ITEMS()}/${item.id}.json`]) {
            try { await fs.unlink(path); } catch (e) { if (await fs.exists(path)) throw e; }
          }
          removed.add(item.id);
        } catch { failed++; }
      }
      this.items = this.items.filter((i) => !removed.has(i.id));
      this.removing = false;
      if (failed) notify({ title: "Couldn't remove some images", body: `${failed} image(s) could not be removed. Try again.`, level: "error" });
      cx.notify();
    });
    cx.notify();
  }

  renderPanel() {
    const t = theme();
    const { space, items } = this.scope();
    const title = items.findLast?.((i) => i.title)?.title ?? [...items].reverse().find((i) => i.title)?.title;
    const W = Math.max(120, this.size.width - 28);
    const stop = (_e, cx) => cx.stop_propagation();
    const iconButton = (id, icon, tip, action) => div().id(id).size(24).flex().items_center().justify_center().rounded(5)
      .text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)).cursor_pointer().on_mouse_down("left", stop)
      .tooltip(tip).accessibility_label(tip).on_click((_e, cx) => action(cx)).child(typeof icon === "string" && icon.endsWith(".svg") ? svg(icon).size(13) : icon);
    const pill = (id, label, primary, action) => h_flex().id(id).h(26).px(10).items_center().rounded(7).text_size(11.5).font_medium()
      .bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground).border_1().border_color(primary ? t.solid : t.border)
      .cursor_pointer().hover((s) => s.opacity(0.88)).on_mouse_down("left", stop).on_click((_e, cx) => action(cx)).child(label);
    const kindColor = { shown: t.dim, marked: t.ansi1, fixed: t.ansi2 };

    const card = (item, group) => {
      const ratio = item.height / item.width;
      let w = W, h = W * ratio;
      if (h > 520) { h = 520; w = h / ratio; }
      const fixedLater = group.some((g) => g.parent === item.id && g.kind === "fixed");
      return v_flex().id(`item-${item.id}`).gap(6).flex_none()
        .child(h_flex().h(22).gap(7).items_center().text_size(12)
          .child(div().size(8).rounded(2).flex_none().bg(kindColor[item.kind] ?? t.dim))
          .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(item.name))
          .child(div().text_size(11).text_color(t.muted).child(clock(item.time)))
          .child(iconButton(`mark-${item.id}`, "✎", "Mark up", () => this.openEditor(item)))
          .child(iconButton(`open-${item.id}`, "↗", "Open", () => exec("open", [item.path])))
          .child(iconButton(`del-${item.id}`, "mods/show/x.svg", "Remove", (cx) => this.remove(item, cx))))
        .child(h_flex().justify_center().child(div().id(`img-${item.id}`).w(w).h(h).rounded(8).overflow_hidden().border_1().border_color(t.border)
          .cursor_pointer().on_click(() => this.openEditor(item)).child(image(item.file).size_full())))
        .when(item.kind === "marked" && Boolean(item.note), (el) => el.child(div().text_size(11.5).text_color(t.muted).child(`“${item.note}”`)))
        .when(item.kind === "marked", (el) => el.child(h_flex().gap(8).items_center()
          .when(!item.sent, (r) => r.child(pill(`send-${item.id}`, "Send back ↩", true, (cx) => cx.spawn(async (cx) => { await sendBack(item); cx.notify(); }))))
          .when(Boolean(item.sent) && !fixedLater, (r) => r
            .child(spin(svg("mods/show/spinner.svg").size(12).text_color(t.working)))
            .child(div().text_size(11.5).text_color(t.muted).child(`Sent to ${item.sentTo}, waiting for the fix…`))
            .child(div().flex_1())
            .child(pill(`resend-${item.id}`, "Resend", false, (cx) => cx.spawn(async (cx) => { await sendBack(item); cx.notify(); }))))
          .when(Boolean(item.sent) && fixedLater, (r) => r.child(div().text_size(11.5).text_color(t.ansi2).child("Fixed ✓")))));
    };

    const groups = this.groups(items);
    return v_flex().id("root").size_full().min_h(0).overflow_hidden().bg(t.background)
      .when(!this.embedded, el => el.rounded(10).border_1().border_color(t.border))
      .when(Boolean(this.embedded), el => el.track_focus(this.handle))
      .text_color(t.foreground).text_size(13)
      .on_size_change((size, cx) => { this.size = size; cx.notify(); })
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .when(!this.embedded, el => el.child(div().font_semibold().child("Show")))
        .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(title ?? ""))
        .child(div().min_w(0).truncate().text_size(11).text_color(t.muted).child(this.all ? "all spaces" : space?.name ?? ""))
        .child(pill("scope", this.all ? "This space" : "All", false, (cx) => { this.all = !this.all; cx.notify(); }).flex_none())
        .when(items.length > 0, (el) => el.child(pill("clear-items", this.removing ? "Clearing…" : "Clear", false, (cx) => this.clear(cx))
          .flex_none().tooltip(this.all || !space ? "Remove all shown images" : "Remove shown images in this space")
          .when(this.removing, (b) => b.opacity(0.5))))
        .when(!this.embedded, el => el.child(moveToPaneButton("show", { all: this.all }, t))))
      .child(v_flex().id("show-list").flex_1().min_h(0).overflow_y_scrollbar().p(14).gap(18)
        .when(!items.length, (el) => el.child(v_flex().gap(6).text_color(t.muted).text_size(12)
          .child(div().child(this.error ?? "Nothing shown yet."))
          .child(div().child("Agents post images with: herdr-show <file.png>"))))
        .children(groups.map((g, gi) => v_flex().id(`group-${gi}`).gap(14).flex_none()
          .when(gi > 0, (el) => el.pt(14).border_t(1).border_color(t.border))
          .children(g.map((item) => card(item, g))))));
  }

  // editor

  scale() {
    if (!this.base) return 1;
    const aw = this.size.width - PAD * 2, ah = this.size.height - HEADER - FOOTER - PAD * 2;
    return Math.max(0.05, Math.min(aw / this.base.width, ah / this.base.height, 2));
  }

  point(e) {
    const s = this.scale(), p = e.local_position ?? { x: 0, y: 0 };
    return [Math.max(0, Math.min(this.base.width, p.x / s)), Math.max(0, Math.min(this.base.height, p.y / s))];
  }

  down(e, cx) {
    cx.stop_propagation();
    this.finish();
    const s = this.scale(), p = this.point(e), c = this.color;
    if (this.tool === "pin") {
      this.shapes.push({ t: "pin", c, size: 13 / s, n: this.shapes.filter((x) => x.t === "pin").length + 1, pts: [p] });
    } else if (this.tool === "text") {
      this.textAt = p;
      this.text.set_value("");
      this.text.focus();
    } else {
      this.drawing = { t: this.tool, c, w: 4 / s, pts: this.tool === "pen" ? [p] : [p, [...p]] };
    }
    cx.notify();
  }

  move(e, cx) {
    if (!this.drawing) return;
    const p = this.point(e), d = this.drawing;
    if (d.t === "pen") {
      const last = d.pts[d.pts.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) * this.scale() < 2) return;
      d.pts.push(p);
    } else d.pts[1] = p;
    cx.notify();
  }

  finish() {
    const d = this.drawing;
    this.drawing = null;
    if (!d) return;
    const [a, b] = [d.pts[0], d.pts[d.pts.length - 1]];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) * this.scale() < 4 && d.t !== "pen") return;
    if (d.t === "pen" && d.pts.length < 2) return;
    this.shapes.push(d);
  }

  placeText(cx) {
    const value = this.text.value().trim();
    if (value && this.textAt) this.shapes.push({ t: "text", c: this.color, size: 18 / this.scale(), text: value, pts: [this.textAt] });
    this.textAt = null;
    this.handle.focus();
    cx.notify();
  }

  key(e, cx) {
    if (e.key === "escape") {
      cx.stop_propagation();
      if (this.textAt) { this.textAt = null; this.handle.focus(); }
      else closeOverlay(props().overlay);
      cx.notify();
    } else if (e.key === "z" && (e.modifiers.platform || e.modifiers.control) && !this.textAt) {
      this.shapes.pop();
      cx.notify();
    }
  }

  save(send, cx) {
    if (this.busy || !this.base) return;
    this.finish();
    this.busy = true;
    this.error = null;
    const spec = { parent: this.base.id, note: this.note.value().trim(), shapes: this.shapes };
    cx.spawn(async (cx) => {
      try {
        const specPath = `${appHome()}/show/tmp/${this.base.id}-${Date.now()}.json`;
        await fs.writeFile(specPath, JSON.stringify(spec));
        const r = await exec(CLI(), ["mark", specPath]);
        try { await fs.unlink(specPath); } catch {}
        if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
        const item = JSON.parse(r.stdout);
        if (send) await sendBack(item);
        closeOverlay(props().overlay);
      } catch (e) {
        this.error = String(e.message ?? e);
        this.busy = false;
        cx.notify();
      }
    });
    cx.notify();
  }

  renderEditor() {
    const t = theme();
    const root = v_flex().id("root").size_full().bg(t.popover).text_color(t.foreground).text_size(12.5)
      .track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .on_size_change((size, cx) => { this.size = size; cx.notify(); });
    if (!this.base) return root.child(div().p(20).text_color(t.muted).child("Loading…"));
    const s = this.scale(), W = this.base.width * s, H = this.base.height * s;
    const stop = (_e, cx) => cx.stop_propagation();
    const chip = (id, label, on, action) => h_flex().id(id).h(28).px(10).items_center().rounded(7).text_size(12)
      .bg(on ? t.selected : t.raised).text_color(on ? t.foreground : t.muted).border_1().border_color(on ? t.accent : t.border)
      .cursor_pointer().hover((st) => st.bg(t.hover)).on_mouse_down("left", stop).on_click((_e, cx) => { action(); cx.notify(); }).child(label);
    const button = (id, label, primary, action) => h_flex().id(id).h(32).px(14).items_center().rounded(8).font_medium()
      .bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground).border_1().border_color(primary ? t.solid : t.input)
      .when(!this.busy, (b) => b.cursor_pointer().hover((st) => st.opacity(0.88))).when(this.busy, (b) => b.opacity(0.5))
      .on_mouse_down("left", stop).on_click((_e, cx) => action(cx)).child(label);
    const shown = this.drawing ? [...this.shapes, this.drawing] : this.shapes;

    const canvas = div().id("canvas").relative().w(W).h(H).flex_none().rounded(6).overflow_hidden().border_1().border_color(t.border)
      .cursor_crosshair()
      .on_mouse_down("left", (e, cx) => this.down(e, cx))
      .on_mouse_move((e, cx) => this.move(e, cx))
      .on_mouse_up("left", (_e, cx) => { this.finish(); cx.notify(); })
      .child(image(this.base.file).absolute().top(0).left(0).size_full())
      .children(shown.map((sh, i) => paintShape(sh, s, `shape-${i}`)).filter(Boolean))
      .when(Boolean(this.textAt), (el) => el.child(div().id("text-entry").absolute().left(this.textAt[0] * s).top(this.textAt[1] * s)
        .w(220).h(30).px(8).flex().items_center().rounded(6).bg(t.background).border_1().border_color(t.accent)
        .on_mouse_down("left", stop).child(Input.new(this.text).h_full().text_size(12.5).text_color(t.foreground))));

    return root
      .child(h_flex().h(HEADER).flex_none().px(14).gap(6).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().max_w(220).truncate().child(this.base.name))
        .child(div().w(10))
        .children(TOOLS.map(([id, label]) => chip(`tool-${id}`, label, this.tool === id, () => { this.tool = id; this.textAt = null; })))
        .child(div().w(10))
        .children(COLORS.map((c) => div().id(`color-${c}`).size(24).rounded(12).bg(c).cursor_pointer().tooltip(COLOR_NAMES[c]).accessibility_label(`${COLOR_NAMES[c]} marker`).border_2()
          .border_color(this.color === c ? t.foreground : t.border).on_mouse_down("left", stop)
          .on_click((_e, cx) => { this.color = c; cx.notify(); })))
        .child(div().flex_1())
        .child(chip("undo", "Undo", false, () => this.shapes.pop()))
        .child(chip("clear", "Clear", false, () => { this.shapes = []; })))
      .child(div().flex_1().min_h(0).flex().items_center().justify_center().bg(t.canvas).child(canvas))
      .child(h_flex().h(FOOTER).flex_none().px(14).gap(8).items_center().border_t(1).border_color(t.border)
        .child(div().id("note").flex_1().min_w(0).h(32).px(10).flex().items_center().rounded(8).border_1().border_color(t.input).bg(t.background)
          .cursor_text().on_mouse_down("left", stop).child(Input.new(this.note).h_full().text_size(12.5).text_color(t.foreground)))
        .when(Boolean(this.error), (el) => el.child(div().max_w(260).truncate().text_color(t.ansi1).child(this.error)))
        .child(button("cancel", "Cancel", false, () => closeOverlay(props().overlay)))
        .child(button("save", this.busy ? "Saving…" : "Save", false, (cx) => this.save(false, cx)))
        .child(button("save-send", "Save & send back", true, (cx) => this.save(true, cx))));
  }
}
