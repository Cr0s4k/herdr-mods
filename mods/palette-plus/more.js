import { spaces, focused, agents, layout, shared, setShared, openOverlay, run } from "herdr";
import { popupSize as togglesSize } from "./toggles.js";
import { STORE, taskJumps } from "./jump.js";

export const GROUPS = ["Panel", "Pipeline", "Review"];

const PANELS = [
  ["files", "Files", "files-modal", "tree explorer browse"],
  ["changes", "Git", "changes-modal", "changes diff commit uncommitted history log commits branches graph"],
  ["show", "Show", "show", "screenshots images markup draw"],
  ["brief", "Brief", "brief", "since you left feed summary finished"],
  ["loops", "Loops", "loops", "goals scheduled loop"],
  ["skills", "Skills", "skills", "agent skills inventory"],
  ["watchers", "Watchers", "watchers", "pull request checks notify"],
  ["plane", "Tasks", "plane", "plane tickets issues work items"],
  ["linear", "Linear", "linear", "tickets issues"],
];

const PIPELINE = [
  ["start", "Start Pipeline", "run go resume"],
  ["pause", "Pause Pipeline", "stop hold"],
  ["new", "New Pipeline task", "add queue type"],
  ["approve", "Merge or approve everything waiting", "pipeline review accept all"],
  ["retry", "Retry failed Pipeline tasks", "again failed"],
  ["answer", "Next Pipeline task that needs you", "question blocked answer"],
  ["queue", "Pipeline: Queue", "waiting"],
  ["review", "Pipeline: Review", "finished ready"],
  ["prs", "Pipeline: Pull requests", "pr github"],
  ["done", "Pipeline: Completed", "history merged"],
  ["activity", "Pipeline: Activity", "log events"],
  ["schedule", "Pipeline: Schedule", "time hours"],
  ["planner", "Pipeline: Plan", "planner"],
  ["settings", "Pipeline: Settings", "options agent delivery"],
];

function find(node, test) {
  if (!node) return null;
  if (test(node)) return node;
  for (const child of node.children ?? []) {
    const found = find(child, test);
    if (found) return found;
  }
  return null;
}

// <mod>.<command> only reaches copies on screen: a hidden block, or a stack's other children, never hears it.
function shown(node, mod) {
  if (!node || node.hidden) return false;
  if (node.content?.mod === mod) return true;
  const children = node.children ?? [];
  return (node.active ? children.filter(c => c.id === node.active) : children).some(c => shown(c, mod));
}

const command = (group, title, name, words, args = {}) => ({ name, args, group, title, words });
const overlay = (group, title, words, spec) =>
  ({ name: "openOverlay", args: { mod: spec.mod, ...spec.props }, group, title, words, do: () => openOverlay({ kind: "dialog", ...spec }) });

export function more() {
  const root = layout(), list = [];
  const features = shared("features") ?? {};
  const space = spaces().find(s => s.active);
  const where = focused();

  list.push(command("Panel", "Find file…", "mod.open", "go to file open search fuzzy quick name", { name: "find-file" }));
  list.push(overlay("Review", "Clean up worktrees…", "git remove delete prune stale old branches merged checkouts", { mod: "worktree-cleanup", width: 860, height: 560 }));
  list.push(command("Agent", "Find conversation…", "mod.open", "search chats sessions history said resume past recent", { name: "find-chat" }));
  if (shown(root, "tabs-show")) {
    const panel = find(root, n => n.id === "panel"), body = find(root, n => n.id === "panel-body");
    const enabled = new Set([...(shared("workspace.panels") ?? ["files", "changes"]), "show", "brief", "plane", "linear",
      ...["loops", "skills", "watchers"].filter(k => features[k] !== false)]);
    const open = panel && !panel.hidden ? body?.active : null;
    for (const [id, label, mod, words] of PANELS) {
      if (!enabled.has(id)) continue;
      list.push(command("Panel", `${open === id ? "Close" : "Open"} ${label} panel`, `tabs-show.${id}`, `side panel show hide toggle ${words}`));
      if (open === id) list.push(command("Panel", `Move ${label} panel to a pane`, `${mod}.pane`, `split tab ${words}`));
    }
    list.push(command("Pipeline", "Open Pipeline", "tabs-show.pipeline", "tasks queue worktrees agents"));
    for (const [cmd, title, words] of PIPELINE) list.push(command("Pipeline", title, `tabs-show.pipeline-${cmd}`, words));
    for (const jump of taskJumps(shared(STORE), spaces())) {
      list.push({ ...command("Pipeline", jump.title, `tabs-show.pipeline-task-${jump.task}`, jump.words, { space: jump.space }),
        do: () => { run("space.select", { id: jump.space }); run(`tabs-show.pipeline-task-${jump.task}`); } });
    }
    list.push(command("Review", "Open Changes + terminal", "tabs-show.review", "review diff git commit"));
    list.push(command("Review", "Open on GitHub", "tabs-show.github", "browser repository pull request"));
    if (features.watchers !== false) list.push(command("Review", "Watch this branch's pull request", "tabs-show.watch-pr", "watcher notify tell me wait review approved changes requested"));
  }

  if (shown(root, "spaces-pin")) {
    list.push(command("Space", "Tidy spaces", "spaces-pin.tidy", "sort order recent fold quiet"));
    if (features.needsYou !== false) list.push(command("Space", "Toggle the Needs you filter", "spaces-pin.needs-you", "attention blocked waiting only"));
    list.push(command("Space", "Focus the spaces sidebar", "spaces-pin.focus", "keyboard sidebar navigate"));
    if (shared("spaces.focus")) list.push({ ...command("Space", "All spaces", "spaces.focus", "unfocus sidebar filter show"), do: () => setShared("spaces.focus", null) });
    else if (space) list.push({ ...command("Space", "Focus this space", "spaces.focus", "only sidebar filter"), do: () => setShared("spaces.focus", space.id) });
  }
  list.push(overlay("Space", "New space from a project…", "projects folder add workspace", { mod: "space-new", width: 460, height: 500, props: { projects: true } }));
  if (space) list.push(overlay("Space", "Hide this space for a while…", "snooze later timed", { mod: "space-hide", width: 330, height: 350, props: { id: space.id } }));
  list.push(overlay("Space", "Hidden spaces…", "snoozed restore", { mod: "space-hide", width: 350, height: 420, props: { list: true } }));

  if (where?.tab) list.push(command("Tab", "Put tab away", "tab.settle", "settle hide park out of the lists"));
  const agent = where?.terminal && agents().find(a => a.address === where.terminal);
  if (agent) list.push(command("Agent", agent.pinned ? "Unpin agent" : "Pin agent", "terminal.pin", "top agent lists", { terminal: agent.address, pinned: !agent.pinned }));

  list.push(overlay("App", "Feature toggles", "switches enable disable on off loops skills watchers", { mod: "toggles", ...togglesSize() }));
  return list;
}
