import { appHome, exec, readTextFile } from "herdr";

let script;
export const PRIORITY = { Urgent: 4, High: 3, Medium: 2, Low: 1 };
export const openIssue = issue => !["completed", "canceled"].includes(issue.statusType);

// Plane access stays on this computer, even for a project on another machine.
export async function readPlane(payload) {
  script ??= await readTextFile(`${appHome()}/mods/plane/herdr-plane`);
  if (!script) throw new Error("The Plane reader is missing. Reinstall the mods.");
  const result = await exec("python3", ["-c", script, "--home", appHome(), "request", JSON.stringify(payload)], { timeout: 120000 });
  let response;
  try { response = JSON.parse(result.stdout); }
  catch { throw new Error("Cannot read Plane. Check Python 3 on this computer."); }
  if (response.error || result.code !== 0) {
    const error = new Error(response.error || "Cannot load Plane.");
    error.kind = response.kind;
    throw error;
  }
  return response.data;
}
