---
name: Herdr Mods
description: Native project tools that share Herdr's theme, controls and workspace density.
typography:
  body:
    fontSize: "13px"
  label:
    fontSize: "12px"
  compact-label:
    fontSize: "11.5px"
  metadata:
    fontSize: "11px"
rounded:
  badge: "4px"
  control: "6px"
  tab: "7px"
  task: "9px"
  panel: "10px"
spacing:
  inline: "6px"
  controls: "8px"
  stack: "12px"
  panel: "14px"
  section: "16px"
  inspector: "18px"
  canvas: "24px"
components:
  compact-button:
    typography: "{typography.compact-label}"
    rounded: "{rounded.control}"
    padding: "0 8px"
    height: "26px"
  task-button:
    typography: "{typography.compact-label}"
    rounded: "{rounded.control}"
    padding: "0 9px"
    height: "28px"
  pipeline-action:
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 11px"
    height: "32px"
  capture-search-input:
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 9px"
    height: "34px"
  workspace-tab:
    rounded: "{rounded.tab}"
    padding: "0 10px"
    height: "29px"
  pipeline-task-node:
    typography: "{typography.label}"
    rounded: "{rounded.task}"
    padding: "10px"
    width: "164px"
    height: "68px"
  pipeline-task-row:
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "10px"
---

# Design System: Herdr Mods

## Overview

**Creative North Star: "Herdr's native workspace"**

Herdr Mods extends a native GPUI desktop workspace. Its controls, typography, focus behavior and semantic colors belong to Herdr. The visual character is compact, quiet and practical: clear text, small icons, restrained rounding and thin separators keep project context close to terminal work.

Pipeline inherits this system. Its approved spatial constellation gives dispatch room to be understood, while its controls and inspector keep the same native character. This document records the incumbent implementation; it introduces no new visual identity or raster artwork. Pipeline's surface strategy remains in [its direction contract](docs/pipeline.md).

**Key Characteristics:**

- Dynamic host theme and inherited UI font.
- Compact controls, explicit states and keyboard access.
- Flat surfaces separated by tone and thin strokes.
- Spatial geometry for Pipeline, with scrolling for constrained panes.

The frontmatter records observed reusable measurements. Its `px` strings represent GPUI logical lengths before Herdr applies zoom; they are not a CSS implementation. Color and font-family primitives are intentionally absent because the host supplies them dynamically. Code remains the implementation authority: [Tasks](mods/plane/main.js), [ticket primitives](mods/plane/tickets.js), [Loops](mods/loops/main.js), [workspace tabs](mods/tabs-show/main.js), [Pipeline](mods/pipeline/main.js) and [Pipeline geometry](mods/pipeline/geometry.js).

## Colors

The palette follows the active Herdr theme. Obtain `t = theme()` during render and bind semantic roles directly; hue names and fixed color values would misrepresent this system.

### Primary

- **Host accent — `t.accent`:** Pipeline's primary action, planner outline and icon, active task indicators, quota fill and focused or selected node borders.
- **Accent foreground — `t.accent_foreground`:** Text and icons on filled accent actions.
- **Solid action — `t.solid` / `t.solid_foreground`:** Existing Tasks create and launch actions. Preserve this incumbent pair where it is already used.

### Neutral

- **Workspace and canvas — `t.background`, `t.canvas`, `t.chrome`:** Native panel background, Pipeline's scene background and workspace tab-bar background respectively.
- **Surface and raised — `t.surface`, `t.raised`:** Pipeline nodes, buttons and inspector; compact existing controls, active tabs, badges and quiet progress tracks.
- **Input — `t.input`:** Editable native fields.
- **Foreground and muted — `t.foreground`, `t.muted`:** Main content and secondary metadata. `t.dim` serves unavailable workspace actions, gutter line numbers and decorative dots only, never text someone needs to read.
- **Chrome labels — `brighter(t)`:** The labels of the tab bar, status bar and sidebar footer use `muted` blended 35% towards `foreground` (about 9:1 in Catppuccin dark). It lives in `mods/tabs-show/ui.js`, symlinked into the mods that use it.
- **Text on a fill — `ink(fill)`:** Letters on a colored fill (space badges, Show markers) take white or near-black, whichever contrasts more with that fill.
- **Border — `t.border`:** Single-stroke panel edges, row separators, scene connections and planner orbit.
- **Hover and selection — `t.hover`, `t.selected`:** Pointer feedback and persistent chosen state. These roles remain distinct.

