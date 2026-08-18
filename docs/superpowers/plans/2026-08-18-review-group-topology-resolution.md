# Review Group Topology Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow a deterministic Registry topology migration to resolve and apply from either a review or blocked update group.

**Architecture:** Keep the existing resolution endpoint and atomic migration service. Change only the group eligibility guard so status establishes actionability while the rebuilt resolution plan remains the authority for availability and safety.

**Tech Stack:** Bun, TypeScript, Express, `bun:sqlite`, Bun test, Vitest.

## Global Constraints

- Do not add a new endpoint or change the request payload.
- Do not infer resolution availability from status alone.
- Preserve concurrency, signed-template, project-revision, relationship, and transaction checks.
- Do not apply any live pending Registry update during verification.
- Update the unreleased structured release notes and `CHANGELOG.md`.

---

### Task 1: Permit Deterministic Resolution From Review Groups

**Files:**
- Modify: `server/persistence/sqlite-store.ts:2325-2335`
- Test: `server/persistence/sqlite-store.bun_spec.ts`

**Interfaces:**
- Consumes: `resolveAndApplyRegistryUpdateGroupById({ groupId, concurrencyToken, linkId, template, expectedProjectRevisions, userId })`.
- Produces: unchanged compact applied receipt after the existing atomic resolution transaction succeeds.

- [ ] **Step 1: Add a failing regression test**

Extend the canonical WLAN topology fixture to call the public by-ID method through a `review` group:

```ts
const group = store.getRegistryUpdateGroups().find((entry: any) => entry.status === 'review')!
const result = store.resolveAndApplyRegistryUpdateGroupById({
  groupId: group.id,
  concurrencyToken: group.concurrencyToken,
  linkId: 2,
  template,
  expectedProjectRevisions: { 1: beforeProject.revision },
}) as any
expect(result.decisions).toEqual([expect.objectContaining({ status: 'applied' })])
```

Retain the existing assertions for allocation reclassification, private fields, placements, connections, route cache, and Registry linkage.

- [ ] **Step 2: Run the focused test and confirm the current failure**

Run:

```bash
bun test server/persistence/sqlite-store.bun_spec.ts --test-name-pattern "atomically adopts canonical WLAN topology"
```

Expected: failure with `catalog-update-resolution-unavailable` because the group status is `review`.

- [ ] **Step 3: Implement the minimal status guard change**

Change the eligibility condition to:

```ts
if (!['review', 'blocked'].includes(group.status) || !group.members.some((member: Row) => member.linkId === linkId)) {
  throw lifecycleError('Registry topology resolution is not available for this group.', 'catalog-update-resolution-unavailable', 409)
}
```

Do not bypass `resolveAndApplyRegistryUpdateGroup`; it must continue rebuilding and validating the plan.

- [ ] **Step 4: Add fail-closed coverage**

Add assertions proving applied/declined groups remain rejected and a review group whose rebuilt plan contains no relationship operation returns `catalog-update-resolution-unavailable` without modifying inventory or project state.

- [ ] **Step 5: Run persistence tests**

Run:

```bash
bun test server/persistence/sqlite-store.bun_spec.ts
```

Expected: all tests pass.

### Task 2: Verify The HTTP Contract And Document The Fix

**Files:**
- Modify: `server/registry-routes.test.mjs`
- Modify: `src/release-notes.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `POST /api/registry/update-groups/:groupId/resolve-and-apply` with the existing concurrency token and link ID.
- Produces: HTTP 200 with the store's compact applied receipt; lifecycle failures retain their existing status and code.

- [ ] **Step 1: Add route regression coverage**

Mock a review group and verify the route forwards the exact group ID, concurrency token, link ID, signed template, and authenticated user ID to `resolveAndApplyRegistryUpdateGroupById`.

- [ ] **Step 2: Run the route test**

Run:

```bash
bun test server/registry-routes.test.mjs
```

Expected: all tests pass and the compact receipt is returned unchanged.

- [ ] **Step 3: Update release documentation**

Add one unreleased fix explaining that **Resolve and apply** now works for deterministic relationship migrations shown in review-required Registry updates.

- [ ] **Step 4: Run required verification**

Run:

```bash
bun run lint
bun run test
bun run build
```

Expected: all commands pass; existing approved lint warnings may remain.

- [ ] **Step 5: Commit the implementation**

```bash
git add server/persistence/sqlite-store.ts server/persistence/sqlite-store.bun_spec.ts server/registry-routes.test.mjs src/release-notes.ts CHANGELOG.md
git commit -m "fix: resolve review topology updates"
```

Do not bump the version or deploy until explicitly requested.
