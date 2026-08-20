# lab.gd Application Sharing Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add secure, opt-in `lab.gd` identity, privacy preview, publication, lifecycle, account claiming, backup, and local management to Homelab Inventory.

**Architecture:** Persist non-secret share configuration and operation state in core SQLite while storing the Ed25519 identity under `/data/sharing`. A server-side projector creates strict share-contract blobs, and a signed outbound client performs content-addressed publication. The frontend manages shares through ordinary APIs and receives state changes through the existing application SSE hub.

**Tech Stack:** Bun, Express 5, bun:sqlite, Drizzle, Ed25519, Zod, React 19, TanStack Query, shadcn/ui, Lucide, SSE.

## Global Constraints

- Requires the shared package track and approved design at commit `05a5244`.
- Sharing is disabled by default and always disabled in demo mode.
- Identity files live only under `/data/sharing`, mode `0600`, owned by the app UID.
- `sync.sh` must never copy sharing identity between installations.
- Serial numbers, network identifiers, agent identity, telemetry history, credentials, audit data, and private metadata cannot cross the default boundary.
- Tags and custom fields are explicit opt-in and default excluded.
- Resource usage is a one-time snapshot and never changes through normal synchronization.
- Every mutating route requires an explicit authorization policy.
- No application version bump or deployment occurs in this plan.

---

### Task 1: Add Sharing Persistence And Ordered Migration

**Files:**
- Create: `server/persistence/core/schema/sharing.ts`
- Modify: `server/persistence/core/schema/index.ts`
- Create: `server/persistence/core/migrations/generated/0028_sharing_foundation.sql`
- Modify: `server/persistence/core/migrations/manifest.ts`
- Create: `server/persistence/core/repositories/sharing-repository.ts`
- Create: `server/persistence/core/repositories/sharing-repository.bun_spec.ts`

**Interfaces:**
- Produces: `SharingRepository`, numeric relational IDs, revisioned share configuration and operation records.
- Consumes: core SQLite transaction and repository-context patterns.

- [ ] **Step 1: Write failing schema and repository tests**

Assert positive numeric IDs, foreign keys, unique remote share IDs, optimistic
revisions, immutable local revision records, and tombstone-compatible states.

```ts
expect(await repository.createShare(input)).toMatchObject({ id: 1, revision: 1, state: 'unpublished' })
await expect(repository.updateShare(1, 99, patch)).rejects.toThrow('revision-conflict')
```

- [ ] **Step 2: Run focused persistence tests**

Run: `bun test server/persistence/core/repositories/sharing-repository.bun_spec.ts`

Expected: FAIL because the schema and repository do not exist.

- [ ] **Step 3: Implement normalized tables**

Create `sharing_settings`, `sharing_installation_projection`, `shares`,
`share_views`, `share_field_selections`, `share_tag_selections`,
`share_publication_operations`, and `share_resource_snapshots`. Use integer PK/FK
columns and a `revision` column on mutable records. Store no password.

- [ ] **Step 4: Register the migration checksum and verify rollback safety**

Run: `bun run db:migrations:check && bun test server/persistence`

Expected: PASS, migration applies twice idempotently, and backup restore to the
pre-migration schema remains available.

- [ ] **Step 5: Commit persistence foundation**

```bash
git add server/persistence
git commit -m "feat: add sharing persistence foundation"
```

### Task 2: Implement Stable Sharing Installation Identity

**Files:**
- Create: `server/sharing/installation-instance.mjs`
- Create: `server/sharing/installation-identity.mjs`
- Create: `server/sharing/installation-auth.mjs`
- Create: `server/sharing/installation-identity.test.mjs`
- Create: `server/sharing/installation-auth.test.mjs`

**Interfaces:**
- Produces: `SharingInstallationIdentityService.ensure()`, `signRequest()`, `rotateKey()`, `resumeRecovery()`.
- Consumes: `/data/sharing`, SQLite projection repository, lab.gd challenge/activation endpoints.

- [ ] **Step 1: Write failing first-run and restart tests**

