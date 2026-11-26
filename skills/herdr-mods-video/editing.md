# Editing the film (step 4)

Only when the film itself should change. Afterwards, go on with step 5 in [SKILL.md](SKILL.md).

`video/composition/index.html` is one Hyperframes composition: timed elements carry `data-start`
and `data-duration`, and one paused GSAP timeline registered as `window.__timelines["main"]` moves
them. `video/composition/AGENTS.md` has the framework's rules; `npx hyperframes docs <topic>`
prints the reference.

- **Words**: the `caption-N` and hook elements. Each caption starts with the feature's name in
  an `<i>`. Every claim must be something the README says about that feature.
- **Reading time**: a caption stays fully visible for at least 0.8 seconds, or 0.3 seconds a word
  if that is longer. The check fails a closing line shown for under two seconds.
- **Camera**: `look(scale, fx, fy, tx, ty)` zooms the footage so the point (`fx`, `fy`) of the
  window, as fractions, sits at (`tx`, `ty`) of the frame. In Pipeline, the queue is top left,
  the planner at about (0.33, 0.5), the work slots right of it, the review column top right. The
  side panel is the right sixth of the window (`PANEL`, `SHOW_*`); the dialogs fill the middle
  (`DIFF`, `CODE`), and `DIFF` frames only the new side of the split diff, so no old line is cut
  at its left edge; toasts are bottom right (`TOAST`). If a layout moved, adjust these and look
  at snapshots.
- **Sound**: the music is a 110 BPM track; its beat grid starts at 0.27 seconds and repeats every
  0.545. Entrances marked `beat-locked` sit on beats; keep them there when you move things.
- **Length**: keep the film around thirty seconds; every mod scene is two to three.
- A `<video>` with `data-start` must not sit inside another element that has `data-start`; the
  renderer then shows the wrong frames. `#stage` is deliberately untimed.

Update `video/brag-plan.md` and `video/composition-brief.md` when the story or timings change.
