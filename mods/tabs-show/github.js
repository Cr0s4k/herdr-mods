import { exec, notify } from "herdr";

export function repositoryContext(spaceList, paneList, focus) {
  const space = spaceList.find(space => space.active);
  const tab = space?.tabs.find(tab => tab.active)?.id;
  const members = paneList.filter(pane => pane.tab === tab);
  const direct = space && focus?.space === space.id && focus?.tab === tab ? focus.cwd : null;
  return {
    cwd: direct || members.find(pane => pane.focused && pane.cwd)?.cwd
      || members.find(pane => pane.cwd)?.cwd || space?.folder || null,
    on: space?.machine ?? null,
  };
}

export function githubUrl(remote) {
  const match = remote.match(/^(?:(?:https?|ssh|git):\/\/(?:[^\s/@]+@)?github\.com(?::\d+)?\/|(?:[^\s/@:]+@)?github\.com:)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  if (!match || [match[1], match[2]].some(part => part === "." || part === "..")) return null;
  return `https://github.com/${match[1]}/${match[2]}`;
}

export async function openRepository(context, platform, path = "") {
  if (!context.cwd) throw new Error("Select a project folder, then try GitHub again.");
  const result = await exec("git", ["remote", "-v"], context);
  if (result.code !== 0) throw new Error("This folder is not a Git repository. Select a repository, then try again.");
  const remotes = result.stdout.split(/\r?\n/).flatMap(line => {
    const match = line.match(/^(\S+)\s+(\S+)\s+\(fetch\)$/);
    const url = match && githubUrl(match[2]);
    return url ? [{ name: match[1], url }] : [];
  });
  const remote = remotes.find(remote => remote.name === "origin") ?? remotes[0];
  if (!remote) throw new Error("This repository has no GitHub remote. Add a GitHub remote, then try again.");

  // Open the browser on this computer, even when Git ran on a remote machine.
  // -n delivers --new-tab even when Firefox is already running; Firefox forwards it.
  const mac = platform === "macos", url = remote.url + path;
  const attempts = [
    mac ? ["open", ["-na", "Firefox", "--args", "--new-tab", url]] : ["firefox", ["--new-tab", url]],
    [mac ? "open" : "xdg-open", [url]],
  ];
  for (const [command, args] of attempts) {
    try { if ((await exec(command, args)).code === 0) return; } catch {}
  }
  throw new Error(`Could not open a browser. Open ${url} yourself.`);
}

export class GitHubRepo {
  constructor() { this.opening = false; }

  open(cx, context, platform) {
    if (this.opening) return;
    this.opening = true;
    cx.notify();
    cx.spawn(async cx => {
      try { await openRepository(context, platform); }
      catch (error) { notify({ title: "Cannot open GitHub", body: error.message || String(error), level: "error" }); }
      finally { this.opening = false; cx.notify(); }
    });
  }
}
