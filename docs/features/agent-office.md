# Agent Office

Your team's agent office inside Herdr: the web page where everyone's Claude Code sessions sit
at their desks, type, wait for a human and walk to the coffee counter.

- **The building button** in the tab bar, after Pipeline, opens the office in its own window
  over Herdr, at nine tenths of Herdr's window. So does **Agent Office** in the command
  palette (⇧⌘P). It's the real page, live and clickable: claim a desk, join, sign in. Esc
  (when no DESKS or JOIN panel is open), ⌘W, the close button or going back to Herdr hides it.
  **Reload** (⌘R) and **Open in browser** are at its top right.
- **The sidebar**: a small live office at the bottom of the left sidebar, above Settings,
  refreshed every second. Click it to open the window. It hides while the sidebar is
  collapsed to its rail.

## Which office

The address you set in **Agent Office address…** (command palette), else the one Claude Code's
office hook sends events to: `OFFICE_URL` in `~/.claude/settings.json`, without its `/events`.
Only that value is used; the token never is. An address with the office's read key (`?key=…`)
needs no sign-in.

With neither, the sidebar shows no office and the building button asks for an address. Clear
the field and save to go back to the hook's.

## Signing in

An office behind Google sign-in shows its sign-in page in the window, and the sidebar says
**Sign in to see it**. Sign in there once; it's kept as a browser keeps a sign-in.

## Switches

Under the tab bar's switches: **Agent Office** (the button, the window and the sidebar's
office) and **Agent Office in the sidebar** (that one only). Both are on until you switch them
off.

## How it works

Herdr can't show a web page, so a small macOS program runs the office in WebKit. The window
is that program's own; the sidebar shows pictures of it, since a mod can only show images.

- `mods/agent-office/view.swift` is compiled on first use to
  `~/.cache/herdr-agent-office/herdr-agent-office` (it needs Xcode's command line tools, as
  Show does), and again whenever the source is newer. WebKit keeps its sign-in under that
  name, in `~/Library/HTTPStorages/herdr-agent-office.binarycookies`.
- Requests go through `~/.config/herdr-app/agent-office/`: the building button writes
  `show.json` (starting the program if it isn't running), and the sidebar rewrites
  `want-mini.json` every few seconds with its size. The program places the window over
  Herdr's (found by its owner, no screen recording needed) and quits 15 seconds after the
  window is hidden and the sidebar stops asking, so it stops with Herdr, when Herdr is hidden
  and when both are switched off.
- Between uses the window is fully see-through and lets clicks through, but stays on screen:
  off screen or ordered out, WebKit stops drawing.
- The sidebar's office is a layout block of fixed height (`agent-office` in
  `layouts/main-custom.json`). The tab bar shows it only when there's an office to show, both
  switches are on and the sidebar is wider than its rail.
- Its pictures go to `frames/` under new names (Herdr caches an image by its path), keeping
  the last four; one identical to the last is dropped, and `status.json` names the newest and
  the page's state.
- The page draws at most 30 times a second in the window and 12 for the sidebar, which renders
  it small (420 high) since it's shown at about 150. On the real office the sidebar costs
  about 7% of one core and the open window about 24%; Herdr itself does nothing extra.
