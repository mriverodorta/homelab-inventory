# Authentication Persistence Reconciliation Design

## Problem

The SQLite authentication projection currently persists every mutation by deleting all authentication rows and reinserting the projected state. This conflicts with database triggers that correctly prevent deletion of built-in roles and the protected owner's Owner-role assignment. Fresh installations can therefore fail while creating the first owner account with `Built-in roles cannot be deleted.` Once an owner exists, later authentication mutations can fail against the protected assignment guard.

The existing SQLite persistence test does not reproduce production because its imported authentication fixture contains no roles. Its first mutation merely materializes the built-in roles and never performs the second mutation that fails.

## Decision

Authentication persistence will use transactional relational reconciliation rather than wholesale replacement.

- Validate the complete projected authentication state before opening the write transaction.
- Upsert users, code-defined permissions, roles, credentials, identities, sessions, recovery tokens, security events, OIDC transactions, invitations, identity-link requests, role permissions, and user-role assignments by positive numeric ID.
- Delete only rows whose IDs are absent from the validated next state, in foreign-key-safe order.
- Never disable, remove, or bypass the built-in-role and protected-owner database triggers.
- Keep built-in roles and the protected owner assignment present throughout every transaction.
- Rebuild invitation-role rows inside the transaction because the legacy projection does not expose stable invitation-role IDs.
- Preserve unknown authentication extension metadata through the existing metadata projection.

This is preferred over temporarily dropping triggers or special-casing first-run setup because it fixes every authentication mutation and keeps the relational database authoritative.

## Data Flow

1. `SqliteHomelabInventoryStore.updateAuthentication` projects and clones the current relational state.
2. The service mutator changes that draft.
3. `assertAuthenticationStoreShape` validates built-ins, owner invariants, IDs, and relationships.
4. `persistAuthenticationState` upserts parent rows, upserts dependent rows, reconciles relation rows, and removes stale mutable rows.
5. The surrounding immediate SQLite transaction commits atomically or rolls back completely.
6. The store reprojects the committed relational state for the caller.

## Failure Behavior

- Invalid or incomplete protected-owner state fails before persistence.
- Unique-key, foreign-key, or trigger violations roll back the complete mutation.
- Built-in roles omitted by an invalid caller are not silently deleted.
- Existing custom roles remain deletable only after their assignments and pending invitation relationships are removed by the application service.

## Verification

Regression coverage will prove:

- built-in roles can be materialized and a later owner bootstrap succeeds;
- repeated authentication and session mutations remain valid;
- built-in role IDs and the protected owner assignment remain stable;
- an unassigned custom role can be deleted without touching built-ins;
- a failed mutation rolls back without partial authentication changes;
- the realistic fixture contains built-in authorization records;
- lint, the complete test suite, and the production build pass.

The fix is user-visible and will be recorded in the unreleased release notes and changelog without changing the app version.
