# LabGD Joint Publication Certification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy Homelab Inventory `0.15.0` to `main/latest`, certify automatic enrollment and the complete LabGD publication lifecycle with synthetic data, and leave normal publication enabled only if every invariant passes.

**Architecture:** Promote the already approved ARM64 candidate by building AMD64 from the identical commit, deploy the exact multi-platform image, and verify the app while LabGD remains gated. Then temporarily enable LabGD publication, run isolated two-installation protocol and viewer proofs, and retain the enabled state only after backup, restart, privacy, and ownership validation.

**Tech Stack:** Local OCI release tooling, Docker Hub, Watchtower, Bun, SQLite, PostgreSQL, Ed25519, SSE, Playwright, LabGD Compose.

## Global Constraints

- Plan 01 and Plan 02 must both be complete before this plan starts.
- Use only the approved Application commit, ARM64 digest, sanitized snapshot, and release receipt from Plan 02.
- LabGD must begin this plan healthy, package-backed, and `PUBLICATION_ENABLED=false`.
- Use synthetic disposable installations and sanitized fixture content for publication certification; do not publish live production inventory.
- Do not change the Registry, its signing key, or signed catalog artifacts.
- Never copy sharing identities between environments or expose their contents.
- Stop immediately and restore `PUBLICATION_ENABLED=false` on any contract, security, ownership, privacy, restart, backup, or data-integrity failure.
- Do not connect directly to SkyArk.

---

### Task 1: Publish The Approved Application To Main

**Files:**
- Use: `scripts/local-release.mjs`
- Modify through release tooling: `main` branch and Docker tag `latest`
- Record: `docs/handoffs/lab-gd-rollout/EVIDENCE.md`

**Interfaces:**
- Consumes: approved `0.15.0` ARM64 candidate.
- Produces: exact AMD64+ARM64 `latest` image and synchronized `main`.

- [ ] **Step 1: Revalidate the approval binding**

Confirm the current commit, source fingerprint, release version, sanitized snapshot hash, and ARM64 digest still match the approval receipt. Any drift requires repeating Plan 02.

- [ ] **Step 2: Build AMD64 and perform the publication dry run**

```bash
bun run release:local publish --channel latest --dry-run
```

Expected: AMD64 cold build, runtime smoke tests, Docker Scout and Trivy zero findings, exact two-platform index assembly in the disposable local registry, and no remote tag changes.

- [ ] **Step 3: Publish the exact candidates**

```bash
bun run release:local publish --channel latest
```

Expected: exact OCI candidates uploaded, `latest` moved, temporary candidate tags removed, approved revision pushed to `main`, and no stable/versioned tag moved.

- [ ] **Step 4: Verify Docker Hub and GitHub state**

Confirm `latest` resolves to the recorded multi-platform digest for AMD64 and ARM64, no candidate tags remain, `origin/main` matches the approved revision, and GitHub CI passes for the exact commit.

### Task 2: Verify Production And Demo Upgrade

**Files:**
- Verify production: `/data/stack/homelab-inventory`
- Verify demo: existing demo Compose deployment

**Interfaces:**
- Consumes: published `latest` image.
- Produces: healthy upgraded production and unchanged demo isolation.

- [ ] **Step 1: Create and verify the matched application backup**

Use the established SkyBolt deployment backup workflow before Watchtower recreation. Record checksum and encrypted-backup results without accessing SkyArk directly.

- [ ] **Step 2: Wait for Watchtower and verify exact image**

Confirm exactly production and demo update to the expected digest, both become healthy, and unrelated containers are unchanged.

- [ ] **Step 3: Verify migrations and application invariants**

Confirm schema 29-or-newer migration state, restart idempotency, and unchanged projects, workspaces, inventory identities, assignments, resource/slot IDs, placements, connections, route cache, Registry links, Agent bindings, metadata, authentication, permissions, notifications, and compatibility findings.

- [ ] **Step 4: Verify demo isolation**

Confirm demo has no `/data/sharing` UUID, private key, credentials, public-ID key, enrollment projection, event cursor, remote request, or share operation.

### Task 3: Verify Automatic Production Enrollment

**Files:**
- Verify: `/data/sharing/installation-instance.json`
- Verify: `/data/sharing/installation-ed25519.pem`
- Verify: `/data/sharing/installation-credentials.json`
- Verify: `/data/sharing/public-id-key`

**Interfaces:**
- Consumes: healthy production app and gated LabGD.
- Produces: one stable connected production installation without publishing content.

- [ ] **Step 1: Verify startup-created identity files**

Confirm one UUID v4 and one Ed25519 key exist, private files are mode `0600`, ownership matches the non-root app user, and no Registry identity file changed.

- [ ] **Step 2: Verify capability negotiation and enrollment**

Confirm production reports connected sharing state, protocol 1, share contract 1, Systems/Canvas view contract 1, complete installation scopes, resumable events, lifecycle operations, protected handoff, claiming, and analytics. Publication remains unavailable while LabGD is gated.

- [ ] **Step 3: Run the read-only verifier**

```bash
HLI_ORIGIN=https://inv.hkloud.org \
LABGD_ORIGIN=https://lab.gd \
HLI_SESSION_COOKIE="$(cat /private/tmp/hli-sharing-verifier-cookie)" \
bun run sharing:integration:check
rm -f /private/tmp/hli-sharing-verifier-cookie
```

Write the cookie to the mode-`0600` task-scoped file without printing it. The command substitution keeps the value out of shell history and process arguments; never include it in commits or evidence. Remove the file immediately afterward.

