# Agent Office

Your team's agent office inside Herdr: the web page where everyone's Claude Code sessions sit
at their desks, type, wait for a human and walk to the coffee counter.

- **The building button** in the tab bar, after Pipeline, opens it in a large dialog. So does
  **Agent Office** in the command palette (⇧⌘P). Esc or × closes it.
- **The corner**: a small live office at the bottom right of the terminals. Click it to open
  the dialog. Drag it to another edge or corner; Herdr keeps it there.

The dialog's picture is live, about five times a second while Herdr is in front and once a
second behind another app. The corner refreshes every few seconds. Both only look: to claim a
desk or join, use **Open in browser**.

## Which office

The address you set with **Address** in the dialog, else the one Claude Code's office hook
sends events to: `OFFICE_URL` in `~/.claude/settings.json`, without its `/events`. Only that
value is used; the token never is. An address with the office's read key
(`?key=…`) needs no sign-in.

With neither, the corner stays hidden and the dialog asks for an address. Clear the field and
save to go back to the hook's.

## Signing in

An office behind Google sign-in shows **Sign in** in the dialog. A window opens on the
office's sign-in page; sign in there and it closes by itself, and the office appears. The
sign-in is kept as a browser keeps one. Closing the window without signing in cancels it.

## Switches

Under the tab bar's switches: **Agent Office** (the button, the dialog and the corner) and
**Agent Office corner** (the corner only). Both are on until you switch them off.

## How it works

Herdr can't show a web page, so a small macOS program draws the office with WebKit in an
invisible window and saves what it shows as pictures, which the mod displays.

- `mods/agent-office/view.swift` is compiled on first use to
  `~/.cache/herdr-agent-office/herdr-agent-office` (it needs Xcode's command line tools, as
  Show does), and again whenever the source is newer. WebKit keeps its sign-in under that
  name, in `~/Library/HTTPStorages/herdr-agent-office.binarycookies`.
- The dialog and the corner each write what they want (address, size, how often) to
  `~/.config/herdr-app/agent-office/want-modal.json` and `want-mini.json` every few seconds.
  The program follows the dialog while it's open, else the corner, and quits 15 seconds after
  neither asks, so it stops with Herdr, when Herdr is hidden and when both are switched off.
- Pictures go to `~/.config/herdr-app/agent-office/frames/` under new names (Herdr caches an
  image by its path), keeping the last four; `status.json` names the newest and the page's
  state.
- Between the corner's pictures the page's animation is paused, so the corner costs a few
  percent of one core. The dialog's five pictures a second cost about a third of one, only
  while it's open and Herdr is in front.
