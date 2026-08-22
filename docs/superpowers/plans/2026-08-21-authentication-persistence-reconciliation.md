# Authentication Persistence Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make first-run owner creation and every later authentication mutation persist safely in SQLite without deleting protected authorization records.

**Architecture:** Replace the authentication projection's delete-and-reinsert writer with ID-based upserts and foreign-key-ordered stale-row reconciliation inside the existing immediate transaction. Keep SQLite protection triggers enabled and expand the production-shape test fixture so repeated mutations exercise materialized built-in roles.

**Tech Stack:** Bun, TypeScript, `bun:sqlite`, Bun test, Hono authentication services.

## Global Constraints

- Persist all primary and foreign keys as positive safe integers.
- Preserve built-in role IDs and the protected owner's global Owner-role assignment.
- Do not disable or weaken database triggers.
- Do not bump the app version before deployment.
- Update the unreleased structured release notes and `CHANGELOG.md`.

---

### Task 1: Reproduce Protected Authentication Mutation Failures

**Files:**
- Modify: `server/persistence/fixtures/schema-29-production-shape.ts`
- Modify: `server/persistence/sqlite-store.bun_spec.ts`

**Interfaces:**
- Consumes: `createAuthenticationStore`, `createOwnerAccount`, and `ensureProtectedOwnerRole` from `server/auth/model.mjs`.
- Produces: Regression tests that perform multiple writes against materialized built-in authorization records.

- [ ] Populate the production-shape fixture with the code-defined built-in roles and role permissions rather than empty arrays.
- [ ] Add a test that materializes built-ins, creates the protected owner in a later mutation, and performs another session/authentication mutation.
- [ ] Assert stable role IDs, one protected Owner assignment, and successful reprojection.
- [ ] Add a test that creates and later removes an unassigned custom role while retaining every built-in role.
- [ ] Run the focused SQLite store test and verify the new repeated-mutation test fails with the built-in-role deletion guard before implementation.

### Task 2: Implement Transactional Relational Reconciliation

**Files:**
- Modify: `server/persistence/core/projections/legacy-domains.ts`

**Interfaces:**
- Consumes: A fully validated normalized authentication state.
- Produces: `persistAuthenticationState(database, state, now)` with stable-ID upserts and stale-row deletion.

- [ ] Add a small helper that deletes table rows whose positive numeric IDs are absent from an expected ID set.
- [ ] Upsert users, permissions, roles, and all dependent authentication entities by ID.
- [ ] Reconcile `role_permissions` and `user_roles` without deleting retained protected relations.
- [ ] Rebuild invitation-role links only after invitations and roles exist.
- [ ] Delete stale dependent entities before stale users, custom roles, and permissions.
- [ ] Keep built-in roles present and fail closed if validated state and relational protections disagree.
- [ ] Run the focused tests and verify first-run, repeated mutation, and custom-role deletion cases pass.

### Task 3: Verify Service-Level Behavior And Document The Fix

**Files:**
- Modify: `server/auth/auth-service.test.mjs` or add a focused SQLite-backed authentication integration test if required by existing test boundaries.
- Modify: `src/release-notes-unreleased.ts` or the repository's current structured unreleased release-note file.
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: The reconciled SQLite authentication writer.
- Produces: User-visible regression evidence and release documentation.

- [ ] Verify first-run owner bootstrap persists account, credential, built-in roles, protected assignment, bootstrap completion, security event, and session across sequential mutations.
- [ ] Verify transaction rollback leaves the previous authentication projection byte-equivalent after an injected relational failure.
- [ ] Record that fresh owner setup no longer fails with the built-in-role deletion error.
- [ ] Run `bun run lint`.
- [ ] Run `bun run test`.
- [ ] Run `bun run build`.
- [ ] Confirm no version, tag, deployment artifact, or private runtime data changed.
