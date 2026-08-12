# Catalog Cold-Load Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Warm and cache the verified local catalog before HTTP availability and prefetch immutable category metadata before users open Add Hardware.

**Architecture:** A process-local runtime shares one `SnapshotService` per store. Each service single-flights signed generation/index initialization and caches facets by catalog revision and digest; TanStack Query uses the same identity for browser caching.

**Tech Stack:** Bun, Express, `bun:sqlite`, TanStack Query, React, Vitest, Bun test.

## Global Constraints

- Preserve strict signed catalog, digest, schema, and SQLite index validation.
- Keep remote registry refresh nonblocking.
- Never cache the complete catalog in application memory.
- Keep demo session stores isolated.
- Do not bump the application version or create a release tag.

---

### Task 1: Shared Catalog Runtime And Single-Flight Warmup

**Files:**
- Create: `server/registry/catalog-runtime.mjs`
- Modify: `server/registry/snapshot-service.mjs`
- Test: `server/registry/catalog-runtime.test.mjs`
- Test: `server/registry/snapshot-service.bun_spec.mjs`

**Interfaces:**
- Produces: `CatalogRuntime.forStore(store): SnapshotService`
- Produces: `SnapshotService.warm(): Promise<CatalogFacetResponse>`

- [ ] Write failing tests for per-store service reuse, store isolation, concurrent warmup, cached facets, retry after failure, and revision invalidation.
- [ ] Run focused Bun and Vitest tests and confirm the new expectations fail.
- [ ] Implement the runtime, keyed initialization promise, and revision/digest facet cache.
- [ ] Run focused tests and confirm they pass.

### Task 2: Startup Warmup And Shared Route Service

**Files:**
- Modify: `server/index.mjs`
- Modify: `server/registry-routes.mjs`
- Test: `server/registry-routes.test.mjs`

**Interfaces:**
- Consumes: `CatalogRuntime.forStore(store)` and `SnapshotService.warm()`.
- Produces: production startup that does not listen until the active local catalog is ready.

- [ ] Add route tests proving the injected shared runtime service is reused.
- [ ] Build one catalog runtime in `server/index.mjs` and use it for refresh, contributions, routes, and demo bootstrap.
- [ ] Await production local warmup before starting schedules and opening the listener.
- [ ] Confirm missing snapshots remain a valid startup state and invalid active generations fail explicitly.

### Task 3: Revision-Keyed Browser Prefetch

**Files:**
- Modify: `src/hooks/use-registry.ts`
- Modify: `src/app/app.tsx`
- Modify: `src/components/inventory-sidebar.tsx`
- Modify: `src/components/inventory/catalog-source-panel.tsx`
- Modify: `src/components/inventory/catalog-browser.tsx`
- Test: `src/test/catalog-browser.test.tsx`
- Test: `src/test/catalog-facet-prefetch.test.tsx`

**Interfaces:**
- Produces: `catalogFacetQueryKey(snapshot)` and `prefetchCatalogFacets(queryClient, snapshot)`.
- Consumes: registry snapshot revision and digest.

- [ ] Add tests proving immutable query keys change across revisions and idle/intent prefetch occurs once.
- [ ] Add revision/digest to facet query keys with infinite stale time.
- [ ] Prefetch during idle time after workspace hydration.
- [ ] Prefetch both the dialog chunk and facets on Add hover, focus, and activation.
- [ ] Run the focused frontend tests.

### Task 4: Documentation And Verification

**Files:**
- Modify: `CHANGELOG.md`
- Modify: structured unreleased release notes under `src/release-notes.ts` or the repository's active draft.

- [ ] Record the user-visible catalog startup improvement in Unreleased notes.
- [ ] Run `bun run lint`.
- [ ] Run `bun run test`.
- [ ] Run `bun run build`.
- [ ] Review the diff for private data and unrelated changes.
