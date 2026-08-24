# LabGD Installation Account Claim State Design

**Status:** Approved

**Date:** 2026-08-24

**Repositories:**

- Homelab Inventory: `ServerSpecsInventory`
- LabGD: `HomelabInventoryShare`

## Problem

LabGD account ownership belongs to the authenticated installation, but Homelab
Inventory currently persists `accountClaimed` only on individual share rows.
The account-claim SSE event advances the installation event cursor and marks
non-deleted shares as claimed. It does not persist an installation-level claim
projection.

This fails when an installation has no active shares. The production
installation currently has one deleted share, so LabGD completed the GitHub
claim and delivered the event, but the application retained no visible claimed
state. The settings dialog therefore remained open, displayed no success
feedback, and continued offering **Connect account** after a hard refresh.
LabGD also permits another claim by the same account, so repeating the code flow
appears to work even though the installation is already claimed.

## Ownership Model

The LabGD installation is the only source of truth for account ownership.
Account ownership must not depend on whether a share exists, whether a share is
deleted, or whether a share was created before or after the claim.

Homelab Inventory will persist an installation-level projection containing:

- `accountClaimed`: whether LabGD confirms an account owns the installation.
- `githubUsername`: the verified GitHub login when available.
- `accountClaimedAtMs`: the confirmed claim timestamp when available.

The existing per-share `account_claimed` column remains temporarily for schema
and backup compatibility. It is no longer authoritative. API projections that
still expose `ShareRecord.accountClaimed` derive it from the installation
projection so all shares report one consistent ownership state. Account claims
must not increment share revisions, alter share publication state, or make a
share appear to have content changes.

## LabGD Signed Account Status

LabGD will add an installation-authenticated endpoint:

```http
GET /v1/installations/account-status
```

The request uses the existing installation bearer credential, timestamp,
nonce, Ed25519 signature, and replay protection. It uses the existing account-
claim authorization boundary and does not require browser account cookies.

The successful response is:

```json
{
  "claimed": true,
  "githubUsername": "mriverodorta",
  "claimedAt": "2026-08-24T15:30:00.000Z"
}
```

An unclaimed installation returns HTTP 200 with:

```json
{
  "claimed": false,
  "githubUsername": null,
  "claimedAt": null
}
```

The endpoint must not return email, GitHub numeric identifiers, Better Auth
user IDs, OAuth tokens, account IDs, installation secrets, or share data.
`githubUsername` is obtained from the server-verified GitHub OAuth identity,
never from a browser request body. LabGD validates it as a GitHub login before
persisting or returning it. If the installation is claimed but username
resolution is temporarily unavailable, LabGD returns `claimed: true` with a
null username. Claim state must never be downgraded merely because username
enrichment failed.

LabGD will persist the verified username and claim timestamp with the account
ownership record. Existing claimed installations are reconciled from the
current account relationship and the server-held GitHub provider identity. The
status response remains valid when the installation has zero shares.

The LabGD capability document will advertise signed installation account
status support. The addition remains backward compatible: older applications
ignore it, and newer applications call the endpoint only when it is advertised.

## Duplicate Claim Prevention

`POST /v1/installations/claim-device` must not create another pending code when
the authenticated installation is already account-owned. It returns HTTP 409
with the stable code:

```json
{
  "code": "installation-already-claimed"
}
```

Homelab Inventory handles that response by reconciling the signed account
status instead of showing an error or starting another claim. Account transfer
or disconnection is outside this change and must use a future explicit,
authenticated lifecycle rather than repeated claim codes.

## Application Persistence

An ordered SQLite migration adds the following nullable projection fields to
`sharing_installation_projection`:

- `account_claimed`, constrained to boolean values and defaulting to false.
- `github_username`.
- `account_claimed_at_ms`, constrained to a positive timestamp when present.

The migration is transactional, idempotent, rollback-capable, and included in
complete and sharing-identity backup validation. It may seed a positive local
projection from legacy non-deleted share rows, but absence of such a row is not
evidence that the installation is unclaimed. The first signed reconciliation
after migration supplies the authoritative remote state.

The migration and reconciliation must preserve the installation UUID, Ed25519
key, credentials, remote installation ID, event cursor, shares, local and remote
share revisions, publication operations, manifests, blobs, projects,
workspaces, inventory, assignments, placements, cables, route cache, private
fields, Registry links, Agent state, notification state, and authentication
state.

## Reconciliation Lifecycle

Homelab Inventory reconciles account status only at bounded, event-driven
points:

1. After startup enrollment or credential reactivation succeeds.
2. After reconnecting the installation event stream.
3. After receiving an `account-claim` SSE event.
4. When a pending claim dialog regains browser visibility after the user
   returns from LabGD.
5. After receiving `installation-already-claimed` from claim creation.

There is no interval polling. The account-claim SSE event remains identity-free
and only signals that reconciliation is required. The signed status response is
the authoritative state and username source.

Applying the status response and advancing any related event cursor occurs in
one SQLite transaction. Duplicate events and duplicate status responses are
idempotent. A transient status failure retains the last confirmed projection,
does not reopen a completed claim, and is retried only at the next bounded
reconciliation point.

If LabGD advertises account claiming but not the new status capability, the app
keeps the existing claim UI available and does not infer ownership from share
rows. This compatibility state must not block publication.

## User Experience

Before ownership is confirmed, Settings displays **Connect account**.

When a claim is pending:

- The modal continues showing the single-use code and GitHub continuation link.
- The app listens for the existing sharing SSE signal.
- Returning focus to the app triggers one signed reconciliation request.
- No periodic request is started.

When the signed response first confirms the pending claim:

- The modal closes automatically.
- A success toast confirms the connection.
- Settings replaces **Connect account** with **Connected to @username**.
- If the username is unavailable, it displays **GitHub account connected**.

A claimed installation does not expose another claim action. Loading or
refreshing an already-claimed installation displays the connected state without
showing a new success toast. Toasts are limited to the transition associated
with the claim initiated in the current browser session.

## Security And Privacy

- The status endpoint is unavailable without successful installation
  authentication and request-signature verification.
- Cross-installation requests fail without revealing whether another
  installation is claimed.
- GitHub username is the only account profile field returned to Homelab
  Inventory.
- Username and claim state are excluded from public share manifests, embeds,
  previews, analytics, logs, Registry traffic, Agent traffic, and demo data.
- Demo mode never enrolls, claims, reconciles, or opens sharing SSE traffic.
- Tokens, private keys, signatures, OAuth credentials, and claim-code digests
  are never logged or returned.
- A malformed username is stored as null rather than passed through.

## Tests

### LabGD

1. Signed account status returns unclaimed state for an unowned installation.
2. Signed account status returns claimed state and verified GitHub username for
   the owning installation.
3. Claimed state remains true when username enrichment is unavailable.
4. Email, internal IDs, tokens, and unrelated profile fields are absent.
5. Foreign installation and invalid signatures fail without ownership leakage.
6. Claim approval persists installation ownership, username, and timestamp.
7. Repeating `claim-device` after ownership returns
   `installation-already-claimed` and creates no pending claim or event.
8. Existing claimed installations reconcile without requiring another code.
9. Account status is independent of share count and deleted-share state.
10. Restart and migration replay preserve the same account projection.

### Homelab Inventory

1. Migration adds the installation account projection without changing any
   unrelated row or identity hash.
2. A claim event with zero shares persists installation claim state.
3. A claim event with only deleted shares persists installation claim state.
4. Account reconciliation does not mutate share revisions or publication state.
5. SSE completion closes the active modal and produces one success toast.
6. Browser visibility reconciliation repairs a missed SSE completion without
   polling.
7. Startup reconciliation repairs the currently deployed already-claimed
   installation after refresh.
8. `installation-already-claimed` reconciles instead of creating another claim.
9. Settings renders **Connected to @username** and hides the claim action.
10. A null username renders the generic connected label.
11. Restart, SSE reconnect, and repeated status responses are idempotent.
12. Demo mode performs no claim or account-status request.
13. Backups and restores validate and preserve the account projection.
14. Sync in either direction preserves the destination installation identity
    and its account projection.

## Rollout

1. Implement and validate the LabGD migration, signed status endpoint,
   capability advertisement, username reconciliation, and duplicate-claim
   prevention.
2. Deploy LabGD with publication behavior otherwise unchanged.
3. Implement the Homelab Inventory migration, signed client method,
   installation reconciliation, SSE integration, and UI transition.
4. Run lint, complete tests, production builds, migration checks, backup/restore
   tests, and dual-architecture container security gates in both repositories.
5. Deploy Homelab Inventory as a patch release.
6. Verify the existing production installation reconciles as claimed without a
   new claim code and displays the connected GitHub username.
7. Verify a fresh installation claim closes automatically and remains connected
   after restart and hard refresh.
8. Verify production and demo health, zero demo enrollment traffic, and no
   changes to shares or unrelated application state.

Both repositories update their changelogs and unreleased structured release
notes. Neither project may claim completion until the existing production
installation and a fresh controlled claim pass end to end.
