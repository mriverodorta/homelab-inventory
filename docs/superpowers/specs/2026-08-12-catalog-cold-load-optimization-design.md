# Catalog Cold-Load Optimization Design

## Goal

Make the verified catalog category picker available immediately after the application becomes healthy without weakening catalog signature, digest, schema, or index validation.

## Architecture

Introduce a process-local catalog runtime that owns one `SnapshotService` per persistence store. Production refresh, contribution matching, catalog routes, and startup warmup reuse the same service. Demo sessions remain isolated because their stores are keyed independently in a `WeakMap`.

`SnapshotService` will provide a single-flight `warm()` operation. It resolves and validates the active signed generation, ensures the SQLite index exists at the supported schema version, reads the signed facet metadata from SQLite, and caches only the resulting facet response. The cache key is the immutable catalog revision and digest. Activation clears the old initialization state before exposing the new revision.

Production startup awaits local warmup before opening the HTTP listener. Remote connected-catalog refresh remains nonblocking and starts afterward. An installation with no active snapshot starts normally. Invalid active artifacts continue to stop startup explicitly; a missing or outdated index is rebuilt through the existing verified path.

## Frontend

TanStack Query keys for facets include the active revision and digest. The app prefetches facets during browser idle time after the registry state and workspace are available. Pointer hover, keyboard focus, and activation of the Add button also prefetch the dialog chunk and facet request. Because revisions are immutable, facet queries remain fresh indefinitely and a newly activated revision naturally uses a different key.

## Invalidation

Catalog activation replaces the generation atomically, clears the service's path and facet caches, and then permits warmup for the new revision. Existing browser cache entries remain harmless because their query key includes the previous revision and digest.

## Error Handling

- No snapshot: warmup returns an unavailable empty facet response.
- Missing or outdated index: rebuild using the already verified snapshot and signed facets.
- Invalid signature, digest, generation metadata, or incompatible index: fail startup or the triggering request explicitly.
- Concurrent cold requests: await the same initialization promise.
- Failed initialization: clear the in-flight promise so a later request can retry after the underlying problem is corrected.

## Verification

- Unit tests prove concurrent warm requests validate once and return one cached facet object.
- Activation tests prove a new revision invalidates the previous cache.
- Runtime tests prove stores receive isolated services.
- Frontend tests prove revision-keyed query caching and idle/intent prefetch.
- Existing registry, demo, security, lint, test, and production build checks remain required.

## Performance Targets

- The first facets request after the server reports healthy completes in under 100 ms on the live deployment.
- Opening Add shows the category picker in under 300 ms when network latency is normal.
- The first UI request never rebuilds an already valid index.
- Memory remains bounded to one parsed facet response per active store, not the full catalog.
