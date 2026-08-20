# lab.gd Private Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the private `HomelabInventoryShare` service that securely ingests signed Homelab Inventory shares and serves public, unlisted, protected, and embedded read-only viewers.

**Architecture:** Use a private Bun workspace with a Hono API, React/Vite web assets, PostgreSQL metadata, content-addressed filesystem blobs, isolated workers, and exact versions of the public Homelab Inventory packages. Hono serves share-specific HTML for `/s/:shareId` and `/e/:shareId`, injects dynamic security and metadata headers, and references immutable Vite assets for hydration. Publication stages immutable data and atomically changes an active-revision pointer; public rendering never calls a private installation.

**Tech Stack:** Bun, Hono, Zod, Drizzle ORM, PostgreSQL 17, React 19, Vite, shadcn/ui, Lucide, Better Auth GitHub OAuth, Playwright/Chromium, Cloudflare Tunnel, Infisical.

## Global Constraints

- Create GitHub repository `mriverodorta/HomelabInventoryShare` as **private**.
- Product and public origin are `lab.gd`; repository/service name is `HomelabInventoryShare`.
- Design authority: Homelab Inventory commit `05a5244` and `docs/superpowers/specs/2026-08-20-lab-gd-sharing-platform-design.md`.
- Initial protocol is `shareContractVersion=1`, `systems@1`, and `canvas@1`.
- Consume exact pinned versions of `@homelab-inventory/share-contract`, `viewer-model`, and `viewer-react` when published.
- Fixture-only mode is allowed before package publication, but publication remains hard-disabled.
- Never copy Homelab Inventory source or import its API, persistence, editor, agent, authorization, or Registry credential modules.
- PostgreSQL has no host port and Watchtower is disabled.
- Runtime containers are non-root, read-only, capability-free, and use bounded hardened tmpfs.
- No direct SkyArk access; backups use only the established SkyBolt workflow.
- Do not deploy until the coordinated rollout plan authorizes deployment.

---

### Task 1: Create The Private Repository, Fixture Gate, And Workspace

**Files:**
- Create: `package.json`
- Generate: `bun.lock`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `.dockerignore`
- Create: `.env.example`
- Create: `config/contract-mode.ts`
- Copy conditionally: `fixtures/contract-v1/manifest-v1.json`
- Copy conditionally: `fixtures/contract-v1/systems-v1.json`
- Copy conditionally: `fixtures/contract-v1/canvas-v1.json`
- Copy conditionally: `fixtures/contract-v1/SHA256SUMS`
- Create: `test/fixtures/contract-checksum/example.json`
- Create: `test/fixtures/contract-checksum/SHA256SUMS`
- Create: `apps/api/package.json`
- Create: `apps/web/package.json`
- Create: `packages/database/package.json`
- Create: `packages/domain/package.json`
- Create: `packages/registry-mirror/package.json`
- Create: `packages/observability/package.json`
- Create: `workers/renderer/package.json`
- Create: `workers/lifecycle/package.json`
- Create: `workers/analytics/package.json`
- Create: `workers/registry-mirror/package.json`
- Create: `test/workspace.test.ts`
- Create: `test/contract-mode.test.ts`

**Interfaces:**
- Produces: a real private Git repository, Bun workspace, and `readContractMode(): { mode: 'fixtures-disabled' | 'packages-enabled'; publicationEnabled: boolean }`.
- Consumes: fixture bundle and checksums from `ServerSpecsInventory/docs/handoffs/lab-gd-contract-v1` when available.

- [ ] **Step 1: Refuse unsafe local bootstrap states**

From `/Users/maikeldorta/Code/home-datacenter`, fail if
`HomelabInventoryShare` exists and is non-empty. Then run:

```bash
gh repo create mriverodorta/HomelabInventoryShare --private
gh repo clone mriverodorta/HomelabInventoryShare HomelabInventoryShare
cd HomelabInventoryShare
test "$(gh repo view mriverodorta/HomelabInventoryShare --json visibility -q .visibility)" = PRIVATE
test "$(git remote get-url origin)" = "git@github.com:mriverodorta/HomelabInventoryShare.git" \
  || test "$(git remote get-url origin)" = "https://github.com/mriverodorta/HomelabInventoryShare.git"
```

- [ ] **Step 2: Write failing workspace and fixture-mode tests**

```ts
expect(readContractMode(fixtureConfig)).toEqual({
  mode: 'fixtures-disabled', publicationEnabled: false,
})
expect(() => verifyFixtureChecksums(tamperedTestFixtureDir)).toThrow('checksum')
expect(importsOf('apps/web')).not.toContain('packages/database')
expect(importsOf('packages/domain')).not.toContain('packages/database')
```

- [ ] **Step 3: Copy and verify bootstrap fixtures**

