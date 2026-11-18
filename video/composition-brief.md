# Hyperframes Composition Brief: herdr-mods

## Objective
A short launch-style video for the top of the README: a real Pipeline run, then a few seconds of
each of the other mods, all on a throwaway repository.

## Output
- Composition directory: `video/composition/`
- Rendered video: `docs/herdr-mods.mp4`, uploaded to GitHub and embedded in the README
- Format: landscape, 1920x1080
- Duration: 30.4 seconds

## Source Material
- Pipeline footage: `video/composition/assets/footage.mp4`, recorded by `video/capture/record.py` and
  retimed by `video/capture/make-clip.py`
- Mods footage: `video/composition/assets/mods.mp4`, recorded by `video/capture/record-mods.py` and
  retimed by `video/capture/make-mods-clip.py`
- Both are retimed so their moments always land at the same seconds
- Product name: herdr-mods
- Copy that must appear verbatim:
  - Each task gets its own agent, branch and worktree.
  - Mods for Herdr

## Creative Direction
- Tone preset: polished
- Creative direction: quiet mission control; stay inside the real window
- Angle and storyboard: `video/brag-plan.md`
- Avoid: generic SaaS language, anything not recorded from the real window, claims the README doesn't make

## Visual Identity
- Background: #0f1018 around the window, #181926 inside it
- Text: #cdd6f4, muted #a6adc8
- Accent: #89b4fa, success #a6e3a1
- Font: Inter

## Scenes (seconds of the film)
1. Hook, 0 to 2.4: "Herdr, extended." / "Ten features, one window." over the dimmed first frame
2. Pipeline, 2.4 to 8.4: Pipeline clip 0 to 6; the queue, then the planner, then the work slots
3. Pipeline, 8.4 to 12.2: Pipeline clip 11.8 to 15.6; the review column, then the whole window
4. Show, 12.2 to 15.8: the panel as the screenshot, its markup and the fix arrive
5. Changes, 15.8 to 18.3: the panel, then the diff in the dialog
6. Files, 18.3 to 20.6: the panel, then `src/cart.js` in the dialog
7. Since you left, 20.6 to 23: the handoff with its question
8. Watchers, 23 to 25.5: the "tiny-shop tests pass succeeded" toast
9. Name, 25.5 to 30.4: herdr-mods, Mods for Herdr, the features' names

## Audio
- Music: happy-beats-business-moves-vol-10 by Sascha Ende, ende.app (CC BY 4.0), from 0s, low, fading under the name
- Cue source: the brag skill's preset for that track (110 BPM)
- Beat-locked: window lands 2.46; the four queue cards on 3.01, 3.55, 4.10, 4.64
- SFX (Kenney, CC0): a soft hit when the window lands, a card slide per queued task and for the
  Show screenshot and its fix, one bell on the watcher's toast
- Audio-reactive: the glow follows the track's beat grid
