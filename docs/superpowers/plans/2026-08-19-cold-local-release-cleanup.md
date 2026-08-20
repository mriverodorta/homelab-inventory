# Cold Local Release Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every local release architecture build cold and automatically remove release-owned Docker cache and volumes after each phase.

**Architecture:** OCI builds use a freshly recreated dedicated Buildx builder with `--no-cache` and no external cache import/export. A focused cleanup module owns release-specific Docker cleanup, while `dclaim` combines it with safe global pruning that never prunes volumes.

**Tech Stack:** Bun, Node filesystem APIs, Docker Buildx, Docker Scout, Trivy, zsh

## Global Constraints

- Preserve immutable OCI archives and release receipts needed for approval and stable promotion.
- Preserve unrelated containers, images, networks, and named application data volumes.
- Preserve the active staging container through ARM64 review and stop it only after successful publication or an explicit stop.
- Run release cleanup after successful and failed architecture build phases.
- Never use a reusable BuildKit cache for release candidates.

---

### Task 1: Cold OCI candidate builds

**Files:**
- Modify: `scripts/local-release/oci.mjs`
- Modify: `scripts/local-release/oci.bun_spec.mjs`

**Interfaces:**
- Produces: `candidateBuildCommand()` with `--no-cache` and no cache import/export.
- Produces: `recreateReleaseBuilder(paths)` that clears old release cache state before creating the builder.

- [x] Change the OCI command regression test to require `--no-cache` and reject cache import/export flags.
- [x] Run the focused test and verify the current cached command fails.
- [x] Remove external cache rotation and recreate the release builder per architecture.
- [x] Run the focused test and verify it passes.

### Task 2: Release-owned Docker cleanup

**Files:**
- Create: `scripts/local-release/cleanup.mjs`
- Create: `scripts/local-release/cleanup.bun_spec.mjs`
- Modify: `scripts/local-release.mjs`
- Modify: `scripts/local-release/cli.bun_spec.mjs`

**Interfaces:**
- Produces: `releaseCleanupCommands(options)` for deterministic, testable cleanup selection.
- Produces: `cleanupReleaseDockerState({ paths, revision })` for executing release-scoped cleanup.

- [x] Write tests proving cleanup targets only the release builder, release registries, candidate images, Trivy volume, Scout cache, and external cache directory.
- [x] Run the focused test and verify it fails before the cleanup module exists.
- [x] Implement cleanup and expose `release:local cleanup-local`.
- [x] Wrap ARM64 preparation and AMD64 publication so cleanup runs after success and failure.
- [x] Stop staging after successful publication before final cleanup.
- [x] Run focused local-release tests.

### Task 3: Manual Docker.raw cleanup

**Files:**
- Modify: `/Users/maikeldorta/bin/dclaim`

**Interfaces:**
- Consumes: `bun run release:local cleanup-local`.

- [x] Replace bounded release cache retention with complete release-owned cleanup.
- [x] Keep normal Docker pruning volume-safe.
- [x] Retain Docker.raw block reclamation and before/after reporting.
- [x] Validate the zsh script syntax.

### Task 4: Verification and one-time cleanup

**Files:**
- Modify: `CHANGELOG.md` only if required by release-note policy.

**Interfaces:**
- Produces: focused test results and before/after Docker storage evidence.

- [x] Run local-release tests, lint, complete tests, and production build.
- [x] Execute the new release cleanup against current Docker state.
- [x] Execute `dclaim` to prune unused objects and trim Docker.raw.
- [x] Verify unrelated running containers and named application volumes remain.
- [x] Record final Docker.raw, Docker object, release cache, and support-directory sizes.
