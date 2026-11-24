import { exec } from "herdr";

export function parseBranch(header) {
  const m = /^## (?:No commits yet on )?(.+?)(?:\.\.\.(\S+))?(?: \[(.*)\])?$/.exec(header ?? "");
  if (!m || m[1].startsWith("HEAD (")) return null;
  const n = (word) => Number(new RegExp(`${word} (\\d+)`).exec(m[3] ?? "")?.[1] ?? 0);
  return { branch: m[1], upstream: m[2] ?? null, gone: m[3] === "gone", ahead: n("ahead"), behind: n("behind") };
}

export const remoteGit = (args, root, on, timeout) => exec("env", ["GIT_TERMINAL_PROMPT=0", "git", ...args], { cwd: root, on, timeout });

export async function branchState(git) {
  const head = await git(["symbolic-ref", "-q", "--short", "HEAD"]);
  const branch = head.code === 0 ? head.stdout.trim() : "";
  if (!branch) return null;
  const ref = await git(["for-each-ref", "--format=%(upstream:short)%00%(upstream:track)", `refs/heads/${branch}`]);
  const [upstream = "", track = ""] = ref.code === 0 ? ref.stdout.trim().split("\0") : [];
  return parseBranch(`## ${branch}${upstream ? `...${upstream}` : ""}${track ? ` ${track}` : ""}`);
}
