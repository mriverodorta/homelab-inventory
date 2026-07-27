# Data Model And Persistence

Homelab Inventory stores data in JSON files managed through lowdb.

## Runtime Layout

```txt
/data
  meta.json
  stores/
    inventory.json
    project.json
    agents.json
    agent-status.json
    registry.json
  backups/
  registry/
    installation-ed25519.pem
    installation-credentials.json
```

## Stores

- `inventory.json`: hardware records grouped by category.
- `project.json`: canvas layout, assignments, cables, and project state.
- `agents.json`: enrolled agent credentials and ownership.
- `agent-status.json`: latest agent telemetry.
- `registry.json`: registry preferences, private templates, catalog links, contribution outbox/ledger records, and public enrollment metadata.
- `meta.json`: database schema version and metadata.

## Migrations

The server checks `meta.json` on startup. When the schema version is older than the app expects, migrations run in order and create a backup before changing data.

This lets a deployment skip app versions without manually applying every intermediate migration.

See [MIGRATIONS.md](MIGRATIONS.md) for pre-upgrade, verification, Docker, interruption recovery, and rollback procedures.

### Schema 7 Compatibility Data

Schema 7 adds normalized hardware compatibility profiles and deterministic host resource allocations. The migration creates a backup before it:

- normalizes compatibility fields stored on hosts and components;
- calculates allocations for compatible existing RAM, storage, GPU, and network-card assignments; and
- preserves existing assignments, including legacy assignments that would be blocked if created or changed under the current rules.

Compatibility enforcement applies to new or changed assignments after migration. Missing compatibility fields remain unknown and produce warnings rather than blocking normal use.

The official catalog remains optional. Disabled registry mode performs no catalog requests, Offline file mode verifies a manually supplied signed artifact, and Connected mode checks only the official registry endpoint. Private templates provide sanitized local reuse without changing inventory relationships.

### Schema 15 Registry Data

Schema 15 adds `stores/registry.json` as an independent lowdb store. Private templates, official sources, inventory links, and contribution records use positive numeric IDs and explicit foreign keys. Private templates and contribution payloads contain only reusable hardware identity, specifications, compatibility, and physical port structure. Device properties, addresses, notes, assignments, connections, canvas positions, agent data, and smart-device instance configuration are excluded.

Verified signed artifacts are retained under `/data/catalog`, while `/data/cache/catalog.sqlite` is a disposable derived search index. Deleting the cache does not delete catalog or inventory data; the backend rebuilds it from the active verified artifact. Catalog links never use names or UI keys as relationships.

When automatic contributions are explicitly enabled, `/data/registry/installation-ed25519.pem` and `/data/registry/installation-credentials.json` are created with mode `0600`. The private key and short-lived token never enter lowdb or browser API responses. Back up these files with the rest of `/data`; revoking enrollment invalidates the remote token, and rotating the key replaces both files without changing queued hardware records.

### Schema 16 Physical RAM Records

Schema 16 converts each legacy RAM kit into one inventory record and one assignment per physical stick. The first stick retains the original numeric ID; additional sticks and assignments receive new positive numeric IDs. Existing physical slot positions and total capacity are preserved and validated. Obsolete RAM catalog links, projections, and contribution records are removed because kit-level identity cannot safely identify either stick.

The migration refuses ambiguous or inconsistent kit data instead of guessing. A failure restores the pre-migration stores and prevents the app from starting with a partially converted database.

## Backups

Backups are written under:

```txt
/data/backups
```

Keep the whole `/data` directory backed up if this inventory becomes operationally important.

Before upgrading a Docker deployment across a schema change, stop writes and take a separate copy or snapshot of the complete mounted `/data` directory. Automatic migration backups are a recovery aid, not a replacement for an external backup.

## Privacy

Runtime data can contain:

- LAN and VPN IP addresses
- Device names
- Hardware serials
- Agent enrollment tokens
- Service and port information

Do not publish your real `/data` directory.