### State roles

Pipeline binds queued tasks to `t.muted`, active tasks to `t.accent`, review and merging to `t.ansi5`, open pull requests to `t.ansi4`, completed tasks to `t.ansi2`, and failures and tasks waiting for your answer to `t.blocked`. A waiting task's **Needs you** pill matches the sidebar's: `t.blocked` text on `t.blocked` at 15% (`"26"` alpha), 11 semibold. Its quota-wait indicator also uses `t.blocked`. These are host bindings, not a new palette; `ansi2` and `ansi5` can change with the theme. Existing panels also use host status roles such as `t.working` and `t.done` in their own contexts.

**The Native Theme Rule.** Resolve colors from Herdr at render time; preserve semantic foreground/background pairs instead of freezing a screenshot's palette.

**The State Has Words Rule.** Pair state color with a readable label, icon or accessible name. A colored dot alone does not explain dispatch, waiting, failure or review.

## Typography

Use the UI font inherited from Herdr. The inspected mods set size and native weight helpers without choosing a font family. There is no separate display family or new monospace treatment.

The frontmatter's body, label, compact-label and metadata roles describe the recurring scale. Medium and semibold GPUI helpers establish hierarchy within that scale; they do not imply a replacement font or a universal numeric weight override.

Pipeline adds local emphasis: its page title uses semibold (23 logical px), inspector heading semibold (14), task detail title semibold (18), quota figure semibold (29), and stepper value semibold (16). Task identifiers, status lines and repository metadata use the metadata size (11). Task titles use medium weight at the label size. Descriptions and the planner explanation use a line-height multiplier (1.5).

No readable text goes below 11; only Pipeline's particle glyphs (9) do. Keep action labels in sentence case. Truncate compact canvas labels and tab titles where the implementation does; the inspector supplies fuller task content. Existing Tasks list titles may occupy two lines. Avoid promoting these surface-specific choices into a new global type scale.

## Layout

Native panels fill the available pane. Shrinkable flex containers use `min_w(0)` and `min_h(0)` so text truncation and owned scroll areas can work. Tasks and Loops use compact horizontal headers, panel gutters and vertically scrolling lists; Tasks must remain usable at its declared minimum width (280 logical px). Existing large ticket lists use the native virtual-list pattern.

The named spacing primitives describe observed gaps and gutters, not a requirement to snap every value to a new grid. Preserve the differences between compact workspace chrome, ordinary side panels and Pipeline's more spacious canvas.

### Pipeline geometry

Pipeline has two bars around the scene. The top bar (50 high) holds the title, the Demo badge while the simulation shows, the New task field and intake controls (in Live, Add from tickets and one chip naming the agent, the parallel limit and usage, which opens Settings), speed, motion, settings and the run action. Below width 1340 the field and intake controls move to their own horizontally scrollable row (46) under it, and the freed space in the top bar names the project. The bottom status bar (36, horizontally scrollable) holds state, the latest activity line (which opens the activity log) and the actions that need you. The scene receives the remaining height (86 less than the view, 132 below width 1340). All dimensions here are logical units.

The scene has two layouts, switched by the view button in the top bar and remembered locally: the map (default) and the board. The board is three equal columns (Queue, Working, Review) filling the width, minimum 680 in all, each a bordered list that scrolls on its own, under a 36-high row with the plan line and the completed count. It uses the map's cards unchanged; free work slots are 40-high dashed placeholders, and pull requests follow the review cards under their own heading.

The canvas is a stable coordinate field with both-axis scrolling. Its minimum height is 420. Its minimum width is 940 for up to three visible slots and 1180 for more than three. Larger available dimensions expand the field. Lowering the parallel limit preserves occupied higher-numbered slots: the visible slot count is the greater of the current limit and the highest active slot plus one. That count also determines the canvas minimum width.