The four `fixtures/contract-v1` files are conditional outputs and must not be
created when the approved bundle is absent. Do not synthesize `SHA256SUMS`.
Checksum unit tests use only `test/fixtures/contract-checksum`, which is clearly
non-production data. Tasks 1-6 must pass in the absent-fixture state. When the
approved bundle is present, copy it byte-for-byte, verify every sorted SHA-256
entry before parsing, and commit the exact bytes. Never invent replacement
contract fixtures.

- [ ] **Step 4: Scaffold package boundaries and hard publication gate**

Fixture mode may validate local adapters but `publicationEnabled` is always
false. Package mode requires exact versions and npm integrity values from the
rollout ledger; any missing or mismatched package fails startup.

- [ ] **Step 5: Generate and inspect the initial lockfile**

Run `bun install` once after all workspace manifests have been written. Inspect
`bun pm ls --all` and `bun.lock` for exact resolved versions, unexpected Git or
file dependencies, duplicate security-sensitive packages, and unpinned shared
packages. Commit no package cache or install output.

- [ ] **Step 6: Prove reproducibility and commit**

Run: `bun install --frozen-lockfile && bun test test/workspace.test.ts test/contract-mode.test.ts`

```bash
git add .
git commit -m "chore: initialize private lab.gd workspace"
```

### Task 2: Add PostgreSQL Schema, Migrations, And Role Isolation

**Files:**
- Create: `packages/database/src/schema/*.ts`
- Create: `packages/database/src/client.ts`
- Create: `packages/database/src/migrator.ts`
- Create: `packages/database/drizzle.config.ts`
- Create: `packages/database/migrations/0001_foundation.sql`
- Create: `packages/database/test/schema.test.ts`
- Create: `packages/database/test/roles.test.ts`
- Create: `deploy/init-database-roles.sql`

**Interfaces:**
- Produces: typed repositories and separate `api`, `renderer`, `lifecycle`, `analytics`, and `registry_mirror` PostgreSQL roles.
- Consumes: PostgreSQL 17 and Drizzle.

- [ ] **Step 1: Write failing relational-integrity tests**

Cover positive numeric IDs, random public IDs, installation keys/tokens/nonces,
shares, immutable revisions, active pointers, view blobs, Registry definitions,
password hashes, claims, operations/events, qualified loads, analytics buckets,
bootstrap attributions, reports, and tombstones.

- [ ] **Step 2: Implement normalized schema and constraints**

Use integer PK/FK relationships internally and separate generated public IDs.
Add unique constraints for idempotency keys, used nonces, blob hashes, exact
Registry references, GitHub subject, load event IDs, and one active pointer per
share.

- [ ] **Step 3: Implement checksummed transactional migrations**

Acquire a PostgreSQL advisory lock, refuse changed historical checksums, apply
each migration in one transaction, and expose the active schema in readiness.

- [ ] **Step 4: Prove table and column privileges**

Renderer cannot read password, OAuth, or installation tables; analytics cannot
mutate shares; lifecycle cannot read OAuth credentials; Registry mirror cannot
read account or password tables. Filesystem isolation is tested in Task 15.

- [ ] **Step 5: Run and commit**

Run: `bun test packages/database && bun run db:migrations:check`

```bash
git add packages/database deploy/init-database-roles.sql
git commit -m "feat: add lab.gd relational foundation"
```

### Task 3: Centralize Configuration, Secrets, Proxy Trust, And Rate Limits

**Files:**
- Create: `packages/domain/src/config/environment.ts`
- Create: `packages/domain/src/config/secrets.ts`
- Create: `packages/domain/src/http/client-address.ts`
- Create: `packages/domain/src/rate-limits/rate-limiter.ts`
- Create: `packages/domain/src/rate-limits/policies.ts`
- Create: `packages/database/src/schema/rate-limits.ts`
- Create: `packages/database/src/rate-limits/postgres-rate-limiter.ts`
- Create: `packages/database/migrations/0002_rate_limits.sql`
- Create: `packages/domain/test/config.test.ts`
- Create: `packages/domain/test/client-address.test.ts`
- Create: `packages/domain/test/rate-limit-policies.test.ts`
- Create: `packages/database/test/postgres-rate-limiter.test.ts`

**Interfaces:**
- Produces: domain `RateLimiter` port and policies plus database `PostgresRateLimiter`; API composition injects the implementation into routes.
- Consumes: Infisical-rendered files, configured trusted peer CIDRs, PostgreSQL.

- [ ] **Step 1: Write failing configuration tests**

Reject simultaneous `NAME` and `NAME_FILE`, unreadable/empty secret files,
non-HTTPS production origins, malformed CIDRs, missing publication gate, weak
password pepper, and unknown contract mode.

- [ ] **Step 2: Write failing trusted-address tests**

