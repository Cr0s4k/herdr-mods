---
name: herdr-mods-video
description: Re-record and re-render the video at the top of the herdr-mods README (docs/herdr-mods.mp4 and docs/herdr-mods.gif): a real Pipeline run, then Show, Changes, Files, Since you left and Watchers, all on a throwaway repository.
disable-model-invocation: true
---

# Regenerating the herdr-mods video

The video at the top of the README is about thirty seconds of real Herdr footage, not the demo
mode. It opens on a Pipeline run: four small tasks on a throwaway repository called `tiny-shop`,
worked by real Claude Code agents. Then it gives a few seconds each to Show, Changes, Files, Since
you left and Watchers, filmed in the same kind of throwaway space. The two halves are separate
recordings, so either can be redone alone. Everything lives in `video/` in the herdr-mods
repository (`~/Projects/herdr-mods` unless the user says otherwise); run every command from the
repository's root.

| Path | What it is |
|---|---|
| `video/capture/record.py` | Runs the Pipeline session in Herdr and saves frames of the window |
| `video/capture/record-mods.py` | Films the other mods' scenes the same way |
| `video/capture/make-repo.sh` | Makes the throwaway `tiny-shop` repository |
| `video/capture/cart.html` | The shop page `record-mods.py` screenshots for the Show scene |
| `video/capture/driver/` | A tiny mod the recorders install for the run; it is how actions reach Pipeline and how the dialogs open |
| `video/capture/make-clip.py` | Retimes a Pipeline run into `video/composition/assets/footage.mp4` |
| `video/capture/make-mods-clip.py` | Retimes a mods run into `video/composition/assets/mods.mp4` |
| `video/composition/` | The Hyperframes project: `index.html` is the whole film |
| `video/render.sh` | Checks, renders, and writes `docs/herdr-mods.mp4` and `docs/herdr-mods.gif` |
| `video/brag-plan.md`, `video/composition-brief.md` | The storyboard and the brief the film follows |

Decide first what you need. Only the words, timing, music or look of the film changed: skip to
step 4, the footage in the repository is reused. Pipeline looks different now: steps 1 to 3 with
`record.py`. One of the other mods looks different: steps 1 to 3 with `record-mods.py`.

## Before recording

- Run from the main checkout, never a Pipeline worktree: the recording shows the mods Herdr has
  installed. If the change you want on screen isn't installed yet, run `./install.sh` first.
- Herdr must be open on the `main-custom` layout with `herdr-app status` reporting no errors.
- `claude` must be installed and signed in, and `ffmpeg`, `node` and `python3` on the path.
- Tell the user before you start: for two to three minutes the Herdr window switches to a
  temporary `tiny-shop` space with the sidebar hidden, and they can't use Herdr meanwhile. The run
  starts four Claude Code agents on Sonnet and a planner on Haiku, which costs a little usage.
  If you are running inside Herdr yourself, your own terminal is hidden during the run; that is
  fine, the script doesn't need it. The mods recording takes about a minute, starts no agents, and
  also needs Google Chrome (for the shop screenshot).
- While either recorder runs, Herdr shows only toasts that mention `tiny-shop` (or the `cart.`
  screenshots): the recorder points `main-custom`'s `toast` at a filtering copy of Herdr's toast
  mod (`mods/video-toast`) and puts the layout back at the end. Toasts from the user's real spaces
  during that time are dropped, not delayed.

## 1. Record

```sh
python3 video/capture/record.py /tmp/herdr-mods-video > /tmp/herdr-mods-video.log 2>&1
```

Run it in the background and wait for it to exit; a run takes one to three minutes and gives up
after fifteen. It prints one line per event with the second it happened, and ends with
`N frames, 4 of 4 tasks merged`. It exits non-zero when a task did not merge.

What it does, so you can tell where a failure is: makes the repository inside the output folder,
opens a `tiny-shop` space and a live Pipeline tab on it, hides the sidebar, sets the pipeline up
(Claude Code on Sonnet, `npm test` as the check, three parallel, the planner on, new worktrees
trusted), adds the four tasks one at a time, presses Start, approves each task five seconds after
it reaches review, and presses Enter in the terminal of an agent that has waited six seconds for
an answer. At the end it closes the space, forgets the pipeline, deletes the repository and its
worktrees, removes the driver mod, shows the sidebar again and returns to the space and tab the
user was on. `--keep` skips that cleanup when you need to look at what went wrong; clean up by
hand afterwards (close the space, delete `~/.config/herdr-app/mods/video-driver`).

If it stops early, read the log, then `herdr-pipeline --all` and `herdr-app status`. Problems seen
so far:

- **"Pipeline did not take …"**: the driver mod did not run. `herdr-app do mod.open
  '{"name":"video-driver"}'` toggles an overlay, so a driver left open by a crashed run makes the
  next call close it instead. Run that command once by hand, then record again.
- **A task stays "Needs you"**: the agent asked something Enter doesn't answer. `hc read <terminal>`
  shows the question (the terminal id is on the task in `herdr-pipeline --json`).
- **A task stops as failed**: its checks failed twice or the agent quit. Record again; the tasks
  are small enough that this is rare.

After a failed run check that nothing is left behind: no `tiny-shop` space in `herdr-app ls`, the
sidebar visible, no `video-driver` or `video-toast` folder in `~/.config/herdr-app/mods`, and no
`"toast"` key in `~/.config/herdr-app/layouts/main-custom.json` (run `./install.sh` to restore it).

### The mods

```sh
python3 video/capture/record-mods.py /tmp/herdr-mods-video-mods > /tmp/herdr-mods-video-mods.log 2>&1
```

