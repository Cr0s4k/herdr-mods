---
name: herdr-show
description: Post screenshots or images to the user's Herdr "Show" panel so they can mark them up and send them back. Use whenever you produce a screenshot, render, chart or any image the user should look at while running inside Herdr (HERDR_ENV=1 or HC_TERMINAL_ID is set), and when a message says "Marked-up screenshot from the Show panel".
---

# Showing images in Herdr

The user reviews images in Herdr's Show panel (top right, next to Changes). They draw on an
image, add a note, and send it back to you.

- Show an image: `herdr-show <file.png> --title "<what it is, e.g. Landing page v2>"`
- When you receive "Marked-up screenshot from the Show panel: <path> …": Read that PNG, fix
  what the markup points at, take a new screenshot of the same view, then post it with the
  exact command the message gives: `herdr-show <new.png> --fixes <id>`. That links the fix
  under the markup in the panel.
- `herdr-show` writes to `~/.config/herdr-app/show/`, outside the workspace. In a sandbox (e.g.
  Codex) run it with escalated permissions from the start, or rerun it that way when it fails
  with "Operation not permitted". Don't fall back to showing the image inline.
- In a Herdr Pipeline task, the before and after screenshots its first message asks for go in
  the folder it names, not here: Pipeline lists them on the task and opens them in Show.
- Only PNG/JPEG. Post the image file you made; don't paste images inline instead.
