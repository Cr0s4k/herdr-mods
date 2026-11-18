import { View, div } from "gpui-kit";
import { shared, setShared, readTextFile, writeTextFile, appHome, openOverlay, closeOverlay, props, knownAgents, layout } from "herdr";
import { STORE, reduce } from "./pipeline-model.js";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class VideoDriver extends View {
  init(_props, cx) {
    cx.spawn(async () => {
      try {
        const folder = `${appHome()}/mods/video-driver`;
        const { key, actions } = JSON.parse(await readTextFile(`${folder}/actions.json`));
        for (const action of actions) {
          if (action.type === "overlay") {
            openOverlay({ mod: action.mod, kind: "dialog", width: 0.9, height: 0.9, props: action.props });
            continue;
          }
          if (action.type === "panel") {
            const panel = find(layout(), "panel"), body = find(layout(), "panel-body");
            await writeTextFile(`${folder}/panel.json`, JSON.stringify({ hidden: !!panel?.hidden, active: body?.active ?? null }), null);
            continue;
          }
          const all = shared(STORE) ?? {};
          if (action.type === "forget") { const { [key]: _gone, ...rest } = all; setShared(STORE, rest); continue; }
          if (!all[key]) throw new Error(`No pipeline is saved as ${key}`);
          let step = action;
          if (action.type === "agent") {
            const agent = (await knownAgents({})).find(agent => agent.key === action.key && agent.installed);
            if (!agent) throw new Error(`${action.key} is not installed`);
            step = { type: "agent", value: { key: agent.key, name: agent.name, run: agent.run } };
          }
          const now = shared(STORE);
          setShared(STORE, { ...now, [key]: reduce(now[key], step) });
        }
      } finally { closeOverlay(props()?.overlay); }
    });
  }

  render() { return div(); }
}
