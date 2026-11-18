---
name: herdr-mods-video
description: Re-record and re-render the video at the top of the herdr-mods README (docs/herdr-mods.mp4): a real Pipeline run, then Show, Changes, Files, Since you left and Watchers, all on a throwaway repository.
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
| `video/render.sh` | Checks, renders, and writes `docs/herdr-mods.mp4` |
| `video/brag-plan.md`, `video/composition-brief.md` | The storyboard and the brief the film follows |

Decide first what you need. Only the words, timing, music or look of the film changed: skip to
step 4, the footage in the repository is reused. Pipeline looks different now: steps 1 to 3 with
`record.py`. One of the other mods looks different: steps 1 to 3 with `record-mods.py`.

## 1 to 3. Record, look at the run, make the footage

Read [recording.md](recording.md) first: what must be true before recording and what to tell the
user, the two recorders and the failures seen so far, how to check the frames for anything that
is not the throwaway project, and the commands that turn a run into footage.

## 4. Edit the film (only if it should change)

Read [editing.md](editing.md) first: where the words, camera moves, sounds and timings are in
`video/composition/index.html`, and the rules they must keep.

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
(with sound). Frame 0 is what the README's player shows before it plays. Rendering takes a few
minutes.

## 6. Verify and finish

- Extract a few frames from `docs/herdr-mods.mp4` with `ffmpeg -ss <t> -i docs/herdr-mods.mp4
  -frames:v 1 out.jpg` and read them: the opening words, a zoomed shot, the count and the name.
- `ffprobe docs/herdr-mods.mp4` should show a video and an audio stream and a length near 30.4
  seconds.
- GitHub plays videos only from its own attachments, never from files in the repository, so the
  README embeds an uploaded copy: a bare `https://github.com/user-attachments/assets/…` line
  under the introduction. After a new render, the user uploads `docs/herdr-mods.mp4` (drag it
  into a new issue's description on github.com, copy the link that appears, close the page
  without submitting) and you replace that line with the new link. The repository is private, so
  this needs a browser signed in to GitHub; ask the user rather than signing in. Keep the caption
  under it accurate if what the film shows changed.
- The music is "Happy Beats / Business Moves Vol. 10" by Sascha Ende, ende.app, CC BY 4.0; the
  credit in `NOTICE` must stay. The sound effects are Kenney's, CC0.
- Delete the run folders (`/tmp/herdr-mods-video`, `/tmp/herdr-mods-video-mods`): they hold a few
  hundred megabytes of frames.
- Commit `video/`, `docs/herdr-mods.mp4` and the README only when the user asks.
