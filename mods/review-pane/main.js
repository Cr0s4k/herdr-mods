import { nextCommand, props, shared, setShared } from "herdr";
import Changes from "./changes.js";

export default class ReviewPane extends Changes {
  init(_props, cx) {
    this.embedded = true;
    super.init(_props, cx);
    cx.spawn(async cx => {
      for (;;) if (await nextCommand() === "focus") this.handle.focus();
    });
  }

  render(cx) {
    const tab = props()?.tab;
    if (tab) {
      const key = `review-pane.summary.${tab}`;
      const summary = { files: this.files.length,
        add: this.files.reduce((n, file) => n + file.add, 0),
        del: this.files.reduce((n, file) => n + file.del, 0) };
      if (JSON.stringify(shared(key)) !== JSON.stringify(summary)) setShared(key, summary);
    }
    return super.render(cx);
  }
}
