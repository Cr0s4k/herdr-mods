# Tab bar: GitHub and feature toggles

## GitHub

**GitHub** in the tab bar opens the current project on GitHub: in a new Firefox tab when
Firefox is installed, otherwise in your default browser. It follows the focused terminal's
folder, including subfolders and worktrees, and reads HTTPS or SSH GitHub remotes. It prefers
`origin`, then the first GitHub fetch remote. Remote spaces read Git on their machine and
open the browser on this computer.

## Feature toggles

The switch icon in the tab bar, after GitHub, opens **Features**: on/off switches for parts
of the mods. Everything is on until you switch it off, and changes apply at once.

- **Commit message box**: the message field and Commit button at the bottom of Git's Changes tab.
- **Push and pull**: the branch bar with ahead/behind counts and Push/Pull in Git.
- **Loops**: the Loops button in the tab bar and its side panel.
- **Skills**: the Skills button in the tab bar and its side panel.
- **Watchers**: the Watchers button in the tab bar and its side panel. Off, watchers still
  check and notify.
- **Needs you**: the filter button at the top of the Spaces sidebar. Off, the sidebar always
  shows every space.
- **Terminals in the sidebar**: the terminals listed under their space, after its agents.
- **Recent conversations**: the Recent row under each space, with its folder's closed conversations.
- **Pipeline usage log**: the local note of which Pipeline buttons you press (`herdr-pipeline --usage` reads it).

Switches live in Herdr's shared state (`features`), so they survive restarts. To add one,
add a row to `FEATURES` in `mods/toggles/main.js` and check
`shared("features")?.<key> !== false` where the feature is drawn. The popup grows to fit
the new row.
