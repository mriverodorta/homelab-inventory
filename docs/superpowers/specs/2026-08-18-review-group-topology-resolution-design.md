# Review Group Topology Resolution Design

## Problem

The Registry update review can expose a deterministic topology migration for either a `review` or `blocked` group. The detail endpoint correctly builds and displays the migration for the Dell OptiPlex Micro 3000, but the apply endpoint rejects every group whose status is not `blocked`. This makes the displayed **Resolve and apply** action fail before its migration plan is evaluated.

## Design

`resolveAndApplyRegistryUpdateGroupById` will accept actionable `review` and `blocked` groups. Status alone will no longer establish that resolution is available. The requested link must still belong to the group, and `resolveAndApplyRegistryUpdateGroup` must rebuild a deterministic plan from the current inventory, project relationships, and signed catalog template.

The existing fail-closed behavior remains authoritative:

- The concurrency token must match the current group.
- The link and available template revision/content hash must still match.
- Every affected project must produce either a deterministic plan or no required relationship migration.
- At least one deterministic relationship operation must exist.
- Expected project revisions, assignments, ports, and cable endpoints must remain unchanged since planning.
- Inventory replacement, relationship migration, registry-link advancement, and update receipt persistence remain one atomic transaction.

A `review` group without a deterministic relationship operation continues to fail with `catalog-update-resolution-unavailable`. A stale, ambiguous, applied, or declined group remains ineligible.

## API And UI

The existing `POST /api/registry/update-groups/:groupId/resolve-and-apply` contract remains unchanged. The UI already calls this endpoint only for a member whose detailed resolution reports `available: true`, so no frontend behavior or payload change is required.

Successful application moves the group to **Applied**, refreshes update counts, and removes it from the Review or Blocked tab without a full page reload.

## Verification

Regression coverage will prove:

1. A `review` group with a deterministic WLAN resource reclassification resolves and applies successfully.
2. A `blocked` group with a deterministic migration remains supported.
3. A `review` group without relationship operations is rejected.
4. Stale concurrency tokens, templates, project revisions, assignments, and endpoints remain rejected.
5. Assignments are preserved or remapped as planned, while placements, cables, manual bend points, route cache, private fields, and unrelated Registry links remain unchanged.
6. The route returns an applied decision and refreshed summary for the exact group member only.

The user-visible fix will be included in the unreleased structured release notes and changelog before the next patch deployment.
