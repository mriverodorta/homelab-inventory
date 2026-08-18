# Cross-Platform Memory Pressure Design

## Objective

Make Systems workspace RAM utilization communicate actual memory pressure instead of memory composition. Update the Homelab Inventory Agent to report the raw Linux and FreeBSD counters required for deterministic pressure calculations, while keeping the compact table visually simple and comparable across operating systems.

## Chosen Approach

The Systems table uses a two-segment pressure bar for every host:

1. Green: memory the operating system does not currently consider readily available.
2. Gray: memory the operating system considers available or reclaimable without swapping.

The percentage label is the green segment rounded to a whole percent. Cache, buffers, inactive pages, ZFS ARC, shared memory, and FreeBSD page classes remain available as telemetry facts and future inspector detail, but they do not receive saturated segments in the dense Systems table.

This avoids the rejected composition-bar approach, which colored nearly the entire bar on healthy cache-heavy systems and visually implied that memory was exhausted.

## Agent Contract

All additions are optional fields within the existing protocol-v1 memory object, preserving compatibility with older agents and servers.

Linux reports the raw values available from `/proc/meminfo`:

- `totalBytes`
- `freeBytes`
- `availableBytes`
- `buffersBytes`
- `cachedBytes`
- `reclaimableBytes`
- `sharedBytes`
- existing swap fields
- optional `zfsArcBytes`

Linux pressure remains `(totalBytes - availableBytes) / totalBytes`, matching the kernel's available-memory estimate. The additional fields are not added together to derive pressure.

FreeBSD reports the raw values available through unprivileged `sysctl` reads:

- `totalBytes`
- `pageSizeBytes`
- `pageCount`
- `activePages`
- `inactivePages`
- `cachePages`
- `laundryPages`
- `wiredPages`
- `freePages`
- optional `zfsArcBytes`
- existing swap fields

FreeBSD pressure follows the OPNsense calculation: page count minus inactive, cache, laundry, and free pages, with ZFS ARC removed from used memory before calculating the displayed pressure. The result is bounded to zero through total memory. ARC is never counted twice.

Collectors must omit unavailable optional counters rather than fabricate zero values. Existing agents continue to work through the current `usedPercent` fallback.

## Application Data Flow

The telemetry normalizer preserves the new raw fields in the latest host runtime state. The Systems read service resolves one bounded pressure percentage in this order:

1. Valid operating-system-specific raw counters.
2. Valid `usedPercent` reported by an older agent.
3. Valid `usedBytes / totalBytes` fallback.
4. No utilization bar when none are trustworthy.

The Systems response remains compact. It does not include every raw counter merely to render a two-segment table bar. Detailed counters remain available through the host telemetry/inspector response.

## Systems Table Layout

The utilization component uses a two-column grid:

- exactly `4ch` for `00%` through `100%`;
- the remaining width for the bar.

The columns use a minimal explicit gap rather than the current larger utility gap. Neither the percentage track nor its parent adds horizontal padding. CPU, memory, and storage retain identical alignment.

The accessible label identifies the metric and pressure percentage. Detailed memory composition is not announced by the compact bar because it is not rendered there.

## Compatibility And Failure Handling

- Linux, FreeBSD, and OPNsense use the same green/gray visual semantics.
- FreeBSD collection remains available to the unprivileged `nobody` agent account.
- ZFS ARC absence is valid and does not fail memory collection.
- Missing newer counters falls back to older agent fields.
- Invalid, negative, overflowing, or internally inconsistent counters are ignored.
- No telemetry schema migration is required because latest memory state is persisted as JSON.
- Historical heartbeat retention is unchanged.

## Verification

- Linux parser tests cover free, available, buffers, cache, reclaimable, shared, and swap counters.
- FreeBSD collector tests cover all VM page counters, ARC subtraction, unprivileged-compatible sysctl collection, bounds, and systems without ZFS.
- Application telemetry tests prove the new fields survive normalization and latest-state persistence.
- Systems read-service tests prove Linux pressure, FreeBSD/OPNsense pressure, legacy fallback, and invalid-data omission.
- Component tests prove a simple green/gray bar, exact four-character label track, minimal gap, and accessible text.
- Browser verification checks dense and comfortable Systems rows at narrow and wide table widths.

