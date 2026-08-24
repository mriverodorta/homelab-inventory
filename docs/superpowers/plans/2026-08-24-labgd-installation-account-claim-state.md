# LabGD Installation Account Claim State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist LabGD GitHub ownership at installation scope, reconcile it through a signed endpoint and SSE signals, and make Homelab Inventory close the claim dialog and display the connected GitHub username automatically.

**Architecture:** LabGD owns the authoritative account relationship and exposes a minimal installation-signed status projection. Homelab Inventory persists that projection in SQLite, reconciles it at bounded lifecycle events, and derives legacy per-share ownership output from the installation state without polling or mutating share revisions.

**Tech Stack:** Bun, Hono, Better Auth 1.7.1, PostgreSQL, Ed25519 signed requests, React, TanStack Query, SQLite/Drizzle, SSE, Vitest, Docker Scout, and Trivy.

## Global Constraints

- Ownership is installation-scoped and independent of share count or state.
- Return only `claimed`, verified `githubUsername`, and `claimedAt` to the authenticated installation.
- Never expose email, OAuth tokens, internal account IDs, or GitHub numeric IDs.
- SSE signals account changes but never carries GitHub identity.
- Do not add interval polling.
- Duplicate claim creation returns `installation-already-claimed` and creates no claim or event.
- Reconciliation must not mutate share revisions, publication state, manifests, blobs, inventory, projects, placements, cables, route cache, private fields, Registry links, Agent state, notifications, or authentication state.
- Demo and staging never claim, reconcile, or open sharing SSE traffic.
- Preserve per-share `account_claimed` only for compatibility; it is not authoritative.
- Update unreleased notes and changelogs without bumping versions before deployment.
- Preserve unrelated work and the app repository's existing untracked `.superpowers/`.

---

### Task 1: LabGD Installation Account Projection

**Files:**
- Create: `../HomelabInventoryShare/packages/database/migrations/0017_installation_account_projection.sql`
- Modify: `../HomelabInventoryShare/packages/database/src/repositories/postgres-api-stores.ts`
- Modify: `../HomelabInventoryShare/apps/api/src/routes/account-claims.ts`
- Test: `../HomelabInventoryShare/apps/api/test/account-claims.test.ts`
- Create: `../HomelabInventoryShare/packages/database/test/installation-account-projection.test.ts`

**Interfaces:**
- Produces `InstallationAccountStatus = { claimed:boolean; githubUsername:string|null; claimedAt:Date|null }`.
- Produces `PostgresAccountClaimStore.status(installationId)`.
- Consumes server-verified `{ subject, githubUsername }`.

- [ ] **Step 1: Write failing migration and repository tests**

Assert migration 0017 adds `accounts.github_username` and `installations.account_claimed_at`, preserves existing relationships, and replays idempotently. Assert unowned and owned status projections, and prove duplicate claim creation leaves `account_claims` and `events` unchanged.

- [ ] **Step 2: Verify focused failure**

```bash
cd ../HomelabInventoryShare
bun test apps/api/test/account-claims.test.ts packages/database/test/installation-account-projection.test.ts
```

Expected: failure because migration 0017 and installation status methods do not exist.

- [ ] **Step 3: Add the ordered migration**

```sql
ALTER TABLE accounts ADD COLUMN github_username text;
ALTER TABLE accounts ADD CONSTRAINT accounts_github_username_check
  CHECK (github_username IS NULL OR github_username ~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$');
ALTER TABLE installations ADD COLUMN account_claimed_at timestamptz;
UPDATE installations SET account_claimed_at=updated_at
WHERE account_id IS NOT NULL AND account_claimed_at IS NULL;
```

Do not grant worker write access. Existing `labgd_api` privileges remain the only write path.

- [ ] **Step 4: Add typed repository operations**

Implement `status(installationId)`, lock the installation before claim creation, throw `InstallationAlreadyClaimedError` when `account_id` is set, and change approval to consume a verified identity. Persist a valid username without replacing an existing value with null, set `account_claimed_at` once, and emit one completion event.

- [ ] **Step 5: Pass tests and commit**

```bash
bun test apps/api/test/account-claims.test.ts packages/database/test/installation-account-projection.test.ts
git add packages/database/migrations/0017_installation_account_projection.sql packages/database/src/repositories/postgres-api-stores.ts packages/database/test/installation-account-projection.test.ts apps/api/src/routes/account-claims.ts apps/api/test/account-claims.test.ts
git commit -m "fix: persist LabGD installation account ownership"
```

