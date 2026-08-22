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
/data/sharing/public-id-key.json
```

Private files use mode `0600`. Short-lived credentials can be renewed, while
the UUID and private key remain stable across restart. Failed key rotation keeps
the old key and credentials. Recovery-pending state retains exactly one
replacement key, stops publication, and waits for owner approval without a
retry loop.

`sync.sh` excludes every sharing identity file in both directions and rebuilds
the destination's public SQLite projection when needed. Complete backups and
the Sharing identity section preserve the identity as one validated set;
Sharing configuration can be backed up separately.

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

Demo and staging modes always disable identity creation, enrollment, recovery,
rotation, publication, and remote events regardless of environment or persisted
settings. lab.gd failures never block Homelab Inventory health or readiness.

Password-protected share configuration is represented locally, but publication
remains disabled until lab.gd exposes the signed installation password handoff.
Homelab Inventory never stores the share password locally or substitutes an
insecure transport while that endpoint is unavailable.

## Permissions

- `sharing.configure` controls connection and share definitions.
- `sharing.publish` controls preview approval, publication, replacement,
  snapshot refresh, recovery, and lifecycle commands.

Every API route is protected by the server's default-deny authorization policy.
State changes reach the browser through the existing authenticated application
SSE stream; the browser does not poll sharing status.
