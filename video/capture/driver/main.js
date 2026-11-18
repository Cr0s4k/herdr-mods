import { View, div } from "gpui-kit";
import { shared, setShared, readTextFile, appHome, closeOverlay, props, knownAgents } from "herdr";
import { STORE, reduce } from "./pipeline-model.js";

export default class VideoDriver extends View {
  init(_props, cx) {
    cx.spawn(async () => {
      try {
        const { key, actions } = JSON.parse(await readTextFile(`${appHome()}/mods/video-driver/actions.json`));
        for (const action of actions) {
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
