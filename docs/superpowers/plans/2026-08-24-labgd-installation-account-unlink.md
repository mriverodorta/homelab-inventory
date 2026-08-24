# LabGD Installation Account Unlink Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a capability-gated, installation-authenticated LabGD account unlink flow that keeps sharing enrollment active and atomically applies the selected remote-share disposition.

**Architecture:** LabGD remains authoritative for account ownership and performs one idempotent transaction. Homelab Inventory negotiates account-status v2 and unlink support, persists a binding revision plus durable local attempt identity, signs the remote request, commits the authoritative result to SQLite, and reconciles other browsers through the existing resumable SSE stream. The UI is isolated in a dedicated dialog component and never receives installation credentials.

**Tech Stack:** Bun, Express 5, TypeScript, React 19, TanStack Query, Drizzle schema definitions, `bun:sqlite`, Vitest, Testing Library, Ed25519 signed LabGD requests, Server-Sent Events.

## Global Constraints

- Preserve `GET /v1/installations/account-status` v1 exactly; binding revisions use the separately negotiated `/v1/installations/account-status-v2` endpoint.
- Hide account unlink unless LabGD advertises status version 2, `unlinkSupported: true`, and exactly `keep`, `unpublish`, and `delete` dispositions.
- Unlinking must retain the installation UUID, Ed25519 key, credentials, enrollment, and enabled sharing connection.
- Keep affects remote shares only by removing account ownership; unpublish preserves IDs and history; delete preserves permanent public-ID reservations.
- Local unpublished drafts remain unchanged.
- Permanent delete requires an exact `DELETE` confirmation.
- The complete account/share result commits through SQLite without workspace-engine synchronization or cable routing.
- Demo and staging modes never enroll, claim, unlink, publish, or open sharing installation events.
- Do not modify the app version, create release tags, push, or deploy during implementation.
- Update `CHANGELOG.md` and `UNRELEASED_RELEASE_NOTES` for this user-visible feature.
- Leave the pre-existing untracked `.superpowers/` directory untouched.

---

### Task 1: Freeze The Application/LabGD Contract Boundary

**Files:**
- Modify: `server/sharing/remote-capabilities.mjs`
- Modify: `server/sharing/capabilities.mjs`
- Modify: `server/sharing/remote-capabilities.test.mjs`
- Modify: `server/sharing/capabilities.test.mjs`
- Modify: `test/support/fake-labgd.mjs`
- Create: `docs/handoffs/lab-gd-installation-account-unlink-v1.md`

**Interfaces:**
- Produces: `remote.accountUnlink: boolean` and public `capabilities.accountUnlink: boolean`.
- Produces: fake LabGD v2 status and unlink endpoints used by later application tests.
- Preserves: exact status-v1 behavior for already-deployed clients.

- [ ] **Step 1: Add failing capability normalization tests**

Add tests proving this declaration enables unlink:

```js
accountClaiming: {
  supported: true,
  statusSupported: true,
  statusVersions: [1, 2],
  unlinkSupported: true,
  unlinkDispositions: ['keep', 'unpublish', 'delete'],
}
```

Also prove absent unlink fields or `unlinkSupported: false` leave unlink
disabled, while a present declaration with missing v2, duplicate dispositions,
missing dispositions, or an unknown disposition fails strict validation. The
rest of sharing must remain usable when unlink fields are absent.

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```bash
bunx vitest run server/sharing/remote-capabilities.test.mjs server/sharing/capabilities.test.mjs
```

Expected: failure because `accountUnlink` is not projected.

- [ ] **Step 3: Implement strict optional unlink negotiation**

Extend normalized capabilities with:

```js
accountUnlink: capabilities.accountClaiming.unlinkSupported === true
  && integerList(capabilities.accountClaiming.statusVersions).includes(2)
  && exactStringSet(capabilities.accountClaiming.unlinkDispositions, ['keep', 'unpublish', 'delete']),
```

Do not call the existing non-empty `integerList` helper when `statusVersions` is
absent. Treat an absent unlink declaration as supported account claiming with
unlink disabled. Reject malformed declarations rather than guessing.

- [ ] **Step 4: Extend the fake LabGD contract**

Add in-memory account state with `bindingRevision`, an exact v1 status route, an
exact v2 route, and an unlink route that validates:

```ts
type UnlinkRequest = {
  requestVersion: 1
  idempotencyKey: string
  expectedAccountBindingRevision: number
  shareDisposition: 'keep' | 'unpublish' | 'delete'
}
```

The fake must replay an identical idempotency request, reject changed input,
increment the binding revision, and return bounded counts.

