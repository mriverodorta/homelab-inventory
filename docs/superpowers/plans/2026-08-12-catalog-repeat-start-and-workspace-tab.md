# Catalog Repeat-Start And Workspace Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trust an already verified immutable catalog generation through a bounded receipt fast path, recover catalog corruption without blocking the app, and make selected workspace tabs one uninterrupted colored surface.

**Architecture:** Activation writes a versioned verification receipt after complete signed-artifact and SQLite validation. Repeat startup verifies file hashes, generation identity, and SQLite integrity without parsing the full catalog; failures isolate catalog routes behind a single-flight recovery while the rest of the application starts. Workbook tabs move selected background ownership to the full tab container.

**Tech Stack:** Bun, `bun:sqlite`, Express, React, Tailwind CSS, Vitest, Bun test, Docker Buildx, distroless Debian runtime.

## Global Constraints

- Preserve complete signature, schema, digest, facet, and topology validation during activation.
- Never serve a catalog index after receipt or integrity validation fails.
- Do not retain the complete catalog snapshot in process memory.
- Existing generations without a receipt must upgrade automatically.
- Catalog failure must not block inventory, canvas, authentication, telemetry, agents, or settings.
- Preserve demo enrollment and contribution restrictions.
- Use copied development data for Docker tests; never mutate the primary local data directory.
- Do not bump semver, tag, push, deploy, or modify live data.

---

### Task 1: Versioned Generation Receipt

**Files:**
- Create: `server/registry/catalog-generation-receipt.mjs`
- Test: `server/registry/catalog-generation-receipt.bun_spec.mjs`
- Modify: `server/registry/catalog-index.mjs`

**Interfaces:**
- Produces: `writeCatalogGenerationReceipt(paths, identity): Promise<CatalogGenerationReceipt>`
- Produces: `verifyCatalogGenerationReceipt(paths, identity): Promise<ReceiptVerification>`
- Produces: `CatalogIndex.verifyRuntime(expected): RuntimeIndexVerification`

- [ ] Write failing tests covering receipt creation, regular-file requirements, size/hash mismatch, version mismatch, generation mismatch, SQLite schema mismatch, quick-check failure, foreign-key failure, and atomic write mode.
- [ ] Run the focused Bun tests and confirm the receipt module is absent.
- [ ] Implement streaming file hashes, canonical receipt validation, atomic mode-`0600` writes, and bounded SQLite runtime verification.
- [ ] Run the focused tests and confirm all receipt cases pass.
- [ ] Commit the receipt module and tests.

### Task 2: Snapshot Fast Path And Legacy Upgrade

**Files:**
- Modify: `server/registry/snapshot-service.mjs`
- Test: `server/registry/snapshot-service.bun_spec.mjs`

**Interfaces:**
- Consumes: receipt read/write and `CatalogIndex.verifyRuntime()`.
- Produces: `SnapshotService.warm()` that returns through the receipt fast path for unchanged generations.
- Produces: legacy full validation followed by one receipt write.

- [ ] Add failing tests proving repeat warm skips full snapshot parsing, legacy generations validate once, activation writes a receipt, and new revisions invalidate all initialization state.
- [ ] Run focused tests and confirm the new expectations fail.
- [ ] Refactor full generation validation and fast receipt validation into separate paths without changing activation trust checks.
- [ ] Ensure activation writes the receipt before the active pointer changes.
- [ ] Run focused tests and confirm fast, legacy, activation, and revision cases pass.
- [ ] Commit the snapshot-service fast path.

### Task 3: Catalog Availability And Recovery

**Files:**
- Create: `server/registry/catalog-availability.mjs`
- Test: `server/registry/catalog-availability.test.mjs`
- Modify: `server/registry/catalog-runtime.mjs`
- Modify: `server/registry-routes.mjs`
- Modify: `server/index.mjs`
- Test: `server/registry-routes.test.mjs`
- Test: `server/registry/catalog-runtime.test.mjs`

