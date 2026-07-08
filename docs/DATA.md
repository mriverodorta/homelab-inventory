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

## Backups

Backups are written under:

```txt
/data/backups
```

Keep the whole `/data` directory backed up if this inventory becomes operationally important.

## Privacy

Runtime data can contain:

- LAN and VPN IP addresses
- Device names
- Hardware serials
- Agent enrollment tokens
- Service and port information

Do not publish your real `/data` directory.