Ignore forwarded headers from untrusted peers. For configured Cloudflare Tunnel
peers, accept one valid `CF-Connecting-IP`, normalize IPv4-mapped IPv6, reject
oversized or malformed chains, and never trust arbitrary `X-Forwarded-For`.

- [ ] **Step 3: Define the domain port and policies**

`packages/domain` defines request/result types and named policies without
importing PostgreSQL, Drizzle, or `packages/database`. Policy tests cover
installation, password, reports, account claims, public reads, and global load.

- [ ] **Step 4: Implement one atomic PostgreSQL adapter**

Use bounded windows and one `INSERT ... ON CONFLICT ... DO UPDATE`. Keys are HMAC
digests, not raw addresses. Authentication and mutation endpoints fail closed
when limiting is unavailable; public reads return 503 when required database
state is unavailable. Construct the adapter in the API composition root and
inject only the `RateLimiter` interface into route services. Add the rate-limit
table through checksummed migration `0002_rate_limits.sql`; test fresh install,
upgrade from `0001`, changed-checksum refusal, and concurrent consumption.

- [ ] **Step 5: Run and commit**

Run: `bun test packages/domain/test/config.test.ts packages/domain/test/client-address.test.ts packages/domain/test/rate-limit-policies.test.ts packages/database/test/postgres-rate-limiter.test.ts`

```bash
git add packages/domain packages/database
git commit -m "feat: centralize lab.gd security configuration"
```

### Task 4: Implement Installation Authentication And Resumable SSE

**Files:**
- Create: `packages/domain/src/installations/*.ts`
- Create: `apps/api/src/routes/installations.ts`
- Create: `apps/api/src/routes/installation-events.ts`
- Create: `apps/api/test/installations.test.ts`
- Create: `apps/api/test/replay.test.ts`
- Create: `apps/api/test/installation-events.test.ts`

**Interfaces:**
- Produces: challenge, activation, token renewal, rotation, recovery, device claim, and authenticated installation SSE.
- Consumes: config/rate limiter and installation repository.

- [ ] **Step 1: Write failing activation and replay tests**

Assert UUID v4 and Ed25519 SPKI validation, five-minute single-use challenge,
bounded request timestamp, body hash, token scope/expiry, nonce uniqueness,
revocation, and generic failures.

- [ ] **Step 2: Write failing rotation and recovery tests**

Failed rotation preserves current credentials. Identity mismatch returns
`409 installation-recovery-pending`, persists exactly one replacement, and does
not create retry loops or duplicate logical installations.

- [ ] **Step 3: Implement monotonic resumable SSE**

Persist installation event IDs, support `Last-Event-ID` bounded replay, emit
15-second comment heartbeats, and stream only publication, claim, expiration,
grace, and recovery state. Use PostgreSQL `LISTEN/NOTIFY` plus reconciliation on
reconnect; do not poll.

- [ ] **Step 4: Run integration tests and commit**

Run: `bun test apps/api/test/installations.test.ts apps/api/test/replay.test.ts apps/api/test/installation-events.test.ts`

```bash
git add packages/domain apps/api
git commit -m "feat: authenticate publishing installations"
```

### Task 5: Implement Verified Content-Addressed Blob Storage

**Files:**
- Create: `packages/domain/src/content/blob-store.ts`
- Create: `packages/domain/src/content/filesystem-blob-store.ts`
- Create: `packages/domain/src/content/blob-validation.ts`
- Create: `packages/domain/test/blob-store.test.ts`
- Create: `deploy/storage-init.sh`

**Interfaces:**
- Produces: `putVerified`, `openVerified`, `quarantineUnreferenced`, `purgeQuarantined`.
- Consumes: private filesystem roots and SHA-256 metadata.

- [ ] **Step 1: Write failing filesystem safety tests**

Reject traversal, symlinks, non-regular files, hash/size mismatch, oversized
writes, partial files, and duplicate storage. Prove interruption leaves no
addressable partial blob.

- [ ] **Step 2: Implement atomic verified storage**

Stream to task-scoped temp, enforce limits while hashing, fsync, rename, and
derive immutable paths only from lowercase SHA-256.

- [ ] **Step 3: Implement quarantine GC primitives**

Require zero references in a fresh transaction, quarantine first, wait the
configured period, and recheck before deletion.

- [ ] **Step 4: Run and commit**

Run: `bun test packages/domain/test/blob-store.test.ts`

```bash
git add packages/domain deploy/storage-init.sh
git commit -m "feat: add verified content-addressed storage"
```

### Task 6: Mirror Exact Historical Registry Definitions

**Files:**
- Create: `packages/registry-mirror/src/client.ts`
- Create: `packages/registry-mirror/src/importer.ts`
- Create: `packages/registry-mirror/src/verifier.ts`
- Create: `packages/registry-mirror/test/historical-revisions.test.ts`
- Create: `workers/registry-mirror/src/index.ts`

