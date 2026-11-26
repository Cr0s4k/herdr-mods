# Agent Office

Your team's agent office inside Herdr: the web page where everyone's Claude Code sessions sit
at their desks, type, wait for a human and walk to the coffee counter.

- **The building button** in the tab bar, after Pipeline, opens it in a large dialog. So does
  **Agent Office** in the command palette (⇧⌘P). Esc or × closes it.
- **The sidebar**: a small live office at the bottom of the left sidebar, above Settings.
  Click it to open the dialog. It hides while the sidebar is collapsed to its rail.

The dialog's picture is live, ten times a second while Herdr is in front and twice a second
behind another app. The sidebar's refreshes every second. Both move at real speed and only look:
to claim a desk or join, use **Open in browser**.

## Which office

The address you set with **Address** in the dialog, else the one Claude Code's office hook
sends events to: `OFFICE_URL` in `~/.claude/settings.json`, without its `/events`. Only that
value is used; the token never is. An address with the office's read key
(`?key=…`) needs no sign-in.

With neither, the sidebar shows no office and the dialog asks for an address. Clear the field and
save to go back to the hook's.

## Signing in

An office behind Google sign-in shows **Sign in** in the dialog. A window opens on the
office's sign-in page; sign in there and it closes by itself, and the office appears. The
sign-in is kept as a browser keeps one. Closing the window without signing in cancels it.

## Switches

Under the tab bar's switches: **Agent Office** (the button, the dialog and the sidebar's office)
and **Agent Office in the sidebar** (that one only). Both are on until you switch them off.

## How it works

Herdr can't show a web page, so a small macOS program draws the office with WebKit in an
invisible window and saves what it shows as pictures, which the mod displays.

- `mods/agent-office/view.swift` is compiled on first use to
  `~/.cache/herdr-agent-office/herdr-agent-office` (it needs Xcode's command line tools, as
  Show does), and again whenever the source is newer. WebKit keeps its sign-in under that
  name, in `~/Library/HTTPStorages/herdr-agent-office.binarycookies`.
- The dialog and the sidebar each write what they want (address, size, how often) to
  `~/.config/herdr-app/agent-office/want-modal.json` and `want-mini.json` every few seconds.
  The program follows the dialog while it's open, else the sidebar, and quits 15 seconds after
  neither asks, so it stops with Herdr, when Herdr is hidden and when both are switched off.
- The sidebar's office is a layout block of fixed height (`agent-office` in
  `layouts/main-custom.json`). The tab bar shows it only when there's an office to show, both
  switches are on and the sidebar is wider than its rail, and hides it otherwise.
- Pictures go to `~/.config/herdr-app/agent-office/frames/` under new names (Herdr caches an
  image by its path), keeping the last four; `status.json` names the newest and the page's
  state.
- Pictures are taken on their own timer and saved in the background, so saving one never
  delays the next; one identical to the last is dropped. The page draws at most 20 times a
  second for the dialog and 12 for the sidebar, which renders it small (420 high) since it's
  shown at about 150. On the real office the sidebar costs about 7% of one core; the dialog's
  ten pictures a second about 45%, plus Herdr's own drawing, only while it's open.