- [ ] **Step 5: Write the LabGD handoff**

Document the exact capability, v2 status response, unlink request/response,
stable errors, per-share lifecycle events, account-unlink summary event,
transaction ordering, PostgreSQL migration requirements, dashboard entry point,
and required integration tests. State that LabGD must deploy first and preserve
status v1 unchanged.

- [ ] **Step 6: Run focused tests and commit**

```bash
bunx vitest run server/sharing/remote-capabilities.test.mjs server/sharing/capabilities.test.mjs
git add server/sharing/remote-capabilities.mjs server/sharing/capabilities.mjs server/sharing/remote-capabilities.test.mjs server/sharing/capabilities.test.mjs test/support/fake-labgd.mjs docs/handoffs/lab-gd-installation-account-unlink-v1.md
git commit -m "feat: negotiate LabGD account unlink"
```

---

### Task 2: Persist Binding Revisions And Durable Unlink Attempts

**Files:**
- Create: `server/persistence/core/migrations/generated/0030_sharing_account_unlink.sql`
- Modify: `server/persistence/core/migrations/manifest.ts`
- Modify: `server/persistence/core/schema/sharing.ts`
- Modify: `server/persistence/core/repositories/sharing-repository.ts`
- Modify: `server/persistence/core/repositories/sharing-repository.bun_spec.ts`
- Modify: `scripts/check-database-migrations.bun_spec.mjs`

**Interfaces:**
- Produces: `SharingInstallationProjection.accountBindingRevision: number`.
- Produces: `prepareAccountUnlink`, `markAccountUnlinkRetryable`, `failAccountUnlink`, and `completeAccountUnlink` repository methods.
- Consumes later: one durable `clientAttemptId` maps to one server-generated remote idempotency key.

- [ ] **Step 1: Write failing migration and repository tests**

Test a migration from both unclaimed and claimed migration-29 databases:

```ts
expect(unclaimed.accountBindingRevision).toBe(0)
expect(claimed.accountBindingRevision).toBe(1)
```

Test that preparing the same `clientAttemptId`, binding revision, and
disposition returns the same operation and remote key, while changed input is
rejected. Test all three completion dispositions and a local/remote count
mismatch.

- [ ] **Step 2: Run focused SQLite tests and verify failure**

```bash
bun test server/persistence/core/repositories/sharing-repository.bun_spec.ts scripts/check-database-migrations.bun_spec.mjs
```

Expected: failure because migration 31 and repository methods do not exist.

- [ ] **Step 3: Add the ordered migration**

Create `0030_sharing_account_unlink.sql` with:

```sql
ALTER TABLE sharing_installation_projection
ADD COLUMN account_binding_revision integer NOT NULL DEFAULT 0
CHECK(account_binding_revision >= 0);

UPDATE sharing_installation_projection
SET account_binding_revision = 1
WHERE account_claimed = 1 AND account_binding_revision = 0;

CREATE TABLE sharing_account_operations (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  client_attempt_id text NOT NULL,
  remote_idempotency_key text NOT NULL,
  share_disposition text NOT NULL,
  expected_account_binding_revision integer NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  result_json text,
  last_error_code text,
  actor_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  created_at_ms integer NOT NULL,
  updated_at_ms integer NOT NULL,
  CONSTRAINT sharing_account_operations_client_attempt_unique UNIQUE(client_attempt_id),
  CONSTRAINT sharing_account_operations_remote_key_unique UNIQUE(remote_idempotency_key),
  CONSTRAINT sharing_account_operations_disposition_check CHECK(share_disposition IN ('keep','unpublish','delete')),
  CONSTRAINT sharing_account_operations_revision_check CHECK(expected_account_binding_revision >= 0),
  CONSTRAINT sharing_account_operations_state_check CHECK(state IN ('pending','retrying','succeeded','failed')),
  CONSTRAINT sharing_account_operations_result_check CHECK(result_json IS NULL OR json_valid(result_json))
);
```

Add the exact SHA-256 to migration manifest entry
`0031_sharing_account_unlink`.

- [ ] **Step 4: Implement repository preparation and completion**

Use these types:

```ts
export type ShareDisposition = 'keep' | 'unpublish' | 'delete'

export type AccountUnlinkResult = Readonly<{
  account: { connected: false; githubUsername: null; bindingRevision: number }
  disposition: ShareDisposition
  affected: { shares: number; keptOnline: number; unpublished: number; deleted: number }
}>
```

`completeAccountUnlink` must run one immediate SQLite transaction that:

