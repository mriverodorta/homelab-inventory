# LabGD Publication Recovery And Revision Convergence Design

## Status

Approved application-side design for Homelab Inventory. This specification does not change LabGD, Cloudflare, Registry publication, or deployment state.

## Context

Homelab Inventory already enrolls installations with LabGD using a stable Ed25519 identity, negotiates package-backed capabilities, publishes deterministic share manifests, and consumes a resumable installation event stream. Three remaining application defects can leave a valid publication permanently failed or can make the local logical share revision diverge from LabGD:

1. The publication client discards LabGD's staged operation state and durable failure code.
2. Publication completion increments the current local projection instead of converging on the logical revision implied by the immutable operation.
3. The installation event validator differs from LabGD's accepted payload states, timestamp rules, and account-unlink binding revision floor.

LabGD commit `730ffed2a7ceaf2a9d376432c4fb02b40091561e` already supports replaying a failed publication whose durable `failureCode` is `registry-definition-unavailable`. Replaying the original staging request returns the same remote operation, and activation can later succeed with the original expected logical share revision. No LabGD amendment is required.

## Goals

- Recover Registry-blocked publications without allocating a new public ID, local operation, remote operation, manifest, or uploaded blob set.
- Make publication completion, SSE delivery, crashes, and restarts converge on one exact logical share revision.
- Match LabGD's installation-event contract exactly and fail closed on malformed data.
- Prove all behavior through injected or loopback-only test infrastructure that cannot contact production LabGD.

## Non-Goals

- Changing LabGD's API or persistence.
- Adding a remote operation-status endpoint.
- Treating arbitrary failed operations as recoverable.
- Replacing permanent public share IDs.
- Changing signing, ownership, digest, or content-integrity rules.
- Deploying or versioning Homelab Inventory as part of implementation.

## Chosen Architecture

### Operation-Scoped Logical Revision

Each local publish operation stores `expected_remote_revision` before its first remote mutation. The value is the logical revision currently known for the share, or `0` for an initial publication. It is immutable for the lifetime of that operation.

The operation's expected result is always:

```text
resulting logical revision = expected_remote_revision + 1
```

LabGD's activation `revisionId` identifies the PostgreSQL `share_revisions` row. It is useful as validated replay evidence but is not the logical share revision and must never be copied into `shares.remote_revision`.

This design is preferred over deriving the expected revision at retry time because the current share projection may already have advanced through SSE. It is also preferred over adding a LabGD status endpoint because the existing stage and activate replay contract already supplies sufficient evidence.

### Ordered SQLite Migration

Migration `0035` adds nullable column `expected_remote_revision` to `share_publication_operations` with a non-negative integer check when present.

- New `publish` operations must always set it.
- Existing unfinished `publish` operations are backfilled from `shares.remote_revision`, defaulting to `0`.
- Non-publication operations retain `NULL` because their expected lifecycle revision remains represented by their idempotency input and current lifecycle implementation.
- Existing migrations remain byte-for-byte unchanged.
- Repeated migration execution is deterministic and idempotent through the existing migrator.

The repository rejects execution of a publish operation whose expected revision is absent after migration.

## Stage Response Contract

`LabGdPublicationClient.stage()` validates and returns a sanitized projection of LabGD's staged operation:

```js
{
  operationId,
  state,                  // staged | ready | active | failed
  failureCode,            // null or safe kebab-case code
  missingHashes,          // unique lowercase SHA-256 hashes
  activationResult: null | { operationId, revisionId }
}
```

Validation requirements:

- `operationId` is a positive safe integer.
- `state` is one of LabGD's exact publication operation states.
- `failureCode` is absent/null unless the operation is failed and is sanitized before persistence.
- `missingHashes` contains unique lowercase 64-character hexadecimal hashes only.
- An active operation includes a valid activation result whose operation ID matches the staged operation.
- Unknown or malformed response structures fail closed.

