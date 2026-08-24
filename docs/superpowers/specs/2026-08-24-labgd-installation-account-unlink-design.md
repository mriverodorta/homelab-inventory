# LabGD Installation Account Unlink Design

**Status:** Approved

**Date:** 2026-08-24

**Repositories:**

- Homelab Inventory: `ServerSpecsInventory`
- LabGD: `HomelabInventoryShare`

## Problem

Homelab Inventory can connect a LabGD installation to a GitHub account, but it
cannot remove that account ownership. Disabling sharing is not an account
unlink: it intentionally preserves the installation UUID, Ed25519 identity,
credentials, account projection, and remote ownership. Individual share
lifecycle actions also cannot safely express an installation-wide ownership
change.

Account unlinking must therefore be an explicit, authenticated operation. It
must preserve the Homelab Inventory-to-LabGD installation connection while
allowing the user to decide what happens to every remotely published share.

## Approved Behavior

Unlinking removes the GitHub account from the LabGD installation but does not
disable sharing, revoke installation credentials, rotate keys, or create a new
remote installation. The installation remains able to publish and manage
shares without an account.

The user selects exactly one remote-share disposition:

1. **Keep shares online** (default): existing shares remain available and under
   signed installation management.
2. **Unpublish all shares**: existing public content becomes unavailable, while
   public IDs, revision history, and data required for republishing remain.
3. **Permanently delete all shares**: remote share data is deleted through the
   existing lifecycle process. Generated public IDs remain permanently
   reserved and cannot be assigned to another installation.

Only shares that reached LabGD are affected. Local unpublished drafts remain
unchanged. After unlinking, any GitHub account may claim the installation using
a newly generated single-use claim code.

The operation is available from both Homelab Inventory and the authenticated
LabGD account dashboard. Both entry points use the same LabGD domain service
and transaction boundary.

## Capability Contract

LabGD advertises unlink support explicitly:

```json
{
  "accountClaiming": {
    "supported": true,
    "statusSupported": true,
    "unlinkSupported": true,
    "unlinkDispositions": ["keep", "unpublish", "delete"]
  }
}
```

Homelab Inventory must not infer unlink support from account claiming or remote
lifecycle support. It hides the unlink action unless `unlinkSupported` is true
and the advertised disposition set contains all dispositions the UI offers.

Older LabGD deployments continue supporting claim and publication without an
unlink action. Older Homelab Inventory clients ignore the additional
capability fields.

## Atomic LabGD Operation

Homelab Inventory sends an installation-authenticated request:

```http
POST /v1/installations/account/unlink
```

```json
{
  "requestVersion": 1,
  "idempotencyKey": "generated-stable-key",
  "expectedAccountBindingRevision": 3,
  "shareDisposition": "keep"
}
```

The request uses the existing installation credential, timestamp, nonce,
Ed25519 signature, and replay protection. LabGD performs one authoritative
transaction that:

1. Locks the installation, current account binding, and affected remote shares.
2. Verifies the expected account-binding revision.
3. Validates or replays the idempotency record.
4. Applies the selected share disposition.
5. Invalidates pending claim codes for the installation.
6. Removes the account relationship.
7. Increments the account-binding revision.
8. Records the durable result.
9. Emits the existing bounded lifecycle event for each affected share.
10. Emits one `account-unlink` installation summary event.

If any synchronous share transition fails, the complete transaction rolls
back. For permanent deletion, database tombstones, ownership reservations, and
deleted share state commit atomically. Existing lifecycle workers may remove
objects and previews afterward with bounded retries. A cleanup retry never
restores account ownership or public availability.

The LabGD dashboard invokes the same operation service using authenticated
account authorization instead of an installation signature. The account must
currently own the installation when the transaction begins.

## Binding Revision And Concurrency

LabGD stores a monotonically increasing non-negative
`accountBindingRevision` for each installation. A never-claimed installation
starts at revision 0. The revision increments after every successful claim and
unlink. Existing claimed installations migrate to revision 1 unless they
already have a higher reconciled revision. Homelab Inventory persists the
latest confirmed revision in its installation projection.

The expected revision prevents an old browser or delayed request from
unlinking an account that was claimed after the confirmation dialog opened. A
stale request returns:

```json
{
  "code": "account-binding-changed"
}
```

with HTTP 409. Homelab Inventory reconciles signed account status and requires
new confirmation. Claim and unlink operations serialize through the locked
installation record. Only one resulting binding state may commit.

