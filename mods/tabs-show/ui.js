import { exec } from "herdr";

let reduced = false, asked = false;

const rgb = (hex) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));

const luminance = (hex) => {
  const [r, g, b] = rgb(hex).map(v => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export const brighter = (t) => "#" + [0, 1, 2].map(i => Math.round(rgb(t.muted)[i] * 0.65 + rgb(t.foreground)[i] * 0.35).toString(16).padStart(2, "0")).join("");

export function ink(fill) {
  if (!/^#[0-9a-f]{6}/i.test(fill ?? "")) return "#ffffff";
  const l = luminance(fill);
  return (1.05 / (l + 0.05)) >= ((l + 0.05) / (luminance("#111114") + 0.05)) ? "#ffffff" : "#111114";
}

export function watchMotion(cx) {
  if (asked) return;
  asked = true;
  cx.spawn(async (cx) => {
    try {
      const result = await exec("defaults", ["read", "com.apple.universalaccess", "reduceMotion"]);
      reduced = result.code === 0 && result.stdout.trim() === "1";
      cx.notify();
    } catch {}
  });
}

export const spin = (el) => reduced ? el : el.spin(900);
