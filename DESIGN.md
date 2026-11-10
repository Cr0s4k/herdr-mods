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
- **Foreground and muted — `t.foreground`, `t.muted`:** Main content and secondary metadata. `t.dim` serves unavailable workspace actions.
- **Border — `t.border`:** Single-stroke panel edges, row separators, scene connections and planner orbit.
- **Hover and selection — `t.hover`, `t.selected`:** Pointer feedback and persistent chosen state. These roles remain distinct.

### State roles

Pipeline binds queued tasks to `t.muted`, active tasks to `t.accent`, review and merging to `t.ansi5`, completed tasks to `t.ansi2`, and failures to `t.blocked`. Its quota-wait indicator also uses `t.blocked`. These are host bindings, not a new palette; `ansi2` and `ansi5` can change with the theme. Existing panels also use host status roles such as `t.working` and `t.done` in their own contexts.

**The Native Theme Rule.** Resolve colors from Herdr at render time; preserve semantic foreground/background pairs instead of freezing a screenshot's palette.

**The State Has Words Rule.** Pair state color with a readable label, icon or accessible name. A colored dot alone does not explain dispatch, waiting, failure or review.

## Typography

Use the UI font inherited from Herdr. The inspected mods set size and native weight helpers without choosing a font family. There is no separate display family or new monospace treatment.

The frontmatter's body, label, compact-label and metadata roles describe the recurring scale. Medium and semibold GPUI helpers establish hierarchy within that scale; they do not imply a replacement font or a universal numeric weight override.

Pipeline adds local emphasis: its page title uses semibold (23 logical px), inspector heading semibold (14), task detail title semibold (18), quota figure semibold (29), and stepper value semibold (16). Task identifiers, status lines and repository metadata use smaller type (9–10). Task titles use medium weight at the label size. Descriptions and the planner explanation use a line-height multiplier (1.5).

Keep action labels in sentence case. Truncate compact canvas labels and tab titles where the implementation does; the inspector supplies fuller task content. Existing Tasks list titles may occupy two lines. Avoid promoting these surface-specific choices into a new global type scale.

## Layout

Native panels fill the available pane. Shrinkable flex containers use `min_w(0)` and `min_h(0)` so text truncation and owned scroll areas can work. Tasks and Loops use compact horizontal headers, panel gutters and vertically scrolling lists; Tasks must remain usable at its declared minimum width (280 logical px). Existing large ticket lists use the native virtual-list pattern.

The named spacing primitives describe observed gaps and gutters, not a requirement to snap every value to a new grid. Preserve the differences between compact workspace chrome, ordinary side panels and Pipeline's more spacious canvas.

### Pipeline geometry

Pipeline has a title region (86 high), horizontally scrollable controls (52), a horizontally scrollable status strip (37), a flexible scene viewport and an activity footer (44). The scene receives the remaining height after these fixed regions (219 total). All dimensions here are logical units.

The canvas is a stable coordinate field with both-axis scrolling. Its minimum height is 540. Its minimum width is 900 for up to three visible slots and 1200 for more than three. Larger available dimensions expand the field. Lowering the parallel limit preserves occupied higher-numbered slots: the visible slot count is the greater of the current limit and the highest active slot plus one. That count also determines the canvas minimum width.

- Planner center: `x = 0.37w`, `y = 0.49h`.
- Work slots: first three at `x = 0.61w`, further slots at `x = 0.76w`; rows repeat at `y = 0.26h`, `0.50h`, `0.74h`.
- Queue preview: first five tasks centered at `x = 112`, `y = 100 + 80i`. The Queue action always opens the full scrollable list; more than five entries also exposes a View all action.
- Review preview: first four review, merging or failed tasks at `x = w − 112`, `y = 110 + 91i`. The Review action opens task activity.
- Completed trail: latest three completed nodes at `x = w − 112 − 32i`, `y = h − 54`, with full history accessible from the completed action.

Connection paths and clickable task nodes share these coordinates. Preserve that shared geometry so visual paths agree with their targets.

### Narrow panes and zoom

Below width 790, the header hides its standalone Motion action; motion remains available in Settings. Controls and the status strip scroll horizontally. The footer's secondary simulation note appears only above width 800.