**Interfaces:**
- Produces: `resolveExactTemplate(templateKey, templateRevision, contentHash)`.
- Consumes: immutable signed Registry releases and trusted public keys.

- [ ] **Step 1: Write failing historical resolution tests**

Use multiple signed Registry snapshots containing different template revisions.
Assert exact key/revision/hash resolution, deduplication, signature verification,
and no `latest` fallback.

- [ ] **Step 2: Implement signed import and deduplication**

Verify release manifest, Ed25519 signatures, hashes, and sizes before parsing.
Store each unique exact definition once with provenance and signing key ID.

- [ ] **Step 3: Add unavailable and corrupt behavior**

Missing or invalid historical definitions return a stable blocking result. The
public viewer never contacts Registry, and mirror failure never alters active
shares.

- [ ] **Step 4: Run and commit**

Run: `bun test packages/registry-mirror`

```bash
git add packages/registry-mirror workers/registry-mirror
git commit -m "feat: mirror signed historical registry definitions"
```

### Task 7: Implement Manifest-First Ingestion And Atomic Activation

**Files:**
- Create: `packages/domain/src/publication/*.ts`
- Create: `apps/api/src/routes/publications.ts`
- Create: `apps/api/test/publications.test.ts`
- Create: `apps/api/test/decompression-limits.test.ts`

**Interfaces:**
- Produces: manifest, missing-hash, blob upload, activation, unpublish, and delete endpoints.
- Consumes: package-enabled contract mode, installation auth, rate limits, blob store, Registry mirror.

- [ ] **Step 1: Enforce the package and fixture gate**

In fixture mode every publication route returns
`503 publication-contract-not-enabled`. In package mode startup verifies exact
npm versions and integrities plus fixture checksums before routes become ready.

- [ ] **Step 2: Write protocol-order and decompression tests**

Assert transport limit, auth, replay, bounded decompression, strict schema,
semantic references, Registry references, hashes, and activation order. Reject
over 2 MB compressed, over 10 MB expanded, pathological ratios, extras,
dangling or duplicate public IDs, and unsupported versions.

- [ ] **Step 3: Implement durable staged operations**

Use idempotency keys, bounded attempts, leases, heartbeats, optimistic revisions,
sanitized events, and one transaction to create an immutable revision and move
the active pointer. Failure leaves the previous active revision.

- [ ] **Step 4: Run integration tests and commit**

Run: `bun test apps/api/test/publications.test.ts apps/api/test/decompression-limits.test.ts`

```bash
git add packages/domain apps/api
git commit -m "feat: ingest and activate signed shares"
```

### Task 8: Implement Public Read API And Visibility Enforcement

**Files:**
- Create: `apps/api/src/routes/public-shares.ts`
- Create: `apps/api/src/middleware/share-visibility.ts`
- Create: `apps/api/src/http/cache-policy.ts`
- Create: `packages/domain/src/public-loads/bootstrap-attribution.ts`
- Create: `packages/database/src/public-loads/postgres-bootstrap-attribution.ts`
- Create: `apps/api/test/public-shares.test.ts`
- Create: `apps/api/test/public-cache-policy.test.ts`
- Create: `apps/api/test/qualified-load-outbox.test.ts`
- Create: `packages/database/test/bootstrap-attribution.test.ts`

**Interfaces:**
- Produces: metadata, manifest, initial-load, view-blob, social-preview, expired, tombstone, unavailable endpoints, and `BootstrapAttributionStore.issue/consume`.
- Consumes: active share projection, blob store, transactional outbox, optional short-lived HTML bootstrap-attribution token, and a generic protected gate that Task 9 later replaces with injected session authorization.

- [ ] **Step 1: Write the public-state response matrix**

Test public, unlisted, protected, pending, unpublished, expired, tombstone,
missing, and temporarily unavailable states. Protected responses are generic and
contain no title, count, hash, cache validator, or state-specific detail.

- [ ] **Step 2: Define cache, ETag, and content-type policy**

Immutable blobs use strong hash ETags and immutable caching. Active manifests use
revision ETags and short revalidation. Protected and owner state use
`private, no-store`. Unlisted/protected metadata uses `noindex`.

- [ ] **Step 3: Implement one-time client-confirmed load receipts**

`GET /v1/public/shares/:id/load?mode=full|embed` returns metadata, manifest, and
initial view with a generated `loadEventId` and short-lived opaque completion
token. It may also consume the one-time bootstrap-attribution token issued by
Task 10, verify that token's share, mode, and expiry, and copy only its
server-recorded external hostname onto the pending load. It never accepts a
referring hostname from browser JavaScript. Persist only opaque-token hashes.
After the viewer parses the initial payload and mounts its initial view, it
sends the completion token once to
`POST /v1/public/shares/:id/load/:loadEventId/complete`. In one transaction,
verify the share, mode, expiry, and token hash; mark the pending load delivered;
and insert one outbox row under unique `loadEventId`. Missing, expired,
replayed, or unconfirmed loads do not qualify. This metric is explicitly a
client-confirmed initial load, not cryptographic proof that a human rendered or
viewed the content. One-time tokens, expiry, deduplication, and shared
source/share/global limits make it abuse-resistant rather than authoritative.

