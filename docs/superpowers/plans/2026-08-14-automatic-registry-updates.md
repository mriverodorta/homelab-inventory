# Automatic Registry Updates Implementation Plan

> **For Codex:** Execute this plan inline in order. Keep safe updates atomic, preserve topology, and add regression coverage before moving to the next layer.

**Goal:** Automatically apply verified, compatibility-safe official catalog updates while grouping risky updates into a scalable review workflow.

**Architecture:** Persist update policy, runs, and per-link decisions in the core SQLite database. A backend coordinator evaluates newly activated official catalog revisions, simulates compatibility impact, atomically applies safe links, and retains review-required links. React consumes grouped update summaries through TanStack Query and exposes policy controls plus a permanent bottom-toolbar review surface.

**Tech Stack:** Bun, bun:sqlite, Drizzle schema/migrations, Express, React 19, TanStack Query, shadcn/ui, Vitest, Bun test.

---

### Task 1: Persist the update policy and decision history

**Files:**
- Modify: `server/persistence/core/schema/registry.ts`
- Create: `server/persistence/core/migrations/generated/0013_automatic_registry_updates.sql`
- Modify: `server/persistence/core/migrations/manifest.ts`
- Modify: `server/persistence/core/projections/legacy-domains.ts`
- Modify: `server/persistence/migration/core-importer.ts`
- Modify: `server/registry/model.mjs`
- Modify: registry backup/export table lists
- Test: core migration, projection, backup, and restore tests

1. Add `automatic_safe_updates` to the singleton settings row, default enabled.
2. Add numeric-ID tables for update runs and per-link evaluations/decisions with foreign keys to sources and links.
3. Add constraints for statuses, decisions, revisions, and JSON reason fields.
4. Include the new policy and tables in legacy projection/import, backup, selective export, restore, and validation.
5. Prove existing databases migrate with the setting enabled and existing links unchanged.

### Task 2: Build the pure safety evaluator

**Files:**
- Create: `server/registry/catalog-update-policy.mjs`
- Modify: `server/persistence/sqlite-store.ts`
- Test: `server/registry/catalog-update-policy.bun_spec.mjs`

1. Materialize proposed linked items while preserving local fields.
2. Hard-deny inventory type and normalized identity changes.
3. Detect destructive port, occupied slot, and host-topology changes conservatively.
4. Compare compatibility findings before and after the proposed updates per affected project.
5. Classify each link as `safe`, `review-required`, `blocked`, or `skipped` with stable reason codes.
6. Cover safe CPU metadata repairs, incompatible CPU changes, occupied slot reductions, and connected port removal.

### Task 3: Apply safe updates atomically

**Files:**
- Create: `server/registry/catalog-update-coordinator.mjs`
- Modify: `server/persistence/sqlite-store.ts`
- Modify: `server/registry/catalog-refresh-coordinator.mjs`
- Modify: server startup wiring
- Test: coordinator/store integration tests

1. Create or resume one run per source/catalog revision.
2. Group links by template key and target revision and evaluate them idempotently.
3. Preflight all safe replacements, then write inventory records, links, evaluations, and run totals in one SQLite transaction.
4. Abort without partial mutation when hashes, links, validation, or project state are stale.
5. Trigger evaluation after successful startup, scheduled, and manual catalog activation.
6. Force safe updates in demo mode while preserving demo enrollment/contribution prohibitions.
7. Verify metadata-only updates do not alter assignments, placements, cables, route cache, or project revisions.

### Task 4: Expose grouped review APIs

**Files:**
- Modify: `server/registry-routes.mjs`
- Modify: `server/auth/api-permissions.mjs`
- Modify: `src/types/registry.ts`
- Modify: `src/lib/registry-api.ts`
- Modify: `src/hooks/use-registry.ts`
- Test: registry route and API tests

1. Return grouped Review, Applied, and Declined data with affected items/projects and before/after definitions.
2. Add atomic approve-selected, decline-selected, reconsider, and retry endpoints.
3. Make decline revision-specific while retaining registry links.
4. Require `registry.manage` for mutations and existing registry read permission for summaries.
5. Return one mutation response suitable for one TanStack Query invalidation.

### Task 5: Add settings, toolbar badge, and review dialog

**Files:**
- Modify: registry settings UI/actions
- Modify: `src/components/canvas-command-bar.tsx`
- Create: `src/components/inventory/registry-updates-dialog.tsx`
- Create: focused grouped review child components and view-model helpers
- Modify: app dialog/surface wiring
- Test: component and integration tests

1. Add the enabled-by-default automatic-safe-update switch with official-source trust copy.
2. Add a permanent `CloudDownload` toolbar action with a badge counting review groups.
3. Build shadcn Review, Applied, and Declined views with search, filters, expansion, selection, and batch actions.
4. Keep blocked updates non-forceable and show dependency reasons.
5. Use loading and error states without resizing the toolbar or triggering canvas reroutes.

### Task 6: Release notes and verification

**Files:**
- Modify: `CHANGELOG.md`
- Modify: structured unreleased release-note draft

1. Document automatic verified updates and grouped review behavior under Unreleased.
2. Run focused migration, policy, coordinator, route, and UI tests while implementing.
3. Run `bun run db:migrations:check`.
4. Run `bun run lint`.
5. Run `bun run test`.
6. Run `bun run build`.
7. Review the final diff for private data, runtime stores, credentials, and unrelated changes.

