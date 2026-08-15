# Registry Update And Agent Polling Efficiency Design

## Purpose

Fix registry update decisions that leave cards in the Review list, isolate pending UI state to the groups being changed, and remove oversized background agent-status transfers.

## Current Problems

### Registry update decisions

- The dialog passes one global mutation pending flag to every visible card. Clicking one action therefore disables every card and makes the whole list appear active.
- The decision response contains every detailed update group even though the client ignores that response.
- Success invalidates overlapping `registry`, `registry updates`, and `project` query prefixes. This repeats detailed downloads and relies on refetch ordering to update the visible list.
- A stale or delayed refetch can leave an approved group visible in Review despite a successful HTTP response.
- The global toolbar downloads the same detailed review payload needed by the dialog merely to display a count.

### Agent status polling

- The global status endpoint returns complete latest telemetry for every registered host.
- Server records are serialized twice under `hosts` and `servers`.
- The response includes metrics, disks, network interfaces, services, containers, capabilities, and storage health even when only an availability badge is visible.
- The app polls this aggregate every 30 seconds while agents normally report once per minute.
- Per-host telemetry already exists and is sufficient for the inspector's detailed panels.

## Registry Update Contract

### Summary

The always-mounted application toolbar uses a compact summary response containing only:

- latest evaluation run state and counts;
- number of reviewable groups;
- number of blocked groups.

The summary response must not include group changes, linked inventory records, projects, or legacy per-link update previews.

### Detailed groups

Detailed groups are fetched only while the Registry updates dialog is open. The response contains the fields needed to render the cards, filters, affected inventory, and field comparisons.

The existing per-link update review remains a separate contract so group details and legacy link previews are not serialized together.

### Decisions

One group action sends one group identity. Bulk actions send only the explicitly selected group identities. The server performs the decision atomically and returns a compact authoritative result containing:

- accepted group identities and resulting statuses;
- updated run/count summary;
- affected project IDs and revisions when inventory changed;
- affected registry link IDs.

The response must not contain all detailed groups or a complete project snapshot.

On success, the client immediately updates the detailed-group and summary caches from the response. An approved group leaves Review immediately and appears under Applied. A declined group leaves Review and appears under Declined. Relevant registry and active-project state is refreshed once, without invalidating the detailed groups a second time.

On failure, the group remains unchanged and receives a visible inline error. Repeated clicks for an already-pending group are ignored. Decision processing remains idempotent at the server boundary.

### Pending state

Pending state is keyed by group ID. Only groups included in the active request show disabled controls and a spinner. Unrelated cards retain their normal visual state. Bulk actions mark only their selected groups pending.

## Agent Status Contract

### Global summary

The bootstrap response and `/api/agent/status` polling contract return compact host summaries containing only:

- host type and numeric host ID;
- registration and connection state;
- computed availability state and age;
- last-seen and collected timestamps;
- agent version;
- hostname when available;
- availability flags for detailed sections;
- update availability and upgrade command metadata when applicable.

Full metrics and resource arrays are forbidden from this response. The response uses one canonical host map and does not duplicate complete server records.

### Detailed host telemetry

Metrics, services, containers, storage, network, capabilities, and heartbeat samples continue to use the per-host telemetry endpoint. These requests run only for the selected host while its inspector is mounted. TanStack Query shares the per-host result across Agent, Services, Containers, Network, and storage panels.

Dynamic inspector tabs use compact availability flags to decide whether a detailed section exists, then render data from the per-host telemetry query.

### Poll cadence

- Global compact status: every 60 seconds.
- Per-host detailed telemetry: every 60 seconds while the relevant inspector is mounted.
- Background polling: disabled while the document is hidden.
- Focus recovery: TanStack Query may refresh stale compact and selected-host data when visibility returns.

This cadence aligns with the one-minute agent heartbeat. Availability transitions can be displayed at most one minute after their threshold is crossed, which is appropriate for the existing stale and offline windows.

## Performance Budgets

Automated contract tests use representative multi-host fixtures and enforce:

- compact agent summary excludes telemetry-heavy fields and duplicate full server records;
- compact registry summary excludes group details and link previews;
- a single registry decision response remains below 4 KiB for representative data;
- opening the detailed dialog performs one detailed-group request;
- deciding one group performs one decision request and no immediate detailed-group refetch;
- idle agent polling occurs no more frequently than once per minute.

The detailed dialog and per-host telemetry payloads remain proportional to the information the user explicitly opened.

## Error And Consistency Handling

- Server decisions are authoritative; optimistic UI is limited to pending presentation until the response succeeds.
- Successful responses update query caches before targeted project and registry reconciliation.
- Failed responses preserve the original group status and display the server message on the affected card.
- Project refresh is scoped to projects reported by the decision response.
- The active project is reconciled through the existing canonical project application path so canvas and inspector state cannot retain the old registry-owned definition.
- Permissions and demo-mode restrictions remain unchanged.

## Verification

Tests cover:

- clicking one group affects only that card's pending state;
- one click produces one decision mutation;
- a successful approval removes the card from Review and updates counts immediately;
- decline and bulk decisions update only their requested groups;
- errors remain local to the failed groups;
- summary and detail endpoints do not duplicate data;
- compact polling continues to drive canvas and Systems availability badges;
- detailed inspector tabs load their data from one shared per-host query;
- hidden-page polling remains paused;
- response-size budgets hold for fixtures containing many services and containers.