- [ ] **Step 4: Prove API and header behavior through a real Hono server**

Run: `bun test apps/api/test/public-shares.test.ts apps/api/test/public-cache-policy.test.ts apps/api/test/qualified-load-outbox.test.ts packages/database/test/bootstrap-attribution.test.ts`

Expected: PASS, including actual headers and duplicate-completion defense.

- [ ] **Step 5: Commit public read API**

```bash
git add packages/domain packages/database apps/api
git commit -m "feat: expose privacy-safe public share reads"
```

### Task 9: Add Password Hashing And Protected Sessions

**Files:**
- Create: `packages/domain/src/passwords/password-service.ts`
- Create: `apps/api/src/routes/passwords.ts`
- Create: `apps/api/src/middleware/protected-session.ts`
- Create: `apps/api/src/middleware/protected-embed-capability.ts`
- Create: `apps/api/test/passwords.test.ts`
- Create: `apps/api/test/protected-no-leak.test.ts`
- Create: `apps/api/test/protected-embed-capability.test.ts`

**Interfaces:**
- Produces: password set/replace/verify, host-wide viewer session, per-share revision grants, `requireProtectedShareSession`, and memory-only protected-embed capability.
- Consumes: Bun Argon2id, versioned Infisical pepper, shared rate limiter.

- [ ] **Step 1: Write hashing and bounded-attempt tests**

Assert unique salts, PHC-only persistence, pepper version, no recovery, generic
failure, and atomic limits by share, source, and global keys.

- [ ] **Step 2: Implement password replacement and verification**

Use pinned Argon2id parameters with `Bun.password.hash` and
`Bun.password.verify`. Password replacement revokes existing protected sessions.
Never log or persist plaintext.

- [ ] **Step 3: Implement one host-wide revision-bound viewer session**

Set one opaque `__Host-labgd_viewer` cookie with `Path=/`, `HttpOnly`, `Secure`,
and `SameSite=Lax`; do not set `Domain`. The cookie identifies a short-lived
server-side viewer session and therefore reaches `/s`, `/e`, and `/v1/public`
routes. Store separate session grants keyed by numeric share ID and active
revision ID. Every protected request resolves its route share, verifies a
matching unexpired grant, and rejects cross-share or stale-revision use. One
browser session may hold multiple independent grants without encoding share IDs,
password data, or grants in the cookie. Password replacement, active-revision
replacement, unpublish, expiration, and deletion revoke the affected grant.

For a protected cross-origin iframe, `SameSite=Lax` intentionally does not
authorize the embedded request. Its generic password flow exchanges a
successful password verification plus Task 10's one-time HTML bootstrap context
for a separate short-lived bearer capability bound to numeric share ID, active
revision ID, and one exact allowlisted embed origin. Keep it only in iframe
memory and send it in the `Authorization` header for that share's read API. It
must never enter a URL, cookie, local/session storage, log, referrer, or parent
window message. Reload requires a new verification. Test origin/share/revision
mismatch, expiration, revocation, replayed bootstrap context, and storage/URL
absence. If the exact embedding origin cannot be established and matched to the
share allowlist, fail closed and direct the viewer to open the protected share
as a top-level lab.gd page.

- [ ] **Step 4: Integrate middleware into Task 8 and run no-leak proof**

Test JSON, ETags, cache headers, errors, load envelopes, blobs, and social
preview responses against public and protected fixtures through the real Hono
server. Task 10 owns HTML and Open Graph no-leak integration after those routes
exist.

- [ ] **Step 5: Run and commit**

Run: `bun test apps/api/test/passwords.test.ts apps/api/test/protected-no-leak.test.ts apps/api/test/protected-embed-capability.test.ts`

```bash
git add packages/domain apps/api
git commit -m "feat: protect shares with Argon2id passwords"
```

### Task 10: Build Full-Page And Embed Viewer Shells

**Files:**
- Create: `apps/web/src/routes/share-page.tsx`
- Create: `apps/web/src/routes/embed-page.tsx`
- Create: `apps/web/src/routes/password-page.tsx`
- Create: `apps/api/src/routes/share-pages.ts`
- Create: `apps/api/src/html/share-document.ts`
- Create: `apps/api/src/public-loads/html-bootstrap.ts`
- Create: `apps/web/src/components/share-header.tsx`
- Create: `apps/web/src/components/share-community-state.tsx`
- Create: `apps/web/src/components/share-actions.tsx`
- Create: `apps/web/src/lib/deep-links.ts`
- Create: `apps/web/test/viewer.test.tsx`
- Create: `apps/web/test/embed.test.tsx`
- Create: `apps/api/test/share-pages-html.test.ts`
- Create: `apps/api/test/bootstrap-attribution.test.ts`
- Create: `apps/api/test/embed-csp.test.ts`

