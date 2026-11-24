import { exec, appHome, shared, checking } from "herdr";

// What was opened or pressed, kept on this computer only, to see later which mods are used. Names only: no titles, paths or text.
export function track(feature, name) {
  if (shared("features")?.usageLog === false || checking()) return;
  const line = JSON.stringify({ at: Date.now(), feature, name });
  Promise.resolve(exec("sh", ["-c", 'mkdir -p "$1" && printf "%s\\n" "$2" >> "$1/mods.jsonl"', "sh", `${appHome()}/usage`, line])).catch(() => {});
}
