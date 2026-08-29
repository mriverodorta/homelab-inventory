# LabGD Publication Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Registry-blocked LabGD publications durably recoverable and make local share revisions converge exactly across activation, SSE replay, crashes, and restarts without contacting production LabGD.

**Architecture:** Persist each publish operation's immutable expected remote logical revision in SQLite, validate LabGD staging replay metadata, classify failures explicitly, and complete publication plus share convergence in one repository transaction. Align the installation-event validator with LabGD's frozen contract and exercise the full lifecycle through injected fake transport guarded against production hosts.

**Tech Stack:** Bun, TypeScript, JavaScript ES modules, SQLite, Drizzle schema definitions, Vitest, React structured release notes.

## Global Constraints

- Application repository: `/Users/maikeldorta/Code/home-datacenter/ServerSpecsInventory`.
- Reference LabGD commit: `730ffed2a7ceaf2a9d376432c4fb02b40091561e`; do not modify or deploy it.
- Do not contact `lab.gd`, `app.lab.gd`, SkyBolt LabGD ports, production aliases, Cloudflare, or SkyArk.
- Keep demo, staging, and test modes at `LABGD_ENABLED=false` with no identity or credential creation.
- Do not replace public share IDs or weaken Ed25519, ownership, digest, hash, scope, or replay validation.
- Add migration `0035`; do not edit prior migrations.
- Do not bump the application version or run the container security gate unless deployment is separately requested.
- Preserve Docker volumes and remove task-created temporary files, build output, and caches after validation.

---

### Task 1: Persist Immutable Publication Revision Intent

**Files:**
- Create: `server/persistence/core/migrations/generated/0035_labgd_publication_convergence.sql`
- Modify: `server/persistence/core/migrations/manifest.ts`
- Modify: `server/persistence/core/schema/sharing.ts`
- Modify: `server/persistence/core/schema/schema.bun_spec.ts`
- Modify: `server/persistence/core/repositories/sharing-repository.ts`
- Test: `server/persistence/sqlite-store.bun_spec.ts`

**Interfaces:**
- Produces operation field `expectedRemoteRevision: number | null`.
- Produces `completePublication(input)` for atomic operation/share convergence.
- Extends `enqueueOperation(input)` with `expectedRemoteRevision` and explicit identical retry control.

- [x] **Step 1: Write failing migration and repository tests**

Cover migration backfill for unfinished publication rows, rejection of negative revisions, new operation persistence, restart reads, different immutable request rejection, identical explicit retry, and one-transaction convergence for behind/equal/newer share projections.

- [x] **Step 2: Run focused tests and verify failure**

```bash
bunx vitest run server/persistence/core/schema/schema.bun_spec.ts
bun test server/persistence/sqlite-store.bun_spec.ts
```

Expected: failures for missing migration `0035`, missing `expectedRemoteRevision`, and missing `completePublication`.

- [x] **Step 3: Add migration and schema**

Add `expected_remote_revision INTEGER` with a non-negative check. Backfill unfinished publish operations from `shares.remote_revision`, using `0` when absent. Register `0035_labgd_publication_convergence` after migration `0034`.

- [x] **Step 4: Add strict repository operations**

`enqueueOperation` captures expected revision for publish operations. Conflict handling returns existing immutable operations, reopens only an explicitly requested identical eligible failure, and preserves remote operation ID plus attempt history. `completePublication` validates operation identity and commits operation success plus exact share convergence atomically.

- [x] **Step 5: Run focused persistence tests**

```bash
bunx vitest run server/persistence/core/schema/schema.bun_spec.ts
bun test server/persistence/sqlite-store.bun_spec.ts
```

Expected: PASS.

### Task 2: Validate Durable LabGD Stage Replay Metadata

**Files:**
- Modify: `server/sharing/labgd-client.mjs`
- Test: `server/sharing/labgd-client.test.mjs`

**Interfaces:**
- Produces `stage()` result `{ operationId, state, failureCode, missingHashes, activationResult }`.
- Adds safe remote error metadata `status` and bounded `retryAfterMs`.

- [x] **Step 1: Write failing client contract tests**

Use injected `signedFetch` responses for staged, ready, failed Registry, and active replay operations. Reject malformed state, duplicate/invalid hashes, mismatched activation operation IDs, unsafe failure codes, unknown fields required by the sanitized projection, and oversized bodies.

- [x] **Step 2: Run the focused test**

