# Release Critical Path Round Two Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the verified local release critical path by parallelizing independent tests, directly loading exact OCI runtime images, and retaining a cache-free BuildKit runtime through ARM64 approval.

**Architecture:** A supervised test runner owns concurrent process lifecycle and private logs. Candidate builds use one BuildKit solve with OCI and Docker exporters, then a dedicated OCI verifier proves config and rootfs identity before runtime tests. Builder lifecycle is explicit: recreate for ARM64, prune records while waiting, reuse for AMD64, and remove on every terminal path.

**Tech Stack:** Bun 1.3.14, Node-compatible child processes, Docker Buildx 0.35+, OCI image layout, `tar-stream`, Docker Scout, Trivy, Bun test, Vitest.

## Global Constraints

- Keep image builds cold with `--no-cache`; do not introduce reusable Docker layer caches.
- Preserve exact OCI archives, provenance, SBOM, smoke tests, Scout, Trivy, and staging SSE probes.
- Do not publish Docker images, push Git branches, create GitHub releases, or mutate production during verification.
- Preserve `sehmadocker_mysql` and every pre-existing Docker volume.
- Remove task-created logs, volumes, candidates, scanner data, builders, cache, and generated output after verification.
- Update unreleased structured release notes and `CHANGELOG.md` for the release-process behavior change.

---

### Task 1: Supervised Parallel Test Families

**Files:**
- Create: `scripts/ci/test-supervisor.mjs`
- Create: `scripts/ci/test-supervisor.bun_spec.mjs`
- Modify: `package.json`
- Modify: `scripts/ci/contract.bun_spec.mjs`

**Interfaces:**
- Produces: `runConcurrentTestFamilies({ root, jobs, spawnProcess, logRoot }) -> Promise<{ jobs, durationMs }>`.
- Consumes: package scripts `test:vitest` and `test:bun`.

- [x] **Step 1: Write failing supervisor lifecycle tests**

Cover two concurrent successful commands, first-failure sibling termination,
environment forwarding, duration reporting, and removal of the private log
directory.

- [x] **Step 2: Run the focused test and confirm failure**

Run:

```bash
bun test scripts/ci/test-supervisor.bun_spec.mjs
```

Expected: failure because `test-supervisor.mjs` does not exist.

- [x] **Step 3: Implement the supervised runner**

Use task-scoped files under `os.tmpdir()`, `node:child_process.spawn`, and a
bounded `SIGTERM`/`SIGKILL` shutdown. Return per-job monotonic durations and
always remove logs in `finally`.

- [x] **Step 4: Split package scripts and preserve focused commands**

Set:

```json
{
  "test": "bun scripts/ci/test-supervisor.mjs",
  "test:vitest": "NODE_OPTIONS=--no-experimental-webstorage vitest run",
  "test:bun": "bun run test:auth && bun run test:sqlite"
}
```

- [x] **Step 5: Run focused and complete tests**

```bash
bun test scripts/ci/test-supervisor.bun_spec.mjs scripts/ci/contract.bun_spec.mjs
/usr/bin/time -lp env HOMELAB_WASM_PREBUILT=1 bun run test
```

Expected: all tests pass, logs are absent, and elapsed time improves over the
approximately 47-second sequential test phase.

- [x] **Step 6: Commit Task 1**

```bash
git add package.json scripts/ci/test-supervisor.mjs scripts/ci/test-supervisor.bun_spec.mjs scripts/ci/contract.bun_spec.mjs
git commit -m "build: run independent test suites concurrently"
```

---

### Task 2: Exact Direct OCI Runtime Loading

**Files:**
- Create: `scripts/local-release/oci-runtime-identity.mjs`
- Create: `scripts/local-release/oci-runtime-identity.bun_spec.mjs`
- Modify: `scripts/local-release/oci.mjs`
- Modify: `scripts/local-release/oci.bun_spec.mjs`
- Modify: `scripts/local-release/local-registry.mjs`
- Modify: `scripts/local-release/cleanup.mjs`

**Interfaces:**
- Produces: `readOciRuntimeIdentity({ archive, candidateDigest, platform })`.
- Produces: `verifyLoadedRuntimeIdentity({ candidate, identity, inspect })`.
- Updates: `candidateBuildCommand()` to emit OCI and Docker outputs when supported.
- Updates: `loadOciCandidate()` to verify a directly loaded image before fallback.

- [x] **Step 1: Write synthetic OCI identity tests**

Generate small OCI tar fixtures in the test and cover exact config/rootfs
matching, changed config, changed diff IDs, wrong platform, attestation
exclusion, blob hash mismatch, and duplicate platform descriptors.

- [x] **Step 2: Run identity tests and confirm failure**

```bash
bun test scripts/local-release/oci-runtime-identity.bun_spec.mjs
```

Expected: failure because the identity module does not exist.

- [x] **Step 3: Implement bounded OCI projection and runtime proof**

Stream the tar archive, retain only `index.json` and bounded JSON blobs, verify
all selected blob SHA-256 values, resolve one platform image manifest, and
compare its config digest and `rootfs.diff_ids` with Docker inspect output.

- [x] **Step 4: Add deterministic local Docker loading**

Buildx cannot combine attestations with its Docker exporter because provenance
and SBOM produce a manifest list. Keep one attested OCI output, convert only the
selected runtime manifest to Docker load format, and prove config/rootfs
identity after loading.

