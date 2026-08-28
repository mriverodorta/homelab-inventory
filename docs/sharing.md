# lab.gd Sharing

Homelab Inventory can publish selected read-only Systems and Canvas views to
`lab.gd` without exposing the source installation to inbound traffic.

## Enrollment And Publication

Production installations enroll automatically after the local HTTP service is
ready. Enrollment creates a random UUID v4 and Ed25519 key under
`/data/sharing`, then sends only that installation identifier, public key,
supported contracts, and signed request metadata. It does not send inventory,
projects, hostnames, addresses, Registry identity, Agent identity, telemetry,
tags, or custom fields.

Enrollment never creates a share. Publication requires all of these local
steps:

1. Select one project and one or more Systems or Canvas views.
2. Choose publication, visibility, expiration, embed, and optional-data rules.
3. Generate and inspect the exact local privacy preview.
4. Approve that preview hash.
5. Publish the approved content-addressed manifest and only the blobs lab.gd
   reports missing.

Any selected-content change invalidates the approval. An interrupted update
leaves the previous remote revision active.

## Privacy Boundary

The projector constructs new public objects from an allowlist. It never clones
private records and removes fields afterward. The default payload excludes:

- serial numbers and local inventory IDs;
- IP addresses, MAC addresses, hostnames, and network identifiers;
- local authentication, Registry, Agent, and sharing credentials;
- Agent identity, telemetry history, service or container history;
- compatibility audit and notification history;
- notes, tags, and custom fields;
- unrelated projects, workspaces, items, placements, and connections.

Tags and custom fields are individually selectable and default to excluded.
Current Systems CPU, memory, and storage use is an explicit one-time snapshot;
normal synchronized updates do not refresh it.

Registry-linked items use the exact approved template revision and content hash.
Custom items include only their sanitized public definition. Public IDs are
deterministic inside one installation but reveal no database IDs.

## Update Modes

- **Immutable** publishes one fixed revision.
- **Replaceable / manual** keeps the public ID and waits for an explicit update.
- **Replaceable / synchronized** collapses relevant project changes into one
  operation after a one-minute debounce.

Unrelated project changes do not schedule a share. Resource snapshots update
only through their separate explicit command.

## Identity And Recovery

Sharing identity is independent from Registry enrollment:

```text
/data/sharing/installation-instance.json
/data/sharing/installation-ed25519.pem
/data/sharing/installation-credentials.json
/data/sharing/public-id-key
```

Private files use mode `0600`. Short-lived credentials renew proactively before
expiration, independently of browser requests and event callbacks. The event
stream reconnects after network failures, LabGD restarts, credential renewal,
and Homelab Inventory restarts while the UUID, remote installation, and private
key remain stable. Failed key rotation keeps
the old key and credentials. Recovery-pending state retains exactly one
replacement key, stops publication, and waits for owner approval without a
retry loop.

`sync.sh` excludes every sharing identity file in both directions and rebuilds
the destination's public SQLite projection when needed. Complete backups and
the Sharing identity section preserve the UUID, signing credentials, recovery
key, and deterministic 32-byte public-ID key as one validated set; Sharing
configuration can be backed up separately.

## Configuration

```text
LABGD_ENABLED=true
LABGD_ORIGIN=https://lab.gd
```

`LABGD_ENABLED` defaults to `true` in production. Set it to `false` before first
startup to prevent identity creation and every lab.gd request. The Settings
toggle is a later opt-out that retains the stable local identity for reconnect.
`LABGD_ORIGIN` is intended for development or an explicitly trusted compatible
service.

Demo, staging, and test modes always disable identity creation, enrollment,
recovery, rotation, publication, and remote events regardless of environment or
persisted settings. They also disable Registry identity, contributions, network
refresh, and update checks. lab.gd failures never block Homelab Inventory health
or readiness.

Optional behavior is exposed only after Homelab Inventory validates lab.gd's
public capability contract. Password-protected shares, remote lifecycle
actions, account claiming, owner analytics, and installation events remain
hidden or disabled when the service does not explicitly advertise support.
Homelab Inventory sends a protected-share password only through the negotiated
signed installation handoff and never stores it locally.

Installation tokens carry explicit short-lived scopes. Older credentials can
continue publishing, but a newly required operation first refreshes the token
and fails closed if lab.gd does not grant its required scope.

