# Local Staged Release Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build, test, approve, and publish Homelab Inventory releases from the maintainer's Mac using a production-shaped local ARM64 staging container and exact OCI artifact promotion.

**Architecture:** A Bun command orchestrates a persisted release state machine composed of focused modules for preflight/state, live SQLite snapshots, sanitization, OCI builds, validation, staging, and publication. ARM64 is built and approved first; AMD64 is built only after approval, then the exact local OCI layouts are copied to Docker Hub and assembled into a multi-platform index without rebuilding.

**Tech Stack:** Bun 1.3.14, TypeScript/JavaScript, Docker Buildx/BuildKit, OCI image layouts, ORAS 1.3.3, Docker Scout, Trivy 0.73.0, SQLite online backup, SSH, rsync, Git, GitHub CLI.

## Global Constraints

- Production is read-only and ordinary repository `./data` is never changed.
- Every `prepare` creates a fresh consistent production snapshot and uses rsync only against that stable snapshot.
- Authentication, Agent mutation, Registry enrollment/contribution, notifications, updates, and all external effects are disabled in staging.
- ARM64 must pass scanning, smoke, migration, integrity, and staging checks before manual approval.
- AMD64 is built only after approval and must pass the same platform checks before publication.
- Docker Hub receives the exact tested OCI manifests; publication cannot invoke Docker build.
- Final runtime remains pinned distroless and both Scout and Trivy must report zero vulnerabilities at every severity.
- A source or image-input change invalidates approval and both architecture candidates.
- Release state, production-shaped data, credentials, OCI layouts, and receipts never enter Git.
- No semver bump, Docker publication, Git tag, or deployment occurs during implementation.

---

### Task 1: Release State, Paths, Locking, And CLI Skeleton

