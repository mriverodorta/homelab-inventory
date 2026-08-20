# lab.gd Coordinated Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the shared packages, deploy the private service and application in safe order, and prove the complete sharing workflow without exposing private data or destabilizing existing installations.

**Architecture:** Use an explicit rollout ledger shared by the Application and `lab.gd` tasks. Publish immutable package versions first, deploy `lab.gd` with application publication disabled, deploy the compatible Homelab Inventory client, then enable the contract and perform controlled live proofs with matched backups.

**Tech Stack:** Git, npm, GitHub CLI, local multi-architecture Docker release tooling, SkyBolt Compose, Cloudflare Tunnel, Infisical, PostgreSQL, Playwright.

## Global Constraints

- Both implementation tracks must be complete and clean before rollout.
- Do not mutate or redeploy the Registry unless an exact historical-artifact defect is proven.
- Do not connect directly to SkyArk.
- Use the established SkyBolt matched-backup workflow.
- Do not publish candidate Docker tags.
- Shared npm tarballs must be the exact audited artifacts.
- Never enable application publishing before `lab.gd` reports compatible contract and view versions.
- Demo mode must remain unable to enroll or publish.

---

### Task 1: Create The Cross-Project Rollout Ledger

**Files:**
- Create: `docs/handoffs/lab-gd-rollout/STATUS.md`
- Create: `docs/handoffs/lab-gd-rollout/ROLLOUT.md`
- Create: `docs/handoffs/lab-gd-rollout/CHECKSUMS.txt`

**Interfaces:**
- Produces: one owner/turn ledger and immutable fixture/package checksums.
- Consumes: exact commits from both repositories.

- [ ] **Step 1: Record immutable inputs**

Record application commit, private-service commit, shared package versions,
contract fixture hashes, Registry public key ID, and current production/demo
health.

- [ ] **Step 2: Define ordered ownership turns**

Use `PACKAGE_PUBLICATION`, `SERVICE_DEPLOYMENT`, `APPLICATION_DEPLOYMENT`,
`LIVE_VERIFICATION`, and `CLOSEOUT`. Exactly one owner is active.

- [ ] **Step 3: Commit the ledger**

```bash
git add docs/handoffs/lab-gd-rollout
git commit -m "docs: start lab.gd coordinated rollout [skip release-notes]"
```

### Task 2: Publish Exact Shared npm Packages

**Files:**
- Modify: `docs/handoffs/lab-gd-rollout/STATUS.md`
- Modify: `docs/handoffs/lab-gd-rollout/ROLLOUT.md`
- Modify: `docs/handoffs/lab-gd-rollout/CHECKSUMS.txt`

**Interfaces:**
- Produces: immutable public package versions consumed by both projects.
- Consumes: audited npm tarballs from Plan 1.

- [ ] **Step 1: Re-run package and repository gates**

Run: `bun run packages:share:check && bun run lint && bun run test && bun run build && bun run security:container`

Expected: PASS and clean tree.

- [ ] **Step 2: Pack and checksum exact artifacts**

Run `npm pack` for each package into a task-scoped directory, record SHA-256, and
inspect file lists again. Do not rebuild between audit and publication.

- [ ] **Step 3: Publish in dependency order**

Publish `share-contract`, then `viewer-model`, then `viewer-react` with public
access. Verify npm metadata, tarball checksum, exports, and a clean install in an
empty temporary project.

- [ ] **Step 4: Update and commit rollout evidence**

Record package versions, integrity hashes, npm URLs, and verification output.

### Task 3: Deploy lab.gd With Publication Gated

**Files:**
- Modify: rollout ledger files.

**Interfaces:**
- Produces: healthy private service at `lab.gd` with ingestion disabled.
- Consumes: private-service release and Infisical secrets.

- [ ] **Step 1: Create and verify matched predeployment backup**

Use only SkyBolt workflow. Record backup path, checksums, PostgreSQL metadata,
blob metadata, and encrypted-backup result.

- [ ] **Step 2: Deploy hardened service**

Apply migrations, keep publication gate disabled, verify PostgreSQL unexposed,
Cloudflare Tunnel routing, service roles, mounts, secrets, health, and readiness.

- [ ] **Step 3: Verify public empty states and protected behavior**

Unknown IDs return generic not-found, tombstoned fixtures return expired, and
password fixtures return generic gates with no metadata leaks.

- [ ] **Step 4: Record exact deployment evidence**

Include source commit, image digests, container IDs/start times, schema, package
versions, health output, and security scan receipts.

