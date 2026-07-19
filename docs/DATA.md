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
  backups/
```

## Stores

- `inventory.json`: hardware records grouped by category.
- `project.json`: canvas layout, assignments, cables, and project state.
- `agents.json`: enrolled agent credentials and ownership.
- `agent-status.json`: latest agent telemetry.
- `meta.json`: database schema version and metadata.

## Migrations

The server checks `meta.json` on startup. When the schema version is older than the app expects, migrations run in order and create a backup before changing data.

This lets a deployment skip app versions without manually applying every intermediate migration.

### Schema 7 Compatibility Data

Schema 7 adds normalized hardware compatibility profiles and deterministic host resource allocations. The migration creates a backup before it:

- normalizes compatibility fields stored on hosts and components;
- calculates allocations for compatible existing RAM, storage, GPU, and network-card assignments; and
- preserves existing assignments, including legacy assignments that would be blocked if created or changed under the current rules.

Compatibility enforcement applies to new or changed assignments after migration. Missing compatibility fields remain unknown and produce warnings rather than blocking normal use.

The app does not query an online hardware catalog or ship a universal compatibility database. Compatibility fields are maintained when inventory items are created or edited, so ongoing upkeep is limited to new hardware and corrections to existing records.

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
