# Unified Canvas Zoom Range

## Problem

The editable Homelab Inventory Canvas currently permits zoom levels from 25% to 180%, while the LabGD Canvas viewer permits 10% to 200%. The inconsistent limits make large layouts harder to review in the application and cause shared and local views to behave differently.

## Design

Standardize every current Canvas surface on a 10% minimum zoom and 200% maximum zoom:

- Homelab Inventory editable Canvas: `minZoom={0.1}` and `maxZoom={2}`.
- LabGD viewer Canvas: retain its existing `minZoom={0.1}` and `maxZoom={2}`.

Keep the limits explicit at each React Flow boundary. There are only two current Canvas surfaces, so introducing a cross-package zoom-configuration abstraction would add coupling without meaningful reuse.

## Behavior

- Mouse-wheel, touchpad, pinch, and React Flow zoom controls may zoom out to 10%.
- The same interactions may zoom in to 200%.
- Fit-to-view behavior remains unchanged and respects the configured limits.
- Existing saved viewport values remain valid; React Flow constrains interaction to the new range.
- Canvas placement, routing, selection, warm-surface retention, and persistence remain unchanged.

## Verification

Add regression coverage that asserts both React Flow surfaces expose a minimum zoom of 0.1 and a maximum zoom of 2. Run the focused Canvas tests, lint, full test suite, and production build.