Run it in the background; it ends with `N frames, 14 events` after about a minute, and exits
non-zero when the watcher never fired. It makes `tiny-shop` with the four Pipeline tasks already
committed and a `checkout()` change left uncommitted, posts a Since you left handoff, hides the
sidebar, then films, five frames a second: the Show panel (`herdr-show` posts the shop page, `herdr-show
mark` adds a red circle and a note, then the fixed page arrives), the Changes panel and the diff in
its dialog, the Files panel and `src/cart.js` in its dialog, the Since you left panel, and a
command watcher on `npm test` firing its toast (it checks every 15 seconds, so that wait is the
longest). At the end it removes the Show images, the handoff and the watcher it made, closes the
space and puts the side panel back how it was. `--keep` skips that cleanup.

## 2. Look at the run before using it

The frames are the whole Herdr window, so check them for anything that is not the throwaway
project. Notifications are the risk: a toast from one of the user's real spaces can appear in the
bottom right corner during the run.

```sh
python3 - <<'EOF'
import json, subprocess
run = "/tmp/herdr-mods-video"
frames = json.load(open(f"{run}/frames.json"))
step = max(1, len(frames) // 12)
picks = [frame["file"] for frame in frames[::step]][:12]
inputs = sum((["-i", f"{run}/frames/{name}"] for name in picks), [])
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *inputs, "-filter_complex",
                f"concat=n={len(picks)}:v=1,scale=1280:-2,tile=3x4", "-frames:v", "1", f"{run}/sheet.jpg"], check=True)
EOF
```

Read `/tmp/herdr-mods-video/sheet.jpg` (for the mods, set `run` to `/tmp/herdr-mods-video-mods`).
Every toast must name `tiny-shop` or a `cart` image; the tab bar must show
only `Pipeline` and the `T-…` tabs (and the space's own shell tab). If a frame shows a real project,
a ticket, a path under the user's home or a person's name, record again rather than cropping.
The usage chip in the toolbar ("46% used") is the user's real Claude usage; mention it to them if
it shows.

## 3. Make the footage

```sh
python3 video/capture/make-clip.py /tmp/herdr-mods-video video/composition/assets/footage.mp4
```

```sh
python3 video/capture/make-mods-clip.py /tmp/herdr-mods-video-mods video/composition/assets/mods.mp4
```

The docstring of each script lists the second of the clip each moment lands on. For the Pipeline
clip, this is what keeps the film stable between recordings: whatever the agents' pace was, the four
tasks join the queue at 0.61, 1.15, 1.70 and 2.24 seconds of the clip, Start is at 3.2, the first
agent works at 5.2, the first check or review is at 8.6, the last merge at 14.0, and the clip ends
at 15.6. The film shows two cuts of it: clip 0 to 6 at film 2.4 to 8.4, and clip 11.8 to 15.6
at film 8.4 to 12.2. The mods clip (13.6 seconds) plays from film 12.2, so add 12.2 for film time. It also writes
`footage.jpg`, the first frame, shown behind the opening words. Change these times only together
with the captions, camera moves and sounds in `index.html`.

## 4. Edit the film (only if it should change)

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
  (`DIFF`, `CODE`); toasts are bottom right (`TOAST`). If a layout moved, adjust these and look at
  snapshots.
- **Sound**: the music is a 110 BPM track; its beat grid starts at 0.27 seconds and repeats every
  0.545. Entrances marked `beat-locked` sit on beats; keep them there when you move things.
- **Length**: keep the film around thirty seconds; every mod scene is two to three.
- A `<video>` with `data-start` must not sit inside another element that has `data-start`; the
  renderer then shows the wrong frames. `#stage` is deliberately untimed.

Update `video/brag-plan.md` and `video/composition-brief.md` when the story or timings change.

## 5. Check, look, render

```sh
(cd video/composition && npm run check)
(cd video/composition && npx hyperframes snapshot --at 1.5,4.4,6.6,9.5,13,14.5,17.6,19.8,21.8,23.9,28)
```

The check must end with `Check passed`. Notices that are expected and fine: `first_frame_empty` for `#veil`
(frame 0 is replaced by the poster in the next step), `canvas_covered` for `#curtain` (the closing
card covers the window on purpose) and `timeline_track_too_dense`. Then read the snapshot's
`contact-sheet.jpg`, whose path the command prints. A passing check says nothing about how it
looks. In each frame the caption should describe what the footage shows at that moment, and the
UI text in the zoomed shots should be readable.

```sh
./video/render.sh
```

It runs the check again, renders, puts the poster (the film at 9.6 seconds, the review column;
`POSTER_AT=<seconds>` picks another settled moment) in as frame 0, and writes `docs/herdr-mods.mp4`
(with sound) and `docs/herdr-mods.gif` (silent, 960 wide, for the README). Rendering takes a few
minutes.

## 6. Verify and finish

- Extract a few frames from `docs/herdr-mods.mp4` with `ffmpeg -ss <t> -i docs/herdr-mods.mp4
  -frames:v 1 out.jpg` and read them: the opening words, a zoomed shot, the count and the name.
- `ffprobe docs/herdr-mods.mp4` should show a video and an audio stream and a length near 30.4
  seconds. Keep the GIF under about 10 MB; if it is larger, lower `fps` or the width in
  `video/render.sh`.
- The README shows `docs/herdr-mods.gif` and links to `docs/herdr-mods.mp4`; update its alt text if
  what the film shows changed.
- The music is "Happy Beats / Business Moves Vol. 10" by Sascha Ende, ende.app, CC BY 4.0; the
  credit in `NOTICE` must stay. The sound effects are Kenney's, CC0.
- Delete the run folders (`/tmp/herdr-mods-video`, `/tmp/herdr-mods-video-mods`): they hold a few
  hundred megabytes of frames.
- Commit `video/`, `docs/herdr-mods.*` and the README only when the user asks.