The complete installation scope set is `publication:write`, `events:read`,
`shares:manage`, `analytics:read`, `token:renew`, `key:rotate`, and
`claim:create`. The original four-scope credential shape is accepted only as a
renewal source: Homelab Inventory signs `/v1/installations/renew` with the
existing key and token, preserves the installation UUID and remote installation
ID, and persists only the scopes and expiration returned by lab.gd. Unknown or
partial scope sets fail closed.

Capability negotiation requires protocol 1, share contract 1, systems and
canvas view contract 1, resumable installation events, protected-password
handoff, the complete lifecycle operation set, account claiming, 90-day daily
owner analytics, and configuration-only comments and reactions. A missing or
explicitly unsupported declaration disables enrollment and publication instead
of being guessed from server readiness.

Account claiming returns an opaque claim ID, a single-use code, expiration, and
the exact clean verification destination `https://app.lab.gd/claim`. The app
shows the code separately and never places it in the URL, browser storage, or
logs.

## Remote State And Owner Controls

Homelab Inventory opens one authenticated installation SSE stream and resumes it
with the last committed event ID. Each supported event is applied to the local
sharing projection and its cursor is advanced in the same SQLite transaction,
so reconnect replay cannot duplicate state. There is no polling fallback.
Unknown event versions stop event application and trigger capability
renegotiation before the stream can resume.

Connection timestamps, bounded error codes, reconnect attempts, and the next
retry time are persisted without tokens, signatures, nonces, private keys, or
request payloads. The UI reports a retrying state after credentials expire when
there is no live or recently authenticated stream. Reconnect uses bounded
exponential backoff with jitter and never generates a replacement identity.

Remote settings changes, unpublish, delete, and republish use the current remote
revision and a stable idempotency key. A remote success commits before the local
projection changes; a conflict reloads authoritative state instead of
overwriting it. Password entry is sent only through the signed installation
handoff. Plaintext passwords are never stored in local SQLite, browser storage,
logs, backups, queued operations, or response bodies.

After a GitHub account consumes the separate short-lived claim code at the exact
clean claim URL, Homelab Inventory reflects the claimed installation state from
the event stream. The owner can inspect at most 90 UTC daily analytics buckets
for an owned share. Analytics are remote aggregate results only; Homelab
Inventory does not create request-level telemetry or a local time-series store.

When LabGD advertises account-unlink contract v1, an administrator with
`sharing.publish` can remove the GitHub owner while keeping the installation
connection, UUID, signing key, credentials, and public-ID ownership intact. The
operator chooses to keep remote shares online, unpublish all remote shares, or
permanently delete their content while reserving their generated IDs. Permanent
deletion requires the exact confirmation `DELETE`. Local unpublished drafts are
never changed. The app persists the binding revision and durable unlink attempt
with the Sharing identity backup section, then reconciles other browsers through
the existing resumable SSE stream without polling.

Installation identity is the authorization boundary for every token, event,
share command, claim, and analytics request. A public ID or cursor from another
installation never grants access. Rotate a suspected installation credential
through signed renewal or key rotation while preserving the installation UUID,
then resume from the last transactionally committed cursor and reuse original
idempotency keys for incomplete commands.

## Permissions

- `sharing.configure` controls connection and share definitions.
- `sharing.publish` controls preview approval, publication, replacement,
  snapshot refresh, recovery, remote lifecycle commands, and account unlinking.

Every API route is protected by the server's default-deny authorization policy.
State changes reach the browser through the existing authenticated application
SSE stream; the browser does not poll sharing status.

The contract verification workflow is local and non-deploying. It must not
render production secrets, modify SkyBolt services, enable publication, publish
container images, or change public routing.

## Rollout Verification

The read-only integration verifier checks both services without creating,
updating, or publishing a share:

```bash
HLI_ORIGIN=https://inventory.example.com \
LABGD_ORIGIN=https://lab.gd \
HLI_SESSION_COOKIE='session-cookie-name=session-value' \
bun run sharing:integration:check
```

It requires a healthy production app, a package-backed and publication-ready
lab.gd service, connected automatic enrollment, and an exact match between the
remote capability document and both application capability projections. See
`docs/sharing-rollout.md` for the coordinated deployment and rollback order.
