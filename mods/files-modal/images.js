import { div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, appHome } from "herdr";

const EXT = /\.(png|jpe?g|gif|webp|bmp|ico|avif|tiff?)$/i;
const DIR = "data/image-preview";
export const isImage = (path) => EXT.test(path);

// image() only loads files under Herdr's own folder, so each version is copied there, named by its hash.
const STAGE = `set -e; cd "$1"; mkdir -p "$4"; find "$4" -type f -mtime +1 -delete 2>/dev/null || true
t="$4/.tmp.$$"
if [ -n "$3" ]; then git --no-optional-locks cat-file blob "$3:$2" > "$t"; else cat -- "$2" > "$t"; fi
name="$(shasum < "$t" | cut -c1-40)$5"; mv "$t" "$4/$name"
size=$(sips -g pixelWidth -g pixelHeight "$4/$name" 2>/dev/null | awk '/pixel/ {printf "%s ", $2}') || true
printf '%s\\n%s\\n%s' "$name" "$(wc -c < "$4/$name" | tr -d ' ')" "$size"`;

export async function stageImage(root, path, rev) {
  const ext = path.match(EXT)[0].toLowerCase();
  const r = await exec("sh", ["-c", STAGE, "sh", root, path, rev ?? "", `${appHome()}/${DIR}`, ext]);
  if (r.code !== 0) return null;
  const [name, bytes, size] = r.stdout.split("\n"), [width, height] = (size ?? "").trim().split(" ").map(Number);
  return { file: `${DIR}/${name}`, bytes: Number(bytes), width: width || null, height: height || null };
}

const kb = (n) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;

function frame(pic, color, t, room) {
  if (!pic) return div().flex_1().min_h(0).flex().items_center().justify_center().text_color(t.muted).child("Cannot preview this image");
  const scale = pic.width ? Math.min(1, room.width / pic.width, room.height / pic.height) : 0;
  return v_flex().flex_1().min_h(0).min_w(0).overflow_hidden().gap(8).items_center().justify_center()
    .child(div().flex_1().min_h(0).w_full().overflow_hidden().flex().items_center().justify_center().p(8)
      .child(div().flex_none().p(4).rounded(6).border_1().border_color(color ?? t.border).bg(t.raised)
        .when(scale > 0, (e) => e.w(Math.floor(pic.width * scale) + 10).h(Math.floor(pic.height * scale) + 10))
        .when(!scale, (e) => e.size_full())
        .child(image(pic.file).size_full())))
    .child(div().flex_none().text_size(11).text_color(t.muted)
      .child([pic.width ? `${pic.width} × ${pic.height}` : null, kb(pic.bytes)].filter(Boolean).join(" · ")));
}

// The dialog is 90% of the window; the rest is its header, footer, padding and captions.
const room = (sides, label) => {
  const v = globalThis.window.viewport_size();
  return { width: (v.width * 0.9 - 32 - 16 * (sides - 1)) / sides - 34, height: v.height * 0.9 - 78 - 32 - 54 - (label ? 24 : 0) };
};

export function imageView(pic, t) {
  return v_flex().flex_1().min_h(0).p(16).child(frame(pic, null, t, room(1, false)));
}

export function imageCompare(before, after, t) {
  const sides = Number(before !== undefined) + Number(after !== undefined), space = room(sides, true);
  const side = (label, pic, color) => v_flex().flex_1().min_w(0).min_h(0).gap(6)
    .child(div().flex_none().text_size(12).font_semibold().text_color(color).child(label))
    .child(frame(pic, color, t, space));
  return h_flex().flex_1().min_h(0).p(16).gap(16)
    .when(before !== undefined, (e) => e.child(side("Before", before, t.ansi1)))
    .when(after !== undefined, (e) => e.child(side("After", after, t.ansi2)));
}