### Task 2: LabGD Signed Status And GitHub Login

**Files:**
- Create: `../HomelabInventoryShare/apps/api/src/auth/github-identity.ts`
- Create: `../HomelabInventoryShare/apps/api/test/github-identity.test.ts`
- Modify: `../HomelabInventoryShare/apps/api/src/routes/installations.ts`
- Modify: `../HomelabInventoryShare/apps/api/test/installations.test.ts`
- Modify: `../HomelabInventoryShare/apps/api/src/routes/account-claims.ts`
- Modify: `../HomelabInventoryShare/apps/api/src/server.ts`
- Modify: `../HomelabInventoryShare/apps/api/src/routes/capabilities.ts`
- Modify: `../HomelabInventoryShare/apps/api/test/capabilities.test.ts`

**Interfaces:**
- Produces signed `GET /v1/installations/account-status` using `claim:create`.
- Produces `resolveGithubIdentity(headers)`.
- Advertises `accountClaiming.statusSupported: true`.

- [ ] **Step 1: Write failing route, privacy, and capability tests**

Cover exact unclaimed/claimed responses, invalid signatures, foreign installation isolation, null username fallback, duplicate claim HTTP 409, forbidden profile fields, and enabled/disabled capability documents.

- [ ] **Step 2: Verify failure**

```bash
bun test apps/api/test/github-identity.test.ts apps/api/test/installations.test.ts apps/api/test/capabilities.test.ts
```

- [ ] **Step 3: Resolve the login from GitHub server-side**

Use the authenticated Better Auth session and provider access-token API, then GitHub's authenticated `/user` endpoint. Normalize only:

```ts
export function normalizeGithubUsername(value: unknown): string | null {
  return typeof value === 'string'
    && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(value)
    ? value
    : null
}
```

Never accept the login from the approval request body or log OAuth data.

- [ ] **Step 4: Add the signed status route**

Authenticate an empty body and return exactly:

```ts
{
  claimed: status.claimed,
  githubUsername: status.githubUsername,
  claimedAt: status.claimedAt?.toISOString() ?? null,
}
```

Map an already-owned `claim-device` call to HTTP 409 with `{ code:'installation-already-claimed' }`.

- [ ] **Step 5: Advertise support, pass tests, and commit**

```bash
bun test apps/api/test/github-identity.test.ts apps/api/test/installations.test.ts apps/api/test/capabilities.test.ts apps/api/test/account-claims.test.ts
git add apps/api/src/auth/github-identity.ts apps/api/test/github-identity.test.ts apps/api/src/routes/installations.ts apps/api/test/installations.test.ts apps/api/src/routes/account-claims.ts apps/api/src/server.ts apps/api/src/routes/capabilities.ts apps/api/test/capabilities.test.ts
git commit -m "feat: expose signed installation account status"
```

### Task 3: LabGD Verification And Documentation

**Files:**
- Modify: `../HomelabInventoryShare/CHANGELOG.md`
- Modify: `../HomelabInventoryShare/config/unreleased-release-note.json`
- Modify: `../HomelabInventoryShare/README.md` only if its account contract is affected.

- [ ] **Step 1: Document installation-level ownership and duplicate prevention**

Describe the signed, privacy-limited account projection and automatic reconciliation support.

- [ ] **Step 2: Run complete LabGD gates**

```bash
cd ../HomelabInventoryShare
bun install --frozen-lockfile
bun run verify:catalog-protocol
bun run verify
bun run db:migrations:check
bun run security:container
```

Expected: all tests/builds pass and both image architectures have zero Scout and Trivy findings.

- [ ] **Step 3: Commit documentation**

```bash
git add CHANGELOG.md config/unreleased-release-note.json README.md
git commit -m "docs: note installation account reconciliation"
```

### Task 4: Homelab Inventory SQLite Projection

**Files:**
- Create: `server/persistence/core/migrations/generated/0029_sharing_account_projection.sql`
- Modify: `server/persistence/core/migrations/manifest.ts`
- Modify: `server/persistence/core/schema/sharing.ts`
- Modify: `server/persistence/core/repositories/sharing-repository.ts`
- Modify: `server/persistence/core/repositories/sharing-repository.bun_spec.ts`
- Modify: `server/persistence/sqlite-store.bun_spec.ts`

**Interfaces:**
- Produces core migration `0030_sharing_account_projection`.
- Produces `reconcileInstallationAccount(status, eventCursor?)`.
- Derives legacy `ShareRecord.accountClaimed` from the installation projection.