1. Verifies the operation is pending/retrying and result matches its disposition.
2. Clears account claim fields and stores the new binding revision.
3. Counts local rows with a remote public ID excluding already deleted rows.
4. Applies the disposition only when the local count equals `affected.shares`.
5. Marks count mismatch for SSE reconciliation without modifying share rows.
6. Stores the exact bounded result and marks the operation succeeded.
7. Inserts a `security_events` row with actor, disposition, counts, and result.

Do not increment local share revisions merely to clear account ownership. For
unpublish/delete, update only remote state fields necessary to match LabGD;
later per-share SSE events supply authoritative remote revisions.

- [ ] **Step 5: Run migration and repository tests**

```bash
bun test server/persistence/core/repositories/sharing-repository.bun_spec.ts scripts/check-database-migrations.bun_spec.mjs
bun run db:migrations:check
```

- [ ] **Step 6: Commit**

```bash
git add server/persistence/core/migrations/generated/0030_sharing_account_unlink.sql server/persistence/core/migrations/manifest.ts server/persistence/core/schema/sharing.ts server/persistence/core/repositories/sharing-repository.ts server/persistence/core/repositories/sharing-repository.bun_spec.ts scripts/check-database-migrations.bun_spec.mjs
git commit -m "feat: persist LabGD account unlink state"
```

---

### Task 3: Add The Signed Unlink Client And Application Route

**Files:**
- Create: `server/sharing/account-unlink-service.mjs`
- Create: `server/sharing/account-unlink-service.test.mjs`
- Modify: `server/sharing/installation-identity.mjs`
- Modify: `server/sharing/installation-identity.test.mjs`
- Modify: `server/sharing/routes.mjs`
- Modify: `server/sharing/routes.test.mjs`
- Modify: `server/auth/api-permissions.mjs`
- Modify: `server/auth/api-permissions.test.mjs`
- Modify: `server/index.mjs`

**Interfaces:**
- Produces: `InstallationIdentityService.unlinkAccount(command)`.
- Produces: `AccountUnlinkService.execute({ clientAttemptId, disposition, confirmation, actorUserId })`.
- Produces: `POST /api/sharing/account/unlink`, authorized by `sharing.publish`.

- [ ] **Step 1: Write failing signed-client tests**

Prove that account status uses v1 when unlink is absent and v2 when negotiated.
The v2 parser must require exactly:

```json
{
  "claimed": true,
  "githubUsername": "mriverodorta",
  "claimedAt": "2026-08-24T15:30:00.000Z",
  "bindingRevision": 3
}
```

Test exact unlink request bytes, `claim:create` scope, bounded response shape,
stale binding mapping, malformed counts, and cross-disposition responses.

- [ ] **Step 2: Run identity tests and verify failure**

```bash
bunx vitest run server/sharing/installation-identity.test.mjs
```

- [ ] **Step 3: Implement status-v2 and unlink client methods**

Add:

```js
async unlinkAccount({ idempotencyKey, expectedAccountBindingRevision, shareDisposition })
```

It signs canonical JSON for `/v1/installations/account/unlink`, validates every
key and non-negative count, and maps stable LabGD errors without logging the
request signature or credential.

- [ ] **Step 4: Write failing service and route tests**

Test permission classification, exact delete confirmation, capability denial,
demo denial, stable retry reuse, success reconciliation, stale revision, and
that enrollment/credentials are untouched.

- [ ] **Step 5: Implement the orchestration service**

`AccountUnlinkService.execute` must:

1. Validate UUID `clientAttemptId`, disposition, and delete confirmation.
2. Require a claimed projection and negotiated unlink support.
3. Prepare/reuse the durable operation with a server-generated UUID key.
4. Call the signed identity client.
5. Complete the SQLite transaction and publish `sharing.status-changed`.
6. Mark network/5xx failures retryable and stable 4xx failures failed.

The Express route passes `request.authentication?.account?.id ?? null` as the
audit actor and returns the repository's authoritative completion projection.

- [ ] **Step 6: Run focused backend tests**

```bash
bunx vitest run server/sharing/installation-identity.test.mjs server/sharing/account-unlink-service.test.mjs server/sharing/routes.test.mjs server/auth/api-permissions.test.mjs
```

- [ ] **Step 7: Commit**

```bash
git add server/sharing/account-unlink-service.mjs server/sharing/account-unlink-service.test.mjs server/sharing/installation-identity.mjs server/sharing/installation-identity.test.mjs server/sharing/routes.mjs server/sharing/routes.test.mjs server/auth/api-permissions.mjs server/auth/api-permissions.test.mjs server/index.mjs
git commit -m "feat: add signed LabGD account unlink route"
```