```bash
bunx vitest run server/sharing/labgd-client.test.mjs
```

Expected: failures because stage currently returns only operation ID and missing hashes.

- [x] **Step 3: Implement strict stage projection**

Validate LabGD's response and return only the sanitized fields consumed by publication recovery. Preserve HTTP status and bounded retry delay on remote errors without retaining response payloads.

- [x] **Step 4: Run the focused test**

```bash
bunx vitest run server/sharing/labgd-client.test.mjs
```

Expected: PASS.

### Task 3: Implement Explicit Retry Classification

**Files:**
- Create: `server/sharing/publication-retry-policy.mjs`
- Create: `server/sharing/publication-retry-policy.test.mjs`
- Modify: `server/sharing/publication-coordinator.mjs`
- Modify: `server/sharing/publication-coordinator.test.mjs`

**Interfaces:**
- Produces `classifyPublicationFailure(error, attemptCount)` returning `{ disposition, delayCapMs, maxAttempts }`.
- Produces `publicationRetryDelay(classification, attemptCount, retryAfterMs)`.

- [x] **Step 1: Write failing retry taxonomy tests**

Assert durable unlimited-attempt treatment only for `registry-definition-unavailable`; six-attempt bounded treatment for transport/timeouts, `408`, `425`, `429`, selected `5xx`, readiness, and recoverable authentication; and terminal treatment for ownership, idempotency, integrity, unsupported, malformed `4xx`, and unknown errors.

- [x] **Step 2: Run focused policy/coordinator tests**

```bash
bunx vitest run server/sharing/publication-retry-policy.test.mjs server/sharing/publication-coordinator.test.mjs
```

Expected: failure because the coordinator still retries every non-unsupported error six times.

- [x] **Step 3: Implement and integrate policy**

Use a 15-second base. Cap durable Registry delay at six hours and bounded transient delay at 15 minutes. Honor a valid bounded `Retry-After`. Persist monotonic attempt counts, next availability, and safe error codes. Keep the share in publishing/failed state according to whether work remains retryable.

- [x] **Step 4: Run focused policy/coordinator tests**

```bash
bunx vitest run server/sharing/publication-retry-policy.test.mjs server/sharing/publication-coordinator.test.mjs
```

Expected: PASS, including Registry recovery after attempt six and restart-preserved backoff.

### Task 4: Converge Publication, SSE, And Replay

**Files:**
- Modify: `server/sharing/publication-service.mjs`
- Modify: `server/sharing/publication-service.test.mjs`
- Modify: `server/persistence/core/repositories/sharing-repository.ts`
- Test: `server/persistence/sqlite-store.bun_spec.ts`

**Interfaces:**
- Consumes persisted `expectedRemoteRevision` and client stage replay metadata.
- Consumes repository `completePublication(input)`.
- Produces idempotent execution across all activation/SSE ordering cases.

- [x] **Step 1: Write failing crash-boundary tests**

Cover no mutation before activation; remote activation before local completion; SSE before replay; replay before SSE; duplicate SSE; repeated repository/service reconstruction; newer lifecycle revision preservation; and future lifecycle calls using the exact converged revision.

- [x] **Step 2: Run focused service and persistence tests**

```bash
bunx vitest run server/sharing/publication-service.test.mjs
bun test server/persistence/sqlite-store.bun_spec.ts
```

Expected: failures from blind `(share.remoteRevision ?? 0) + 1` behavior.

- [x] **Step 3: Implement immutable execution flow**

Capture expected revision at enqueue, stage the exact request on every retry, require stable remote operation identity, upload only validated missing hashes, activate using the stored expected revision, and call `completePublication` with logical result `expected + 1`. Treat an active stage replay as success evidence without inventing a second remote mutation.

- [x] **Step 4: Run focused service and persistence tests**

```bash
bunx vitest run server/sharing/publication-service.test.mjs
bun test server/persistence/sqlite-store.bun_spec.ts
```

Expected: PASS with one local operation, one remote operation, one public ID, and one logical revision.

### Task 5: Align Installation Event Contract

**Files:**
- Modify: `server/sharing/installation-event-coordinator.mjs`
- Modify: `server/sharing/installation-event-coordinator.test.mjs`
- Modify: `server/persistence/core/repositories/sharing-repository.ts`
- Test: `server/persistence/sqlite-store.bun_spec.ts`

