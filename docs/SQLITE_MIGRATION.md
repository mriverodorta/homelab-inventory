# SQLite Persistence Migration

Homelab Inventory now uses three private SQLite databases for its active runtime state:

```txt
/data/databases/
  homelab-inventory.sqlite
  telemetry.sqlite
  catalog.sqlite
  persistence-engine.json
```

The core database stores inventory, topology, settings, access control, Registry relationships, Agent enrollment, notifications, backup metadata, and other application state. Telemetry and the disposable local catalog index remain isolated in their own databases so retention and catalog rebuilds cannot block or enlarge ordinary inventory transactions.

## Before Upgrading

1. Confirm only one Homelab Inventory container can write to the mounted `/data` directory.
2. Create and verify an external copy or snapshot of the complete `/data` directory.
3. Confirm UID and GID `10001:10001` can write to `/data`.
4. Ensure the volume has enough free space for the existing data, a complete migration backup, and the three staged databases.
5. Keep the previous pinned image available until the migrated workspace has been reviewed.

The migration is automatic. Do not create the SQLite files manually and do not run Drizzle `push` against a user database.

## First Startup

On the first startup with SQLite support, the application:

1. Acquires a private migration lock so two processes cannot migrate the same data.
2. Creates and rereads a complete `.hlibackup` archive under `/data/backups/migrations`.
3. Reads the latest supported legacy JSON state without modifying it.
4. Imports core, telemetry, and catalog data into a private staging directory.
5. Validates semantic counts, capacities, numeric relationships, topology, authentication, notifications, Registry identity, database integrity, and foreign keys.
6. Atomically activates all three databases and writes `/data/databases/persistence-engine.json` only after validation succeeds.
7. Opens the databases in WAL mode and begins serving requests.

The generated migration archive is mode `0600`. When no deployment backup passphrase is configured, the migration creates a separate mode-`0600` `.key` file beside the archive and records both relative paths in the activation marker. Preserve the archive and key together.

Migration is ordered and idempotent. A restart after successful activation opens the existing databases and applies only newer checksummed SQL migrations. A failed initial migration leaves the legacy files authoritative and records a private diagnostic at `/data/databases/persistence-migration-failure.json`.

## Verification

Wait for the container to become healthy, then inspect the persistence section:

```bash
curl -fsS http://127.0.0.1:8798/api/health | jq '{
  ok,
  mode,
  schemaVersion,
  persistence
}'
```

Expected persistence state:

- `ok` is `true`.
- `persistence.status` is `active`.
- Core, telemetry, and catalog schema versions are present.
- `/data/databases` is mode `0700` and database/marker files are mode `0600`.
- Inventory counts, assignments, placements, cables, Registry links, Agent bindings, users, roles, and notification settings match the pre-upgrade installation.

Review container logs if health remains unavailable:

```bash
docker compose logs --tail=200 homelab-inventory
```

Do not remove a migration lock while a Homelab Inventory process is running. A stale lock from a terminated process is reclaimed safely on a later startup.

## Legacy Files

The original `/data/meta.json`, `/data/stores/*.json`, and legacy telemetry database remain byte-identical after a successful import. They are retained as recovery evidence but are no longer active runtime stores. New changes are written only to SQLite, so the legacy files become stale immediately after the first post-migration mutation.

Do not edit or synchronize individual legacy JSON files after activation. Back up and restore through the application or copy the complete stopped `/data` directory.

## Backup Compatibility

Portable `.hlibackup` archives remain logical and database-independent:

- Format 1 archives remain importable through the compatibility reader.
- SQLite deployments export format 2 archives with independent core, telemetry, and catalog schema versions.
- Complete and custom exports preserve the existing dependency-aware section model.
- A complete archive can still restore only selected compatible sections.
- Registry enrollment includes the stable installation UUID, Ed25519 key, and credentials as one protected unit.
- Agent and authentication secrets retain their existing encryption requirements.
- Route cache remains optional and disposable.

Restore never copies untrusted SQLite files directly over the active database. The application materializes selected logical sections into an isolated copy, validates relationships and integrity, checkpoints WAL state, and performs a journaled file swap. Startup completes or rolls back an interrupted swap without serving a partial database.

This logical archive boundary is also the portability contract for a future PostgreSQL backend; portable backups are not tied to SQLite pages or internal table layout.

## Rollback

The safest rollback is a complete filesystem rollback:

1. Stop Homelab Inventory.
2. Move the migrated `/data` directory aside without deleting it.
3. Restore the complete external pre-upgrade `/data` snapshot.
4. Pin and start the previous application image.
5. Verify inventory and topology before allowing writes.

Immediately after migration and before any user mutation, the untouched legacy files also represent the pre-migration state. After any SQLite-backed change, they do not contain the new data and must not be treated as a current rollback source.

Keep `/data/backups/migrations/pre-sqlite-*.hlibackup` and its optional `.key` file until the migration and normal backup/restore workflows have both been verified. Never merge SQLite tables, JSON files, or database sidecars by hand.
