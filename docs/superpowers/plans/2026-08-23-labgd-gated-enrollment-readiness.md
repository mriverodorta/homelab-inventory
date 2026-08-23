# LabGD Gated Enrollment Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow automatic LabGD installation enrollment while publication is gated, while continuing to reject every publication write until LabGD explicitly reports `publicationReady: true`.

**Architecture:** Split general package-backed contract readiness from publication readiness inside `SharingInstallationIdentityService`. Enforce the publication gate at the signed `publication:write` request boundary so enrollment and independently scoped operations remain available without weakening publication controls.

**Tech Stack:** Bun, Node crypto, Hono-compatible HTTP contracts, SQLite identity projection, Vitest, distroless Docker.

## Global Constraints

- Do not modify or redeploy LabGD as part of this patch.
- Do not enable LabGD publication to make enrollment pass.
- Preserve the current installation UUID, Ed25519 key, credentials, public-ID key, and SQLite projection on every retry and restart.
- Demo, staging, and `LABGD_ENABLED=false` must remain zero-contact modes.
- Release as `0.15.1` only after the complete source and container security gates pass.
- Do not begin synthetic publication certification until automatic production enrollment and restart identity stability pass.

---

### Task 1: Specify The Readiness Boundary

**Files:**
- Modify: `server/sharing/installation-identity.test.mjs`
- Modify: `server/sharing/installation-identity.mjs`
- Modify: `scripts/sharing/verify-contract-readiness.test.mjs`
- Modify: `scripts/sharing/verify-contract-readiness.mjs`

**Interfaces:**
- Consumes: LabGD `/readyz`, `/v1/capabilities`, and installation activation endpoints.
- Produces: `readiness({ requirePublication?: boolean })` and publication-scoped enforcement in `signedFetch()`.

- [ ] **Step 1: Add a gated-enrollment regression**

Add a test whose `/readyz` response is package-backed and healthy with
`publicationReady: false`. Assert `activate()` succeeds, writes one identity and
credential set, and makes exactly one challenge and activation request.

- [ ] **Step 2: Add publication and non-publication boundary regressions**

Using the same enrolled identity, assert an `events:read` signed request reaches
its endpoint while `publication:write` rejects with `labgd-unavailable` before
the publication endpoint is called. Change the fixture gate to true and assert
the next publication request succeeds without another challenge or activation.

- [ ] **Step 3: Run focused tests and confirm the old implementation fails**

```bash
bun run test -- server/sharing/installation-identity.test.mjs
```

Expected: the gated enrollment test fails because `activate()` currently rejects
before identity creation.

- [ ] **Step 4: Implement the readiness split**

Change general readiness to reject only an unhealthy service or incompatible
package contract. Add the optional publication assertion and call it from
`signedFetch()` only when `scope === 'publication:write'`.

- [ ] **Step 5: Run focused sharing tests**

```bash
bun run test -- server/sharing/installation-identity.test.mjs server/sharing/labgd-client.test.mjs server/sharing/enrollment-coordinator.test.mjs
```

Expected: all focused tests pass with no unbounded retry or identity churn.

- [ ] **Step 6: Split the read-only verifier phases**

Add `requirePublicationReady: boolean` to `verifySharingReadiness()`, defaulting
to false for gated enrollment verification. Parse
`LABGD_REQUIRE_PUBLICATION_READY=true` for the post-enablement phase and reject
other values. Test both gated success and explicit publication-ready failure.

### Task 2: Finalize Patch Documentation

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `src/release-notes.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: verified readiness correction.
- Produces: consolidated `0.15.1` patch metadata.

- [ ] **Step 1: Add the user-visible fix to Unreleased metadata**

Describe that automatic enrollment now works while LabGD publication is safely
gated and that publication requests remain blocked until explicitly enabled.

- [ ] **Step 2: Run release-note validation before versioning**

```bash
bun run release-notes:check
```

- [ ] **Step 3: Finalize `0.15.1` at deployment time**

Move the Unreleased item into `0.15.1`, add the structured release entry, and set
`package.json` to `0.15.1` without changing dependencies.

### Task 3: Run The Complete Patch Gate

**Files:**
- Verify: `bun.lock`
- Verify: application source and migrations

**Interfaces:**
- Consumes: exact patch commit.
- Produces: source, migration, build, and container security evidence.

- [ ] **Step 1: Run frozen install and source checks**

```bash
bun install --frozen-lockfile
bun run lint
bun run test
bun run build
bun run db:migrations:check
bun run release-notes:check
```

- [ ] **Step 2: Run the mandatory container gate**

```bash
bun run security:container
```

Expected: AMD64 and ARM64 boot successfully and Docker Scout plus Trivy report
zero findings at every severity without exclusions.

- [ ] **Step 3: Verify source hygiene**

Confirm only the pre-existing untracked `.superpowers/` directory remains and
remove all task-created build cache, images, containers, and temporary files.

### Task 4: Deploy And Resume Coordinated Certification

**Files:**
- Use: `scripts/local-release.mjs`
- Record: `docs/handoffs/lab-gd-rollout/EVIDENCE.md`

**Interfaces:**
- Consumes: verified `0.15.1` commit.
- Produces: healthy production enrollment and a restored Plan 04 certification gate.

- [ ] **Step 1: Obtain and verify a matched SkyBolt backup**

Use only the established SkyBolt workflow. Stop if the deployment identity cannot
produce the required verified backup; never connect directly to SkyArk.

- [ ] **Step 2: Build and publish the exact local release**

Run the cold local ARM64 candidate, smoke/security checks, approval, AMD64 build,
and exact `latest` publication workflow.

- [ ] **Step 3: Verify production and demo**

Confirm both use the exact digest and are healthy. Production must enroll while
LabGD remains publication-gated. Demo must retain no sharing files, projection,
cursor, or network operation.

- [ ] **Step 4: Prove identity restart stability**

Restart and recreate production once. Confirm UUID, private-key hash,
installation ID, credential identity, public-ID-key hash, event cursor, Registry
identity, inventory, projects, assignments, placements, cables, and route cache
remain unchanged.

- [ ] **Step 5: Resume Plan 04 only after all invariants pass**

Keep LabGD publication disabled until the bounded synthetic publication and
viewer certification begins under the existing coordinated rollout plan.
