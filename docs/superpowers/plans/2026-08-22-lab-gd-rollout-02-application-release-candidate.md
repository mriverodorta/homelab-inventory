# Homelab Inventory Sharing Release Candidate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finalize and approve the Homelab Inventory `0.15.0` ARM64 release candidate without publishing or changing production.

**Architecture:** Consolidate the completed installation-authenticated sharing implementation into one minor release, run every source/migration/package/security gate, then use the existing cold local release workflow to build a sanitized production-shaped ARM64 candidate at port `8799`. AMD64 construction and Docker publication remain blocked until LabGD Plan 01 is complete.

**Tech Stack:** Bun, React, Hono, SQLite, Rust/WASM, Docker BuildKit, Docker Scout, Trivy, local OCI release tooling.

## Global Constraints

- Execute in `/Users/maikeldorta/Code/home-datacenter/ServerSpecsInventory`.
- Start from commit `233b8b52c88e550b94a72f0e07f7a3324014e990` or a reviewed descendant.
- Use version `0.15.0`; installation-authenticated external sharing is a new feature, not a patch-only correction.
- Do not push `main`, move `latest`, build AMD64, publish Docker tags, create Git tags, or create a GitHub release in this plan.
- Preserve the user's untracked `.superpowers/` directory.
- Use a fresh sanitized production snapshot for every cold release attempt.
- Demo and staging must not create `/data/sharing` identity files or contact LabGD.
- Remove task-created build cache, Rust `target/`, Vite cache, obsolete `dist/`, candidate containers/images, and temporary snapshots after the candidate is no longer needed; retain the approved candidate state until Plan 04 finishes.

---

### Task 1: Finalize Release Metadata

**Files:**
- Modify: `package.json`
- Modify: `src/release-notes.ts`
- Modify: `CHANGELOG.md`
- Verify: `README.md`
- Verify: `DOCKERHUB.md`
- Verify: `docs/sharing.md`
- Verify: `docs/sharing-rollout.md`

**Interfaces:**
- Consumes: current `Unreleased` sharing notes.
- Produces: one consolidated `0.15.0` release definition.

- [ ] **Step 1: Write the failing release-note expectation**

Add or update the release-note test so it expects version `0.15.0`, channel `latest`, and consolidated highlights for automatic enrollment, privacy-reviewed Systems/Canvas sharing, immutable and replaceable shares, SSE remote state, lifecycle controls, account claiming, and owner analytics.

- [ ] **Step 2: Run the release-note check and confirm failure**

```bash
bun run release-notes:check
```

Expected: failure because `0.15.0` has not yet been finalized.

- [ ] **Step 3: Finalize version and human-readable notes**

Set `package.json` to `0.15.0`, move every sharing entry from `CHANGELOG.md` `Unreleased` into `## [0.15.0] - 2026-08-22`, add the structured entry in `src/release-notes.ts`, and leave `Unreleased` empty. Do not alter dependency pins unless verification proves a mismatch.

- [ ] **Step 4: Verify release documentation**

Ensure `README.md`, `DOCKERHUB.md`, `docs/sharing.md`, and `docs/sharing-rollout.md` accurately state that production enrollment is automatic, opt-out is allowed, publication is explicit, demo/staging are disabled, and sharing identity is separate from Registry identity.

- [ ] **Step 5: Commit the release metadata**

```bash
git add package.json src/release-notes.ts CHANGELOG.md README.md DOCKERHUB.md docs/sharing.md docs/sharing-rollout.md
git commit -m "chore: prepare 0.15.0 sharing release"
```

### Task 2: Run The Complete Source Gate

**Files:**
- Verify: `bun.lock`
- Verify: `packages/share-contract/**`
- Verify: `packages/viewer-model/**`
- Verify: `packages/viewer-react/**`
- Verify: `packages/catalog-protocol/**`
- Verify: `server/sharing/**`
- Verify: `scripts/sharing/**`

**Interfaces:**
- Consumes: exact release commit.
- Produces: source, package, migration, and security receipts bound to that commit.

- [ ] **Step 1: Verify frozen dependencies and public packages**

```bash
bun install --frozen-lockfile
bun run packages:public:check
bun run test:public-packages
```

- [ ] **Step 2: Run application validation**

```bash
bun run lint
bun run test
bun run build
bun run db:migrations:check
bun run release-notes:check
```

Expected: all checks pass, including 29-or-newer SQLite migrations and sharing identity/sync/backup tests.

- [ ] **Step 3: Run the final dual-architecture security gate**

```bash
bun run security:container
```

Expected: final distroless image boots on AMD64 and ARM64, and Docker Scout plus Trivy report zero findings at every severity without exclusions.

- [ ] **Step 4: Verify clean source state**

```bash
git status --short
git rev-parse HEAD
```

Expected: only the pre-existing `.superpowers/` path is untracked and the exact release commit is recorded.

### Task 3: Prepare The ARM64 Production-Shaped Candidate

**Files:**
- Use: `scripts/local-release.mjs`
- Use: `scripts/local-release/snapshot.mjs`
- Use: `scripts/local-release/sanitize.mjs`
- Use: `scripts/local-release/staging.mjs`

**Interfaces:**
- Consumes: clean release commit and current live snapshot.
- Produces: approved immutable ARM64 OCI candidate and validation receipt.

- [ ] **Step 1: Start the cold release preparation**

```bash
bun run release:local prepare
```

Expected sequence: exact `ci:verify`, fresh live snapshot, sanitization, ARM64 OCI build, smoke test, zero-vulnerability scans, and staging on `127.0.0.1:8799`.

- [ ] **Step 2: Verify sanitization boundaries**

Confirm the staging copy contains no real secrets, authentication sessions, Registry private key, sharing private key, sharing credentials, Agent identity, serial numbers, private addresses, or unrelated transient backups. Confirm the sanitized source snapshot hash is recorded in the release receipt.

- [ ] **Step 3: Exercise staging behavior**

At `http://127.0.0.1:8799`, verify existing projects, Systems, Canvas, assignments, placements, cables, route cache, authentication, Registry, Agent summaries, backups, and custom metadata load. Verify sharing UI is present but remote enrollment and publication remain disabled by staging policy.

- [ ] **Step 4: Approve the exact candidate**

```bash
bun run release:local approve
```

Expected: approval receipt binds the commit, source fingerprint, sanitized snapshot, ARM64 candidate digest, and completed staging check.

- [ ] **Step 5: Pause at the deployment gate**

Record the approved commit and ARM64 digest in the rollout ledger. Do not run `publish`, do not build AMD64, and keep the exact candidate receipt available for Plan 04.

### Task 4: Prepare Production Invariant Baselines

**Files:**
- Modify: `docs/handoffs/lab-gd-rollout/EVIDENCE.md`

**Interfaces:**
- Consumes: read-only production access.
- Produces: predeployment hashes and counts for Plan 04.

- [ ] **Step 1: Record production health and identity projection**

Record version, revision, schema versions, mode, Registry state, Agent count, sharing enabled/disabled state, and whether `/data/sharing` exists. Hash identity files without recording their contents.

- [ ] **Step 2: Record relational invariants**

Record counts and stable hashes for projects, workspaces, inventory items, assignments, resource slots, placements, connections, route cache, metadata definitions/values/tags, access control, notifications, Registry links, and Agent host bindings.

- [ ] **Step 3: Record demo baseline**

Confirm demo mode has no persistent sharing identity, enrollment, events, or share projection before the release.
