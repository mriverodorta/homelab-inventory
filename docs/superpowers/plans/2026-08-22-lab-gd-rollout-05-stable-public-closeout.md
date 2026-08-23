# LabGD Stable And Public Closeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the certified Homelab Inventory `0.15.0` artifact to stable, publish final user documentation, and mark the LabGD sharing and embed roadmap proposals shipped.

**Architecture:** Reuse the exact `latest` commit and multi-platform digest certified in Plan 04; do not rebuild application images. After stable health is confirmed, make the website and database-backed roadmap reflect the verified feature, then close the shared rollout ledger.

**Tech Stack:** Local OCI release tooling, Docker Hub, GitHub Releases, Bun, website roadmap PostgreSQL, Playwright/deployment tests.

## Global Constraints

- Plan 04 must be complete with LabGD publication enabled and healthy.
- Promote the exact certified Application commit and digest; no source or dependency change is allowed between `latest` certification and `stable` promotion.
- Do not rebuild ARM64 or AMD64 for stable.
- Stable publishes `stable`, `0.15.0`, and `0.15`; the existing `latest` digest remains unchanged.
- Roadmap proposals 20 and 21 become `shipped` only after stable production verification succeeds.
- Preserve roadmap PostgreSQL and create a verified matched backup before status changes.
- Do not connect directly to SkyArk.
- Remove local release artifacts and caches only after exact-digest promotion and evidence capture; do not delete Docker volumes without explicit approval.

---

### Task 1: Promote The Exact Application Artifact To Stable

**Files:**
- Use: `scripts/local-release.mjs`
- Update through release tooling: `stable` branch, Docker tags, Git tag, GitHub Release

**Interfaces:**
- Consumes: certified `0.15.0` release state from Plan 04.
- Produces: stable, versioned, and minor-series tags pointing to the certified digest.

- [ ] **Step 1: Verify immutable promotion inputs**

Confirm `origin/main`, local approved revision, existing `latest` image labels, platform manifests, ARM64 digest, AMD64 digest, and multi-platform digest match Plan 04 evidence.

- [ ] **Step 2: Fast-forward stable without changing source**

Fast-forward the `stable` branch to the exact certified `main` revision. Do not merge an unrelated commit or regenerate release notes.

- [ ] **Step 3: Publish stable tags**

```bash
bun run release:local publish --channel stable
```

Expected: `stable`, `0.15.0`, and `0.15` point to the exact certified multi-platform digest; Git tag `v0.15.0` and the GitHub Release point to the same commit; no candidate tags remain.

- [ ] **Step 4: Verify stable consumers**

Wait for production services configured for `stable`, if any, to update. Confirm health, version, revision, schema, sharing connection, and existing data/identity invariants remain unchanged.

### Task 2: Finalize Application And LabGD Documentation

**Files:**
- Verify or modify: `README.md`
- Verify or modify: `DOCKERHUB.md`
- Verify or modify: `docs/sharing.md`
- Verify or modify LabGD: `README.md`
- Verify or modify LabGD: `docs/operations.md`

**Interfaces:**
- Consumes: certified public behavior and final URLs.
- Produces: complete user and operator documentation.

- [ ] **Step 1: Verify user-facing app documentation**

Document automatic production enrollment with opt-out, privacy preview, selected Systems/Canvas views, immutable/replaceable modes, manual/synchronized updates, visibility/password/expiration, deep links, embeds, one-time metrics, QR actions, lifecycle controls, account claiming, analytics, and abuse reports.

- [ ] **Step 2: Document explicit limits**

State that comments and reactions are not interactive yet, protected passwords cannot be recovered, telemetry is a one-time snapshot, unsupported contracts fail closed, and expiration/inactivity policies can remove content while reserving IDs.

- [ ] **Step 3: Verify operator documentation**

Document service topology, publication gate, package evidence, backups/restores, restart order, secret rotation, ownership isolation, analytics retention, and failure recovery without disclosing infrastructure secrets.

- [ ] **Step 4: Run documentation-coupled checks**

Run each repository's lint, tests, build, release-note validation, and documentation link checks required by its package scripts before committing any closeout-only correction.

### Task 3: Switch The Website From In Progress To Shipped

**Files:**
- Modify: website sharing section and matching tests under `apps/web/src/`
- Modify: website metadata/social assets when they mention the in-progress state
- Use: `scripts/backup-roadmap.sh`

**Interfaces:**
- Consumes: Plan 03 website refresh and certified stable release.
- Produces: accurate public shipped messaging.

- [ ] **Step 1: Write failing shipped-state assertions**

Require the public page to describe available sharing and embeds, link to the live LabGD viewer and app documentation, and remove `In progress` wording only for proposals 20 and 21.

- [ ] **Step 2: Update public content**

Change the LabGD section to shipped language grounded in tested capabilities. Preserve `coming soon` labels for comments and reactions.

- [ ] **Step 3: Run website checks**

```bash
bun run test
bun run build
bun run test:deployment
```

- [ ] **Step 4: Create and verify the roadmap backup**

Run the established SkyBolt matched roadmap backup and record its exact verified path before changing proposal states.

- [ ] **Step 5: Mark only proposals 20 and 21 shipped**

Use the authenticated roadmap moderation API/UI so audit timestamps and GitHub discussion synchronization remain intact. Do not update proposal rows directly unless the established operational procedure explicitly requires it.

- [ ] **Step 6: Deploy and verify the website**

Confirm homepage and roadmap show the feature as shipped, all other proposal statuses are unchanged, GitHub discussion links remain valid, console errors are zero, failed requests are zero, metadata is current, and mobile/desktop layouts remain correct.

### Task 4: Close The Rollout And Reclaim Local Space

**Files:**
- Modify: `docs/handoffs/lab-gd-rollout/STATUS.md`
- Modify: `docs/handoffs/lab-gd-rollout/EVIDENCE.md`

**Interfaces:**
- Consumes: final stable, LabGD, and website evidence.
- Produces: complete release handoff and clean local machine.

- [ ] **Step 1: Record final state**

Record Application `0.15.0` commit/digest/tags, LabGD commit/migrations/gate state, website commit, roadmap states, npm integrities, backup paths, health/readiness, restart results, ownership/privacy assertions, and known nonblocking limitations.

- [ ] **Step 2: Verify final public paths**

Check `inv.hkloud.org`, demo, `lab.gd`, `app.lab.gd`, `homelabinventory.com`, roadmap proposals 20/21, GitHub release, and Docker Hub tags.

- [ ] **Step 3: Set rollout complete**

Set `STATUS.md` to `COMPLETE` only when every plan is complete and no temporary publication override, synthetic installation, synthetic share, test database, test secret, or task-scoped ingress remains.

- [ ] **Step 4: Clean release artifacts**

Run the existing local release cleanup, remove task-created OCI archives after receipts are retained, clear release builders, images, scanner cache, Rust targets, Vite cache, temporary snapshots, test databases, and temporary browser artifacts. Preserve source, current sanitized rsync delta base, release receipts, active dependencies, production data, and all Docker volumes.

- [ ] **Step 5: Report disk usage**

Report repository sizes, release-support size, Docker image/build-cache size, task temporary size, retained volume size, and any path intentionally retained with its reason.
