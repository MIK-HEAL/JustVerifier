# Agnes Harness — Multi-Agent Workbench Design Contract

## 1. Scope

This contract governs the **multi-agent verification workbench** rendered by the `research-verifier` plugin inside the Agnes Web workbench. The page is a full-screen, three-region application shell:

- Left rail: **Agent palette**.
- Center: **orchestration canvas** with draggable agent nodes and dependency edges.
- Right rail: **configuration and trace inspector**.

The page is not a marketing surface. It is an operational, technical workbench. The design should read calm, precise, and instrument-like, closer to Dify or n8n than to a landing page.

## 2. Design tokens

The plugin already defines local CSS variables under `[data-agnes-multi-agent]`. Those tokens are the single source of truth for this page. Do not introduce raw colors, arbitrary radii, or unexplained spacing values.

### Color

| Token | Meaning | Typical use |
| --- | --- | --- |
| `--ma-page` | Page / canvas background | Workbench base |
| `--ma-card` | Elevated card surface | Nodes, panels, buttons |
| `--ma-border` | Structural border | Panels, nodes, inputs |
| `--ma-muted` | Secondary text | Labels, helper copy |
| `--ma-accent` | Primary interactive color | Selection, ports, primary actions |
| `--ma-danger` | Destructive / error | Delete actions, error states |
| `--ma-ok` | Success | Queued / successful states |
| `--ma-role-planner` | Planner identity | Planner nodes and palette chips |
| `--ma-role-executor` | Executor identity | Executor nodes and palette chips |
| `--ma-role-reviewer` | Reviewer identity | Reviewer nodes and palette chips |
| `--ma-role-verifier` | Verifier identity | Verifier nodes and palette chips |

All colors derive from Agnes theme variables (`--agnes-*`) with local fallbacks. Never hardcode brand hex values in component files.

### Typography

| Style | Size / weight | Use |
| --- | --- | --- |
| Display | 20px / 700 | Page title |
| Body-strong | 13px / 600 | Buttons, primary labels |
| Body | 12px / 400-700 | Node labels, panel copy, form text |
| Micro | 11px / 650 | Field labels, node role, helper text |
| Mono / code | 11px / 400 | Trace ids, checksums, plan references |

Use sentence case for user-facing copy. Avoid all-caps labels except status chips where the compact form carries meaning.

### Spacing

Base unit: `4px`.

- Component padding: `8px`, `10px`, `12px`.
- Intra-component gaps: `4px`, `7px`, `8px`, `12px`.
- Region gaps: `12px`, `14px`.
- Page padding: `20px 22px`.

### Radius

| Token scale | Value | Use |
| --- | --- | --- |
| Tight | `6px` | Small icon chips, inner controls |
| Medium | `7px`-`9px` | Inputs, buttons, agent cards |
| Node | `10px` | Agent node cards |
| Panel | `12px` | Panels and large surfaces |
| Pill | `999px` | Status chips, circular action buttons |

Circular controls must use a `1:1` width/height ratio and `border-radius: 50%` or `999px`. A circular action button is a primitive, not an ad-hoc style.

### Elevation

- Panels: flat card with 1px border and no large shadow.
- Nodes: two-layer soft shadow:
  - `0 1px 2px rgb(16 24 40 / 6%)`
  - `0 6px 16px rgb(16 24 40 / 6%)`
- Selected node: accent-tinted ring, not a heavier black shadow.
- Actionbar: compact card with 1px border, slight shadow, and backdrop blur when floating over the canvas.

### Canvas texture

The canvas uses a subtle radial dot grid:

- Dot color: `color-mix(--ma-border 80%, transparent)`
- Grid size: `18px 18px`
- Dot radius: `1px`

The grid must remain faint. It is a depth cue, not decoration.

## 3. Component anatomy

### 3.1 Agent palette card

A compact, draggable card used in the left rail.

- Layout: icon chip + label.
- States: default, hover (accent border), active/dragging.
- Interaction: click adds to canvas; drag places at pointer.
- No long descriptions in the card; the node and inspector carry context.

### 3.2 Agent node

A compact card representing one agent instance on the canvas.

- Layout:
  - Header: role icon + label.
  - Subline: node id.
  - Ports: input on the left, output on the right.
  - Floating actionbar: top-right, visible on hover or selection.
- States: default, hover, selected, connect-target, dragging, running, disabled.
- The node is draggable, selectable, and connectable. It must not contain hidden interactive dead zones.