**Interfaces:**
- Produces: Hono-served `/s/:shareId` and `/e/:shareId` HTML plus immutable Vite hydration assets.
- Consumes: Task 8/9 APIs and exact pinned `viewer-react`.

- [ ] **Step 1: Write lazy loading and deep-link tests**

Initial load consumes only shell and Task 8 load envelope. Other views load on
selection. Item or connection links center and open the read-only inspector.

- [ ] **Step 2: Implement restrained Impeccable layouts**

Use shared viewer components. Full page has compact utility header and title or
description region. Embed prioritizes content with expandable description and
Open on lab.gd. Disabled comments/reactions are absent; enabled initial states
say Coming soon.

- [ ] **Step 3: Serve dynamic share HTML from Hono**

Hono resolves the generic or authorized share projection and emits the complete
HTML document referencing hashed Vite assets. It owns Open Graph metadata,
canonical URL, robots policy, cache policy, content type, and CSP. A protected
request without a valid Task 9 session receives only generic password-gate HTML
and headers; no title, description, counters, manifest hash, preview, or
state-specific detail enters source or headers.

- [ ] **Step 4: Capture external attribution at HTML delivery**

When serving `/s/:shareId` or `/e/:shareId`, parse the incoming `Referer` with
the platform URL parser. Discard malformed values, non-HTTP(S) schemes, the
`lab.gd` hostname, credentials, path, query, fragment, and port. Normalize and
bound only the external hostname. Store it beside a random short-lived
single-use token hash through Task 8's `BootstrapAttributionStore`, bound to
numeric share ID and `full` or `embed` mode, then place only the opaque token in
the HTML bootstrap data. Task 8 consumes the token while creating the load
event. The subsequent browser load and completion requests cannot supply or
override attribution. For protected embeds, the HTML bootstrap context also
records the exact validated embedding origin used by Task 9's capability
exchange, but analytics and authorization remain separate records and tokens.
Add integration tests for direct loads, external navigation, same-origin
navigation, malformed headers, mode/share mismatch, expiry, replay, and forged
JavaScript fields.

- [ ] **Step 5: Enforce embed CSP with integration tests**

Exact HTTPS origins become `frame-ancestors`. Explicit wildcard is allowed only
for public/unlisted shares. Protected shares reject wildcard. Verify actual
HTML, Open Graph, canonical, robots, cache, content-type, and CSP headers through
the real Hono server for public, unlisted, protected, expired, and missing
fixtures, not component snapshots.

- [ ] **Step 6: Run and commit**

Run: `bun test apps/web apps/api/test/share-pages-html.test.ts apps/api/test/bootstrap-attribution.test.ts apps/api/test/embed-csp.test.ts && bun run --cwd apps/web build`

```bash
git add apps
git commit -m "feat: render public and embedded lab shares"
```

### Task 11: Add GitHub Account Claiming And Management

**Files:**
- Create: `apps/api/src/auth/better-auth.ts`
- Create: `apps/api/src/routes/account-claims.ts`
- Create: `packages/database/src/schema/auth.ts`
- Create: `packages/database/migrations/0003_better_auth.sql`
- Create: `packages/database/test/better-auth-migration.test.ts`
- Create: `apps/web/src/routes/account-dashboard.tsx`
- Create: `apps/api/test/account-claims.test.ts`
- Create: `apps/web/test/account-dashboard.test.tsx`

**Interfaces:**
- Produces: GitHub-only login, device claim, account ownership, revision-safe dashboard.
- Consumes: Better Auth, GitHub OAuth files, installation SSE, rate limiter.

- [ ] **Step 1: Write ownership and isolation tests**

One GitHub subject may claim multiple installations; another cannot claim them.
Claims are short-lived and single-use. Dashboard cannot query installation data.

- [ ] **Step 2: Add the pinned Better Auth schema migration**

Pin the Better Auth version first, generate its required account, session,
verification, and OAuth schema, then review and commit it as ordered migration
`0003_better_auth.sql`. The existing checksummed migration runner owns applying
it. Test a fresh install, sequential upgrade from `0001` through `0002` to
`0003`, changed-checksum refusal, transactional rollback on injected failure,
and restart idempotency. Disable runtime auto-migration in every environment.

- [ ] **Step 3: Implement outbound claim completion**

Local app creates claim; browser signs into GitHub and approves; Task 4 SSE emits
completion. Store immutable GitHub subject, not mutable username.

