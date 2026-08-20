# lab.gd Private Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the private `HomelabInventoryShare` service that securely ingests signed Homelab Inventory shares and serves public, unlisted, protected, and embedded read-only viewers.

**Architecture:** Use a private Bun workspace with a Hono API, React/Vite web shell, PostgreSQL metadata, content-addressed filesystem blobs, isolated workers, and exact versions of the public Homelab Inventory packages. Publication stages immutable data and atomically changes an active-revision pointer. Public rendering never calls a private installation.

**Tech Stack:** Bun, Hono, Zod, Drizzle ORM, PostgreSQL 17, React 19, Vite, shadcn/ui, Lucide, Better Auth GitHub OAuth, Playwright/Chromium, Cloudflare Tunnel, Infisical.

## Global Constraints

- Create GitHub repository `mriverodorta/HomelabInventoryShare` as **private**.
- Product and public origin are `lab.gd`; repository/service name is `HomelabInventoryShare`.
- Design authority: Homelab Inventory commit `05a5244` and its `2026-08-20-lab-gd-sharing-platform-design.md`.
- Consume exact pinned versions of `@homelab-inventory/share-contract`, `viewer-model`, and `viewer-react`.
- Never copy Homelab Inventory source or import its API, persistence, editor, agent, authorization, or Registry credential modules.
- PostgreSQL has no host port and Watchtower is disabled.
- Runtime containers are non-root, read-only, capability-free, and use bounded hardened tmpfs.
- No direct SkyArk access; backups use only the established SkyBolt workflow.
- Public/unlisted/protected content behavior must fail closed.
- Do not deploy until the coordinated rollout plan authorizes deployment.

---

### Task 1: Create The Private Repository And Hardened Workspace

**Files:**
- Create: `package.json`
- Create: `bun.lock`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `.dockerignore`
- Create: `.env.example`
- Create: `apps/api/package.json`
- Create: `apps/web/package.json`
- Create: `packages/database/package.json`
- Create: `packages/domain/package.json`
- Create: `packages/registry-mirror/package.json`
- Create: `packages/observability/package.json`
- Create: `workers/renderer/package.json`
- Create: `workers/lifecycle/package.json`
- Create: `workers/analytics/package.json`
- Create: `test/workspace.test.ts`

**Interfaces:**
- Produces: private Bun workspace and dependency direction.
- Consumes: exact public package versions supplied by the rollout owner.

- [ ] **Step 1: Create and verify the private repository**

Run: `gh repo create mriverodorta/HomelabInventoryShare --private --clone=false`

Expected: `gh repo view mriverodorta/HomelabInventoryShare --json visibility -q .visibility` returns `PRIVATE`.

- [ ] **Step 2: Write the failing workspace-boundary test**

```ts
expect(importsOf('packages/domain')).not.toContain('apps/api')
expect(importsOf('apps/web')).not.toContain('packages/database')
expect(importsOf('workers/renderer')).not.toContain('packages/database/secrets')
```

- [ ] **Step 3: Scaffold workspace manifests**

Enforce dependency direction:

```text
share-contract -> domain -> database/api/workers
viewer-model -> viewer-react -> web/renderer
```

Use exact dependency versions for shared packages and security-sensitive runtime
libraries. Add `lint`, `test`, `build`, `db:generate`, `db:migrate`,
`security:container`, and `verify` scripts.

- [ ] **Step 4: Run frozen installation and boundary tests**