- [ ] **Step 4: Prove restart identity idempotency**

Restart the application without recreation, then recreate it once through Compose. Confirm UUID, private-key hash, credential installation ID, public-ID-key hash, event cursor, and connected projection remain identical and only short-lived credential fields may renew.

### Task 4: Enable Bounded Publication And Certify The Protocol

**Files:**
- Use: LabGD `docs/superpowers/plans/2026-08-22-temporary-publication-enablement.md`
- Use: LabGD `compose.yaml`
- Record: shared rollout evidence

**Interfaces:**
- Consumes: connected app and healthy gated LabGD.
- Produces: complete publication and cross-installation isolation proof.

- [ ] **Step 1: Create a named pre-enablement LabGD backup**

Run and verify the matched PostgreSQL/object/preview backup before changing the gate.

- [ ] **Step 2: Enable publication through the reviewed override**

Use the existing temporary publication override so tracked `compose.yaml` remains `false`. Recreate only the API, require `/readyz`, and verify the capability document now permits publication without changing contract versions.

- [ ] **Step 3: Create two disposable installations**

Generate independent UUIDs, Ed25519 keys, credentials, and public-ID keys in task-scoped directories. Verify their identity hashes differ and neither matches production.

- [ ] **Step 4: Publish the synthetic matrix**

From installation A, publish one public immutable share, one unlisted manual replaceable share, one synchronized replaceable share, and one password-protected share. Include one exact Registry-linked item, one sanitized custom item, one Canvas view with a connection, one Systems view, and one explicit one-time utilization snapshot.

- [ ] **Step 5: Verify content-addressed updates and SSE state**

Confirm missing-hash negotiation uploads only absent blobs, the one-minute synchronized debounce collapses edits, manual updates remain manual, resource snapshots do not refresh implicitly, old revisions stay inactive but intact during replacement, and each remote event plus cursor commits once after replay/reconnect.

- [ ] **Step 6: Verify lifecycle and ownership isolation**

Update settings and password, unpublish, republish, delete, and reactivate according to policy using stable idempotency keys and revision checks. Installation B must receive denial for every read, mutation, claim, analytics, public-ID reuse, and event-stream attempt against installation A's objects.

### Task 5: Verify Public Viewers And Privacy

**Files:**
- Verify public routes: `/s/:shareId`, `/e/:shareId`
- Verify API routes: `/v1/public/shares/:id/**`

**Interfaces:**
- Consumes: certified synthetic shares.
- Produces: browser, embed, preview, privacy, and abuse-report evidence.

- [ ] **Step 1: Verify full and embed viewers**

Use Playwright at desktop and mobile sizes. Confirm lazy view loading, deep links, canvas centering, Inspector behavior, title/description layout, restricted embed controls, original-page link, comments/reactions coming-soon states, QR action, and compact share actions.

- [ ] **Step 2: Verify protected share behavior**

Confirm Argon2id verification, generic pre-auth HTML/metadata, no password persistence, revision-bound viewer session, CSP `frame-ancestors`, exact HTTPS origin handshake, rejection of missing/opaque/HTTP/mismatched origins, and no parent-domain authentication cookie.

- [ ] **Step 3: Verify social previews and failure states**

Confirm the isolated network-disabled renderer generates the expected current revision preview; unsupported, expired, deleted, protected-before-auth, or failed-render states return generic safe previews without content leakage.

- [ ] **Step 4: Verify analytics and reporting**

Confirm only successful full/embed content loads count as activity, browser-submitted referrer values are ignored, daily aggregate retention is bounded, abuse reporting is available from launch, and no request-level visitor time series or source address is stored.

- [ ] **Step 5: Audit browser and service logs**

Expected: console errors `0`, failed viewer requests `0`, secret/private-field occurrences `0`, unbounded retries `0`, cross-installation access `0`, and private Registry signing-key access `0`.

### Task 6: Prove Recovery And Choose The Final Gate State

**Files:**
- Use: LabGD `ops/backup.sh`
- Use: LabGD `ops/verify-backup.sh`
- Use: LabGD `ops/restore.sh`
- Use: LabGD `ops/verify-restart.sh`

**Interfaces:**
- Consumes: successful certification state.
- Produces: enabled normal publication or a safely disabled rollout.

- [ ] **Step 1: Create and verify the post-certification backup**

Capture PostgreSQL, object blobs, previews, migration metadata, and checksums. Restore it into an isolated target and verify active pointers, tombstones, installation ownership, idempotency records, event cursors, claims, and analytics aggregates.

- [ ] **Step 2: Restart the complete LabGD stack**

Run the production restart suite and verify no duplicate installation, share, revision, blob, preview, event, operation, claim, lifecycle transition, load receipt, or aggregate row.

- [ ] **Step 3: Remove synthetic content**

Delete/tombstone all synthetic shares and installations through supported lifecycle/test cleanup boundaries. Confirm production installation remains connected and has published zero live inventory shares.

- [ ] **Step 4: Decide the publication state**

If every prior assertion passed, enable normal publication using the reviewed production configuration and require `/readyz`. If any assertion failed, restore `PUBLICATION_ENABLED=false`, require `/readyz`, and stop the rollout.

- [ ] **Step 5: Record final certification evidence**

Record exact commits, version, image digests, package integrities, backups, health/readiness, identity hashes, synthetic operation IDs, viewer screenshots, invariant counts, restart results, cleanup, and final gate state without secret values.
