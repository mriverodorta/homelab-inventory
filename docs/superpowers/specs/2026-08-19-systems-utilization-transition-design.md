# Systems Utilization Transition Design

## Goal

Animate CPU, memory, and storage utilization changes in the Systems workspace so data-bearing SSE updates feel continuous instead of causing abrupt meter jumps.

## Scope

This change is limited to the shared `SystemsUtilizationBar` presentation component. It does not change telemetry collection, persistence, SSE topics, payloads, query caching, polling behavior, or backend contracts.

## Behavior

- The first rendered value appears immediately. Opening the Systems workspace must not animate every meter from zero.
- A later value received through the existing Systems SSE data flow animates from the currently displayed value to the new value over 600 milliseconds.
- The meter width and whole-number percentage label progress together.
- The transition uses ease-out timing so it responds quickly and settles smoothly.
- If a new value arrives before the current transition finishes, the old transition is cancelled and the new transition begins from the current displayed position. It must not jump back to the previous target.
- Values remain clamped to the inclusive 0–100 range.
- Unchanged values do not start another transition.
- Storage warning and critical colors follow the displayed value during the transition so visual severity and the percentage label remain synchronized.
- CPU, memory, and storage retain their current colors, quarter markers, stable 3.5-character percentage track, 125-pixel minimum width, and accessible utilization label.
- Users with `prefers-reduced-motion: reduce` receive the new value immediately with no interpolation or CSS transition.
- Unmounting a row cancels any pending animation frame and performs no later state update.

## Architecture

`SystemsUtilizationBar` will retain the latest displayed percentage as local presentation state. The incoming `value` remains the authoritative target.

The bar fill uses a CSS width transition for compositor-friendly movement. A small `requestAnimationFrame` interpolator updates the whole-number percentage label over the same 600-millisecond interval. Both use the same ease-out function. The component stores the current interpolated value in a ref so an interrupted transition can start from the exact visual position without relying on a stale render.

Reduced-motion detection is local to the component through `window.matchMedia`. The component must handle environments where `matchMedia` is unavailable, including server rendering and tests, without failing.

No timer or animation state belongs in the Systems query hook. TanStack Query continues to accept authoritative row updates from the existing SSE subscription, and only the affected meter component animates.

## Error And Edge Handling

- Non-finite values are normalized before rendering and never produce invalid widths.
- Values below zero render as zero; values above 100 render as 100.
- An update that rounds to the same label may still move the bar when the normalized fractional value changed.
- Reordered or virtualized rows retain normal React lifecycle behavior; animation state is not persisted across unmounts.
- Rapid updates replace the active target rather than queuing animations.

## Testing

Component tests will use controlled animation frames and cover:

1. Initial values render immediately without animation.
2. Increasing values animate the bar and percentage together.
3. Decreasing values animate in the reverse direction.
4. A mid-transition update continues from the displayed value.
5. Unchanged values do not schedule animation work.
6. Values are clamped to 0–100.
7. Reduced-motion mode updates immediately.
8. Unmounting cancels pending animation frames.
9. Existing memory, storage threshold, sizing, and accessibility behavior remains intact.

## Release Notes

This is a user-visible Systems workspace improvement. Add it to the structured unreleased release-note draft and the `Unreleased` changelog section during implementation.
