# lab.gd Automatic Enrollment Design

**Status:** Approved design amendment

**Date:** 2026-08-22

**Applies to:**

- `docs/superpowers/specs/2026-08-20-lab-gd-sharing-platform-design.md`
- `docs/superpowers/plans/2026-08-20-lab-gd-02-application-sharing-client.md`

## Purpose

Production Homelab Inventory installations must be ready to publish to
`lab.gd` without a separate enrollment or enablement step. Enrollment is an
installation-level connection and is distinct from publication: automatic
enrollment never sends inventory, project, topology, telemetry, tag, custom
field, or share content.

Sharing remains deliberate. A user must still select content, review the exact
privacy projection, and explicitly publish the first revision of a share.

Demo and staging runtimes must never enroll or create a sharing identity.

## Effective Configuration

Persist an installation-wide `labGdConnectionEnabled` setting. Its production
default is `true` for fresh and upgraded installations.

Support `LABGD_ENABLED=false` as a startup-level opt-out. This override must be
evaluated before creating `/data/sharing`, writing an identity projection, or
making any outbound `lab.gd` request. The effective connection state is:

```text
production && LABGD_ENABLED != false && labGdConnectionEnabled
```

Demo and staging runtime policies override both environment and persisted
settings and always produce an effective disabled state.

The application must expose these states without conflating them with share
publication:

- `pending`
- `connected`
- `retrying`
- `recovery-pending`
- `disabled`
- `unsupported`

## Startup Lifecycle

Database migrations and local application readiness complete independently of
`lab.gd`. After local readiness, a background enrollment coordinator performs
the following ordered operation when the effective connection is enabled:

1. Create or load the stable UUID v4 installation instance.
2. Create or load the installation Ed25519 identity.
3. Rebuild a missing SQLite identity projection from the protected files.
4. Negotiate the application and sharing contract versions with `lab.gd`.
5. Complete the signed challenge and activation flow.
6. Persist the resulting credential and public enrollment projection.
7. Open the authenticated publication-status SSE connection.

An unavailable or incompatible `lab.gd` service must not make application
health or readiness fail. Retryable failures use persisted exponential backoff
with jitter and a bounded maximum interval. The coordinator must resume one
scheduled attempt after restart rather than creating an additional retry loop.

Authentication failures and recovery-pending responses are not ordinary
retryable failures. They stop publication and automatic activation attempts
until the applicable recovery operation can safely resume. Recovery retains
one replacement key and must not generate additional replacement identities.

## Identity And Opt-Out

The sharing UUID and key are permanently installation-specific. Opting out
does not delete them or the public SQLite projection. Re-enabling the connection
must resume the same logical `lab.gd` installation and must never enroll a
duplicate.

The Settings interface exposes **Connect to lab.gd**, enabled by default in
production. It displays connection state rather than an enrollment setup flow.
When shares exist, disabling the connection first uses the approved lifecycle:

- Claimed shares may be kept online or disconnected and unpublished.
- Unclaimed shares show the existing 30-day grace-period consequence.
- An unpublish choice completes one final signed operation before outbound
  traffic is disabled.
- A keep-online choice disables local traffic without deleting remote content.

After opt-out completes, enrollment, activation, recovery, rotation,
publication, and publication-status SSE traffic stop. Local identity files stay
protected for a future reconnect.

## Demo And Staging Prohibition

Demo and staging runtimes must:

- Never create `/data/sharing` identity files.
- Never create a remote installation.
- Never enroll, activate, rotate, recover, publish, synchronize, or unpublish.
- Never open a `lab.gd` SSE connection.
- Never expose sharing setup or publication controls.
- Return the existing stable disabled error from sharing APIs.

Persisted production settings or copied public project data cannot override
this policy. Demo-session cleanup must leave no sharing identity or credential
material.

## Backup, Restore, And Synchronization

Complete and sharing-identity backups treat the installation UUID, private key,
credentials, and SQLite identity projection as one validated dependency set.
Restore must reject a mismatched set before activation.

`sync.sh` must never copy sharing identity files or credentials in either
direction. It preserves the destination identity and either preserves or
rebuilds the destination SQLite projection. Tests must prove that UUID and key
hashes never cross environments.

Deleting only the SQLite projection must rebuild public enrollment state from
the protected identity files without creating a new remote installation.
Deleting credentials must resume activation with the existing key.

## Privacy Boundary

Automatic enrollment may send only the information required to establish and
authenticate the installation connection:

- Random installation UUID.
- Ed25519 public key and key identifier.
- Supported application and sharing contract versions.
- Request timestamp, nonce, canonical body hash, and signature.

It must not include hostnames, network addresses, hardware fingerprints,
inventory, project data, telemetry, Registry identity, Agent identity,
authentication accounts, tags, custom fields, or share content.

## Migration

The ordered sharing migration seeds `labGdConnectionEnabled = true` for fresh
and upgraded production installations. It must be transactional, idempotent,
and rollback-capable. It must not modify inventory, project membership,
workspaces, assignments, placements, connections, route cache, private fields,
Registry state, Agent state, notification state, or authentication state.

Identity creation and remote enrollment happen after the migration commits and
after local readiness. They are not part of the database transaction.

## Verification

Required automated coverage includes:

1. Fresh production installs enroll once after local readiness.
2. Upgraded production installs receive the enabled default and enroll once.
3. `LABGD_ENABLED=false` prevents identity creation and all outbound traffic.
4. UI opt-out stops traffic and reconnect resumes the same UUID and key.
5. Offline startup remains healthy and schedules one bounded retry sequence.
6. Restart preserves connection, backoff, and recovery state without loops.
7. Failed rotation preserves the current key and credentials.
8. Recovery pending retains one replacement key and stops publication.
9. Backup and restore validate the complete sharing identity set.
10. `sync.sh` preserves destination identity hashes in both directions.
11. Missing SQLite projection rebuilds without remote duplication.
12. Missing credentials reactivate with the existing key.
13. Demo and staging create no identity and make no outbound request.
14. Enrollment payloads contain no private application data.
15. Automatic enrollment never creates or activates a share.
16. Application health and readiness do not depend on `lab.gd` availability.

## Plan Amendment

Before executing Plan 2, revise its global constraints, persistence defaults,
identity startup flow, API behavior, UI expectations, documentation, and end-to-
end tests to use this design. Any statement that sharing enrollment starts
disabled or requires an explicit setup action is superseded. Explicit content
publication and privacy review requirements remain unchanged.
