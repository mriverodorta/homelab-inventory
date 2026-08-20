# HomelabInventoryShare Implementation Handoff

## Task

Implement the private `lab.gd` sharing service while the Homelab Inventory task
implements the shared public packages and local publication client.

## Repositories

- Application: `/Users/maikeldorta/Code/home-datacenter/ServerSpecsInventory`
- Registry reference: `/Users/maikeldorta/Code/home-datacenter/ServerSpecsInventoryRegistry`
- New private repository: `/Users/maikeldorta/Code/home-datacenter/HomelabInventoryShare`
- GitHub repository: `mriverodorta/HomelabInventoryShare` with visibility `PRIVATE`

## Required Reading

Read these files before creating the new repository:

1. `ServerSpecsInventory/docs/superpowers/specs/2026-08-20-lab-gd-sharing-platform-design.md`
2. `ServerSpecsInventory/docs/superpowers/plans/2026-08-20-lab-gd-03-private-service.md`
3. `ServerSpecsInventory/docs/superpowers/plans/2026-08-20-lab-gd-04-coordinated-rollout.md`

Design commit:

```text
05a5244
```

Do not substitute assumptions for any frozen requirement in the design.

## Ownership

This task owns:

- Private repository creation and workspace scaffolding
- PostgreSQL and Drizzle schema
- Installation enrollment, signed requests, rotation, and recovery
- Content-addressed blob storage
- Manifest-first ingestion and atomic activation
- Historical Registry mirror
- Full-page, protected, and embed viewer shells
- GitHub-only Better Auth account claiming
- Password hashing and protected sessions
- Analytics, abuse reporting, expiration, and inactivity deletion
- Social preview renderer and lifecycle workers
- SkyBolt Compose, Cloudflare Tunnel integration, backups, and operations

This task does not own:

- Homelab Inventory editor behavior
- Local sharing identity files or backups
- Local privacy projection or publication UI
- Shared package source
- Registry publication or Registry schema
- Homelab Inventory release or deployment

## Shared Package Boundary

The service must consume exact pinned releases of:

```text
@homelab-inventory/share-contract
@homelab-inventory/viewer-model
@homelab-inventory/viewer-react
```

Until those packages are published, use only the frozen contract fixtures from:

```text
ServerSpecsInventory/docs/handoffs/lab-gd-contract-v1/fixtures
ServerSpecsInventory/docs/handoffs/lab-gd-contract-v1/SHA256SUMS
```

Copy them byte-for-byte and verify every checksum before use. If this bundle is
not present yet, the private task may complete repository, database,
configuration, authentication, storage, and Registry-mirror foundations, but it
must stop before publication ingestion. Do not invent substitute fixtures, copy
application source, or create a second viewer implementation.

The service may scaffold and test adapters against the verified fixtures, but
publication and production viewer routes must remain disabled until the exact
packages exist and pass the coordinated rollout gate.

## Initial Contract

```text
shareContractVersion: 1
systems schema: 1
canvas schema: 1
```

Publishing remains disabled until exact package versions and fixture hashes are
recorded in the coordinated rollout ledger.

## Non-Negotiable Security Requirements

- The repository is private.
- PostgreSQL has no host port.
- Watchtower is disabled for every service.
- Runtime containers are non-root, read-only, capability-free, and use
  `no-new-privileges` plus bounded `noexec,nosuid,nodev` tmpfs.
- API, renderer, lifecycle, analytics, and Registry mirror use separate database
  roles, secrets, and mounts.
- Domain packages expose infrastructure ports only; PostgreSQL implementations
  remain in the database/infrastructure boundary and are injected by the API.
- Passwords use Bun Argon2id with unique salt and versioned Infisical pepper.
- Better Auth tables are installed only through ordered checksummed migrations;
  runtime auto-migration is disabled.
- Protected routes leak no title, description, counts, manifest, preview, or
  object metadata before successful verification.
- Publication verifies timestamp, nonce, signature, token scope, compressed and
  expanded limits, strict schema, semantic references, Registry references, and
  hashes before activation.
- Active revision changes atomically. Failed replacement leaves the previous
  revision online.
- Raw IPs, full referrers, user-agent history, geography, and persistent
  fingerprints are not stored.
- Hono serves share-specific HTML and owns Open Graph, canonical, robots, cache,
  content-type, and CSP headers; the Vite bundle only hydrates that document.
- Container security must pass build, boot, Docker Scout, and Trivy for both
  `linux/amd64` and `linux/arm64` with zero known vulnerabilities.
- Never connect directly to SkyArk.

## Registry Use

Mirror immutable signed Registry artifacts server-side. Resolve only exact:

```text
(templateKey, templateRevision, contentHash)
```

Never resolve latest. Never require public viewers to contact Registry. A missing
or invalid historical definition blocks activation without changing the current
share.

## Stop Conditions

Stop and report rather than working around any of these:

- Shared fixture checksum mismatch
- Contract ambiguity or disagreement with the design
- Need to import Homelab Inventory private modules
- Protected-share metadata leakage
- Cross-installation ownership ambiguity
- Non-atomic publication behavior
- Database role requiring broader access than its responsibility
- Container vulnerability at any severity
- Backup that cannot restore into isolated staging
- Any proposed direct SkyArk access

## Implementation Order

Execute only the private-service plan in its numbered order. The dependency
sequence is intentional: configuration and shared limits precede authentication;
the Registry mirror precedes publication; public reads and protected sessions
precede viewer shells; deployment security and recovery precede final E2E.
Commit after every task. Keep publication gated. Do not deploy during
implementation.

At completion, return:

- Private repository path and GitHub visibility proof
- Exact commit
- Dependency and package-version report
- Migration schema and role report
- Lint, test, build, and security results
- Container architecture and vulnerability results
- Backup/restore proof
- Contract fixture hashes
- Remaining rollout blockers

Then wait for the coordinated rollout owner. Do not publish shares or enable the
production contract gate independently.