### 3.3 Node actionbar

A floating actionbar anchored to the node's top-right edge, inspired by Dify.

- Visibility: `opacity`/`visibility` transition on node hover, node selection, or actionbar focus.
- Contents, in order:
  1. **Run this agent** — circular play button.
  2. **Delete node** — circular X button.
- Geometry:
  - Container: pill or compact rounded card.
  - Buttons: 20px circles with 1px border and transparent background.
  - Hover: accent-tinted background for run, danger-tinted background for delete.
  - Focus: visible accent ring.
- The actionbar must stop pointer events from propagating to the canvas drag layer.

### 3.4 Circular action button

A reusable control for compact canvas actions.

- 1:1 aspect ratio, circular border.
- Inline SVG icon with 1.5px stroke.
- No text glyph fallback; icons are SVG, not characters.
- Accessible name from `aria-label`, never from the glyph alone.
- States: default, hover, active, focus-visible, disabled.

### 3.5 Edge and edge delete

- Edge: cubic bezier path with accent-tinted stroke.
- Selected edge: brighter accent stroke and wider width.
- Delete affordance: circular SVG button at the edge midpoint, visible only when the edge is selected.
- The delete button uses the same circular action primitive as node actions.

### 3.6 Inspector

The right rail contains:

- Selected agent context.
- Agent-specific instruction field.
- Verification task field.
- Trace timeline.

The inspector is the only place for long-form text. Canvas nodes stay compact.

## 4. Interaction states

Every interactive element must have:

- A hover state that communicates affordance.
- A pressed/active state.
- A visible `focus-visible` state.
- A disabled state that still explains why the control is unavailable.

Node actionbar must also support pointer-independence: keyboard users can reach it through the node, and it remains visible while focused.

## 5. Motion

- Transition duration: `120ms` to `180ms`.
- Easing: `ease` or `ease-out`.
- Animated properties: `opacity`, `visibility`, `transform`, `box-shadow`, `border-color`, `background-color`.
- Do not animate layout properties (`width`, `height`, `top`, `left`).
- Actionbar reveal is a fade/scale transition, not an instant display swap.
- Port hover is a scale transition on `transform` only.

## 6. Accessibility

- Every icon-only control has an `aria-label`.
- Focus rings are visible and use `--ma-accent`.
- Keyboard users can:
  - select nodes and edges,
  - delete with `Delete` / `Backspace`,
  - close the overlay with `Escape`,
  - run a single agent from the inspector.
- Delete actions use `--ma-danger` only on hover/focus, not as a permanent red background.
- Tooltips are native `title` plus `aria-label`; no JavaScript tooltip library is introduced.

## 7. Single-agent direct run

The page supports two execution modes:

1. **Full graph verification** — the default “开始验证” action.
2. **Single-agent direct run** — a focused affordance that submits only the selected agent.

Single-agent direct run must:

- Be reachable from the node actionbar and the inspector.
- Clearly indicate that it runs only that agent, not the whole graph.
- Produce a trace entry and status update distinct from the full graph run.
- Not misuse the multi-agent plan contract. It uses its own backend request shape or a dedicated service.

## 8. Implementation boundaries

- React only via `createElement`; no JSX in bundled plugin files.
- Styling is plain CSS scoped under `[data-agnes-multi-agent]`.
- No Tailwind, shadcn, icon libraries, or animation libraries.
- Frontend modules are split by responsibility:
  - `agent-palette.js` owns the left agent rail.
  - `canvas.js` owns graph geometry and node placement.
  - `node-actions.js` owns the node actionbar and circular icon buttons.
  - `inspector.js` owns the right configuration and trace rail.
  - `use-verification-run.js` owns full-plan and single-agent execution state.
  - `workbench.js` owns only shell state, keyboard handling, and layout composition.
- All new tokens and reusable component patterns must be documented in this file before implementation.
- Public service or schema changes require compatibility notes in the plugin README and tests.

## 9. Visual QA checklist

Before merging:

- Node X is a true circle with an SVG cross, not a text glyph.
- Node actionbar appears on hover and selection without shifting node layout.
- Run and delete buttons are keyboard reachable and have visible focus rings.
- Single-agent run is visually and semantically distinct from full graph run.
- Trace entries clearly label `plan.created` and single-agent runs.
- No raw hex colors or unexplained spacing values are introduced.
- The page remains stable at 375px, 768px, and 1280px widths.