**Files:**
- Create: `scripts/local-release/config.mjs`
- Create: `scripts/local-release/state.mjs`
- Create: `scripts/local-release/process.mjs`
- Create: `scripts/local-release/state.test.mjs`
- Create: `scripts/local-release.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces `releasePaths(environment)`, `readReleaseState(paths)`, `writeReleaseState(paths, state)`, `withReleaseLock(paths, operation)`, `currentReleaseIdentity(root)`, and `run(command, options)`.
- CLI supports `prepare`, `status`, `approve`, `publish`, `logs`, `stop`, `reset`, and `warm-cache`; unimplemented phases fail explicitly until later tasks supply handlers.

- [ ] Write Bun tests for path derivation, atomic state writes, stale-lock refusal, initial state, and revision/input fingerprint calculation.
- [ ] Run `bun test scripts/local-release/state.test.mjs` and confirm failure because modules do not exist.
- [ ] Implement focused configuration, process, and state modules plus the CLI command parser.
- [ ] Add `"release:local": "bun scripts/local-release.mjs"` to package scripts.
- [ ] Run the focused test and `bun run release:local status`.
- [ ] Commit `feat: add local release state machine`.

### Task 2: Staging Runtime Policy

**Files:**
- Create: `server/staging-policy.mjs`
- Create: `server/staging-policy.test.mjs`
- Modify: `server/runtime-config.mjs`
- Modify: `server/runtime-config.test.mjs`
- Modify: `server/index.mjs`
- Modify: `server/app-health.mjs`
- Modify: `server/app-health.test.mjs`

**Interfaces:**
- Produces `createStagingPolicy({ appMode, bindAddress })` with flags for authentication bypass, Agent route disablement, Registry no-enrollment/no-contribution policy, notification delivery disablement, update-check disablement, backup-schedule disablement, and loopback binding validation.
- Extends `APP_MODE` with `staging`; health reports `mode: "staging"`.

- [ ] Write tests proving staging binds only to loopback, bypasses authentication, disables every external-effect route/scheduler, keeps normal inventory/catalog reads available, and reports staging health.
- [ ] Run focused tests and confirm failure.
- [ ] Implement the policy and wire all server services to explicit policy flags instead of conflating staging with demo session behavior.
- [ ] Ensure staging never creates a Registry installation identity and never starts notification, contribution, catalog-status, backup, or update delivery schedules.
- [ ] Run focused server tests plus agent, Registry, notification, auth, backup, and update tests.
- [ ] Commit `feat: add isolated staging runtime mode`.

### Task 3: Consistent Live Snapshot And Incremental Transfer

**Files:**
- Create: `scripts/local-release/snapshot.mjs`
- Create: `scripts/local-release/snapshot.test.mjs`
- Create: `scripts/local-release/remote-snapshot.mjs`

**Interfaces:**
- Produces `createRemoteSnapshot(config, paths)`, `syncRemoteSnapshot(config, paths, manifest)`, and `activateIncomingData(paths)`.
- Remote helper opens live SQLite databases through Bun, uses `Database.serialize()`/SQLite online backup APIs into a temporary root, copies immutable/support files excluding WAL/SHM, private identities, secrets, backups, and temporary files, verifies database integrity, and writes `snapshot-manifest.json`.

- [ ] Write tests with live WAL-mode fixtures proving the snapshot contains committed rows, excludes `-wal`/`-shm`, passes integrity checks, and cleans remote staging after failure.
- [ ] Write tests proving the incoming baseline is cloned from current, rsync-style deletion removes stale files, activation is atomic, and only one previous snapshot remains.
- [ ] Run focused tests and confirm failure.
- [ ] Implement the remote snapshot helper and SSH/rsync orchestration with configurable `HOMELAB_RELEASE_REMOTE_HOST` and stack/data defaults.
- [ ] Validate remote and local manifests and content hashes without logging payloads.
- [ ] Run focused tests and a read-only snapshot dry run against `bolt` into a temporary test root.
- [ ] Commit `feat: add consistent live staging snapshots`.

### Task 4: Staging Sanitization And Validation

**Files:**
- Create: `scripts/local-release/sanitize.mjs`
- Create: `scripts/local-release/sanitize.test.mjs`

**Interfaces:**
- Produces `sanitizeStagingData(dataDir)` returning a sanitized-data fingerprint and count summary, and `validateStagingData(dataDir)`.
- Operates only on incoming copies and uses SQLite transactions for core state.

- [ ] Write fixtures containing authentication, sessions, Registry enrollment, active Agent credentials, notification secrets/deliveries, backup archives, and update state.
- [ ] Write tests proving reusable inventory/topology/catalog/telemetry/history remain while credentials, identities, sessions, pending outbound work, and backup archives are removed or disabled.
- [ ] Write tests proving validation rejects any remaining private identity file, enabled external effect, symlink, unsafe permission, or non-loopback staging configuration.
- [ ] Run focused tests and confirm failure.
- [ ] Implement transaction-safe database sanitization, filesystem removal, permission enforcement, and deterministic fingerprinting.
- [ ] Run focused tests and sanitize a disposable copy of the live dry-run snapshot.
- [ ] Commit `feat: sanitize production-shaped staging data`.

### Task 5: OCI Candidate Build, Loading, Smoke Tests, And Scans

**Files:**
- Create: `scripts/local-release/oci.mjs`
- Create: `scripts/local-release/oci.test.mjs`
- Create: `scripts/local-release/validate-image.mjs`
- Refactor: `scripts/check-container-security.mjs`
- Modify: `Dockerfile`
- Modify: `server/update-checker.mjs`
- Modify: `server/update-checker.test.mjs`
- Modify: `scripts/verify-published-image.mjs`
- Modify: `scripts/verify-published-image.test.mjs`

**Interfaces:**
- Produces `ensureReleaseBuilder(paths)`, `buildOciCandidate(identity, platform, paths)`, `loadOciCandidate(candidate)`, `validateCandidate(candidate)`, and shared `smokeTestImage`/`scanImage` functions.
- Uses channel-neutral immutable metadata so the same bytes can be tagged `latest`, `stable`, and semver; update verification derives channel from the requested tag/runtime setting rather than requiring a mutable channel label.

- [ ] Write tests for build command generation, external local/registry cache wiring, pinned metadata, OCI digest receipts, and input fingerprint invalidation.
- [ ] Write update-check tests proving channel-neutral manifests are accepted only through valid latest/stable/version tags while legacy channel labels remain readable.
- [ ] Run tests and confirm failure.
- [ ] Extract reusable smoke/scan logic from the existing security script without weakening its direct command behavior.
- [ ] Implement the dedicated builder, local OCI export, daemon loading, Scout/Trivy scans, health and SQLite checks, SBOM/provenance verification, and immutable receipt writing.
- [ ] Run tests, build a warm ARM64 candidate, load it, smoke-test it, and verify its config digest matches the OCI receipt.
- [ ] Commit `feat: build exact local OCI release candidates`.

### Task 6: ARM64 Staging Deployment And Approval

**Files:**
- Create: `scripts/local-release/staging.mjs`
- Create: `scripts/local-release/staging.test.mjs`
- Modify: `scripts/local-release.mjs`

**Interfaces:**
- Produces `deployStaging(candidate, paths)`, `checkStaging(paths)`, `stopStaging()`, `stagingLogs()`, and `approveStaging(state, identity, check)`.
- Runs `homelab-inventory-staging` on `127.0.0.1:8799` with `APP_MODE=staging`, no restart policy, current staging data, and explicit outbound-disable environment.

- [ ] Write tests for exact image selection, loopback binding, current-data mounting, health timeout, integrity baseline, approval binding, and approval invalidation.
- [ ] Run focused tests and confirm failure.
- [ ] Implement deployment, health/integrity checks, logs/stop commands, approval receipt, and state transitions.
- [ ] Wire `prepare` to snapshot, sanitize, ARM64 build/validate, deploy, and stop for approval; wire `approve`, `status`, `logs`, and `stop`.
- [ ] Run focused tests and a complete local `prepare` against the sanitized live snapshot, leaving staging on port 8799.
- [ ] Commit `feat: stage and approve arm64 release candidates`.

### Task 7: Exact AMD64 Publication And Release Finalization

**Files:**
- Create: `scripts/local-release/tools.mjs`
- Create: `scripts/local-release/publish.mjs`
- Create: `scripts/local-release/publish.test.mjs`
- Modify: `scripts/local-release.mjs`
- Modify: `scripts/release-plan.mjs`
- Modify: `scripts/release-plan.test.mjs`

**Interfaces:**
- Produces `ensurePinnedOras(paths)` pinned to ORAS 1.3.3 and verified by upstream SHA-256, `publishCandidate({ channel, state, paths })`, and `verifyRemotePublication(receipt)`.
- Copies exact OCI layouts to revision-scoped temporary Docker Hub tags, assembles one index, verifies digest parity, then moves release tags idempotently.

- [ ] Write tests proving publication requires valid approval, builds AMD64 once, never invokes an ARM64 build, rejects changed inputs, rejects conflicting immutable tags, and resumes interrupted tag promotion.
- [ ] Write command-capture tests for ORAS OCI-layout copy, Buildx index assembly, remote digest verification, main/latest policy, and stable/stable+semver+minor+GitHub release policy.
- [ ] Run focused tests and confirm failure.
- [ ] Implement pinned ORAS bootstrap, AMD64 build/validation, exact blob upload, multi-platform index creation, tag promotion, Git/GitHub finalization, and final receipts.
- [ ] Add a `--dry-run` publication mode that performs every local phase and remote ownership read but no registry, Git, or GitHub mutation.
- [ ] Run tests and complete a dry-run publication from an approved candidate.
- [ ] Commit `feat: publish exact local multi-platform releases`.

### Task 8: Cache Warming, Cleanup Survival, And GitHub Workflow Cutover

**Files:**
- Create: `scripts/local-release/cache.mjs`
- Create: `scripts/local-release/cache.test.mjs`
- Modify: `scripts/local-release.mjs`
- Modify: `.github/workflows/docker-publish.yml`
- Modify: `.github/workflows/docker-backfill.yml`
- Modify: `.githooks/pre-push`

**Interfaces:**
- Produces `warmReleaseCache(paths)` and `pruneReleaseCache(paths, policy)` with bounded storage/age behavior.
- GitHub Docker publishing workflows become non-publishing validation/manual notices; local release command owns publication.

- [ ] Write tests for cache locations outside Docker Desktop, registry-cache fallback, pinned base/tool warming, and bounded pruning.
- [ ] Run focused tests and confirm failure.
- [ ] Implement warm-cache and cache retention.
- [ ] Replace the duplicate pre-push full rebuild with verification of a current local zero-vulnerability receipt when pushing main/stable; if absent or stale, invoke the local security preflight.
- [ ] Remove automatic Docker publication credentials and branch-triggered image writes from GitHub workflows while keeping CI and scheduled published-image monitoring.
- [ ] Run workflow syntax/static tests and prove `dclaim` cannot delete OCI candidates, receipts, staging data, or external cache; restore a deliberately removed cache with `warm-cache`.
- [ ] Commit `ci: move Docker releases to local staging pipeline`.

### Task 9: Documentation, Release Notes, And Full Verification

**Files:**
- Modify: `docs/DEVELOPMENT.md`
- Modify: `docs/DOCKER.md`
- Modify: `README.md`
- Modify: `DOCKERHUB.md`
- Modify: `CHANGELOG.md`
- Modify: structured unreleased release-note draft under `src/`

**Interfaces:**
- Documents prerequisites, exact commands, staging-data protections, approval/publish lifecycle, cache behavior, `dclaim`, failure recovery, and channel promotion.

- [ ] Add maintainer documentation and concise public release-channel wording.
- [ ] Record the security-relevant workflow change in Unreleased changelog and structured release notes without bumping semver.
- [ ] Run all local-release tests, server policy tests, release-plan tests, and published-image tests.
- [ ] Run `bun run lint`, `bun run test`, `bun run build`, and `bun run security:container`.
- [ ] Run a complete local dry release: fresh live snapshot, sanitization, ARM64 candidate and staging, manual approval, AMD64 candidate, local index, and publication dry run.
- [ ] Review Git diff for private data, credentials, OCI artifacts, staging data, and runtime files.
- [ ] Commit `docs: document local staged release workflow`.