### Task 4: Deploy Homelab Inventory With Sharing Disabled By Default

**Files:**
- Modify: rollout ledger files.

**Interfaces:**
- Produces: application capable of contract negotiation and publication.
- Consumes: published packages and healthy gated `lab.gd`.

- [ ] **Step 1: Finalize one application release**

Consolidate unreleased notes, choose SemVer from actual accumulated changes,
perform cold local ARM64 validation, then AMD64 build, zero-vulnerability scans,
and publish exact OCI artifacts only after validation.

- [ ] **Step 2: Wait for production update and preserve demo policy**

Verify production and demo health, schema migration, identity directories,
Registry state, inventory/project hashes, assignments, placements, connections,
route cache, agents, and notifications.

- [ ] **Step 3: Verify contract negotiation without publishing**

Enable sharing configuration only in a controlled production account, negotiate
contract/view versions, generate a local preview, and confirm no remote share
exists while the service gate remains disabled.

- [ ] **Step 4: Record deployment evidence**

Include application commit/version/digest, backups, migration results, identity
ownership/modes, health, and no-change invariants.

### Task 5: Enable Contract 1 And Run Controlled Live Proof

**Files:**
- Modify: rollout ledger files.

**Interfaces:**
- Produces: proven production publication path.
- Consumes: compatible deployed client and service.

- [ ] **Step 1: Enable only contract 1 and systems/canvas version 1**

Verify service capabilities endpoint before enabling ingestion. Do not permit
unknown features or versions.

- [ ] **Step 2: Publish controlled shares**

Using sanitized test content, publish one public immutable share, one unlisted
manual replaceable share, one synchronized replaceable share, and one protected
share. Include one exact Registry-linked item and one custom item.

- [ ] **Step 3: Verify update and failure semantics**

Confirm one-minute debounce, missing-hash upload, atomic replacement, previous
revision survival after injected failure, manual update, resource snapshot
isolation, and SSE state transitions.

- [ ] **Step 4: Verify viewers and privacy**

Test `/s` and `/e` on desktop/mobile, deep links, centering, lazy views,
inspector, CSP origin allowlist, noindex, generic protected metadata, social
preview, QR, and report abuse. Audit browser console and network payloads.

- [ ] **Step 5: Verify lifecycle and ownership**

Test fixed/duration expiration in accelerated fixtures, unpublish/delete,
tombstone, same-owner reactivation, unrelated-owner denial, GitHub claim, and
unclaimed grace without waiting real durations.

### Task 6: Prove Backup, Restore, Restart, And Idempotency

**Files:**
- Modify: rollout ledger files.

**Interfaces:**
- Produces: recovery evidence for both projects.
- Consumes: matched backup/restore workflows.

- [ ] **Step 1: Create post-publication matched backups**

Verify PostgreSQL, blobs, previews, application SQLite, sharing identity, and
metadata checksums.

- [ ] **Step 2: Restore into isolated staging**

Restore service database/object data and application data separately. Confirm
identity boundaries, active pointers, Registry references, and share content.

- [ ] **Step 3: Restart all services**

Verify no duplicate installation, share, revision, blob, operation, analytics
count, account claim, or lifecycle transition.

- [ ] **Step 4: Record invariant counts and hashes**

Record assignments lost `0`, placements changed `0`, connections changed `0`,
route-cache changes `0`, private-field leaks `0`, cross-environment identity
hashes `0`, and relevant runtime errors `0`.

### Task 7: Close Out Documentation And Rollout

**Files:**
- Modify: `README.md`
- Modify: `DOCKERHUB.md`
- Modify: `docs/sharing.md`
- Modify: rollout ledger files.

**Interfaces:**
- Produces: documented and supportable initial release.
- Consumes: verified public URLs and operator evidence.

- [ ] **Step 1: Publish user documentation**

Document enablement, privacy preview, share modes, visibility, expiration,
resource snapshots, embeds, passwords, GitHub claiming, deletion, and limits.

- [ ] **Step 2: Document operational limitations**

State that comments/reactions are coming soon, protected passwords cannot be
recovered, resource metrics are snapshots, unsupported app contracts cannot
publish, and expired/inactive content is purged.

- [ ] **Step 3: Mark rollout complete**

Record final commits, package versions, image digests, backups, health,
invariants, and open nonblocking limitations. Set status `COMPLETE` only after
all prior turns pass.

- [ ] **Step 4: Commit closeout evidence**

```bash
git add README.md DOCKERHUB.md docs
git commit -m "docs: complete initial lab.gd rollout"
```