Run: `bun install --frozen-lockfile && bun test test/workspace.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the private workspace**

```bash
git add .
git commit -m "chore: initialize private lab.gd workspace"
```

### Task 2: Add PostgreSQL Schema, Roles, And Ordered Migrations

**Files:**
- Create: `packages/database/src/schema/*.ts`
- Create: `packages/database/src/client.ts`
- Create: `packages/database/src/migrator.ts`
- Create: `packages/database/drizzle.config.ts`
- Create: `packages/database/migrations/0001_foundation.sql`
- Create: `packages/database/test/schema.test.ts`
- Create: `deploy/init-database-roles.sql`

**Interfaces:**
- Produces: typed repositories and separate `api`, `renderer`, `lifecycle`, `analytics`, and `registry_mirror` database roles.
- Consumes: PostgreSQL 17 and Drizzle.

- [ ] **Step 1: Write failing relational-integrity tests**

Cover positive numeric IDs, public random IDs, installation/key/token state,
shares, immutable revisions, active pointers, view blobs, Registry definitions,
password hashes, claims, operations, events, analytics buckets, reports, and
tombstones.

- [ ] **Step 2: Implement normalized schema and constraints**

Use integer PK/FK relationships internally. Store public IDs separately. Add
unique constraints for idempotency keys, nonce use, blob hashes, exact Registry
references, GitHub subject, and active share ownership.

- [ ] **Step 3: Implement ordered transactional migrations**

Record migration filename and checksum. Refuse a changed historical migration.
Acquire a PostgreSQL advisory lock, apply each migration transactionally, and
release the lock before readiness succeeds.

- [ ] **Step 4: Prove role isolation**

Assert renderer cannot read password hashes or installation keys; analytics
cannot mutate shares; lifecycle cannot read OAuth credentials; API cannot access
renderer filesystem paths.

- [ ] **Step 5: Run and commit**

Run: `bun test packages/database && bun run db:migrations:check`

```bash
git add packages/database deploy/init-database-roles.sql
git commit -m "feat: add lab.gd relational foundation"
```

### Task 3: Implement Installation Enrollment And Signed Request Authentication

**Files:**
- Create: `packages/domain/src/installations/*.ts`
- Create: `apps/api/src/routes/installations.ts`
- Create: `apps/api/test/installations.test.ts`
- Create: `apps/api/test/replay.test.ts`
- Create: `apps/api/test/installation-events.test.ts`

**Interfaces:**
- Produces: challenge, activation, token renewal, rotation, recovery-pending, and claim-device endpoints.
- Consumes: Ed25519 public keys, nonce repository, scoped token repository.

- [ ] **Step 1: Write failing challenge and activation tests**

Assert UUID v4 validation, Ed25519 SPKI validation, five-minute challenge expiry,
single-use challenge, signature verification, and one logical installation per
client instance.

- [ ] **Step 2: Write failing signed-request and replay tests**

Assert bounded timestamp age, body-hash verification, short-lived scope, revoked
key rejection, nonce uniqueness, and generic authentication errors.

- [ ] **Step 3: Implement authenticated rotation and recovery**

Rotation creates a replacement only after current-key authentication. Identity
mismatch returns `409 installation-recovery-pending`, stores one replacement,
and never creates another installation or replacement on retry.

Expose one authenticated installation SSE stream for publication state, account
claim completion, expiration, grace, and recovery events. Use monotonic numeric
event IDs, bounded replay, Last-Event-ID resume, 15-second comments as transport
heartbeats, and no polling inside the stream implementation.

- [ ] **Step 4: Run authentication tests**

Run: `bun test apps/api/test/installations.test.ts apps/api/test/replay.test.ts apps/api/test/installation-events.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit installation authentication**

```bash
git add packages/domain apps/api
git commit -m "feat: authenticate publishing installations"
```

### Task 4: Implement Content-Addressed Blob Storage

**Files:**
- Create: `packages/domain/src/content/blob-store.ts`
- Create: `packages/domain/src/content/filesystem-blob-store.ts`
- Create: `packages/domain/src/content/blob-validation.ts`
- Create: `packages/domain/test/blob-store.test.ts`
- Create: `deploy/storage-init.sh`

**Interfaces:**
- Produces: `putVerified`, `openVerified`, `quarantineUnreferenced`, and `purgeQuarantined`.
- Consumes: private filesystem roots and SHA-256 metadata.

- [ ] **Step 1: Write failing filesystem safety tests**

Reject path traversal, symlinks, hash mismatch, size mismatch, oversized writes,
partial files, and non-regular files. Assert duplicate hashes reuse one blob.

- [ ] **Step 2: Implement atomic verified storage**

Write to task-scoped temp files, hash while streaming, fsync, rename atomically,
and create immutable content paths from lowercase hex hashes. Never derive paths
from user filenames.

- [ ] **Step 3: Implement quarantine-based garbage collection**

Require zero database references in a fresh transaction, move to quarantine,
wait the configured period, then recheck references before deletion.

- [ ] **Step 4: Run tests and ownership checks**

Run: `bun test packages/domain/test/blob-store.test.ts`

Expected: PASS under the runtime UID with no writable application root.

- [ ] **Step 5: Commit blob storage**

```bash
git add packages/domain deploy/storage-init.sh
git commit -m "feat: add verified content-addressed storage"
```

### Task 5: Implement Manifest-First Ingestion And Atomic Activation

**Files:**
- Create: `packages/domain/src/publication/*.ts`
- Create: `apps/api/src/routes/publications.ts`
- Create: `apps/api/test/publications.test.ts`
- Create: `apps/api/test/decompression-limits.test.ts`

**Interfaces:**
- Produces: create/update manifest, missing-hash response, blob upload, activate, unpublish, and delete endpoints.
- Consumes: `share-contract`, installation auth, blob store, Registry mirror.

- [ ] **Step 1: Write failing protocol-order tests**

Assert request order is transport limit, authentication, replay prevention,
bounded decompression, strict schema, semantic references, Registry references,
hash validation, and atomic activation.

- [ ] **Step 2: Write decompression-bomb and malformed-reference tests**

Reject content beyond 2 MB compressed or 10 MB expanded, pathological ratios,
extra fields, missing objects, duplicate public IDs, dangling connections, and
unsupported contract/view versions.

- [ ] **Step 3: Implement staged publication operations**

Use idempotency key, operation lease, immutable revision, and one transaction to
activate. Failed replacement retains the previous active revision and records a
sanitized failure code.

- [ ] **Step 4: Run ingestion tests**

Run: `bun test apps/api/test/publications.test.ts apps/api/test/decompression-limits.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit ingestion**

```bash
git add packages/domain apps/api
git commit -m "feat: ingest and activate signed shares"
```

### Task 6: Mirror Exact Historical Registry Definitions

**Files:**
- Create: `packages/registry-mirror/src/client.ts`
- Create: `packages/registry-mirror/src/importer.ts`
- Create: `packages/registry-mirror/src/verifier.ts`
- Create: `packages/registry-mirror/test/historical-revisions.test.ts`
- Create: `workers/registry-mirror/package.json`
- Create: `workers/registry-mirror/src/index.ts`

**Interfaces:**
- Produces: `resolveExactTemplate(templateKey, templateRevision, contentHash)`.
- Consumes: immutable signed Registry releases and trusted public keys.

- [ ] **Step 1: Write failing historical resolution tests**

Use multiple Registry revisions containing different versions of one template.
Assert exact revision/hash resolution, deduplication, signature verification,
and no `latest` fallback.

- [ ] **Step 2: Implement signed release import**

Fetch public immutable artifacts, verify manifest/signatures/hashes/sizes, parse
strictly, and store unique definitions by exact key/revision/hash.

- [ ] **Step 3: Gate publication on exact definitions**

Missing or invalid historical definitions block activation without affecting the
current share. Mirror failure does not make the public viewer contact Registry.

- [ ] **Step 4: Run mirror tests and commit**

Run: `bun test packages/registry-mirror`

```bash
git add packages/registry-mirror workers/registry-mirror
git commit -m "feat: mirror signed historical registry definitions"
```

### Task 7: Build Public, Unlisted, Protected, And Embed Viewers

**Files:**
- Create: `apps/web/src/routes/share-page.tsx`
- Create: `apps/web/src/routes/embed-page.tsx`
- Create: `apps/web/src/routes/password-page.tsx`
- Create: `apps/web/src/components/share-header.tsx`
- Create: `apps/web/src/components/share-community-state.tsx`
- Create: `apps/web/src/components/share-actions.tsx`
- Create: `apps/web/src/lib/deep-links.ts`
- Create: `apps/web/test/viewer.test.tsx`
- Create: `apps/web/test/embed.test.tsx`

**Interfaces:**
- Produces: `/s/:shareId` and `/e/:shareId` viewer shells.
- Consumes: exact pinned `viewer-react`, public manifest APIs, protected session cookie.

- [ ] **Step 1: Write failing lazy-loading and deep-link tests**

Assert initial response loads only shell, public metadata, manifest, and selected
view; selecting another tab fetches only that blob; item/connection links center
and open the inspector.

- [ ] **Step 2: Write failing protected no-leak tests**

Before password verification, assert HTML, JSON, metadata, Open Graph, cache
headers, error bodies, and timing-safe fixture responses contain no title,
description, counts, object names, or content hashes.

- [ ] **Step 3: Implement Impeccable public and embed layouts**

Use the shared viewer package. Keep title/description and actions functional and
restrained. Omit disabled community features; show Coming soon only when enabled.
Embed uses a compact functional header and Open on lab.gd.

- [ ] **Step 4: Enforce visibility and embed policy**

Serve `noindex` for unlisted and protected content. Generate exact
`frame-ancestors` per share. Wildcard is allowed only after explicit opt-in on
public/unlisted shares and is forbidden for protected shares.

- [ ] **Step 5: Run UI tests and commit**

Run: `bun test apps/web && bun run --cwd apps/web build`

```bash
git add apps/web
git commit -m "feat: render public and embedded lab shares"
```

### Task 8: Add Password Hashing And Protected Sessions

**Files:**
- Create: `packages/domain/src/passwords/password-service.ts`
- Create: `apps/api/src/routes/passwords.ts`
- Create: `apps/api/test/passwords.test.ts`

**Interfaces:**
- Produces: password set/replace and verify endpoints, scoped viewer session.
- Consumes: Bun Argon2id, Infisical-mounted versioned pepper.

- [ ] **Step 1: Write failing hashing and rate-limit tests**

Assert different salts, PHC-only persistence, pepper version, no recovery,
bounded attempts by share and source, generic error responses, and successful
cookie scoping.

- [ ] **Step 2: Implement password replacement and verification**

Hash with `Bun.password.hash` Argon2id parameters pinned in code. Append the
versioned pepper before hashing. Verify with `Bun.password.verify`. Never log or
persist plaintext.

- [ ] **Step 3: Harden the session cookie**

Use short-lived `HttpOnly`, `Secure`, `SameSite=Lax`, narrow path, signed session
identifier, active-revision binding, and revocation when the password changes.

- [ ] **Step 4: Run and commit**

Run: `bun test apps/api/test/passwords.test.ts`

```bash
git add packages/domain apps/api
git commit -m "feat: protect shares with Argon2id passwords"
```

### Task 9: Add GitHub Account Claiming And Management

**Files:**
- Create: `apps/api/src/auth/better-auth.ts`
- Create: `apps/api/src/routes/account-claims.ts`
- Create: `apps/web/src/routes/account-dashboard.tsx`
- Create: `apps/api/test/account-claims.test.ts`
- Create: `apps/web/test/account-dashboard.test.tsx`

**Interfaces:**
- Produces: GitHub-only login, short-lived device claim, installation/account ownership, dashboard mutations.
- Consumes: Better Auth, GitHub OAuth credentials, installation-signed claim request.

- [ ] **Step 1: Write failing account isolation tests**

Assert one GitHub account can claim multiple installations, another account
cannot claim them, account dashboard cannot query installation inventory, and
claim codes are short-lived and single-use.

- [ ] **Step 2: Implement outbound device claim flow**

Local app starts a claim and holds temporary outbound SSE. Browser authenticates
with GitHub, approves the claim, and `lab.gd` publishes a completion event. Store
GitHub subject, not mutable username, as the account identity.

- [ ] **Step 3: Implement revision-safe dashboard management**

Allow title, description, visibility, expiration, embed policy, comments,
reactions, unpublish, and delete with optimistic share revision checks. Do not
allow content replacement from the account dashboard.

- [ ] **Step 4: Run and commit**

Run: `bun test apps/api/test/account-claims.test.ts apps/web/test/account-dashboard.test.tsx`

```bash
git add apps
git commit -m "feat: claim and manage shares with GitHub"
```

### Task 10: Add Analytics And Abuse Reporting

**Files:**
- Create: `packages/observability/src/qualified-loads.ts`
- Create: `workers/analytics/src/index.ts`
- Create: `apps/api/src/routes/analytics.ts`
- Create: `apps/api/src/routes/reports.ts`
- Create: `apps/web/src/components/report-dialog.tsx`
- Create: `packages/observability/test/privacy.test.ts`
- Create: `apps/api/test/reports.test.ts`

**Interfaces:**
- Produces: aggregate share analytics and private abuse-report queue.
- Consumes: transactional outbox, daily HMAC derivation, trusted proxy configuration.

- [ ] **Step 1: Write failing privacy tests**

Assert only successful full/embed content loads count; daily visitor digest
changes across UTC dates; raw IP, full referrer, user-agent, country, and
fingerprint are never persisted.

- [ ] **Step 2: Implement bounded aggregate analytics**

Persist total, daily approximate unique count, full/embed count, referring
hostname, and last viewed. Derive a daily HMAC key from a versioned Infisical
secret and discard request identifiers after aggregation.

- [ ] **Step 3: Implement abuse reporting**

Use stable reason codes, bounded optional text, source/share rate limits,
immutable events, sanitized moderation notes, and explicit dispositions. Never
disclose owner identity to reporters.

- [ ] **Step 4: Run and commit**

Run: `bun test packages/observability apps/api/test/reports.test.ts`

```bash
git add packages/observability workers/analytics apps
git commit -m "feat: add privacy-safe analytics and abuse reports"
```

### Task 11: Add Expiration, Grace, Inactivity, And Blob Lifecycle

**Files:**
- Create: `workers/lifecycle/src/index.ts`
- Create: `packages/domain/src/lifecycle/policy.ts`
- Create: `packages/domain/test/lifecycle.test.ts`

**Interfaces:**
- Produces: idempotent lifecycle transitions and permanent ID tombstones.
- Consumes: share revisions, qualified-view timestamps, blob references.

- [ ] **Step 1: Write failing lifecycle matrix tests**

Cover indefinite, duration, fixed UTC date, publication reset, owner update that
does not reset fixed/inactivity timers, one-year inactivity, 30-day unclaimed
grace, claimed keep-online, immediate unpublish/delete, and reactivation by the
same owner.

- [ ] **Step 2: Implement revision-checked transitions**

Each cleanup operation reads expected revision, locks the share, rechecks time
and ownership, purges content references, writes tombstone state, and emits a
sanitized event. Repeated execution is a no-op.

- [ ] **Step 3: Integrate blob quarantine**

Content deletion decrements references in the same transaction. Actual files
enter quarantine only after the database commit and are rechecked before purge.

- [ ] **Step 4: Run and commit**

Run: `bun test packages/domain/test/lifecycle.test.ts`

```bash
git add packages/domain workers/lifecycle
git commit -m "feat: enforce share lifecycle and retention"
```

### Task 12: Add Social Preview Renderer, QR, And Share Actions

**Files:**
- Create: `workers/renderer/src/index.ts`
- Create: `workers/renderer/src/render-share.ts`
- Create: `workers/renderer/test/render-share.test.ts`
- Modify: `apps/web/src/components/share-actions.tsx`

**Interfaces:**
- Produces: one cached social image per active content hash and QR/share actions.
- Consumes: immutable viewer data and isolated Chromium.

- [ ] **Step 1: Write failing renderer isolation tests**

Assert protected shares always return the generic image, renderer input contains
no password or installation credentials, output is keyed by content hash, and
retry never duplicates an artifact.

- [ ] **Step 2: Implement bounded Chromium rendering**

Disable external network access, scripts outside the bundled viewer, downloads,
file URLs, and persistent browser profiles. Set CPU, memory, time, and output-size
limits. Use a generic preview while pending or failed.

- [ ] **Step 3: Add compact share actions**

Provide Copy link, Copy embed, Open, Download social image, and QR. QR encodes the
canonical share URL only.

- [ ] **Step 4: Run and commit**

Run: `bun test workers/renderer apps/web`

```bash
git add workers/renderer apps/web
git commit -m "feat: render social previews and share actions"
```

### Task 13: Build Hardened Compose, Backup, Restore, And Verification

**Files:**
- Create: `Dockerfile`
- Create: `compose.yaml`
- Create: `deploy/storage-init.sh`
- Create: `ops/backup.sh`
- Create: `ops/verify-backup.sh`
- Create: `ops/restore.sh`
- Create: `ops/security-audit.sh`
- Create: `test/compose-security.test.ts`
- Create: `test/backup-restore.test.ts`

**Interfaces:**
- Produces: SkyBolt-ready private deployment with matched backup/restore.
- Consumes: Infisical-rendered secrets and Cloudflare Tunnel network.

- [ ] **Step 1: Write failing compose-security tests**

Assert pinned image digests, read-only roots, all caps dropped, no-new-privileges,
non-root users, hardened tmpfs, no PostgreSQL host port, narrow secrets/mounts,
separate roles, and Watchtower-disabled labels.

- [ ] **Step 2: Implement service dependency order**

Start PostgreSQL health, storage init, migration, API/web, Registry mirror,
renderer, analytics, and lifecycle in that order. Health and readiness remain
separate.

- [ ] **Step 3: Implement matched backup and staged restore**

Backup PostgreSQL, blob store, previews, deployment metadata, and checksums under
an operation lock. Verify checksums and traversal, restore into an isolated
temporary database/object tree, run referential checks, then cut over.

- [ ] **Step 4: Run security and restore proof**

Run: `bun run verify && bun run security:container && bun test test/backup-restore.test.ts`

Expected: zero vulnerabilities at every severity and byte-valid restore.

- [ ] **Step 5: Commit deployment support**

```bash
git add Dockerfile compose.yaml deploy ops test
git commit -m "chore: harden lab.gd deployment and recovery"
```

### Task 14: Complete Private-Service End-To-End Verification

**Files:**
- Create: `test/e2e/publication.spec.ts`
- Create: `test/e2e/privacy.spec.ts`
- Create: `test/e2e/lifecycle.spec.ts`
- Create: `README.md`
- Create: `SECURITY.md`
- Create: `docs/operations.md`

**Interfaces:**
- Produces: verified service ready for coordinated rollout.
- Consumes: frozen application fixtures and all service modules.

- [ ] **Step 1: Run protocol and viewer end-to-end tests**

Cover public, unlisted, protected, immutable, replaceable sync/manual, exact
Registry revision, custom item, deep link, embed origin, social preview, account
claim, analytics, report, expiration, and reactivation.

- [ ] **Step 2: Run adversarial tests**

Cover replay, decompression bomb, dangling references, brute force, account
takeover, cross-installation share access, CSP bypass, stored HTML/script input,
path traversal, worker crash, database restart, and stale operation lease.

- [ ] **Step 3: Run the complete local release gate**

Run: `bun run lint && bun run test && bun run build && bun run security:container`

Expected: PASS and zero image vulnerabilities.

- [ ] **Step 4: Document owner and operator behavior**

Document privacy guarantees, password limitations, retention, Registry mirror,
backup/restore, Infisical secrets, GitHub OAuth, Cloudflare Tunnel, and incident
response without exposing deployment credentials.

- [ ] **Step 5: Commit the verified private service**

```bash
git add README.md SECURITY.md docs test
git commit -m "test: verify lab.gd sharing service end to end"
```