## Idempotency

The unlink operation has a durable, installation-scoped idempotency record.
The same key with the same normalized request returns the original result. The
same key with a different request version, expected revision, or disposition
returns a conflict and changes nothing.

Homelab Inventory creates one idempotency key when the user confirms. Network
retries reuse that key until an authoritative response is received. Closing
and deliberately starting a new unlink attempt creates a new key.

## Response And Local Reconciliation

The successful response contains bounded state and counts:

```json
{
  "account": {
    "connected": false,
    "githubUsername": null,
    "bindingRevision": 4
  },
  "disposition": "unpublish",
  "affected": {
    "shares": 7,
    "keptOnline": 0,
    "unpublished": 7,
    "deleted": 0
  }
}
```

The response never contains the complete share collection. Counts are computed
inside the authoritative transaction and therefore cannot be supplied by the
browser. This keeps the response bounded regardless of installation size.

Homelab Inventory commits the new account projection, binding revision,
affected local remote-share projections, and operation result in one SQLite
transaction. The selected disposition applies to every local share that has a
remote public ID for this installation. The account projection is authoritative
even when the installation has no shares. Local unpublished drafts remain
unchanged. Delete-confirmed local records become deleted; unpublish-confirmed
records become unpublished; kept shares retain their current remote state.
The committed local affected count must equal LabGD's authoritative count. A
count mismatch leaves local share projections unchanged and commits only the
authoritative unlinked account state. The existing bounded per-share lifecycle
events then reconcile each local share through the resumable installation
event stream. This requires no collection payload and no polling endpoint.

LabGD emits the existing per-share lifecycle events plus an identity-minimal
`account-unlink` SSE event containing the installation event ID, binding
revision, disposition, operation ID, and bounded affected counts. It contains
no GitHub identity. Homelab Inventory applies the REST result immediately and
uses the events to reconcile other open browsers and any local count mismatch.
Duplicate or older event revisions are ignored. Missed events are repaired by
the existing resumable installation event stream and signed account-status
reconciliation, without interval polling.

## Homelab Inventory API And Persistence

Homelab Inventory adds:

```http
POST /api/sharing/account/unlink
```

The route requires the existing `sharing.publish` permission. It accepts only
the selected disposition and the current UI confirmation data; the server
creates and signs the LabGD request. Browser clients never receive installation
credentials or signing keys.

An ordered SQLite migration extends the sharing installation projection and
operation persistence for:

- `account_binding_revision`
- durable unlink idempotency and result state
- the `account-unlink` SSE projection

The migration is transactional, ordered, idempotent, rollback-capable, and
covered by startup migration tests. Complete and sharing-section backups must
include and validate the new state. Sync in either direction must continue
preserving the destination installation UUID, Ed25519 identity, credentials,
and installation projection.

The migration and unlink operation must preserve projects, workspaces,
inventory, assignments, placements, cables, route cache, private fields,
Registry links, Agent state, notification state, authentication state, and all
unrelated sharing data.

## User Experience

Settings displays the connected account and an explicit action:

```text
Connected account
@github-username                                      Unlink account
```

Selecting **Unlink account** opens a dialog with the three mutually exclusive
share dispositions. The dialog states:

```text
Your Homelab Inventory installation will remain connected to LabGD.
You can continue publishing shares and connect another GitHub account later.
```

**Keep shares online** is selected by default. Keep and unpublish require a
normal confirmation. Permanent deletion requires typing `DELETE`; the submit
button remains disabled until the text matches exactly.

While the operation is running, disposition controls and confirmation are
disabled. A failure leaves the dialog open, explains the safe resulting state,
and permits retry with the same idempotency key. A stale binding response
refreshes the account status and requires a fresh confirmation.

On success:

- The dialog closes.
- A success notification names the disposition and affected share count.
- The connected GitHub username disappears.
- **Connect account** becomes available.
- The LabGD installation remains connected and sharing remains enabled.

The LabGD dashboard presents equivalent choices and confirmation requirements.
After commit, the former account immediately loses dashboard access to the
installation and its shares. Public visibility follows the selected share
disposition.

## Security And Privacy

- Installation unlink requires complete signed-request validation.
- Dashboard unlink requires the currently linked authenticated account.
- No unauthenticated or public route can unlink an account.
- Existing account sessions are authorized against current database ownership,
  so the former owner loses access immediately after commit.