The local repository persists the same remote operation ID across every replay. If staging returns a different operation ID for the same immutable local operation, execution fails terminally as a contract-integrity error.

## Retry Taxonomy

Retry classification is centralized in a pure function used by the coordinator. Unknown errors are terminal by default.

### Durable Registry Recovery

Only `registry-definition-unavailable` receives durable recovery treatment.

- It remains retryable after six attempts.
- The attempt counter remains monotonic and persists across restarts.
- Delay uses exponential backoff with a 15-second base and a six-hour cap.
- A valid bounded `Retry-After` may increase the delay up to the same cap.
- Every attempt replays staging before activation so LabGD's durable operation state and failure code are authoritative.
- Uploaded blobs are reused; only hashes explicitly returned as missing are uploaded.

### Bounded Transient Recovery

Transport failures, timeouts, HTTP `408`, `425`, `429`, selected `5xx` readiness failures, and recoverable credential/readiness conditions may retry up to six total attempts. Delay uses the same 15-second base with a 15-minute cap and honors a smaller bounded `Retry-After` floor. Exhaustion changes the local operation to `failed`.

### Terminal Failures

The following are terminal immediately:

- Ownership denial or foreign-installation evidence.
- Idempotency conflicts or changed request digests.
- Manifest, blob, signature, hash, or replay-integrity failures.
- Invalid public IDs, response shapes, event payloads, or unsupported contracts.
- Other explicit client errors and unknown failures.

### Explicit Retry

An explicit user retry may requeue a failed operation only when all immutable fields match the existing row:

- share ID
- local revision ID
- idempotency key
- operation kind
- expected remote revision

The repository preserves the remote operation ID and attempt history. It does not reopen unrelated failures, changed manifests, or terminal integrity/ownership conflicts. Registry-unavailable operations normally recover automatically; explicit retry only wakes the same durable operation.

## Publication Execution Flow

1. Privacy preview persists an immutable local revision and manifest hash.
2. Enqueue captures `expected_remote_revision` transactionally with the operation row.
3. The worker stages the exact immutable request.
4. The client validates the returned operation state, failure code, missing hashes, and replay result.
5. The repository records the remote operation ID without replacing an existing different ID.
6. Missing blobs are uploaded from the immutable local revision.
7. Activation always receives the stored expected remote revision.
8. A Registry-unavailable activation is confirmed on the next staging replay and enters durable Registry recovery.
9. A successful activation supplies remote row evidence; the logical result remains `expected + 1`.
10. One SQLite transaction completes the operation and converges the share projection.

## Transactional Revision Convergence

The repository exposes a dedicated publication-completion transaction rather than composing `updateOperation()` and `updateShare()` calls.

Inputs include:

- local operation ID
- expected remote operation ID
- remote public ID
- expected remote logical revision
- resulting logical revision
- active manifest hash
- validated activation row ID

The transaction locks its logical state through SQLite's write transaction and applies these rules:

1. The operation must still reference the same local revision, idempotency key, expected revision, and remote operation.
2. The resulting revision must equal `expected + 1`.
3. If the share has no remote revision or is behind the result, set the exact result, active manifest hash, remote public ID, and `synced` state.
4. If the share is already at the result because SSE arrived first, retain that exact revision, attach the active manifest hash, and converge to `synced` only when the authoritative remote state is active/publishing for this publication.
5. If the share is newer than the result, mark the operation succeeded but preserve the newer revision, lifecycle state, active manifest projection, and local revision. Do not call the stale operation synchronized.
6. Never lower a remote revision.
7. Mark operation success, clear its safe error code, and persist activation replay evidence in the same transaction.

Crash behavior follows directly:

- Before activation: no remote mutation; retry uses the same expected revision.
- After remote activation but before local completion: stage/activation replay returns the same operation/result; completion converges once.
- After SSE but before local completion: the equal revision is recognized and not incremented.
- After local completion but before SSE: the later equal-revision SSE only advances the cursor.
- After any restart: persisted expected revision and remote operation evidence reproduce the same outcome.

