# LabGD Gated Enrollment Readiness Design

## Problem

Homelab Inventory currently treats LabGD's `publicationReady` readiness field as
a prerequisite for installation enrollment. The coordinated rollout deliberately
keeps LabGD publication disabled until the production installation is enrolled
and its identity is proven stable. Those two rules create a circular gate:
publication cannot be enabled before enrollment, while enrollment cannot start
until publication is enabled.

## Approved Behavior

LabGD service readiness and publication readiness are separate conditions.

- Installation enrollment requires HTTP readiness, package-backed contract mode,
  and the complete compatible capability document.
- Enrollment is allowed while `publicationReady` is false.
- Installation events, account claiming, lifecycle operations, and owner
  analytics remain controlled by their negotiated scopes and capabilities.
- Requests using the `publication:write` scope require a fresh readiness response
  with `publicationReady: true` before any publication request is sent.
- A gated publication attempt fails with the existing bounded
  `labgd-unavailable` error and does not replace installation identity or
  credentials.
- Demo, staging, and `LABGD_ENABLED=false` behavior remains unchanged and creates
  no sharing identity.

## Implementation

`SharingInstallationIdentityService.readiness()` validates general service and
contract readiness and records whether publication is currently available. A
new publication-specific assertion calls that same bounded readiness path and
rejects when the remote publication gate is closed. `signedFetch()` invokes the
publication assertion only for `publication:write`; all other scopes keep their
existing capability and credential checks.

The read-only rollout verifier accepts gated publication by default so it can
certify enrollment during Plan 04 Task 3. Its explicit
`requirePublicationReady` option is used after the gate opens to certify the
publication-enabled phase. Both modes continue to require healthy services,
package-backed contracts, exact capabilities, and connected enrollment.

This places the enforcement at the authenticated request boundary. Every
manifest, blob, and activation request already uses `publication:write`, while
events, claims, lifecycle changes, key rotation, token renewal, and analytics use
their narrower scopes.

## Verification

Regression tests must prove:

1. A healthy package-backed LabGD with `publicationReady: false` permits one
   activation and creates stable local identity and credentials.
2. Non-publication signed requests continue to work while publication is gated.
3. A `publication:write` request fails locally before the remote publication
   endpoint receives a request.
4. Opening the gate permits the same installation and credentials to publish
   without reenrollment.
5. Closed-gate retries never generate another UUID, key, installation, or
   credential set.
6. Existing unsupported-contract and unhealthy-service failures remain
   fail-closed.
7. The rollout verifier distinguishes gated enrollment verification from the
   later publication-enabled verification.

The patch is released as `0.15.1` only after lint, tests, build, migrations, and
the dual-architecture zero-vulnerability container gate pass.
