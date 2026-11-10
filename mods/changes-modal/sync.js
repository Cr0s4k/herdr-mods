import { exec } from "herdr";

export function parseBranch(header) {
  const m = /^## (?:No commits yet on )?(.+?)(?:\.\.\.(\S+))?(?: \[(.*)\])?$/.exec(header ?? "");
  if (!m || m[1].startsWith("HEAD (")) return null;
  const n = (word) => Number(new RegExp(`${word} (\\d+)`).exec(m[3] ?? "")?.[1] ?? 0);
  return { branch: m[1], upstream: m[2] ?? null, gone: m[3] === "gone", ahead: n("ahead"), behind: n("behind") };
}

export const remoteGit = (args, root, on, timeout) => exec("env", ["GIT_TERMINAL_PROMPT=0", "git", ...args], { cwd: root, on, timeout });
