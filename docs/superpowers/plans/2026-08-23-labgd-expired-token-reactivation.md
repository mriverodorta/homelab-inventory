# LabGD Expired Token Reactivation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover an expired LabGD credential through the existing installation identity and resume the existing publication operation without rotating keys or creating another installation or public ID.

**Architecture:** Separate authenticated renewal from challenge activation in `SharingInstallationIdentityService`. Valid near-expiry credentials renew; expired credentials and explicit renewal authentication failures challenge-activate with the existing UUID and Ed25519 key, validate that LabGD returns the same installation ID, and atomically replace credentials.

**Tech Stack:** Bun, Node crypto Ed25519, SQLite, Vitest, Hono/Express API integration, Docker distroless release tooling.

## Global Constraints

- Preserve `/data/sharing/installation-instance.json`, the Ed25519 private key, and the persisted installation projection.
- Never rotate or generate a key during token recovery.
- Never create a new logical LabGD installation or replacement public share ID.
- Replace credentials only after validating installation ID, scopes, token, and expiry.
- Resume local operation `1` and remote operation `132` with their existing idempotency identity.
- Update unreleased structured release notes and `CHANGELOG.md`; do not bump the version before deployment.

---

### Task 1: Expired-Credential Identity Recovery

**Files:**
- Modify: `server/sharing/installation-identity.mjs`
- Test: `server/sharing/installation-identity.test.mjs`

**Interfaces:**
- Consumes: `readCredentials(instance)`, `renewCredentials(current, existing)`, the stable result from `ensure()`, and LabGD challenge/activation endpoints.
- Produces: `challengeActivate(current, { keyPath, promoteRecovery, expectedInstallationId })` and credential selection that distinguishes valid, renewable, and expired credentials.

- [ ] **Step 1: Add failing expiry and renewal-race tests**

Add tests that write credentials with an expiry before the fixed test clock, then call `signedFetch`. Assert `/renew` is never requested, `/challenge` and `/activate` are requested once, activation carries the same `clientInstanceId` and public key, and the final signed request succeeds. Add a second test where `/renew` returns `401 {"error":"authentication-failed"}` and assert exactly one challenge activation follows.

- [ ] **Step 2: Add fail-closed tests**

Assert that a challenge activation returning a different `installationId` rejects with an identity mismatch and leaves the credential file byte-for-byte unchanged. Assert renewal `503`, malformed JSON, and unsupported-contract errors do not trigger challenge activation.

- [ ] **Step 3: Run focused tests and verify failure**

Run:

```bash
bun run test -- server/sharing/installation-identity.test.mjs
```

Expected: new expiry/recovery assertions fail because expired credentials currently call `/renew`.

- [ ] **Step 4: Extract challenge activation and implement selection**

Refactor activation so the challenge path accepts the already-loaded stable identity and optional expected installation ID. Use exact expiry comparisons:

```js
const expiresAtMs = Date.parse(existing.tokenExpiresAt)
if (expiresAtMs <= this.now().getTime()) {
  return this.challengeActivate(current, { expectedInstallationId: existing.installationId })
}
if (existing.renewalRequired || expiresAtMs <= this.now().getTime() + TOKEN_REFRESH_MARGIN_MS) {
  try {
    return await this.renewCredentials(current, existing)
  } catch (error) {
    if (error?.code !== 'authentication-failed') throw error
    return this.challengeActivate(current, { expectedInstallationId: existing.installationId })
  }
}
```

Validate the activation installation ID before calling `writeCredentials`. Preserve existing recovery-pending handling and recovery-key promotion behavior.

- [ ] **Step 5: Run focused identity tests**

Run:

```bash
bun run test -- server/sharing/installation-identity.test.mjs
```

Expected: all identity, rotation, recovery, renewal, and expiry tests pass.

- [ ] **Step 6: Commit identity recovery**

```bash
git add server/sharing/installation-identity.mjs server/sharing/installation-identity.test.mjs
git commit -m "fix: reactivate expired LabGD credentials"
```

### Task 2: Publication Resume Regression

**Files:**
- Modify: `server/sharing/publication-coordinator.test.mjs`
- Modify: `server/sharing/publication-service.test.mjs`

**Interfaces:**
- Consumes: existing retrying operation contract and idempotent `enqueuePublish` behavior.
- Produces: regression proof that credential recovery retries the original operation without changing publication identity.

- [ ] **Step 1: Add retry identity test**

Construct a retrying publish operation with local ID `1`, remote ID `132`, a stable idempotency key, and a persisted local revision. Simulate one authentication failure followed by successful identity recovery and stage replay. Assert the coordinator calls publication with the same operation object and the service records remote operation `132` as succeeded.

- [ ] **Step 2: Add public-ID preservation assertion**

Assert the public-ID provider is called deterministically for the existing share only, stage receives the same generated ID on both attempts, and no second local operation is inserted.

- [ ] **Step 3: Run publication tests**

```bash
bun run test -- server/sharing/publication-coordinator.test.mjs server/sharing/publication-service.test.mjs
```

Expected: all tests pass with one operation and one public ID.

- [ ] **Step 4: Commit publication regression**

```bash
git add server/sharing/publication-coordinator.test.mjs server/sharing/publication-service.test.mjs
git commit -m "test: preserve LabGD publication identity on recovery"
```

### Task 3: Documentation And Verification

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `src/release-notes.ts`
- Modify: `config/unreleased-release-note.json`

**Interfaces:**
- Consumes: completed recovery behavior.
- Produces: user-visible unreleased description and release-ready verification evidence.

- [ ] **Step 1: Add the unreleased fix description**

Describe automatic recovery of expired LabGD credentials with stable installation identity and automatic resumption of pending publications. Do not expose operation IDs as product behavior.

- [ ] **Step 2: Run mandatory repository verification**

```bash
bun run lint
bun run test
bun run build
bun run security:container
```

Expected: lint succeeds with only accepted existing warnings; all tests and build pass; amd64 and arm64 final images boot; Scout and Trivy report zero vulnerabilities at every severity.

- [ ] **Step 3: Commit documentation**

```bash
git add CHANGELOG.md src/release-notes.ts config/unreleased-release-note.json
git commit -m "docs: note LabGD credential recovery"
```

