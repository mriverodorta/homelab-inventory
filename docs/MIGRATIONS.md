# Data Migrations

Homelab Inventory upgrades its lowdb JSON stores automatically when the application starts with an older schema. Migrations run in order, so an installation can skip application versions without manually applying each intermediate change.

## Before Upgrading

1. Stop or pause anything that can write to the mounted `/data` directory.
2. Back up the complete `/data` directory outside the application volume.
3. Confirm the volume has enough free space for a second copy of the JSON stores.
4. Confirm the container user (`10001:10001`) can write to `/data`, `/data/stores`, and `/data/backups`.

The application creates its own timestamped backup under `/data/backups` before changing any store. That internal backup is a recovery aid, not a replacement for an external filesystem snapshot or NAS backup.

## Schema 29: RAM Catalog Contract v8

Schema 29 prepares existing inventories for exact physical RAM registry records. It renames a numeric legacy RAM `specs.speed` value to `specs.speedMt`, canonicalizes `SODIMM` as `SO-DIMM`, and separates host memory support into physical `formFactors` and electrical `moduleTypes`.

Legacy host values `DIMM`, `SODIMM`, and `SO-DIMM` move to `formFactors`. Existing `UDIMM`, `RDIMM`, and `LRDIMM` values remain in `moduleTypes`. Missing electrical types remain unknown; the migration does not guess them. Ambiguous values or conflicting `speed` and `speedMt` values stop startup and restore the verified pre-migration backup.

The migration preserves each physical RAM record, positive numeric ID, assignment, memory position, canvas placement, cable, registry link, and cached cable route. A second startup is idempotent and does not run the migration again. Generic RAM without a verified manufacturer part number remains valid local inventory and is not automatically contributed or linked.

## Schema 28: Notification Permissions

Schema 28 adds the static `notifications.view` and `notifications.manage` permissions and grants them to the appropriate existing built-in roles. Custom roles and their permission relationships are preserved unchanged so an administrator can opt them into notification access deliberately after the upgrade.

The migration does not enable notifications, create contact credentials, or alter inventory, assignments, canvas placements, cables, agent enrollment, telemetry, registry identity, or catalog data. Notification stores and their local encryption key are initialized with mode `0600` only when the non-demo application starts; public demo sessions do not create them.

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

## Schema 20: Backup Management

Schema 20 adds `/data/stores/backup-management.json` for scheduled-backup preferences and backup/restore history. Existing inventory, project topology, registry relationships, agents, catalog state, and routing data are not changed. Startup creates the new store through the normal backup-first migration chain.

Portable backup files are stored separately under `/data/backups/user`; they are not embedded in lowdb and are never copied recursively into another archive. Restoring application metadata from an older supported backup keeps the currently running schema version so a partial restore cannot roll the database marker backward.

## Schema 19: Hardware Variant Identity

Schema 19 introduces fingerprint-v3 catalog identity for products that share a manufacturer and model but have materially different motherboards or expansion topology. Existing catalog links, contribution records, numeric IDs, inventory records, assignments, placements, and cables remain unchanged.

Existing fingerprint-v2 records are marked as version 2 instead of being reinterpreted. The next catalog refresh and contribution discovery use version 3 for new projections, while published identity aliases keep compatible version-2 relationships reviewable. A generic family record is never silently attached to a specific board variant when the match is ambiguous.

Variant identity uses evidence in this order:

1. Trusted agent-reported motherboard part number and revision.
2. Explicit motherboard fields saved on the inventory item.
3. A complete, non-conflicting structural topology such as available expansion slots.
4. A generic product-family identity when stronger evidence is unavailable.

Installed CPUs, memory, storage, GPUs, network cards, local device names, and local usage roles do not define the reusable product variant. When stronger evidence becomes available later, the item can contribute a separate candidate without changing its local numeric ID or project relationships.

## Schema 18: Physical Class And Usage Role

Schema 18 separates what a computer physically is from how it is used in the homelab. Every record in the existing `servers` category receives:

- `hardwareClass`: `desktop` or `server`
- `usageRole`: `server`, `desktop`, or `workstation`

Legacy records default to desktop hardware used as a server. This matches the existing tiny, mini, and micro computer inventory without changing how those devices appear or function in the workspace. Existing valid values are retained.

The migration does not move records between category arrays and does not change numeric IDs, assignments, placements, ports, cables, or registry-link relationships. After upgrading, edit either field from the equipment Inspector when a physical server or a desktop/workstation requires a different classification.

Registry identity uses `hardwareClass` because it describes the reusable product definition. `usageRole` remains local and is preserved when catalog revisions are reviewed and applied. A catalog desktop or server is still imported into the local `servers` category so all existing relational IDs remain stable.

## Schema 17: Registry Adoption Links

Schema 17 adds a reviewable `adoption-available` relationship for local hardware whose canonical identity matches a verified registry template but whose catalog-owned fields differ. Existing inventory records, assignments, placements, cables, detached overrides, and catalog links are preserved.

After the migration, activating a connected catalog can create one adoption link per physical inventory item. The application does not overwrite the item automatically. Review the proposed canonical fields under **Settings > Registry > Catalog updates** and apply them explicitly. Local-only properties remain untouched.

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