- [ ] **Step 1: Write failing migration and repository tests**

Prove schema 30 preservation and idempotency. Cover zero shares, deleted shares, legacy true seed, false ambiguity, and no share revision mutation.

- [ ] **Step 2: Verify failure**

```bash
bun test server/persistence/core/repositories/sharing-repository.bun_spec.ts server/persistence/sqlite-store.bun_spec.ts
```

- [ ] **Step 3: Add schema and migration**

```sql
ALTER TABLE sharing_installation_projection ADD COLUMN account_claimed integer NOT NULL DEFAULT 0 CHECK(account_claimed IN (0,1));
ALTER TABLE sharing_installation_projection ADD COLUMN github_username text;
ALTER TABLE sharing_installation_projection ADD COLUMN account_claimed_at_ms integer CHECK(account_claimed_at_ms IS NULL OR account_claimed_at_ms > 0);
UPDATE sharing_installation_projection SET account_claimed=1
WHERE id=1 AND EXISTS(SELECT 1 FROM shares WHERE account_claimed=1);
```

Calculate SHA-256 and append the migration to the manifest.

- [ ] **Step 4: Add one transactional account projection**

Validate GitHub login and timestamp. Update installation account fields and an optional event cursor in one SQLite transaction. Leave every share row unchanged. Overlay installation claim state when mapping share DTOs.

- [ ] **Step 5: Pass tests and commit**

```bash
bun test server/persistence/core/repositories/sharing-repository.bun_spec.ts server/persistence/sqlite-store.bun_spec.ts
git add server/persistence/core/migrations/generated/0029_sharing_account_projection.sql server/persistence/core/migrations/manifest.ts server/persistence/core/schema/sharing.ts server/persistence/core/repositories/sharing-repository.ts server/persistence/core/repositories/sharing-repository.bun_spec.ts server/persistence/sqlite-store.bun_spec.ts
git commit -m "fix: persist LabGD account ownership by installation"
```

### Task 5: Signed App Reconciliation Lifecycle

**Files:**
- Modify: `server/sharing/remote-capabilities.mjs`
- Modify: `server/sharing/remote-capabilities.test.mjs`
- Modify: `server/sharing/capabilities.mjs`
- Modify: `server/sharing/installation-identity.mjs`
- Modify: `server/sharing/installation-identity.test.mjs`
- Modify: `server/sharing/installation-event-coordinator.mjs`
- Modify: `server/sharing/installation-event-coordinator.test.mjs`
- Modify: `server/sharing/enrollment-coordinator.mjs`
- Modify: `server/sharing/enrollment-coordinator.test.mjs`

**Interfaces:**
- Produces remote capability `installationAccountStatus`.
- Produces `SharingInstallationIdentityService.accountStatus()`.
- Consumes repository `reconcileInstallationAccount`.

- [ ] **Step 1: Write failing negotiation and lifecycle tests**

Cover exact response validation, malformed usernames/timestamps, enrollment reconciliation, SSE reconnect, fetch-before-cursor commit, duplicate events, and transient status failure.

- [ ] **Step 2: Verify failure**

```bash
bun run test -- server/sharing/remote-capabilities.test.mjs server/sharing/installation-identity.test.mjs server/sharing/installation-event-coordinator.test.mjs server/sharing/enrollment-coordinator.test.mjs
```

- [ ] **Step 3: Add the signed client**

Implement `accountStatus()` with an empty signed body and `claim:create`. Normalize exact response keys. When claim creation returns `installation-already-claimed`, reconcile instead of creating another code.

- [ ] **Step 4: Wire bounded reconciliation**

Reconcile after activation, event-stream reconnect, account-claim SSE, browser-return route calls, and already-claimed responses. Fetch status before committing an account-claim cursor. Never start a timer.

- [ ] **Step 5: Pass tests and commit**

```bash
bun run test -- server/sharing/remote-capabilities.test.mjs server/sharing/installation-identity.test.mjs server/sharing/installation-event-coordinator.test.mjs server/sharing/enrollment-coordinator.test.mjs
git add server/sharing/remote-capabilities.mjs server/sharing/remote-capabilities.test.mjs server/sharing/capabilities.mjs server/sharing/installation-identity.mjs server/sharing/installation-identity.test.mjs server/sharing/installation-event-coordinator.mjs server/sharing/installation-event-coordinator.test.mjs server/sharing/enrollment-coordinator.mjs server/sharing/enrollment-coordinator.test.mjs
git commit -m "fix: reconcile LabGD account state from signed status"
```