- Planner center: `x = 0.35w`, `y = 0.5h`.
- Work slots sit on orbits around the planner: the first three on an inner orbit (radius `0.25w`, clamped to 210–300), further slots on an outer orbit (inner + 200, reduced to keep clear of review). Slot `i` sits at angle `[0, −spread, +spread][i % 3]`, where `spread = asin(min(0.78, (h/2 − 54) / radius))`. The orbits are drawn as dashed arcs on the planner's right.
- Queue preview: as many tasks as fit, centered at `x = 112`, `y = 92 + 76i`. When more are queued, the last place becomes a +N more action. The Queue action always opens the full scrollable list.
- Review preview: as many review, merging or failed tasks as fit at `x = w − 112`, `y = 92 + 88i`, with the same +N more overflow. The Review action opens the review list.
- Completed constellation: the latest completed tasks as stars linked by a thin line, from `x = w − 44`, `y = h − 66` leftwards in steps of 30 with a fixed vertical wave, stopping clear of the lowest slot. The completed action opens the full list.
- The plan explanation sits above the planner, between the queue and the top slot.

Connection paths and clickable task nodes share these coordinates. Preserve that shared geometry so visual paths agree with their targets.

### Narrow panes and zoom

Below width 820, the header hides its standalone Motion action; motion remains available in Settings. The controls row and the status bar scroll horizontally. Keyboard hints live in the keys overlay (`?`, or the status bar's small Keys action: a 380-wide panel on the Settings backdrop, one row per key with the key in a raised chip) and in Settings.

The inspector is 330 wide, capped at the pane width minus 16. Above width 1180 it sits beside the scene and its width is subtracted from the available canvas width. At or below that threshold it overlays the scene's right edge. Its body owns vertical scrolling; task rows must retain their content height so every queue entry stays reachable.

Settings is a modal, not an inspector drawer: a panel up to 880 × 680 (the pane minus 32 each way), centred over the whole view on a 50% black backdrop, with the panel rounding and a fixed header naming the repository and branch. A 180-wide section list (Live: Agent, Planner, Repositories, Checks and Try it, Delivery, Ticket updates, General; Simulation: Pipeline, Simulation, General) sits left of a scrolling page whose content is capped at 640 wide; below a 620-wide panel the sections become a scrolling row above the page. The Agent and Parallel controls open it on the section that holds them. Pressing the backdrop or Escape closes it, and scene shortcuts wait while it is open. On/off settings use switch rows.

Herdr reports painted bounds while builder lengths are zoomed by the host. Pipeline divides measured width and height by `Number(settings().zoom) || 1` before computing geometry and breakpoints. Keep all scene, drawer and breakpoint calculations in this same logical coordinate space. Native `loop()` lengths are the exception: they are not zoomed, so multiply any looped `left`, `top`, `width` or `height` by the zoom.

### Live mode

Live is what a project opens in, and its header has no mode switch: Try a demo in Settings, General, opens the simulation. The simulation's header carries a Demo pill (flask, `t.ansi3` on its 15% tint) and, with a project folder, a small Exit demo action. Live keeps the same scene: the queue holds typed tasks for the project's repository, slots hold real agents (no stage bars, since real work has no known length), review cards carry Merge, and waiting agents show the Needs you pill with Answer (opens the agent's terminal) or Trust (for the folder-trust prompt). The live inspector shows the agent's latest screen in the terminal font on `t.background`, a message field that types into the agent, the branch's change summary, Merge, and a Discard that asks twice. Live omits Examples, Watch, Quota, speed and the delivery toggle; the status strip names the branch merges go into. In their place the command row has the agent, Plane and Linear actions; each source action reads `<Source> · <state>` and stays selected while a state is watched. The Plane drawer puts Watch a state (small state actions, completed and canceled states left out) above Pick tickets (search, Queue N tickets, Refresh and selectable ticket rows; tickets already in Pipeline are dimmed and disabled). An unlinked repository or missing connection replaces both with one explanation and an Open the Tasks panel (or Linear panel) action. The Linear drawer adds filters above both: small My tickets / Unassigned / All tickets actions, a team line with Choose team (or Change team) and Clear, then a project line with Choose project and Clear. The searchable team and project lists each have Back. Team selection is saved per pipeline, qualifies issue requests and the project list by that team, and clears the selected project when changed. A selected team's workflow states remain available even when no tickets match. State actions are disabled with an explanation until the filter is My tickets, a team or a project; a watch retains its scope, team and project filter. Live settings hold Check before review: a command field in the terminal font with Save, up to three Use <command> suggestions found in the repository, and a toggle between sending failures back to the agent and waiting. A checking task keeps its slot as Running checks, with ansi5 particles towards review; Checks failed docks in the review column with Fix, and its inspector shows the output in the terminal-font block with Ask the agent to fix it, Review anyway and Run checks again. Live settings choose Delivery with two small actions, Merge locally or Open a pull request; with pull requests the approve actions read Open PR and Open N PRs, the status strip names the PR target, and a task whose PR is open moves to a Pull requests section under the review cards, headed by a hairline and a small Pull requests · N action that opens the list. Its card has a #N link action and no halo, since it waits on GitHub rather than on you; its status line names what the PR waits for, in `t.blocked` for conflicts, failing checks or requested changes, `t.ansi2` when ready to merge, and muted otherwise. The inspector shows Checks, Review and Merge rows, each with a dot in the same tones. Under Delivery, pull requests add an Open pull requests automatically toggle in the auto-trust style.

## Elevation & Depth

The inspected native components use flat surfaces, tonal layering and thin borders. They define no custom shadow vocabulary. Selected backgrounds, accent borders and the inspector's opaque surface carry hierarchy; the overlay inspector keeps its separating border. Pipeline's single-stroke curves and dashed planner orbit remain quiet background structure rather than elevated decoration.

## Shapes

Use the frontmatter's control rounding for buttons, fields and inspector rows; tabs, task nodes and outer standalone panels have their own observed radius roles. Embedded Tasks and Loops panels omit the standalone outer rounded border.

Pipeline's round planner is a circle (110 diameter), surrounded by a dashed orbit (86 radius, dash pattern 3/7) and three faint accent glows (radii 112, 180, 260). Standard task nodes share the frontmatter's task silhouette; review cards are taller (78) to hold their action, and empty slots use a dashed outline. A routing task is a small comet (18 diameter) on the planner orbit; a completed task is a star (16). Status dots are small circles (normally 6 diameter). Most boundaries and paths use a single logical-unit stroke; busy paths are accent at 1.5.

Icons are native SVG assets tinted with host semantic colors. Pipeline's ordinary action icons are 15; header and planner icons are larger (24 and 27). Preserve the existing vector vocabulary. No shipping raster assets were introduced for Pipeline.

## Components

### Native buttons and fields

Build actions with `gpui-base`'s `Button` and editable fields with `Input` / `InputState` or `Textarea` / `TextareaState`. Reuse native event, disabled, tooltip and focus behavior.

Compact Loops controls use the compact-button measurements; Tasks controls use task-button measurements. Their quiet default is raised with muted text, selection uses selected with foreground text, and hover uses hover with foreground text. Workspace tab and panel actions use the denser chrome context.

Pipeline actions use the pipeline-action measurements, with narrower horizontal padding for icon-only actions (8). Default actions use surface, border and foreground; selected actions use selected. Primary actions pair accent with accent foreground. Hover uses hover for ordinary actions; primary fill stays accent. Focus changes the border to accent. Disabled actions use the native disabled state and reduced opacity (0.45). Supply accessible names for icon-only actions and a tooltip when its purpose needs explanation. Icon and glyph actions everywhere carry both, and clickable targets are at least 24 square.

Pipeline search and Plane capture fields use capture-search-input measurements, input fill and border. Tasks list search is slightly shorter (32 high). Preserve native editing and focus behavior rather than drawing substitute text fields.

### Workspace navigation

Tabs use the workspace-tab silhouette with compact type (12.8), a small icon (14) and truncated names (maximum width 170). Active tabs use raised, border and foreground; inactive tabs use chrome and muted. Horizontal scrolling keeps the tab strip accessible as space runs out. Existing panel toggles use selected to indicate the open panel.

### Pipeline task nodes and inspector rows

Task nodes combine an identifier and repository line, medium task title and explicit status: a short wait reason in the queue, the stage and slot while active, and how many PRs remain in review. Active cards carry a stage progress bar. Review cards carry one-click Approve (all of the task's PRs) and failed cards Retry, as small primary or default actions in the bottom-right corner; these stop the press so the card underneath is not inspected. Selected nodes use selected fill with an accent border; hover uses hover fill and an accent border; keyboard focus also accents the border. Tooltips expand the title and status or queue wait reason. Accessible labels include task identity and state.

Inspector task rows use the pipeline-task-row measurements, grow to fit their contents and live in a vertically scrolling body. Their selected state uses selected fill and an accent border, with a check in the picker. Queue preview limits never limit access to the full queue.

The inspector uses a bordered surface, a fixed header with a close action, and a shrinkable scrolling body. Closing it returns focus to the scene handle. Escape closes the inspector or leaves the New task field. With the scene handle focused, Space toggles intake, N focuses New task, A opens example tasks, Q opens the next question, Y approves everything waiting, R retries failed tasks and S cycles speed (1×, 2×, 4×). Shortcuts only fire from the scene handle, so they never interfere with native text editing. The New task field keeps focus after Enter, so several tasks can be typed in a row.

The status strip shows Answer N questions, Approve N tasks and Retry N failed only while there is something to act on, beside a PR approval / Auto-merge toggle.

A task waiting for input keeps its slot as a taller card (78) with the Needs you pill, a pulsing `t.blocked` halo, a paused bar and an Answer action. Its inspector leads with the question in a `t.blocked` outlined block: numbered options as full-width actions (number keys choose them while the scene handle has focus), then a field for a typed answer and Send. Answering resumes the task from where it paused and opens the next question, if any. The workspace tab bar's Pipeline action shows a Needs you count across all pipelines, and the tracker raises one warning toast per new question unless a Pipeline view has focus.

### Pipeline planner and motion

The central planner combines an accent outline and icon with a title, brief state text and a separate plan explanation below. In Live it is a button whose title and outline name what waits for the person (`t.blocked` for questions and stopped tasks, ansi5 for reviews, accent otherwise). Slot placeholders stay in fixed positions; occupied slots continue to exist when the concurrency limit is reduced.

All motion is native; the script never renders frames.

- Node transitions move `left` and `top` over 620 ms `ease-in-out` and resize over 320 ms `ease-out`: a task appears as a comet on the planner orbit, launches into its slot as a card, docks in review and shrinks into a star.
- The inspector fades in over 160 ms `ease-out`: it renders once transparent, then a follow-up render targets full opacity.
- Stage progress bars render the current progress, then a single follow-up render targets full width with a linear transition for the remaining stage time. A bar's identity includes its stage start, so speed changes and resumed pauses relaunch it.
- Busy paths carry comet particles: glyph samples along the curve run `frames()` with phase-shifted lists on Herdr's shared clock, so the head travels one way with a two-step tail. Dispatch is accent, checks ansi5 and merges ansi2.
- While the pipeline runs, a moon orbits the planner ring (spin 7000 ms), an electron circles closer (3200 ms) and a corona pulses outwards (3200 ms). Paused, they rest.
- A starfield (about one star per 11000 square units) and completed stars twinkle with opacity loops; review cards waiting for you carry a still ansi5 halo (only a task that needs you pulses); active cards spin a small satellite.

Motion runs only when the local motion preference is on, system Reduce Motion is off and the app window is active. Outside Pipeline, working spinners go through `spin()` in `ui.js`, which leaves them still under Reduce Motion. The current system preference check is macOS-specific. Turning motion off removes particles and loops, keeps every label and state, and shows progress at the last render.

## Do's and Don'ts

### Do:

- **Do** use Herdr's dynamic semantic theme roles and inherited UI font.
- **Do** reuse native buttons, fields, tooltips, focus handles and list scrolling.
- **Do** keep state names visible alongside color and explain why work waits.
- **Do** normalize painted bounds by app zoom before applying Pipeline geometry.
- **Do** preserve occupied work slots and full queue access when limits or pane sizes change.
- **Do** preserve immediate, understandable state updates when motion is disabled.

### Don't:

- **Don't** freeze host colors or the UI font into a separate mod identity.
- **Don't** replace native controls with web-style imitations or inferred browser tokens.
- **Don't** turn Pipeline's constellation into a required layout for ordinary list panels.
- **Don't** hide queued work behind the canvas preview's item limit.
- **Don't** add decorative shadows or raster artwork to describe this incumbent system.