Assert UUID v4 creation, Ed25519 key creation, `0600` mode, stable hashes across
restart, and reconstruction of the SQLite projection after its deletion.

- [ ] **Step 2: Write failing rotation and recovery tests**

Assert that failed rotation preserves the old key and credentials, HTTP 409
persists one recovery-pending replacement key, publication stops, and retry does
not generate another key.

- [ ] **Step 3: Implement identity and signed request envelopes**

Use timestamp, random nonce, canonical body hash, scoped short-lived bearer
token, key ID, and Ed25519 signature. Never reuse Registry identity files.

- [ ] **Step 4: Run the identity suite**

Run: `bun test server/sharing/installation-*.test.mjs`

Expected: PASS for first run, migration, restart, recovery, rotation, and
credentials-file deletion scenarios.

- [ ] **Step 5: Commit identity support**

```bash
git add server/sharing
git commit -m "feat: add stable lab.gd installation identity"
```

### Task 3: Build The Privacy Projector And Exact Preview

**Files:**
- Create: `server/sharing/public-id-service.mjs`
- Create: `server/sharing/share-projector.mjs`
- Create: `server/sharing/privacy-policy.mjs`
- Create: `server/sharing/share-projector.test.mjs`
- Create: `server/sharing/fixtures/private-project.json`
- Create: `server/sharing/fixtures/expected-public-share.json`

**Interfaces:**
- Produces: `projectShare({ projectId, viewIds, selections, resourceSnapshot }): ProjectedShare`.
- Consumes: workspace read model, Registry repository, metadata repository, `share-contract`.

- [ ] **Step 1: Write a private-data exfiltration fixture**

Include serials, IP/MAC addresses, agent credentials, telemetry, audit events,
Registry enrollment, tags, custom fields, private notes, linked items, custom
items, placements, and connections.

- [ ] **Step 2: Write failing exact-output assertions**

Assert forbidden values are absent even when nested, tags/fields appear only
when selected, linked items use exact Registry references, custom items include
sanitized definitions, and public IDs are stable but unrelated to database IDs.

- [ ] **Step 3: Implement allowlist projection**

Build new output objects field-by-field. Do not clone then delete prohibited
fields. Validate the final result with strict package schemas and canonicalize it
before preview or upload.

- [ ] **Step 4: Prove preview/publish byte equality**

Hash preview bytes and assert the publication operation uses the same persisted
hash and blobs. Any selected-content change invalidates preview approval.

- [ ] **Step 5: Run and commit**

Run: `bun test server/sharing/share-projector.test.mjs`

```bash
git add server/sharing
git commit -m "feat: add privacy-safe sharing projector"
```

### Task 4: Implement The Content-Addressed Publication Client

**Files:**
- Create: `server/sharing/labgd-client.mjs`
- Create: `server/sharing/publication-service.mjs`
- Create: `server/sharing/publication-coordinator.mjs`
- Create: `server/sharing/publication-service.test.mjs`
- Create: `server/sharing/publication-coordinator.test.mjs`

**Interfaces:**
- Produces: `publishShare`, `unpublishShare`, `deleteShare`, `refreshResourceSnapshot`, and one-minute synchronized debounce.
- Consumes: signed installation identity, share projector, sharing repository.

- [ ] **Step 1: Write failing manifest-first synchronization tests**

Assert the client sends a manifest, uploads only hashes reported missing, handles
idempotency, and activates only after every upload succeeds.

- [ ] **Step 2: Write failing synchronized/manual behavior tests**

Assert repeated relevant changes collapse into one operation after 60 seconds,
manual mode records `manual-update-available`, ordinary synchronization does not
refresh metrics, and failed replacement leaves the previous remote revision.

- [ ] **Step 3: Implement bounded HTTP and operation state**

Set explicit connect/request timeouts, maximum response sizes, stable error
codes, bounded attempts, Retry-After handling, and operation revision checks.
Maintain one authenticated outbound SSE connection to `lab.gd` while sharing is
enabled. Resume from the last persisted event ID and reconcile only after a gap;
do not poll remote publication or claim status.