**Interfaces:**
- Produces: states `unavailable | verifying | ready | recovering`.
- Produces: `CatalogRuntime.start(store): Promise<void>` that never blocks non-catalog HTTP startup on recoverable catalog corruption.
- Produces: catalog route error `{code:'catalog-initializing', message:'Catalog is being verified. Try again shortly.'}` with HTTP `503`.

- [ ] Write failing state-machine, route, single-flight recovery, sanitized-error, and non-catalog-health tests.
- [ ] Run focused tests and confirm failures.
- [ ] Implement explicit availability state, one recovery promise, ready-only catalog access, and nonblocking startup recovery.
- [ ] Keep missing snapshot as `unavailable`, not an error.
- [ ] Run focused tests plus existing registry route tests.
- [ ] Commit catalog recovery isolation.

### Task 4: Startup Benchmark Harness

**Files:**
- Create: `server/startup/startup-profiler.mjs`
- Create: `scripts/benchmark-catalog-startup.mjs`
- Test: `server/startup/startup-profiler.test.mjs`
- Modify: `server/index.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: optional `StartupProfiler` observer using monotonic milliseconds.
- Produces: `bun run benchmark:catalog-startup -- --base-url <url>` summary.

- [ ] Add failing tests for phase ordering, duration calculation, disabled no-op behavior, and JSON benchmark output.
- [ ] Implement the injectable profiler without normal production logs.
- [ ] Instrument persistence, identity/auth, catalog resolution, hash/integrity/facet work, and listener availability.
- [ ] Add the benchmark package script and run it against a local process fixture.
- [ ] Commit reusable startup regression tooling.

### Task 5: Complete Workspace Tab Color Surface

**Files:**
- Modify: `src/components/workbook/workbook-tab-strip.tsx`
- Modify: `src/components/workbook/workbook-tab-strip.test.tsx`

**Interfaces:**
- Consumes: `workspaceColor(colorKey)`.
- Produces: a full-tab selected background with a stable 24px transparent action slot.

- [ ] Add failing tests asserting selected color ownership on the presentation container, transparent label/menu surfaces, stable action-slot dimensions, and neutral Systems behavior.
- [ ] Run the focused Vitest test and confirm failure.
- [ ] Move selected background to the container and use transparent/subtle overlay states for child buttons.
- [ ] Verify hover, focus, menu-open, drag, inactive, truncation, and accessibility behavior.
- [ ] Run focused workbook tests.
- [ ] Commit the workspace-tab fix.

### Task 6: Release Notes And Full Automated Verification

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `src/release-notes.ts`

**Interfaces:**
- Records both user-visible changes in Unreleased notes.

- [ ] Add consolidated Unreleased entries for repeat startup and complete selected-tab color.
- [ ] Run `bun run lint`.
- [ ] Run `bun run test`.
- [ ] Run `bun run build`.
- [ ] Run `bun run release-notes:check`.
- [ ] Review the diff for private data and unrelated changes.
- [ ] Commit implementation documentation and release notes.

### Task 7: Local Distroless Docker End-To-End Proof

**Files:**
- Create only ignored temporary files under a dedicated local verification directory.
- Do not modify or commit real `data/`.

**Interfaces:**
- Consumes: final Dockerfile, copied data, benchmark command, and app UI.
- Produces: measured cold/repeat/recovery results and visual verification evidence.

- [ ] Copy current development data to a temporary verification directory and record inventory/project/telemetry hashes.
- [ ] Build the final distroless `linux/amd64` image with the current local revision.
- [ ] Start the image on an unused loopback port and verify legacy receipt creation.
- [ ] Restart unchanged data and verify health under 10 seconds, catalog work under 2 seconds, facets under 100 ms, no full parse, and no rebuild.
- [ ] Corrupt a copied receipt and prove catalog-only recovery with non-catalog health.
- [ ] Corrupt a copied SQLite index and prove transactional rebuild and receipt replacement.
- [ ] Activate a different signed fixture revision and prove cache invalidation.
- [ ] Use browser automation to verify category loading, tab idle/hover/menu surfaces, and zero console errors.
- [ ] Compare user-domain hashes and prove no mutation.
- [ ] Run `bun run security:container` for AMD64 and ARM64.
- [ ] Remove temporary containers/images/data and summarize results without deploying.

