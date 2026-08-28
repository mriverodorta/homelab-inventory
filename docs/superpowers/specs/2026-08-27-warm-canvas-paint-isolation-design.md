# Warm Canvas Paint Isolation

## Problem

The warm Canvas surface pool keeps recently used Canvas workspaces mounted so switching between them is immediate. Parked layers currently rely on `visibility: hidden`. React Flow descendants explicitly set `visibility: visible`, which can override inherited visibility and allow nodes from a parked Canvas to paint over the active Canvas.

Production inspection confirmed that a parked layer was correctly marked `aria-hidden`, inert, and non-interactive while thousands of descendants still computed to `visibility: visible`.

## Design

Keep every retained Canvas mounted and measurable. Isolate its rendered output at the layer boundary:

- Active layer: `opacity: 1`, `visibility: visible`, pointer events enabled, and the active stacking level.
- Parked layer: `opacity: 0`, `visibility: hidden`, pointer events disabled, inert, `aria-hidden`, and a lower stacking level.

Ancestor opacity applies to the composed subtree and cannot be overridden by a descendant. This prevents parked React Flow nodes, edges, controls, portals within the layer, or other descendants from painting while preserving their mounted state and dimensions. The existing parked-runtime suspension remains unchanged.

`display: none` is intentionally not used because removing measurable dimensions can cause React Flow to remeasure or reinitialize when the Canvas becomes active. Parked canvases are not unmounted because that would restore the previous loading delay.

## Behavior

- Exactly one retained Canvas layer is visually active.
- Parked canvases cannot paint, receive pointer input, or retain focus.
- Switching through Systems does not discard retained Canvas surfaces.
- Reopening a warm Canvas preserves its viewport and avoids loading states.
- Canvas data, assignments, placements, cables, route caches, and persistence are unchanged.

## Verification

Add component regressions that render a parked descendant with explicit `visibility: visible` and assert the layer-level opacity, visibility, stacking, pointer, inert, and accessibility states. Exercise repeated Canvas-to-Canvas and Canvas-to-Systems transitions and assert one active layer after every transition.

After local lint, focused tests, full tests, and build pass, verify production behavior on `inv.hkloud.org` by repeatedly switching the existing Canvas tabs and inspecting the layer state. Do not mutate live inventory data during verification.
