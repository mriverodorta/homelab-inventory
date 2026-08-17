# Heartbeat Latest-Slot Grace Design

## Objective

Stop the 30-minute Agent heartbeat timeline from showing a red newest slot while the host is online and its latest successful heartbeat is still within the configured online grace period.

## Root Cause

The compact telemetry repository currently ends its bucket window at the current wall-clock minute. When a heartbeat arrives late within a minute, such as `16:41:52`, a request made after `16:42:00` immediately adds an empty `16:42` bucket. The UI renders that empty bucket as missed even though the next heartbeat is not overdue and the same response correctly reports the host as online.

## Selected Design

Build the telemetry window around the latest received metric sample while that sample remains inside the Agent status online grace period. The latest successful sample is therefore the newest green slot.

Only advance the window beyond the latest sample when the elapsed time exceeds the online grace period. Each fully overdue heartbeat interval adds one missed slot. Missing historical slots remain red, while metric graphs continue carrying the previous observed value across those slots.

The telemetry route will pass the negotiated heartbeat interval and online grace period to the repository. The repository remains responsible for producing one canonical set of aligned heartbeat and metric buckets; the React timeline remains a presentation component and will not override backend truth.

## Boundaries

- Keep the fixed 30-slot window.
- Use the negotiated Agent heartbeat interval rather than hardcoding cadence in the route.
- Use the same online grace period as Agent status calculation.
- Do not convert an actually missed historical slot to green.
- Do not create speculative future slots.
- Preserve last-known metric values in missed slots for continuous charts.
- Keep the endpoint outbound-only; no server-to-Agent communication is introduced.

## Alternatives Rejected

1. Force the final chip green in React. This would hide real missed-heartbeat data and make the timeline disagree with the API.
2. Always anchor to the latest sample. This would never expose new missed slots after an Agent stops reporting.
3. Use only wall-clock minute boundaries. This is the current behavior and incorrectly treats a not-yet-due heartbeat as missed.

## Verification

- A heartbeat received seconds before the current minute boundary remains the latest green slot while online.
- Crossing a wall-clock minute boundary alone does not create a red slot.
- The first red slot appears only after the online grace period is exceeded.
- Additional overdue cadence intervals append additional red slots.
- A missing historical minute remains red and carries the previous metrics for chart continuity.
- On-time heartbeats continue producing 30 green slots.
- API, repository, and inspector tests cover the same timeline semantics.

