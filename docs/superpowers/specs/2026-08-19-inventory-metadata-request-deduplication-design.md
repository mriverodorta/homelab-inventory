# Inventory Metadata Request Deduplication Design

## Problem

Saving an inventory tag or custom-field value currently produces one authoritative
`PUT` response followed by two identical metadata `GET` requests. The mutation
invalidates the project item-query prefix, and the resulting SSE event invalidates
the same prefix again. The mutation only writes its response into the cache after
waiting for the first invalidation, so both reads are redundant.

This wastes network and database work on every debounced metadata save and makes
the client briefly reconcile the same state three times.

## Required Behavior

- A successful metadata autosave makes exactly one item-specific HTTP request:
  the `PUT`.
- The mutation response immediately becomes the authoritative local item cache.
- The SSE event carries the authoritative public item metadata so other connected
  clients update without issuing a follow-up `GET`.
- Project metadata projections are invalidated once because filters, tags, and
  visible table values may have changed.
- Each active browser query client may therefore issue one aggregate project
  projection refresh, but it must not issue an item metadata `GET`.
- SSE reconnect or stream resynchronization still invalidates item and projection
  queries so missed changes are recovered safely.
- Stale or duplicate SSE revisions never replace newer cached metadata.

## Server Event Contract

`inventory-metadata.item-changed` will contain:

```json
{
  "itemId": 18,
  "projectIds": [1],
  "metadata": {
    "itemId": 18,
    "revision": 2,
    "definitions": [],
    "values": [],
    "tags": []
  }
}
```

The metadata value is the same sanitized public projection returned by the
mutation endpoint. It contains no private fields beyond metadata values the
authorized user can already read. Payload validation remains strict and bounded.

History-restore events can continue using their bounded identifier payload in
this change. Their multi-item recovery path remains explicit and is not part of
the single-item autosave optimization.

## Client Data Flow

On mutation success:

1. Write `result.metadata` to every affected project-scoped item query for the
   mutated inventory identity.
2. Invalidate only each affected project's metadata projections.
3. Do not invalidate the project item-query prefix.
4. Complete `onSaved` history bookkeeping using the same mutation result.

On a normal item SSE event:

1. Parse the event payload with the inventory metadata schema.
2. For each affected project, compare the incoming revision with the cached item.
3. Replace the cache only when it is absent or older.
4. Invalidate the project's projection queries once.
5. Do not issue an item metadata `GET`.

On SSE resynchronization:

1. Invalidate the project item-query prefix.
2. Invalidate the project projection-query prefix.

This preserves external-browser synchronization and missed-event recovery while
removing duplicate reads from the normal save path.

## Query Ownership

The mutation and live-event handlers will share small cache-update helpers so
revision comparison and affected-project handling have one implementation. Query
keys remain unchanged. Catalog events remain separate because definition and tag
administration changes affect the installation-wide catalog.

## Failure Behavior

- A failed `PUT` leaves the previous cache and editor baseline intact.
- A malformed SSE payload is ignored and causes no partial cache write.
- A stream resync falls back to authoritative HTTP reads.
- Projection invalidation failures do not discard the successful item cache.

## Verification

Automated coverage must prove:

1. A metadata mutation seeds every affected item cache before projection refresh.
2. Mutation success never invalidates item queries.
3. A matching or older SSE revision performs no item fetch or cache downgrade.
4. A newer SSE revision updates the item cache and projection exactly once.
5. Stream resynchronization invalidates both item and projection queries.
6. The SSE payload excludes repository-only normalized fields.
7. Tag selection and deselection each produce one `PUT` and zero metadata `GET`
   requests in the local candidate.
8. A second browser receives the change without manual refresh.

The complete lint, test, build, migration, and container security suites remain
required before release.
