import Panel from "./view.js";
import { bindPaneFocus } from "./panel-actions.js";

export default class Pane extends Panel {
  init(props, cx) {
    this.embedded = true;
    super.init(props, cx);
    bindPaneFocus(this, cx);
  }
}
