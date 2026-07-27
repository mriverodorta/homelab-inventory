# Data Migrations

Homelab Inventory upgrades its lowdb JSON stores automatically when the application starts with an older schema. Migrations run in order, so an installation can skip application versions without manually applying each intermediate change.

## Before Upgrading

1. Stop or pause anything that can write to the mounted `/data` directory.
2. Back up the complete `/data` directory outside the application volume.
3. Confirm the volume has enough free space for a second copy of the JSON stores.
4. Confirm the container user (`10001:10001`) can write to `/data`, `/data/stores`, and `/data/backups`.

The application creates its own timestamped backup under `/data/backups` before changing any store. That internal backup is a recovery aid, not a replacement for an external filesystem snapshot or NAS backup.

## Automatic Startup Process

On startup, the server:

1. Reads the schema version from `/data/meta.json`.
2. Acquires `/data/.schema-migration.lock` so two processes cannot migrate the same stores.
3. Creates a complete pre-migration backup.
4. Applies every required migration in order.
5. Validates inventory, assignments, connections, relational IDs, and registry state.
6. Writes the data stores before advancing the schema marker.
7. Records a safe migration summary in `meta.json` and removes the lock.

The first start after a schema upgrade can take longer than a normal restart. Do not stop the container while migration logs are active. If a migration or write fails, startup stops and restores the pre-migration stores rather than serving partially migrated data.

## Schema 16: Physical RAM Sticks

Schema 16 changes RAM from a kit or pair record into one inventory record per physical stick. This is a breaking data-model correction required for exact slot placement, mixed manufacturers or speeds, registry identity, and future database relationships.

Before:

```json
{
  "id": 4,
  "name": "32GB DDR4",
  "manufacturer": "Kingston",
  "specs": {
    "capacityGb": 32,
    "moduleCount": 2,
    "generation": "DDR4",
    "speedMt": 3200
  }
}
```

After:

```json
[
  {
    "id": 4,
    "name": "16GB DDR4",
    "manufacturer": "Kingston",
    "specs": {
      "capacityGb": 16,
      "generation": "DDR4",
      "speedMt": 3200
    }
  },
  {
    "id": 9,
    "name": "16GB DDR4",
    "manufacturer": "Kingston",
    "specs": {
      "capacityGb": 16,
      "generation": "DDR4",
      "speedMt": 3200
    }
  }
]
```

The first stick keeps the original RAM ID. Additional sticks and assignments receive new positive numeric IDs. Assigned module positions are preserved as one slot per assignment, and total RAM capacity is verified before the migration can complete. Existing RAM catalog links and pending RAM contributions are cleared because the old kit identity cannot safely represent either physical stick.

Ambiguous legacy records are not guessed. Startup fails without changing the live stores when a kit has an unsupported module count, non-divisible capacity, duplicate relationship, or assignment positions that do not match the documented modules. Correct the source data or restore the pre-upgrade application version, then retry.

## Verify An Upgrade

After the application is healthy:

1. Open **Settings > Registry** and confirm the displayed data schema and latest migration summary.
2. Inspect several hosts and verify each RAM stick occupies one physical slot.
3. Confirm the inventory contains the expected number and total capacity of RAM sticks.
4. Check Audit for unknown slot positions or incomplete RAM identity fields.
5. Keep the external pre-upgrade backup until the workspace has been reviewed.

The migration status intentionally exposes only a backup identifier, never an absolute server path.

## Docker And Watchtower

For a manual Docker Compose upgrade:

```bash
docker compose down
cp -a ./data "./data-pre-upgrade-$(date +%Y%m%d-%H%M%S)"
docker compose pull
docker compose up -d
docker compose logs -f homelab-inventory
```

Watchtower can replace the image automatically, but it does not replace your data backup policy. Keep scheduled external backups and review release notes before allowing a release with a schema migration to update automatically.

## Rollback

Application images are not expected to read a newer schema than they support. To roll back:

1. Stop the current container or bare-metal server.
2. Move the failed or newer `/data` directory aside; do not merge JSON files manually.
3. Restore the complete external pre-upgrade `/data` copy, or the matching internal backup directory.
4. Start the previous pinned application image or source checkout.
5. Verify the schema in `meta.json` and inspect the workspace before resuming writes.

If an unexpected interruption leaves `.schema-migration.lock` behind, first confirm that no Homelab Inventory process is running. A recent lock prevents another startup from modifying the stores; an old stale lock is recovered automatically on the next start.