- [ ] **Step 4: Implement revision-safe settings**

Allow metadata, visibility, expiration, embed policy, comments/reactions,
unpublish, and delete with optimistic revisions. Content replacement remains
installation-only.

- [ ] **Step 5: Run and commit**

Run: `bun test packages/database/test/better-auth-migration.test.ts apps/api/test/account-claims.test.ts apps/web/test/account-dashboard.test.tsx`

```bash
git add packages/database apps
git commit -m "feat: claim and manage shares with GitHub"
```

### Task 12: Add Atomic Analytics And Abuse Reporting

**Files:**
- Create: `packages/observability/src/qualified-loads.ts`
- Create: `packages/observability/src/daily-visitors.ts`
- Create: `workers/analytics/src/index.ts`
- Create: `apps/api/src/routes/analytics.ts`
- Create: `apps/api/src/routes/reports.ts`
- Create: `apps/web/src/components/report-dialog.tsx`
- Create: `packages/observability/test/privacy.test.ts`
- Create: `packages/observability/test/idempotency.test.ts`
- Create: `apps/api/test/reports.test.ts`

**Interfaces:**
- Produces: idempotent aggregate analytics and private abuse-report queue.
- Consumes: Task 8 qualified-load outbox and shared rate limiter.

- [ ] **Step 1: Write delivery and idempotency tests**

One successfully completed `loadEventId` produces one outbox event and one
total/full/embed increment despite duplicate completion requests or worker
retry. Pending, expired, disconnected, or client-unconfirmed loads produce none.

- [ ] **Step 2: Implement daily unlinkable uniqueness**

Derive daily HMAC key from versioned Infisical secret. Store unique
`(shareId, utcDate, dailyDigest)`, aggregate counts, and purge digests after 48
hours. Never persist raw IP, full referrer, UA, country, or stable fingerprint.

- [ ] **Step 3: Bound referring-hostname cardinality**

Normalize hostname only, cap length at 253, retain top 100 hostnames per
share/day, and aggregate the remainder as `other`.

- [ ] **Step 4: Implement abuse reports**

Use stable reason codes, bounded optional text, immutable events, sanitized
moderation notes, explicit dispositions, and source/share/global limits.

- [ ] **Step 5: Run and commit**

Run: `bun test packages/observability apps/api/test/reports.test.ts`

```bash
git add packages/observability workers/analytics apps
git commit -m "feat: add privacy-safe analytics and abuse reports"
```

### Task 13: Add Expiration, Grace, Inactivity, And Blob Lifecycle

**Files:**
- Create: `workers/lifecycle/src/index.ts`
- Create: `packages/domain/src/lifecycle/policy.ts`
- Create: `packages/domain/test/lifecycle.test.ts`

**Interfaces:**
- Produces: idempotent lifecycle transitions and permanent ID tombstones.
- Consumes: revisions, qualified-view timestamps, blob references.

- [ ] **Step 1: Write the complete lifecycle matrix**

Cover indefinite, duration, fixed UTC, publication reset, settings changes that
do not reset timers, one-year inactivity, 30-day unclaimed grace, claimed keep
online, immediate delete, and same-owner reactivation.

- [ ] **Step 2: Implement revision-checked transitions**

Lock share, recheck expected revision, time, and ownership, purge references,
retain minimal tombstone, emit sanitized event, and make repeat execution no-op.

- [ ] **Step 3: Integrate quarantine GC and SSE**

Decrement references transactionally, quarantine only after commit, recheck
before file purge, and notify installation through Task 4 events.

- [ ] **Step 4: Run and commit**

Run: `bun test packages/domain/test/lifecycle.test.ts`

```bash
git add packages/domain workers/lifecycle
git commit -m "feat: enforce share lifecycle and retention"
```

### Task 14: Add Social Preview Renderer, QR, And Share Actions

**Files:**
- Create: `workers/renderer/src/render-input.ts`
- Create: `workers/renderer/src/render-share.ts`
- Create: `workers/renderer/src/index.ts`
- Create: `workers/renderer/test/render-share.test.ts`
- Modify: `apps/web/src/components/share-actions.tsx`

**Interfaces:**
- Produces: cached social images keyed by canonical render input.
- Consumes: immutable viewer data and isolated Chromium.

- [ ] **Step 1: Define and test canonical render identity**

Hash canonical title, description, active manifest hash, initial view or focus,
theme, presentation config, protected/public mode, viewer package versions, and
renderer version. Different visible inputs never reuse one image.

- [ ] **Step 2: Implement isolated bounded rendering**

Disable external network, downloads, file URLs, persistent profiles, and
unbundled scripts. Enforce CPU, memory, time, and output limits. Protected shares
always use generic preview; pending or failed rendering uses generic fallback.

- [ ] **Step 3: Add compact actions**