The inspector is 330 wide, capped at the pane width minus 16. Above width 1180 it sits beside the scene and its width is subtracted from the available canvas width. At or below that threshold it overlays the scene's right edge. Its body owns vertical scrolling; task rows must retain their content height so every queue entry stays reachable.

Herdr reports painted bounds while builder lengths are zoomed by the host. Pipeline divides measured width and height by `Number(settings().zoom) || 1` before computing geometry and breakpoints. Keep all scene, drawer and breakpoint calculations in this same logical coordinate space.

## Elevation & Depth

The inspected native components use flat surfaces, tonal layering and thin borders. They define no custom shadow vocabulary. Selected backgrounds, accent borders and the inspector's opaque surface carry hierarchy; the overlay inspector keeps its separating border. Pipeline's single-stroke curves and dashed planner orbit remain quiet background structure rather than elevated decoration.

## Shapes

Use the frontmatter's control rounding for buttons, fields and inspector rows; tabs, task nodes and outer standalone panels have their own observed radius roles. Embedded Tasks and Loops panels omit the standalone outer rounded border.

Pipeline's round planner is a circle (110 diameter), surrounded by a dashed orbit (86 radius, dash pattern 3/7). Standard task nodes and empty slot outlines share the frontmatter's task silhouette. Routing and completed nodes become small circles (20 diameter). Status dots are small circles (normally 6 diameter); active pulse marks are smaller (3). Most boundaries and paths use a single logical-unit stroke.

Icons are native SVG assets tinted with host semantic colors. Pipeline's ordinary action icons are 15; header and planner icons are larger (24 and 27). Preserve the existing vector vocabulary. No shipping raster assets were introduced for Pipeline.

## Components

### Native buttons and fields

Build actions with `gpui-base`'s `Button` and editable fields with `Input` / `InputState` or `Textarea` / `TextareaState`. Reuse native event, disabled, tooltip and focus behavior.

Compact Loops controls use the compact-button measurements; Tasks controls use task-button measurements. Their quiet default is raised with muted text, selection uses selected with foreground text, and hover uses hover with foreground text. Workspace tab and panel actions use the denser chrome context.

Pipeline actions use the pipeline-action measurements, with narrower horizontal padding for icon-only actions (8). Default actions use surface, border and foreground; selected actions use selected. Primary actions pair accent with accent foreground. Hover uses hover for ordinary actions; primary fill stays accent. Focus changes the border to accent. Disabled actions use the native disabled state and reduced opacity (0.45). Supply accessible names for icon-only actions and a tooltip when its purpose needs explanation.

Pipeline search and Plane capture fields use capture-search-input measurements, input fill and border. Tasks list search is slightly shorter (32 high). Preserve native editing and focus behavior rather than drawing substitute text fields.

### Workspace navigation

Tabs use the workspace-tab silhouette with compact type (12.8), a small icon (14) and truncated names (maximum width 170). Active tabs use raised, border and foreground; inactive tabs use chrome and muted. Horizontal scrolling keeps the tab strip accessible as space runs out. Existing panel toggles use selected to indicate the open panel.

### Pipeline task nodes and inspector rows

Task nodes combine an identifier and repository line, medium task title and explicit status. Selected nodes use selected fill with an accent border; hover uses hover fill and an accent border; keyboard focus also accents the border. Tooltips expand the title and status or queue wait reason. Accessible labels include task identity and state.

Inspector task rows use the pipeline-task-row measurements, grow to fit their contents and live in a vertically scrolling body. Their selected state uses selected fill and an accent border, with a check in the picker. Queue preview limits never limit access to the full queue.

The inspector uses a bordered surface, a fixed header with a close action, and a shrinkable scrolling body. Closing it returns focus to the scene handle. Escape closes the inspector; Space toggles intake when the scene handle has focus; A opens task intake. Do not let scene shortcuts interfere with native text editing.

### Pipeline planner and motion

The central planner combines an accent outline and icon with a title, brief state text and a separate plan explanation below. Slot placeholders stay in fixed positions; occupied slots continue to exist when the concurrency limit is reduced.

Native node transitions move `left` and `top` over 750 ms with `ease-out`, and resize `width` and `height` over 400 ms with `ease-out`. Active task marks loop opacity from 0.35 to 1 over 1400 ms. Motion runs only when the local motion preference is on, system Reduce Motion is off and the app window is active. The current system preference check is macOS-specific. Turning motion off preserves immediate state changes and all labels.

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