---

### Task 4: Reconcile Account Unlink Through Resumable SSE

**Files:**
- Modify: `server/sharing/installation-event-coordinator.mjs`
- Modify: `server/sharing/installation-event-coordinator.test.mjs`
- Modify: `server/persistence/core/repositories/sharing-repository.ts`
- Modify: `server/persistence/core/repositories/sharing-repository.bun_spec.ts`
- Modify: `test/sharing-e2e.test.mjs`

**Interfaces:**
- Consumes: LabGD per-share lifecycle events plus `account-unlink` summary.
- Produces: cursor-safe account projection reconciliation for every open browser.

- [ ] **Step 1: Add failing event parser and ordering tests**

Use this exact summary payload:

```json
{
  "eventVersion": 1,
  "bindingRevision": 4,
  "disposition": "unpublish",
  "operationId": 17,
  "affected": {
    "shares": 7,
    "keptOnline": 0,
    "unpublished": 7,
    "deleted": 0
  },
  "occurredAt": "2026-08-24T18:00:00.000Z"
}
```

Prove malformed, oversized, negative, inconsistent, duplicate, and out-of-order
events fail closed or are ignored according to the existing cursor rules.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
bunx vitest run server/sharing/installation-event-coordinator.test.mjs
bun test server/persistence/core/repositories/sharing-repository.bun_spec.ts
```

- [ ] **Step 3: Implement account-unlink event handling**

Add `account-unlink` to event kinds but not share-event kinds. After all prior
per-share events have been processed, reconcile signed account-status v2 with
the summary event cursor. Do not trust the SSE event for GitHub identity.

`reconcileInstallationAccount` must reject a lower binding revision, accept an
equal replay idempotently, and atomically advance the cursor only after the
account projection is valid.

- [ ] **Step 4: Add end-to-end fake-LabGD coverage**

Exercise unlink, dropped browser response, SSE reconnect with `Last-Event-ID`,
per-share reconciliation, and a hard restart. Assert no interval polling and no
changes to projects, workspaces, assignments, placements, cables, route cache,
private fields, Registry links, Agent state, notification state, or auth roles.

- [ ] **Step 5: Run tests and commit**

```bash
bunx vitest run server/sharing/installation-event-coordinator.test.mjs test/sharing-e2e.test.mjs
bun test server/persistence/core/repositories/sharing-repository.bun_spec.ts
git add server/sharing/installation-event-coordinator.mjs server/sharing/installation-event-coordinator.test.mjs server/persistence/core/repositories/sharing-repository.ts server/persistence/core/repositories/sharing-repository.bun_spec.ts test/sharing-e2e.test.mjs
git commit -m "feat: reconcile LabGD account unlink events"
```

---

### Task 5: Add The Connected-Account Unlink Dialog

**Files:**
- Create: `src/components/settings/sharing/account-unlink-dialog.tsx`
- Modify: `src/components/settings/sharing/sharing-settings.tsx`
- Modify: `src/lib/sharing-api.ts`
- Modify: `src/hooks/use-sharing.ts`
- Modify: `src/test/sharing-settings.test.tsx`

**Interfaces:**
- Produces: `unlinkSharingAccount(input)` API client.
- Produces: `sharing.unlinkAccount` TanStack mutation.
- Produces: capability-gated, accessible unlink dialog.

- [ ] **Step 1: Write failing UI tests**

Cover:

- Connected username plus **Unlink account** only with permission and capability.
- Keep selected by default.
- Unpublish and delete selection.
- Exact `DELETE` requirement only for delete.
- Stable `clientAttemptId` across retry and a new ID after closing/reopening.
- Pending controls disabled.
- Success closes the dialog, removes username, shows counts, preserves connected
  enrollment, and restores **Connect account**.
- Failure leaves the dialog open.
- Stale binding requires a fresh confirmation.

- [ ] **Step 2: Run the UI test and verify failure**

```bash
bunx vitest run src/test/sharing-settings.test.tsx
```

- [ ] **Step 3: Add API and hook types**

Add `accountUnlink` to `SharingCapabilities`, `bindingRevision` to account
settings, and:

```ts
export type AccountUnlinkInput = Readonly<{
  clientAttemptId: string
  shareDisposition: 'keep' | 'unpublish' | 'delete'
  confirmation?: 'DELETE'
}>
```

The successful mutation writes the returned settings/shares into query cache or
invalidates each query once. It must not trigger duplicate follow-up reads.

- [ ] **Step 4: Implement the dedicated dialog**

Use native radio inputs with labels for the three dispositions, restrained
warning copy, and an `Input` shown only for permanent deletion. Keep the dialog
within the existing settings width and scrolling boundaries. Use Lucide icons
only where they clarify actions; do not add decorative badges or nested cards.

- [ ] **Step 5: Integrate the settings row**

Replace the standalone connected label with a compact account row containing
the username and **Unlink account** command. Keep **New share** independent.
Display the approved connection-preservation copy in the dialog.

- [ ] **Step 6: Run UI tests and commit**

```bash
bunx vitest run src/test/sharing-settings.test.tsx
git add src/components/settings/sharing/account-unlink-dialog.tsx src/components/settings/sharing/sharing-settings.tsx src/lib/sharing-api.ts src/hooks/use-sharing.ts src/test/sharing-settings.test.tsx
git commit -m "feat: add LabGD account unlink dialog"
```

---

### Task 6: Cover Backup, Restore, Documentation, And Full Verification

**Files:**
- Modify: `server/backup/backup-sections.mjs`
- Modify: `server/backup/backup-sections.test.mjs`
- Modify: `server/backup/sqlite-backup.bun_spec.ts`
- Modify: `server/backup/sqlite-restore-staging.ts`
- Create: `server/backup/sqlite-restore-staging.bun_spec.ts`
- Modify: `CHANGELOG.md`
- Modify: `src/release-notes.ts`
- Modify: `docs/sharing.md`
- Modify: `docs/handoffs/lab-gd-installation-account-unlink-v1.md`

**Interfaces:**
- Preserves: binding revision and in-flight/completed unlink idempotency state in complete and sharing-identity backups.
- Produces: final implementation handoff with exact app commit and verified contract evidence.

- [ ] **Step 1: Write failing backup and restore tests**

Prove complete and sharing-identity backups contain the account binding revision
and account operations, selective sharing-configuration restore cannot import a
foreign account operation without matching identity, and environment sync never
copies installation identity or account operation state across destinations.

- [ ] **Step 2: Implement backup ownership rules**

Keep `sharing_account_operations` identity-bound. Include it with
`sharingIdentity`, not ordinary share configuration. Restore it only together
with the matching destination identity projection, validating UUID-form attempt
and remote keys, dispositions, revisions, states, JSON result shape, and numeric
foreign keys.

- [ ] **Step 3: Update user-facing documentation**

Add one `Unreleased` changelog entry and one structured release-note highlight
covering account unlink, all three share dispositions, and retained installation
connection. Update sharing documentation to distinguish disable, unlink,
unpublish, and delete.

- [ ] **Step 4: Run focused backup tests**

```bash
bunx vitest run server/backup/backup-sections.test.mjs
bun test server/backup/sqlite-backup.bun_spec.ts server/backup/sqlite-restore-staging.bun_spec.ts
```

- [ ] **Step 5: Run complete verification**

```bash
bun run lint
bun run test
bun run build
bun run db:migrations:check
bun run release-notes:check
```

Do not run `security:container` unless preparing a push/deployment; when a
deployment is later requested, it remains mandatory for both architectures.

- [ ] **Step 6: Audit cleanup and repository state**

Remove task-scoped temporary databases, screenshots, logs, generated `dist/`,
Vite cache, Rust build output created by this task, test containers, images,
builders, scanner data, and reclaimable build cache. Do not delete Docker
volumes. Verify only intended source changes and the pre-existing
`.superpowers/` directory remain.

- [ ] **Step 7: Commit**

```bash
git add server/backup/backup-sections.mjs server/backup/backup-sections.test.mjs server/backup/sqlite-backup.bun_spec.ts server/backup/sqlite-restore-staging.ts server/backup/sqlite-restore-staging.bun_spec.ts CHANGELOG.md src/release-notes.ts docs/sharing.md docs/handoffs/lab-gd-installation-account-unlink-v1.md
git commit -m "docs: complete LabGD account unlink support"
```

## Cross-Repository Completion Gate

The Homelab Inventory implementation may merge before LabGD only while the UI
remains capability-hidden. End-to-end certification and roadmap shipment require:

1. LabGD deploys the handoff contract first.
2. Homelab Inventory negotiates account status v2 and unlink capability.
3. Disposable keep, unpublish, and delete flows pass from both entry points.
4. A different GitHub account successfully claims after unlink.
5. Two consecutive restart/reconnect proofs preserve identity, account revision,
   share state, cursor state, and unrelated application data.
6. Both repositories pass their complete container vulnerability gates before
   deployment.
