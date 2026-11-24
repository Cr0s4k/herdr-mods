import { appHome, exec, notify, playSound, shared, setShared, window, checking } from "herdr";
import { ITEMS, ANNOUNCED, ERROR, unannounced } from "./watchers-model.js";

export async function watchCli(args, options = {}) {
  const result = await exec("python3", [`${appHome()}/mods/watchers/herdr-watch`, ...args], { timeout: 120000, ...options });
  let data;
  try { data = JSON.parse(result.stdout); } catch { throw new Error("Watchers could not run. Check that Python 3 is installed."); }
  if (data.error) throw new Error(data.error);
  if (!Array.isArray(data.items)) throw new Error("Watchers could not be read.");
  return data;
}

function announce(items) {
  const fresh = unannounced(items, shared(ANNOUNCED));
  if (!fresh.length) return;
  setShared(ANNOUNCED, [...(shared(ANNOUNCED) ?? []), ...fresh.map(item => item.id)].slice(-500));
  const away = window()?.active === false && window()?.platform === "macos";
  for (const item of fresh) {
    const { title, body, level } = item.fired;
    notify({ title, body, level, timeout: 20000, action: { name: "tabs-show.watchers" } });
    if (away) exec("osascript", ["-e", "on run argv", "-e", "display notification (item 2 of argv) with title (item 1 of argv)", "-e", "end run", title, body || "Herdr watcher"]).catch(() => {});
  }
  playSound("done");
}

// The panel and the tab bar both call this; what fired is announced once whoever reads it first.
export async function syncWatchers(args = ["tick"], options) {
  const data = await watchCli(args, options);
  if (JSON.stringify(shared(ITEMS)) !== JSON.stringify(data.items)) setShared(ITEMS, data.items);
  if (shared(ERROR)) setShared(ERROR, null);
  announce(data.items);
  return data;
}

export async function watchBranch(context) {
  try {
    if (!context.cwd || context.on) throw new Error("No local project here. Open the Watchers panel and paste the pull request's link.");
    const { added } = await syncWatchers(["pr", "--until", "review", "--cwd", context.cwd]);
    notify({ title: `Watching PR #${added.number} for a review`, body: added.title, level: "info", action: { name: "tabs-show.watchers" } });
  } catch (error) {
    notify({ title: "Can't watch the pull request", body: error.message || String(error), level: "error" });
  }
}

export class WatchersTracker {
  start(cx) {
    if (checking()) return;
    this.busy = false;
    const tick = cx => { cx.spawn(async () => this.refresh()); };
    tick(cx);
    cx.timer.every(15000, tick);
  }

  async refresh() {
    if (this.busy) return;
    this.busy = true;
    try { await syncWatchers(); }
    catch (error) {
      const message = `Watchers could not check. ${error.message || error}`;
      if (shared(ERROR) !== message) setShared(ERROR, message);
    } finally { this.busy = false; }
  }
}