The Registry fallback remains available only for unsupported layer compression.
It must mount `/var/lib/registry` as tmpfs and be removed with `--volumes`.

The rejected dual-export command was:

```text
--output type=oci,dest=<candidate.oci.tar>
--output type=docker,name=<candidate-tag>
```

- [x] **Step 5: Verify with a real no-cache ARM64 proof candidate**

Build one task-scoped candidate, prove OCI/runtime identity, smoke test it, and
confirm no Registry container or anonymous volume was created.

- [x] **Step 6: Run focused release tests**

```bash
bun test scripts/local-release/oci-runtime-identity.bun_spec.mjs scripts/local-release/oci.bun_spec.mjs scripts/local-release/cleanup.bun_spec.mjs
```

- [ ] **Step 7: Commit Task 2**

```bash
git add scripts/local-release/oci-runtime-identity.mjs scripts/local-release/oci-runtime-identity.bun_spec.mjs scripts/local-release/oci.mjs scripts/local-release/oci.bun_spec.mjs scripts/local-release/local-registry.mjs scripts/local-release/cleanup.mjs
git commit -m "build: verify directly loaded OCI candidates"
```

---

### Task 3: Cache-Free Warm Builder Lifecycle

**Files:**
- Modify: `scripts/local-release/oci.mjs`
- Modify: `scripts/local-release.mjs`
- Modify: `scripts/local-release/cleanup.mjs`
- Modify: `scripts/local-release/cleanup.bun_spec.mjs`
- Modify: `scripts/ci/integration.bun_spec.mjs`

**Interfaces:**
- Produces: `pruneReleaseBuilderCache()` with strict failure behavior.
- Updates: `buildOciCandidate({ reuseBuilder })`.
- Updates: `cleanupReleaseDockerState({ preserveBuilder })`.

- [ ] **Step 1: Write failing lifecycle tests**

Assert ARM64 recreates the builder, waiting-state cleanup strictly prunes but
does not remove it, AMD64 ensures/reuses it, and publish/reset/failure cleanup
removes it and its image.

- [ ] **Step 2: Run focused tests and confirm failure**

```bash
bun test scripts/local-release/cleanup.bun_spec.mjs scripts/ci/integration.bun_spec.mjs scripts/local-release/oci.bun_spec.mjs
```

- [ ] **Step 3: Implement explicit lifecycle**

Recreate once before ARM64. Strictly prune records before writing
`awaiting-approval`. Preserve only builder runtime and scanner database while
waiting. Reuse the builder for AMD64 and remove it in every terminal cleanup.

- [ ] **Step 4: Verify waiting and terminal disk invariants**

Run an ARM64 prepare, inspect `docker buildx du --builder homelab-release`, and
prove zero reclaimable records while the builder remains. Reset and prove the
builder, its volume, and its image are absent.

- [ ] **Step 5: Commit Task 3**

```bash
git add scripts/local-release/oci.mjs scripts/local-release.mjs scripts/local-release/cleanup.mjs scripts/local-release/cleanup.bun_spec.mjs scripts/ci/integration.bun_spec.mjs
git commit -m "build: retain cache-free builder through approval"
```

---

### Task 4: Timing, Documentation, Full Verification, and Cleanup

**Files:**
- Modify: `scripts/local-release/validate-image.mjs`
- Modify: `scripts/local-release/validate-image.bun_spec.mjs`
- Modify: `scripts/local-release/state.mjs`
- Modify: `src/release-notes.ts`
- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Modify: `DOCKERHUB.md`
- Modify: `docs/RELEASES.md`
- Modify: `docs/DEVELOPMENT.md`

**Interfaces:**
- Adds: architecture candidate `validationTimings` with import/proof, smoke,
  vulnerability database, Scout, and Trivy durations.

- [ ] **Step 1: Add failing timing receipt tests**

Assert scanner operations remain concurrent, timing fields are finite
non-negative integers, and no command output or error text is persisted.

- [ ] **Step 2: Implement validation subphase timing**

Measure runtime identity proof, smoke, database update, and both scanners while
retaining the existing top-level phase receipts.

- [ ] **Step 3: Update release documentation and unreleased notes**

Document parallel test families, exact direct OCI proof, temporary builder
retention, fallback behavior, and terminal cleanup.

- [ ] **Step 4: Run complete repository gates**

```bash
bun run lint
bun run test
bun run build
bun run security:container
```

- [ ] **Step 5: Run the complete non-publishing release benchmark**

```bash
bun run release:local prepare
bun run release:local approve
bun run release:local publish --channel latest --dry-run
```

Capture every timing, exact candidate digest, retained builder size, volume set,
and final disk state. Confirm the critical path is below 154.515 seconds and
target no more than 140 seconds under comparable network conditions.

- [ ] **Step 6: Remove every task-created artifact**

Reset release state, delete candidate archives and generated trees, remove the
release builder, scanner volume/images, direct-load images, and task-created
volumes, prune release build cache, reclaim Docker.raw, and preserve
`sehmadocker_mysql` plus all pre-existing volumes.

- [ ] **Step 7: Commit Task 4**

```bash
git add scripts/local-release/validate-image.mjs scripts/local-release/validate-image.bun_spec.mjs scripts/local-release/state.mjs src/release-notes.ts CHANGELOG.md README.md DOCKERHUB.md docs/RELEASES.md docs/DEVELOPMENT.md
git commit -m "docs: record optimized local release path"
```