- Pending claim codes are invalidated as part of the transaction.
- Cross-installation requests fail without revealing account or share state.
- Logs and audit records exclude claim codes, signatures, private keys, OAuth
  credentials, GitHub tokens, and protected-share passwords.
- Homelab Inventory audit records include the local actor ID, disposition,
  affected counts, result, and timestamp.
- The GitHub username is returned only to the signed installation or the
  authenticated account that owned it. It is never included in public shares,
  embeds, previews, analytics, Registry traffic, or Agent traffic.
- Demo mode never enrolls, claims, unlinks, contributes, or opens installation
  event traffic.

## Error Behavior

Stable LabGD error codes include:

- `account-unlink-not-supported`
- `installation-account-not-linked`
- `account-binding-changed`
- `account-unlink-idempotency-conflict`
- `account-unlink-disposition-invalid`
- `account-unlink-transition-failed`

Authorization failures remain generic and do not reveal whether another
installation or account owns the requested resource. Validation failures occur
before durable state changes. Unexpected failures roll back the transaction and
retain the previous account and share states.

## Required Tests

### LabGD

1. Installation-signed unlink succeeds for keep, unpublish, and delete.
2. Dashboard-authenticated unlink uses the same transaction service.
3. Keep leaves all remote shares and revisions online and unchanged.
4. Unpublish preserves IDs, history, blobs required for republishing, and
   ownership reservations.
5. Delete commits deleted state and permanent public-ID reservations.
6. Local-only drafts are absent from and unaffected by remote processing.
7. Pending claim codes are invalidated.
8. The former account immediately loses access.
9. A new account can claim the installation afterward.
10. Claim and unlink concurrency produces one valid serialized result.
11. A stale binding revision changes nothing.
12. Exact idempotent replay returns the original result.
13. Changed input under an existing idempotency key is rejected.
14. A failed share transition rolls back account and share changes.
15. Permanent-delete cleanup retries do not restore content or ownership.
16. SSE events are bounded, identity-free, resumable, and ordered.
17. Foreign installations and accounts cannot unlink or inspect ownership.
18. Migration replay, process restart, and complete-stack restart are
    idempotent.
19. Backup and isolated restore preserve account revisions, operations,
    reservations, and share state.
20. Service-role grants remain least privilege.

### Homelab Inventory

1. Capability negotiation hides unlink against older LabGD servers.
2. The migration preserves all installation identity and unrelated state.
3. The route requires `sharing.publish`.
4. Keep, unpublish, and delete requests are signed correctly.
5. Delete submission requires an exact `DELETE` confirmation.
6. A successful response updates account and share projections atomically.
7. Local unpublished drafts remain unchanged.
8. Network retry reuses the same idempotency key.
9. A stale binding refreshes status and requires confirmation again.
10. REST completion updates the initiating browser immediately.
11. SSE updates other browsers without polling.
12. Duplicate and older SSE events are idempotent.
13. Account unlink keeps enrollment credentials and sharing enabled.
14. A new claim can be initiated after unlink.
15. The dialog remains open with actionable feedback after failure.
16. Demo mode performs no unlink or reconciliation request.
17. Complete and selective backups preserve the new state.
18. Sync preserves the destination installation identity and projection.
19. Projects, workspaces, assignments, placements, cables, route cache,
    private fields, Registry links, Agent state, and authentication state remain
    unchanged.

## Rollout

1. LabGD implements its ordered migration, binding revision, idempotency store,
   atomic domain service, installation route, dashboard route, capability
   advertisement, UI, and SSE event.
2. LabGD runs frozen installation, lint, tests, builds, migration replay,
   PostgreSQL integration, restart, backup/restore, and dual-architecture
   container security gates.
3. LabGD deploys first with existing publication behavior unchanged and verifies
   unlink capability advertisement.
4. Homelab Inventory implements its migration, capability parser, signed client,
   local route, transactional reconciliation, settings UI, audit event, and SSE
   handling.
5. Homelab Inventory runs lint, tests, builds, migration replay, backup/restore,
   restart, and dual-architecture container security gates.
6. Homelab Inventory deploys only when explicitly requested.
7. End-to-end certification exercises all three dispositions using disposable
   shares and verifies claim-after-unlink behavior.
8. Certification removes all disposable shares, claims, temporary files,
   containers, images, builders, scanner data, and build cache without deleting
   Docker volumes.

Both repositories update their changelogs and unreleased structured release
notes for their implementation. Neither project may mark account unlinking as
shipped until the cross-repository end-to-end tests pass.
