# Local Release Storage Retention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound Homelab Inventory local release storage while preserving active candidates, staging data, and useful warm build layers.

**Architecture:** Release artifact retention lives in the local-release cache module, while OCI cache rotation remains owned by the OCI builder module. The user-level `dclaim` script orchestrates builder pruning, artifact cleanup, normal Docker cleanup, and Docker.raw trimming.

**Tech Stack:** Bun, Node filesystem APIs, Docker Buildx, zsh

## Global Constraints

- Preserve the current release revision and one previous candidate revision.
- Preserve current, previous, incoming, and container-mounted data directories.
- Keep at most 6 GB of dedicated release-builder cache with a 4 GB reserve.
- Never prune Docker named application data volumes.
- Replace external architecture caches only after a successful export.

---

### Task 1: Release artifact retention

**Files:**
- Modify: `scripts/local-release/cache.mjs`
- Modify: `scripts/local-release/cache.bun_spec.mjs`
- Modify: `scripts/local-release.mjs`

**Interfaces:**
- Produces: `pruneCandidateArchives(paths, state, options)` returning removed and retained revision names.

- [ ] Write tests for current revision preservation, one previous revision, deterministic ordering, and missing directories.
- [ ] Run the focused Bun test and verify it fails.
- [ ] Implement candidate retention and expose it through `release:local prune-local`.
- [ ] Run the focused Bun test and verify it passes.

### Task 2: Atomic external cache replacement

**Files:**
- Modify: `scripts/local-release/oci.mjs`
- Modify: `scripts/local-release/oci.bun_spec.mjs`

**Interfaces:**
- Produces: a build command with distinct cache input and output paths and a cache activation helper that swaps directories atomically.

- [ ] Write tests proving old cache input and temporary cache output are distinct.
- [ ] Run the focused Bun test and verify it fails.
- [ ] Export to a temporary directory and activate it only after a successful build.
- [ ] Run the focused Bun test and verify it passes.

### Task 3: System cleanup orchestration

**Files:**
- Modify: `/Users/maikeldorta/bin/dclaim`

**Interfaces:**
- Consumes: `bun run release:local prune-local` and Docker Buildx pruning commands.

- [ ] Remove the obsolete `trigger` builder when present.
- [ ] Fully prune the disposable selected builder.
- [ ] Bound `homelab-release` to 6 GB with a 4 GB reserve.
- [ ] Run project-local artifact retention when the repository is available.
- [ ] Preserve named volumes and trim Docker.raw after cleanup.

### Task 4: Verification and cleanup

**Files:**
- Modify: `CHANGELOG.md` only if the local release workflow change is included in a public release.

**Interfaces:**
- Produces: before/after storage evidence.

- [ ] Run focused local-release tests.
- [ ] Run lint, complete tests, and build.
- [ ] Execute `dclaim`.
- [ ] Remove only unmounted obsolete validation copies.
- [ ] Record final Docker.raw, Docker object, support directory, and external cache sizes.