- [ ] **Step 4: Run publication tests**

Run: `bun test server/sharing/publication-*.test.mjs`

Expected: PASS without external network calls.

- [ ] **Step 5: Commit publication behavior**

```bash
git add server/sharing
git commit -m "feat: add content-addressed share publication"
```

### Task 5: Add Authorization Policies, APIs, And SSE State

**Files:**
- Modify: `server/auth/permission-catalog.mjs`
- Modify: `server/auth/api-permissions.mjs`
- Create: `server/sharing/routes.mjs`
- Create: `server/sharing/routes.test.mjs`
- Modify: `server/live-events/topics.mjs`
- Modify: `server/live-events/topics.test.mjs`
- Modify: `server/index.mjs`

**Interfaces:**
- Produces: `/api/sharing/*` and live topic `sharing:status`.
- Consumes: authorization service, SSE hub, sharing services.

- [ ] **Step 1: Add failing permission tests**

Define static permissions with stable numeric IDs:

```js
definePermission(1301, 'sharing.configure', 'sharing', 'Configure lab.gd sharing.', 'elevated')
definePermission(1302, 'sharing.publish', 'sharing', 'Publish and remove lab.gd shares.', 'elevated')
```

Assert Owner and Administrator receive both, Editor receives neither, and every
new route has a policy.

- [ ] **Step 2: Add failing route and SSE tests**

Cover settings, capabilities, preview, publish, update, snapshot refresh,
unpublish, delete, account claim, recovery, and event subscription. Demo mode
must return a stable `sharing-disabled-in-demo` error and make no outbound call.

- [ ] **Step 3: Implement routes and topic payloads**

SSE payloads include only share ID, local revision, remote revision, state,
timestamp, retryable flag, and sanitized error code. Do not stream payload blobs,
passwords, or identity credentials. The closed state set is `synced`,
`changes-pending`, `publishing`, `manual-update-available`, `failed`, `expired`,
`grace-period`, and `unpublished`.

- [ ] **Step 4: Run authorization and route suites**

Run: `bun test server/auth server/sharing server/live-events`

Expected: PASS with zero `authorization-policy-missing` responses.

- [ ] **Step 5: Commit API integration**

```bash
git add server
git commit -m "feat: expose authorized sharing APIs and events"
```

### Task 6: Integrate Backup, Restore, Ownership, And sync.sh Safety

**Files:**
- Modify: `shared/backup/contract.mjs`
- Modify: `server/backup/backup-sections.mjs`
- Modify: `server/backup/restore-preflight.mjs`
- Modify: `server/backup/sqlite-section-exporter.ts`
- Modify: `sync.sh`
- Create: `server/backup/sharing-identity.test.mjs`
- Create: `test/sync-sharing-identity.test.mjs`

**Interfaces:**
- Produces: selectable `sharingConfiguration` and `sharingIdentity` backup sections.
- Consumes: `/data/sharing` identity service and existing staged restore pipeline.

- [ ] **Step 1: Write failing backup and restore tests**

Assert complete backup includes identity, selective configuration excludes
identity, identity restore validates UUID/key/credentials consistency, incorrect
ownership or mode fails, and replacement restore is staged before activation.

- [ ] **Step 2: Write failing environment-sync boundary tests**

Use different source and destination identity hashes. Run both sync directions
and assert neither UUID, private key, credentials, nor installation projection
crosses environments.

- [ ] **Step 3: Implement backup sections and sync exclusions**

Preserve destination identity and rebuild its public projection if the core
database is replaced. Never print identity bytes or hashes in normal logs.

- [ ] **Step 4: Run backup and sync tests**

