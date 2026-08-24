# LabGD Installation Account Unlink v1 Handoff

## Purpose

Implement the LabGD side of installation account unlinking without disconnecting
the Homelab Inventory installation or changing its UUID, Ed25519 key,
credentials, installation ownership, or public share-ID reservations.

The frozen application design is:

- `docs/superpowers/specs/2026-08-24-labgd-installation-account-unlink-design.md`
- `docs/superpowers/plans/2026-08-24-labgd-installation-account-unlink.md`

## Capability Contract

Preserve the existing exact v1 account-status response. Advertise:

```json
{
  "accountClaiming": {
    "supported": true,
    "statusSupported": true,
    "statusVersions": [1, 2],
    "unlinkSupported": true,
    "unlinkDispositions": ["keep", "unpublish", "delete"]
  }
}
```

Add an installation-signed `GET /v1/installations/account-status-v2` response:

```json
{
  "claimed": true,
  "githubUsername": "mriverodorta",
  "claimedAt": "2026-08-24T15:30:00.000Z",
  "bindingRevision": 3
}
```

## Unlink Operation

Add installation-signed `POST /v1/installations/account/unlink`, authorized by
the existing `claim:create` scope:

```json
{
  "requestVersion": 1,
  "idempotencyKey": "uuid-v4",
  "expectedAccountBindingRevision": 3,
  "shareDisposition": "keep"
}
```

The disposition is exactly one of `keep`, `unpublish`, or `delete`. A successful
bounded response is:

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

Perform one transaction that locks the installation and binding, verifies the
expected revision and durable idempotency record, applies the selected
disposition to all remotely created shares, invalidates pending claim codes,
removes account ownership, increments the binding revision, and persists the
result. A replay with the same normalized request returns the same result. A
changed request under the same key returns `account-unlink-idempotency-conflict`.

Use stable errors including `account-binding-changed`,
`installation-account-not-linked`, and
`account-unlink-disposition-invalid`. No error response may reveal a previous
or current GitHub identity.

`delete` must retain permanent public-ID ownership/tombstones. Local draft
shares never reach this operation and therefore cannot be affected.

## Events And Dashboard

Emit existing per-share lifecycle events first, followed by one installation
summary event:

```json
{
  "eventVersion": 1,
  "bindingRevision": 4,
  "disposition": "unpublish",
  "operationId": 17,
  "affected": {
    "shares": 7,
    "keptOnline": 0,
    "unpublished": 7,
    "deleted": 0
  },
  "occurredAt": "2026-08-24T15:31:00.000Z"
}
```

The summary kind is `account-unlink` and contains no GitHub identity. The
authenticated LabGD dashboard must invoke the same domain transaction with the
same three dispositions. After unlink, a new account may claim the installation
with a new single-use code.

## Migration And Verification

- Add a monotonic non-negative account binding revision; unclaimed starts at 0
  and existing claimed installations migrate to 1 unless already higher.
- Add installation-scoped durable idempotency records.
- Make migration ordered, idempotent, restart-safe, and least privilege.
- Prove concurrent claim/unlink serialization, stale revision rejection,
  exact replay, changed-request conflict, all dispositions, rollback, event
  ordering, permanent ID reservation, and cross-installation denial.
- Prove older v1 clients continue parsing `/account-status` unchanged.
- Deploy LabGD before the Homelab Inventory release advertises the UI action.

Do not change existing installation credentials, publication identity, share
ownership, or signed Registry artifacts as part of this feature.
