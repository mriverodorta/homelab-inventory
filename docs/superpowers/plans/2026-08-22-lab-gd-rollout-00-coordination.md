# lab.gd Rollout Coordination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Coordinate the remaining LabGD, Homelab Inventory, website, certification, and release work without allowing an incompatible client or unverified service to publish a share.

**Architecture:** Three preparation plans may run concurrently because they do not depend on mutable production state. Production changes then pass through one ordered chain: gated LabGD deployment, Homelab Inventory main deployment, joint publication certification, stable promotion, and public closeout.

**Tech Stack:** Git, Bun, npm, Docker Compose, local multi-architecture OCI release tooling, PostgreSQL, SQLite, Infisical, Cloudflare Tunnel, GitHub CLI, Playwright.

## Global Constraints

- Freeze the Application implementation at or after `233b8b52c88e550b94a72f0e07f7a3324014e990` and LabGD at or after `5f1f7520de90ccb90aff1842e7c8cfd967e395c6`.
- Preserve exact pins and npm integrity evidence for `@homelab-inventory/share-contract`, `@homelab-inventory/viewer-model`, `@homelab-inventory/viewer-react`, and `@homelab-inventory/catalog-protocol`.
- Do not modify or redeploy the hardware Registry unless a separate signed-catalog defect is proven.
- Do not connect directly to SkyArk; use only the established matched SkyBolt backup workflow.
- Keep LabGD publication disabled until Plan 04 explicitly reaches its bounded enablement step.
- Demo and staging Homelab Inventory modes must never create a sharing identity, enroll, recover, rotate, publish, or consume installation events.
- Never include credentials, cookies, private keys, passwords, private inventory, or secret values in commits or rollout evidence.
- Stop at the first failed migration, readiness, package, security, privacy, ownership, data-integrity, restart, or rollback invariant.

---

### Task 1: Create The Rollout Ledger

**Files:**
- Create: `docs/handoffs/lab-gd-rollout/STATUS.md`
- Create: `docs/handoffs/lab-gd-rollout/EVIDENCE.md`

**Interfaces:**
- Consumes: exact commits, package integrities, migration checksums, and health baselines from all three repositories.
- Produces: one authoritative phase owner, completion state, and evidence index.

- [ ] **Step 1: Record immutable starting inputs**

Record these values without secrets:

```text
Application implementation: 233b8b52c88e550b94a72f0e07f7a3324014e990
Application deployed baseline: 0.14.1
LabGD implementation: 5f1f7520de90ccb90aff1842e7c8cfd967e395c6
Website handoff baseline: c094e0fd5eedbcbfa7ed5b1ec8fb4efc82674a6a
LabGD migrations: 0011_installation_control.sql, 0012_operational_analytics.sql
Sharing protocol: 1
Share contract: 1
Systems view contract: 1
Canvas view contract: 1
```

- [ ] **Step 2: Define the phase state machine**

Use exactly these states and owners in `STATUS.md`:

```text
PARALLEL_PREPARATION: Application + LabGD + Website
APPLICATION_MAIN_DEPLOYMENT: Application
JOINT_CERTIFICATION: Application + LabGD, one operator
STABLE_AND_PUBLIC_CLOSEOUT: Application + Website
COMPLETE: none
```

During `PARALLEL_PREPARATION`, LabGD may modify only the LabGD stack and its new
host routes, while the website may modify only its website/roadmap stack. The
Application track remains local. After that phase, only the active ordered
phase may modify production.

- [ ] **Step 3: Define evidence fields**

Require `EVIDENCE.md` to record commits, package versions and SHA-512 integrities, migration versions, backup paths, image digests, container IDs/start times, health/readiness responses, security summaries, public route checks, installation identity hashes, synthetic share IDs, restart results, and cleanup results.

- [ ] **Step 4: Commit the ledger**

