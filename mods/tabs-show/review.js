import { spaces, panes, terminals, focused, run, notify } from "herdr";

// Changes and its companion shell live in the tab's real pane tree.
export class ReviewPanes {
  constructor() { this.opening = new Set(); }

  open(cx) { cx.spawn(cx => this.openInTab(cx)); }

  // Also awaitable by the project picker, which stays alive until setup finishes.
  async openInTab(cx) {
    const space = spaces().find(s => s.active), tab = space?.tabs.find(t => t.active)?.id;
    if (!tab || this.opening.has(tab)) return;
    const all = panes().filter(p => p.tab === tab), review = all.find(p => p.mod === "review-pane");
    if (review) { run("pane.focus", { pane: review.pane }); return; }

    const f = focused();
    const anchor = all.find(p => p.pane === f?.pane && p.terminal)
      ?? all.find(p => p.program?.agent) ?? all.find(p => p.terminal) ?? all[0];
    if (!anchor) return;
    run("layout.hide", { id: "panel" });
    const folder = anchor.cwd || space.folder;
    const existing = terminals().find(term => term.state === "live"
      && term.labels?.["herdr.mods.panel-terminal"] === space.id
      && !panes().some(p => p.terminal === term.address));
    this.opening.add(tab);
    cx.notify();
    let upper;
    const wait = async check => {
      for (let i = 0; i < 100; i++) {
        // Do not split a different tab if the user switches while opening.
        if (focused()?.tab !== tab) throw new Error("Return to the tab and choose Changes + terminal again.");
        const result = check();
        if (result) return result;
        await cx.sleep(100);
      }
      throw new Error("The pane did not open. Try Changes + terminal again.");
    };
    try {
      run("pane.split", { pane: anchor.pane, direction: "right", mod: "review-pane", props: { tab } });
      upper = await wait(() => panes().find(p => p.tab === tab && p.mod === "review-pane"));
      run("pane.focus", { pane: upper.pane });
      await wait(() => focused()?.pane === upper.pane);
      const before = new Set(panes().map(p => p.pane));
      if (existing) run("terminal.keep", { terminal: existing.address, place: "down" });
      else run("terminal.open", { folder, place: "down" });
      await wait(() => panes().find(p => p.tab === tab && p.terminal && !before.has(p.pane)));
      run("pane.focus", { pane: anchor.pane });
    } catch (error) {
      // A cancelled opening should be retryable, without leaving half a pair.
      if (upper && !panes().some(p => p.tab === tab && p.terminal && !all.some(old => old.pane === p.pane))) {
        run("pane.close", { pane: upper.pane });
      }
      notify({ title: "Review panes", body: error.message || String(error), level: "error" });
    } finally { this.opening.delete(tab); cx.notify(); }
  }
}
