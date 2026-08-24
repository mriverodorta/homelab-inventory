# LabGD Expired Token Reactivation Design

## Problem

Homelab Inventory retains a stable LabGD installation UUID, Ed25519 key pair,
installation projection, and scoped bearer credentials. The client renews a
credential when it is near expiry, but it currently also attempts the renewal
flow after the credential has already expired. LabGD correctly rejects an
expired bearer token. The application then retries the publication with the
same unusable credential until its bounded retry budget is exhausted.

This was observed while resuming an existing first-publication operation after
LabGD repaired its historical Registry mirror. Local operation `1` and remote
operation `132` remained intact, but the credential had expired before replay.

## Required Behavior

The installation identity is permanent and must remain distinct from its
short-lived credentials:

- A valid credential outside the renewal margin is used directly.
- A valid credential inside the renewal margin is renewed through the
  authenticated renewal endpoint.
- An already-expired credential skips authenticated renewal and performs the
  normal challenge/activation flow with the existing installation UUID and
  Ed25519 key.
- If proactive renewal races with expiry and LabGD returns an authentication
  failure, the client performs that same challenge/activation flow once.
- Challenge activation must resolve to the existing logical installation. It
  must not generate a key, rotate a key, replace the installation UUID, create
  another installation, or enter recovery unless LabGD reports a genuine key
  conflict.
- The old credential file remains unchanged unless a replacement credential is
  fully validated and atomically written.

## Recovery Flow

`SharingInstallationIdentityService` will separate credential selection from
challenge activation:

1. Load and validate the installation instance, Ed25519 key, projection, and
   credential file.
2. If the credential is already expired, challenge-activate the existing
   identity without trying `/v1/installations/renew`.
3. If the credential is still valid but in the renewal margin, try renewal.
4. If renewal returns the explicit LabGD authentication-failure response,
   challenge-activate once with the existing identity.
5. Propagate network failures, unsupported-contract responses, malformed
   responses, permission failures, and recovery-pending responses unchanged.
   They must not be converted into activation attempts.
6. Validate the returned installation ID, scopes, token, and expiry, atomically
   replace the credential file, and update the existing projection.
7. Resume the same queued or retrying publication operation. The operation's
   local ID, remote operation ID, idempotency key, manifest hash, and generated
   public ID remain unchanged.

The activation helper will be explicit about whether an existing credential
may be consulted. This prevents recursive calls from selecting the expired
credential and attempting renewal again.

## Failure Handling

- Challenge activation returning `installation-recovery-pending` retains the
  existing behavior: persist recovery-pending state and stop publication.
- A returned installation ID different from the existing projection is a
  fail-closed identity error; credentials are not replaced.
- An authentication failure during publication does not create a second
  publication operation. The bounded coordinator retries only the existing
  operation after credential recovery.
- No private key, bearer token, signature, or challenge is logged.

## Tests

Regression coverage will prove:

1. A healthy credential is used without renewal or activation.
2. A credential inside the renewal margin renews normally.
3. An expired credential skips renewal and challenge-activates with the same
   UUID and Ed25519 public key.
4. A renewal authentication race falls back to challenge activation exactly
   once.
5. Non-authentication renewal failures do not trigger activation.
6. A mismatched returned installation ID fails closed without replacing the
   credential file or projection.
7. Recovery-pending behavior remains unchanged.
8. Restart with an expired credential preserves all identity hashes and
   reactivates idempotently.
9. A retrying publication resumes with the same local operation, remote
   operation, idempotency key, manifest, and public ID.

## Release And Verification

This is a user-visible reliability and security fix. Update the unreleased
structured release notes and `CHANGELOG.md`. Run lint, the complete test suite,
the production build, and the dual-architecture container security gate before
a patch deployment.

After deployment, resume remote operation `132` from the existing signed
Homelab Inventory operation. Verify activation, public and embed viewers,
preservation of inventory/project/route-cache state, and restart idempotency.
Do not create a replacement share ID.