Provide Copy link, Copy embed, Open, Download social image, and QR. QR contains
only canonical share URL.

- [ ] **Step 4: Run and commit**

Run: `bun test workers/renderer apps/web`

```bash
git add workers/renderer apps/web
git commit -m "feat: render versioned social previews"
```

### Task 15: Build Hardened Deployment, Secret Rendering, Backup, And Restore

**Files:**
- Create: `Dockerfile`
- Create: `compose.yaml`
- Create: `deploy/cloudflared-config.yml`
- Create: `deploy/secret-files.md`
- Modify: `deploy/storage-init.sh`
- Create: `ops/backup.sh`
- Create: `ops/verify-backup.sh`
- Create: `ops/restore.sh`
- Create: `ops/security-audit.sh`
- Create: `test/compose-security.test.ts`
- Create: `test/backup-restore.test.ts`
- Create: `test/secret-mounts.test.ts`

**Interfaces:**
- Produces: SkyBolt-ready deployment and matched recovery workflow.
- Consumes: Infisical-rendered `0600` files and Cloudflare Tunnel network.

- [ ] **Step 1: Write compose and mount security tests**

Assert pinned digests, read-only roots, caps dropped, no-new-privileges, non-root
UIDs, hardened tmpfs, no PostgreSQL port, Watchtower disabled, separate DB
credentials, exact secrets, and exact mounts. Prove API has no renderer object
path and renderer has no password, OAuth, or installation secrets.

- [ ] **Step 2: Implement Cloudflare and secret contract**

Cloudflared is the only public path to web/API. Configure trusted tunnel peers,
no direct public API binding, required secret file paths, startup validation,
publication gate, and rotation by service recreation. Reject direct and file
secret values together.

- [ ] **Step 3: Implement consistent matched backup protocol**

Acquire operation lock and write fence, stop mutating workers, drain API writes,
capture PostgreSQL custom dump plus immutable blob and preview tree, record source
commit/schema/container metadata, checksum, encrypt through established SkyBolt
workflow, then resume writers. Define retention explicitly.

- [ ] **Step 4: Implement isolated restore and rollback**

Require confirmation; verify checksums and traversal; restore into temporary
database and object tree; validate schema, ownership, modes, pointers,
references, and hashes; fence writes; atomically switch; retain previous state
until readiness and smoke tests pass; automatically roll back on failure.

- [ ] **Step 5: Run real container and recovery tests**

Run: `bun run verify && bun run security:container && bun test test/compose-security.test.ts test/secret-mounts.test.ts test/backup-restore.test.ts`

`security:container` must build and boot the final distroless image for both
`linux/amd64` and `linux/arm64`, then run Docker Scout and Trivy against each
exact image. Expected: zero known vulnerabilities at every severity on both
architectures, no mount/role violations, successful staged restore, and
injected cutover rollback.

- [ ] **Step 6: Commit deployment support**

```bash
git add Dockerfile compose.yaml deploy ops test
git commit -m "chore: harden lab.gd deployment and recovery"
```

### Task 16: Complete End-To-End And Restart Verification

**Files:**
- Create: `test/e2e/publication.spec.ts`
- Create: `test/e2e/privacy.spec.ts`
- Create: `test/e2e/lifecycle.spec.ts`
- Create: `test/e2e/restart.spec.ts`
- Create: `README.md`
- Create: `SECURITY.md`
- Create: `docs/operations.md`

**Interfaces:**
- Produces: verified service ready for coordinated rollout.
- Consumes: all preceding tasks and frozen application fixtures.

- [ ] **Step 1: Run complete protocol and viewer scenarios**

Cover public, unlisted, protected, immutable, replaceable sync/manual, exact
Registry revision, custom item, deep link, embed, account claim, analytics,
report, expiration, and reactivation.

- [ ] **Step 2: Run adversarial integration scenarios**

Cover replay, decompression bomb, dangling refs, brute force, account takeover,
cross-installation access, CSP bypass, stored script input, path traversal,
worker crash, database restart, stale lease, and SSE reconnect.

- [ ] **Step 3: Prove restart and retry idempotency**

Restart API and each worker during active operations. Assert no duplicate
installation, share, revision, blob, load count, claim, report, preview, or
lifecycle transition.

- [ ] **Step 4: Run the complete local release gate**

Run: `bun run lint && bun run test && bun run build && bun run security:container`

Expected: PASS, including build/boot plus Docker Scout and Trivy zero-known-
vulnerability results for both `linux/amd64` and `linux/arm64` final images.

- [ ] **Step 5: Document and commit**

Document privacy guarantees, limits, retention, Registry mirror, Infisical,
Cloudflare, backup/restore, and incident response.

```bash
git add README.md SECURITY.md docs test
git commit -m "test: verify lab.gd sharing service end to end"
```
