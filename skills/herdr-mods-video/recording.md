# Recording new footage (steps 1 to 3)

Run every command from the repository's root. When the footage is made, go on with step 4 or 5 in [SKILL.md](SKILL.md).

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
