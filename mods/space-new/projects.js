import { exec } from "herdr";

// Pass paths as arguments: project names may contain quotes, newlines or shell syntax.
export async function listProjects(root) {
  const result = await exec("python3", ["-c", "import json, os, sys\nwith os.scandir(sys.argv[1]) as entries:\n print(json.dumps([e.name for e in entries if not e.name.startswith('.') and e.is_dir()]))", root]);
  if (result.code !== 0) throw new Error(`Could not read ${root}. Check that the folder exists and is readable, then retry.`);
  return JSON.parse(result.stdout).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }))
    .map(name => ({ name, folder: `${root}/${name}` }));
}