**Interfaces:**
- Accepts exact LabGD event kinds and share states.
- Maps remote `staged` to local `publishing`.
- Commits cursor and safe projection in one SQLite transaction.

- [x] **Step 1: Write failing exact-contract tests**

Exercise all event kinds and share states, staged mapping, rejected `grace-period` payload state, canonical timestamps, binding revision zero, exact unlink disposition totals, unknown fields/versions, malformed IDs, oversized frames, cross-installation/unmatched events, and duplicate cursor replay.

- [x] **Step 2: Run focused event tests**

```bash
bunx vitest run server/sharing/installation-event-coordinator.test.mjs
bun test server/persistence/sqlite-store.bun_spec.ts
```

Expected: failures for staged state, timestamp normalization, and binding revision zero.

- [x] **Step 3: Implement exact validator and projection**

Require `new Date(value).toISOString() === value`, accept only LabGD's five share payload states, keep `grace-period` as a kind, validate unlink counts by disposition, map staged to publishing, never lower a revision, and always advance a valid unmatched event cursor once.

- [x] **Step 4: Run focused event tests**

```bash
bunx vitest run server/sharing/installation-event-coordinator.test.mjs
bun test server/persistence/sqlite-store.bun_spec.ts
```

Expected: PASS.

### Task 6: Add Isolated Full Publication Contract Harness

**Files:**
- Create: `server/sharing/test-network-guard.mjs`
- Create: `server/sharing/test-network-guard.test.mjs`
- Create: `server/sharing/fake-labgd-contract.test.mjs`
- Modify: `server/external-access-policy.test.mjs`
- Modify: `server/sharing/publication-service.test.mjs`

**Interfaces:**
- Produces `createTestFetchGuard(fetchImpl)` that rejects non-loopback LabGD destinations.
- Fake contract supports stage, upload, failed activation, staging replay, successful recovery, SSE ordering, and lifecycle commands.

- [x] **Step 1: Write failing network-guard and lifecycle tests**

Prove direct and redirected production host attempts fail before fetch, loopback/in-memory transport works, Registry recovery uses the same remote operation/public ID, and demo/test modes never enroll, renew, publish, or open SSE.

- [x] **Step 2: Run focused isolation tests**

```bash
bunx vitest run server/sharing/test-network-guard.test.mjs server/sharing/fake-labgd-contract.test.mjs server/external-access-policy.test.mjs
```

Expected: failure until the shared guard and fake lifecycle exist.

- [x] **Step 3: Implement guard and fake contract harness**

Keep fixtures synthetic and secret-free. Inject transport into every protocol path. Record attempted destinations and assert that production hostname counters remain zero.

- [x] **Step 4: Run focused isolation tests**

```bash
bunx vitest run server/sharing/test-network-guard.test.mjs server/sharing/fake-labgd-contract.test.mjs server/external-access-policy.test.mjs
```

Expected: PASS with zero production attempts.

### Task 7: Documentation, Release Notes, And Complete Validation

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `src/release-notes.ts`
- Modify: `docs/sharing.md`
- Modify: `docs/superpowers/plans/2026-08-29-labgd-publication-convergence.md`

**Interfaces:**
- Documents retry taxonomy, immutable logical revision convergence, exact event contract, and isolation guarantee.

- [x] **Step 1: Update human and structured release notes**

Add user-visible reliability/security fixes under `Unreleased` without changing version fields.

- [x] **Step 2: Update sharing documentation**

Describe Registry-unavailable durable recovery, bounded transient versus terminal failures, expected logical revision behavior, staged event projection, and no-production-test boundary.

- [x] **Step 3: Run complete required validation**

```bash
bun install --frozen-lockfile
bun run lint
bun run test
bun run build
bun run db:migrations:check
bun run packages:public:check
bun run test:public-packages
```

Expected: every command exits `0` and no test network guard records a production LabGD request.

- [x] **Step 4: Inspect repository and reference-service boundaries**

```bash
git diff --check
git status --short
git -C ../HomelabInventoryShare status --short
git -C ../HomelabInventoryShare rev-parse HEAD
```

Expected: only intended application changes before commit; LabGD remains clean at `730ffed2a7ceaf2a9d376432c4fb02b40091561e`.

- [x] **Step 5: Remove generated artifacts and commit**

Remove task-created `dist`, Vite cache, test databases, logs, and temporary fixtures while preserving source, dependencies, and every Docker volume. Commit the implementation and documentation with no version bump.
