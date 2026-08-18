# Systems Memory Segments Design

## Objective

Render the Systems workspace memory utilization bar as a compact htop-inspired segmented bar when an online Agent reports the required latest-state memory counters. Preserve the current green used/gray available bar for FreeBSD, OPNsense, legacy, stale, offline, and otherwise incomplete Agent data.

## Data Contract

The Systems initial and live responses add a nullable `memoryBreakdown` object:

```ts
type SystemsMemoryBreakdown = Readonly<{
  totalBytes: number
  availableBytes: number
  cachedBytes: number
  buffersBytes: number
  sharedBytes: number | null
}>
```

The telemetry repository reads total, available, cache, and buffer counters from the existing latest `host_runtime_state.memory_json` record. No new database column, migration, heartbeat history, or polling behavior is introduced. `sharedBytes` remains null until a future Agent contract reports it.

The Systems read service includes the object only for an online host when total, available, cache, and buffer values are finite and non-negative. Missing or incomplete breakdown data becomes `null`, while the existing `memoryPercent` remains available.

## Segmentation

The bar keeps its fixed four-character percentage label and existing dimensions. The headline percentage remains `(total - available) / total`, matching current memory-pressure semantics.

When a valid breakdown exists, the bar renders these left-to-right segments:

1. Green: non-available memory, `totalBytes - availableBytes`.
2. Blue: buffers.
3. Orange: cache.
4. Red: shared memory, only when explicitly reported.
5. Gray: remaining available memory after subtracting buffers, cache, and shared.

Every segment is clamped to the remaining total so malformed or overlapping source counters cannot overflow the bar. The accessible label names each displayed category and percentage, so color is not the only carrier of meaning.

When a valid breakdown is absent, the component renders the existing single green used segment and gray remainder. In particular, current FreeBSD and OPNsense Agents remain unchanged because they report total, available, and used values without Linux cache and buffer categories.

## Scope

- Systems workspace memory cells only.
- Latest-state data only; historical graphs remain unchanged.
- No Agent protocol change in this release.
- No database migration.
- No fabricated shared-memory values.

## Verification

- Repository tests prove the bounded Systems projection reads the latest memory JSON fields.
- Read-service tests prove online Linux values are exposed and incomplete or offline values are omitted.
- Component tests prove segment widths, colors, clamping, accessible text, and the FreeBSD fallback.
- Full lint, test, and production build verification remains required.
