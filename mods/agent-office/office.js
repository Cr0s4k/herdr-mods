import { exec, readTextFile, writeTextFile, home, appHome, shared } from "herdr";

export const SETTINGS = "agentOffice";
export const FOLDER = "agent-office";
export const BLOCK = "agent-office";
export const MINI_VIEW = 420;
export const EVERY = 1000;

const LAUNCH = `dir=$1 src=$2 file=$3 bin="$HOME/.cache/herdr-agent-office/herdr-agent-office"
mkdir -p "$dir/frames" "\${bin%/*}" || exit 1
printf '%s' "$4" > "$dir/$file"
if [ ! -x "$bin" ] || [ "$src" -nt "$bin" ]; then
  swiftc -O -o "$bin.$$" "$src" 2> "$dir/build.log" || { rm -f "$bin.$$"; exit 3; }
  mv -f "$bin.$$" "$bin"
fi
nohup "$bin" "$dir" < /dev/null > /dev/null 2>&1 &`;

const folder = () => `${appHome()}/${FOLDER}`;

export function sidebarWanted({ sidebar, features = {}, found, platform }) {
  return Boolean(found) && platform === "macos" && features.agentOffice !== false && features.agentOfficeSidebar !== false
    && !sidebar?.hidden && (sidebar?.size?.px ?? Infinity) >= 160;
}

export const valid = (url) => typeof url === "string" && /^https?:\/\/[^\s/?#]+/i.test(url.trim());

export function pageFor(events) {
  const match = typeof events === "string" && events.trim().match(/^(https?:\/\/[^/?#\s]+)(\/[^?#\s]*)?/i);
  if (!match) return null;
  const path = (match[2] || "/").replace(/\/events\/?$/, "/");
  return match[1] + (path.endsWith("/") ? path : `${path}/`);
}

export function hostOf(url) {
  return (url ?? "").replace(/^https?:\/\//i, "").replace(/[/?#].*$/, "");
}

function parse(text) {
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

async function read(path) {
  try { return parse(await readTextFile(path)); } catch { return null; }
}

export async function findAddress(own = shared(SETTINGS)?.url) {
  if (valid(own)) return { url: own.trim(), from: "you" };
  const claude = await read(`${home()}/.claude/settings.json`);
  const url = pageFor(claude?.env?.OFFICE_URL);
  return url ? { url, from: "hook" } : null;
}

export function want({ url, width, height, shot, every, at = Date.now() }) {
  return JSON.stringify({ at, url, width: Math.round(width), height: Math.round(height), shot: Math.round(shot), every });
}

export const readStatus = () => read(`${folder()}/status.json`);

export const alive = (status, now = Date.now()) => Boolean(status && now - status.at < 10000);

export async function launch(file, text) {
  const dir = folder();
  const result = await exec("sh", ["-c", LAUNCH, "sh", dir, `${appHome()}/mods/agent-office/view.swift`, file, text], { timeout: 300000 });
  if (result.code === 0) return null;
  if (result.code !== 3) return result.stderr.trim() || "The office viewer could not start.";
  const log = (await readTextFile(`${dir}/build.log`).catch(() => null)) ?? "";
  const line = log.split("\n").find(l => /error/i.test(l)) ?? log.split("\n").find(Boolean);
  return `The office viewer did not build (it needs Xcode's command line tools). ${line ?? ""}`.trim();
}

export async function post(file, text) {
  const path = `${folder()}/${file}`;
  await writeTextFile(path, text, await readTextFile(path).catch(() => null));
}

export async function showOffice(url, at = Date.now()) {
  const text = JSON.stringify({ at, url });
  if (alive(await readStatus())) { await post("show.json", text); return null; }
  return launch("show.json", text);
}

export const frameFile = (name) => `${FOLDER}/frames/${name}`;
export const watchPath = folder;