```bash
git add docs/handoffs/lab-gd-rollout/STATUS.md docs/handoffs/lab-gd-rollout/EVIDENCE.md
git commit -m "docs: start coordinated lab.gd rollout [skip release-notes]"
```

### Task 2: Run The Parallel Preparation Wave

**Files:**
- Modify: `docs/handoffs/lab-gd-rollout/STATUS.md`
- Modify: `docs/handoffs/lab-gd-rollout/EVIDENCE.md`

**Interfaces:**
- Consumes: Plans 01, 02, and 03.
- Produces: three independently approved preparation receipts; Plans 01 and 02 form the minimum gate for Application deployment.

- [ ] **Step 1: Dispatch Plan 01 to the LabGD chat**

Plan 01 may deploy LabGD only with `PUBLICATION_ENABLED=false`.

- [ ] **Step 2: Dispatch Plan 02 to the Application chat in parallel**

Plan 02 stops after the ARM64 candidate is running at `127.0.0.1:8799`, validated, and approved. It must not build AMD64, publish Docker tags, or deploy production.

- [ ] **Step 3: Dispatch Plan 03 to the website chat in parallel**

Plan 03 may update and deploy accurate current-product content, but roadmap proposals 20 and 21 and all sharing copy remain explicitly `In progress`.

- [ ] **Step 4: Verify the Application deployment gate**

Plan 04 may start as soon as Plans 01 and 02 prove:

```text
LabGD /healthz: 200
LabGD /readyz: 200
LabGD publication: disabled
Application ARM64 candidate: approved at 127.0.0.1:8799
```

Plan 03 may continue in parallel with Application deployment and joint
certification. It must finish before Plan 05, and its sharing status must remain
`In progress` until Plan 04 passes.

### Task 3: Run The Ordered Production Wave

**Files:**
- Modify: `docs/handoffs/lab-gd-rollout/STATUS.md`
- Modify: `docs/handoffs/lab-gd-rollout/EVIDENCE.md`

**Interfaces:**
- Consumes: completed Plans 01 through 03.
- Produces: one certified and publicly documented feature release.

- [ ] **Step 1: Finish the Application deployment after Plans 01 and 02 pass**

Build AMD64 from the unchanged approved source, publish the exact OCI candidates to `latest`, and verify the production and demo Watchtower updates.

- [ ] **Step 2: Run Plan 04 alone**

No other production deployment may run while joint certification changes the LabGD publication gate or creates synthetic shares.
Plan 03 source work and local verification may continue, but schedule its live
website deployment outside the bounded Plan 04 publication window.

- [ ] **Step 3: Run Plan 05 after Plans 03 and 04 pass**

Promote the exact Application commit and digest to `stable`, switch website sharing language from `In progress` to `Shipped`, and mark roadmap proposals 20 and 21 shipped.

- [ ] **Step 4: Close the ledger**

Set the state to `COMPLETE` only after final health, backup, restart, privacy, ownership, cleanup, and public documentation checks pass.

### Task 4: Enforce Failure Ownership

**Files:**
- Modify: `docs/handoffs/lab-gd-rollout/STATUS.md`
- Modify: `docs/handoffs/lab-gd-rollout/EVIDENCE.md`

**Interfaces:**
- Consumes: a failed gate from any plan.
- Produces: a stopped rollout with the last known-good state retained.

- [ ] **Step 1: Stop the active phase**

Record the failing command, sanitized output, affected commit, and whether production state changed.

- [ ] **Step 2: Restore the safe gate state**

If LabGD publication was temporarily enabled, restore `PUBLICATION_ENABLED=false` and require `/readyz` before any investigation continues.

- [ ] **Step 3: Preserve identities and prior active content**

Do not rotate or replace installation UUIDs, Ed25519 keys, public-ID keys, credentials, event cursors, idempotency keys, or prior active share revisions to work around a failure.

- [ ] **Step 4: Resume from the failed plan**

After a fix is committed and its full local gate passes, repeat the failed plan from its first backup/checkpoint step. Do not skip directly to the next phase.
