# Hyperframes Composition Brief: herdr-mods

## Objective
A short launch-style video of a real Pipeline run, for the top of the README.

## Output
- Composition directory: `video/composition/`
- Rendered video: `docs/pipeline.mp4`, and `docs/pipeline.gif` for the README
- Format: landscape, 1920x1080
- Duration: 21.8 seconds

## Source Material
- Footage: `video/composition/assets/footage.mp4`, recorded by `video/capture/record.py` and retimed by
  `video/capture/make-clip.py` so its moments always land at the same seconds
- Product name: herdr-mods
- Strongest claim: each task gets its own agent, branch and worktree, is checked, then waits for
  review and merges (README, Pipeline)
- Copy that must appear verbatim:
  - Each task gets its own agent, branch and worktree.
  - Mods for Herdr
  - Pipeline · Show · Tasks · Watchers · Loops · Skills

## Creative Direction
- Tone preset: polished
- Creative direction: quiet mission control; stay inside the UI's own starfield
- Angle and storyboard: `video/brag-plan.md`
- Avoid: generic SaaS language, anything not recorded from the real window, claims the README doesn't make

## Visual Identity
- Background: #0f1018 around the window, #181926 inside it
- Text: #cdd6f4, muted #a6adc8
- Accent: #89b4fa, success #a6e3a1
- Font: Inter

## Scenes (seconds of the film)
1. Hook, 0 to 2.4: "Four tasks." / "Zero babysitting." over the dimmed first frame
2. Queue, 2.4 to 5.6: footage starts; close on the queue as the four tasks arrive
3. Plan, 5.6 to 7.8: push in on the planner
4. Work, 7.8 to 11: the three work slots
5. Land, 11 to 16.3: the review column, then back out to the whole window as the last tasks merge
6. Count, 16.3 to 18: the whole window, "4 tasks merged."
7. Name, 18 to 21.8: herdr-mods, Mods for Herdr, the mods' names

## Audio
- Music: happy-beats-business-moves-vol-10 by Sascha Ende, ende.app (CC BY 4.0), from 0s, low, fading under the name
- Cue source: the brag skill's preset for that track (110 BPM)
- Beat-locked: window lands 2.46, work slots 7.79, name 18.55; the four queue cards on 3.01, 3.55, 4.10, 4.64
- SFX (Kenney, CC0): a soft hit when the window lands, a card slide per queued task, one bell on the count
- Audio-reactive: the media-use extraction helper isn't installed here, so the glow follows the
  track's beat grid instead of measured levels