## Installation Event Contract

The application accepts exactly these event kinds:

```text
publication, replacement, unpublish, deletion, expiration, grace-period,
account-claim, account-unlink, recovery
```

Share event payload states are exactly:

```text
staged, active, unpublished, deleted, expired
```

`grace-period` is an event kind, never a share payload state.

Every `occurredAt` value must be canonical:

```js
new Date(value).toISOString() === value
```

The validator continues requiring exact fields, event version `1`, bounded SSE frames, positive safe event/revision/operation IDs, safe generated public IDs, and exact affected-count objects.

Account-unlink `bindingRevision` accepts every non-negative safe integer, matching LabGD. Disposition counts must match LabGD exactly:

- `keep`: all affected shares are kept online.
- `unpublish`: all affected shares are unpublished.
- `delete`: all affected shares are deleted.

### Staged Projection

A valid staged share event maps to local `publishing`. The event's exact logical revision is recorded only when it does not lower a newer local projection. The active manifest hash is not invented or cleared. The event cursor advances in the same transaction even when no local share matches, preventing reconnect loops on valid historical events.

All duplicate or older events advance nothing beyond the already committed cursor and leave share state unchanged.

## Test Isolation

Automated tests use only injected fetch implementations, committed fixtures, or loopback ephemeral servers. A shared test fetch guard rejects:

- `lab.gd`
- `app.lab.gd`
- production aliases or configured non-loopback LabGD endpoints

The guard is installed before sharing protocol tests and records attempted destinations for assertions. The fake LabGD supports capability discovery, stage, upload, activation, Registry-unavailable failure, stage replay, recovery, SSE ordering, and lifecycle operations.

Demo, staging, and test modes retain `LABGD_ENABLED=false`, do not create installation identity/key/credential files, and do not open publication or event connections. The operator readiness verifier remains outside unit/integration tests and is not invoked by this work.

## Regression Coverage

Focused tests cover:

- Registry-unavailable retries beyond six attempts with bounded persisted backoff.
- Process restart using the same local operation, remote operation, public ID, digest, and blobs.
- Later Registry availability and one successful remote/local revision.
- Changed replays, ownership failures, and integrity failures remaining terminal.
- Explicit retry reopening only an identical eligible operation.
- All crash boundaries around activation, local completion, and SSE delivery.
- Repeated SSE delivery and repeated full repository/service reconstruction.
- Preservation of newer lifecycle revisions.
- Future lifecycle commands using the converged logical revision.
- Every supported event kind/state, staged mapping, canonical timestamps, binding revision zero, exact fields, malformed IDs, oversized frames, and transactional cursor replay.
- No production LabGD network attempt and no isolated-mode identity creation.

## Documentation And Release Notes

Implementation updates:

- `CHANGELOG.md` under `Unreleased`.
- The structured unreleased release-note draft in `src/release-notes.ts`.
- `docs/sharing.md` with the retry taxonomy, durable Registry recovery, logical revision convergence, and test-isolation guarantees.

No application version is bumped until the user explicitly requests deployment.

## Validation

Run:

```bash
bun install --frozen-lockfile
bun run lint
bun run test
bun run build
bun run db:migrations:check
bun run packages:public:check
bun run test:public-packages
```

The dual-architecture container security gate is not required until a push to `main`/`stable` or deployment preparation is requested. Task-created build output, caches, test databases, logs, and fixtures are removed after validation. Docker volumes are preserved.

## Safety Boundaries

- Do not modify or deploy HomelabInventoryShare.
- Do not contact production LabGD during tests.
- Do not create a real share.
- Do not change Cloudflare routing.
- Do not connect to SkyArk.
- Do not weaken signing, integrity, ownership, or replay validation.
- Do not replace a permanent public share ID.