Run: `bun test server/backup test/sync-sharing-identity.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit data-safety integration**

```bash
git add shared server/backup sync.sh test
git commit -m "feat: protect sharing identity in backup and sync"
```

### Task 7: Build Sharing Settings, Preview, And Share Management UI

**Files:**
- Create: `src/lib/sharing-api.ts`
- Create: `src/hooks/use-sharing.ts`
- Create: `src/components/settings/sharing/sharing-settings.tsx`
- Create: `src/components/settings/sharing/share-dialog.tsx`
- Create: `src/components/settings/sharing/share-privacy-summary.tsx`
- Create: `src/components/settings/sharing/share-list.tsx`
- Create: `src/components/settings/sharing/share-analytics.tsx`
- Create: `src/components/settings/sharing/account-claim-dialog.tsx`
- Create: `src/components/sharing/share-preview.tsx`
- Modify: `src/components/settings-dialog.tsx`
- Modify: `src/components/canvas-command-bar.tsx`
- Create: `src/test/sharing-settings.test.tsx`
- Create: `src/test/share-dialog.test.tsx`

**Interfaces:**
- Produces: local sharing configuration and publication workflow.
- Consumes: sharing APIs, SSE `sharing:status`, shared read-only viewer package.

- [ ] **Step 1: Write failing settings and permission tests**

Assert sharing starts disabled, unauthorized users cannot see publish controls,
demo never offers setup, and enabled installations display enrollment/recovery
state.

- [ ] **Step 2: Write failing publication-dialog tests**

Cover selected views, full project, immutable/replaceable, sync/manual,
visibility, password replacement, expiration, tags/custom fields, resource
snapshot, comments/reactions, and persistent privacy summary. Cover the complete
embed configurator: initial view, focused object, inspector, tabs, title
expansion, theme, fullscreen, exact allowed origins, and suggested dimensions or
aspect ratio.

Share details must also render the privacy-safe owner analytics returned by
`lab.gd`: total qualified views, approximate daily uniques, full/embed counts,
referring hostname, and last viewed. Do not request or display raw request data.

- [ ] **Step 3: Implement the Impeccable shadcn UI**

Use existing shadcn components without modifying vendor primitives. Use sections,
checkboxes, segmented controls, and concise commands; avoid decorative cards and
pill-heavy metadata. Open the exact preview in a new tab. Disable Publish until
preview hash equals current selection hash.

- [ ] **Step 4: Add manual update and snapshot actions**

Manual replaceable shares expose an icon command with tooltip. Systems shares
with metrics expose Update resource snapshot. Both reflect state through SSE,
not browser polling. Disabling sharing must show the unclaimed 30-day grace
warning; claimed shares must offer Keep online or Disconnect and unpublish.

- [ ] **Step 5: Run frontend tests and commit**

Run: `bunx vitest run src/test/sharing-settings.test.tsx src/test/share-dialog.test.tsx && bun run build`

```bash
git add src
git commit -m "feat: add lab.gd sharing management UI"
```

### Task 8: Complete Application Verification And Documentation

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `DOCKERHUB.md`
- Modify: `CHANGELOG.md`
- Modify: `src/release-notes.ts`
- Create: `docs/sharing.md`
- Create: `test/sharing-e2e.test.mjs`

**Interfaces:**
- Produces: deployable but default-disabled application-side sharing support.
- Consumes: local fake `lab.gd` contract server and all preceding tasks.

- [ ] **Step 1: Add the local protocol end-to-end test**

Exercise enrollment, preview, missing-hash upload, activation, synchronized
replacement, manual replacement, resource snapshot, unpublish, expiration,
recovery pending, restart, and identity deletion recovery.

- [ ] **Step 2: Document configuration and privacy behavior**

Document `LABGD_ORIGIN`, default-disabled behavior, identity paths, backup/sync
rules, permissions, payload exclusions, and demo prohibition.

- [ ] **Step 3: Run complete verification**

Run: `bun run lint && bun run test && bun run build && bun run security:container`

Expected: all checks pass and both architectures report zero vulnerabilities.

- [ ] **Step 4: Verify local production image**

Boot a sanitized local image, enable sharing against the fake service, publish a
Systems and Canvas fixture, confirm SSE state transitions, restart, and verify
identity and pending operations persist.

- [ ] **Step 5: Commit the application track**

```bash
git add .env.example README.md DOCKERHUB.md CHANGELOG.md src/release-notes.ts docs test
git commit -m "docs: complete lab.gd application sharing support"
```