### Task 6: Settings API And Completion UX

**Files:**
- Modify: `server/sharing/routes.mjs`
- Modify: `server/sharing/routes.test.mjs`
- Modify: `src/lib/sharing-api.ts`
- Modify: `src/hooks/use-sharing.ts`
- Modify: `src/components/settings/sharing/account-claim-dialog.tsx`
- Modify: `src/components/settings/sharing/sharing-settings.tsx`
- Modify: `src/test/sharing-settings.test.tsx`

**Interfaces:**
- Produces `settings.account = { claimed, githubUsername, claimedAtMs }`.
- Produces `POST /api/sharing/account/reconcile`.
- Consumes `sharing:status` SSE invalidation and browser visibility.

- [ ] **Step 1: Write failing route and UI tests**

Cover username and fallback labels, hidden claim action, automatic modal close, one success announcement, no load-time toast, one visibility reconciliation, and no interval.

- [ ] **Step 2: Verify failure**

```bash
bun run test -- server/sharing/routes.test.mjs src/test/sharing-settings.test.tsx
```

- [ ] **Step 3: Add the bounded reconcile route**

Require sharing runtime, call signed account status, persist it, publish one `sharing:status` event, and return settings. Preserve demo/staging denial.

- [ ] **Step 4: Add the UI transition**

On the false-to-true transition for a claim initiated in this browser session, clear the claim, close the modal, and use the existing accessible announcement system. Add one `visibilitychange` listener only while pending and visible; remove it on close.

- [ ] **Step 5: Pass tests and commit**

```bash
bun run test -- server/sharing/routes.test.mjs src/test/sharing-settings.test.tsx
git add server/sharing/routes.mjs server/sharing/routes.test.mjs src/lib/sharing-api.ts src/hooks/use-sharing.ts src/components/settings/sharing/account-claim-dialog.tsx src/components/settings/sharing/sharing-settings.tsx src/test/sharing-settings.test.tsx
git commit -m "fix: complete LabGD account claims in settings"
```

### Task 7: Backup, Sync, And Release Notes

**Files:**
- Modify: `server/backup/backup-sections.mjs`
- Modify: `server/backup/backup-sections.test.mjs`
- Modify: `server/backup/sqlite-backup.bun_spec.ts`
- Modify: `server/backup/sqlite-restore-staging.ts`
- Modify: `scripts/sync.sh`
- Modify: matching sync tests found with `rg -n "installation-instance|sharing identity" scripts server test`
- Modify: `CHANGELOG.md`
- Modify: `config/unreleased-release-note.json`
- Modify: `src/release-notes.ts`

- [ ] **Step 1: Extend backup, restore, and sync tests**

Validate account projection fields, reject malformed restored values, preserve complete restore, leave unselected restores unchanged, and prove sync never copies source ownership to the destination identity.

- [ ] **Step 2: Implement validation and destination preservation**

Keep account fields inside `sharing_installation_projection`. Preserve or rebuild the complete destination projection together with destination UUID, key, credentials, and remote installation ID.

- [ ] **Step 3: Document the fix**

State that claims finish automatically, survive refresh/restart, show the connected username, and prevent duplicate claim codes.

- [ ] **Step 4: Pass focused tests and commit**

```bash
bun run test -- server/backup/backup-sections.test.mjs server/backup/sqlite-backup.bun_spec.ts server/sharing/installation-identity.test.mjs
git add server/backup scripts/sync.sh CHANGELOG.md config/unreleased-release-note.json src/release-notes.ts
git add $(git ls-files '*sync*test*')
git commit -m "docs: note LabGD account claim completion"
```

### Task 8: Complete Verification And Cleanup

**Files:** Verification only; modify implementation only to repair discovered failures.

- [ ] **Step 1: Run Homelab Inventory gates**

```bash
bun run lint
bun run test
bun run build
bun run security:container
```

- [ ] **Step 2: Run LabGD gates again**

```bash
cd ../HomelabInventoryShare
bun run verify
bun run db:migrations:check
bun run security:container
```

- [ ] **Step 3: Clean task artifacts**

Remove task databases, containers, images, scanner caches, build caches, temporary files, generated output, and logs. Do not delete Docker volumes. LabGD must be clean; the app may retain only the pre-existing `.superpowers/`.

- [ ] **Step 4: Report the ordered deployment handoff**

Report exact commits and evidence. Deployment order is LabGD first, app second, then existing-account reconciliation and one fresh claim. Do not bump, push, or deploy until explicitly requested.

