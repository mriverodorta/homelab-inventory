# Data Model And Persistence

Homelab Inventory stores active runtime data in three SQLite databases. Legacy JSON stores are supported only as automatic migration sources.

## Runtime Layout

```txt
/data
  databases/
    homelab-inventory.sqlite
    telemetry.sqlite
    catalog.sqlite
    persistence-engine.json
  backups/
  auth/
    oidc-client-secret
  registry/
    installation-instance.json
    installation-ed25519.pem
    installation-credentials.json
  stores/                       # retained legacy migration sources
```

## Databases

- `databases/homelab-inventory.sqlite`: normalized inventory, projects, workspaces, assignments, connections, settings, authentication, authorization, Registry relationships, Agent enrollment, notifications, backup metadata, and disposable route cache.
- `databases/telemetry.sqlite`: bounded raw heartbeat history and latest host, service, container, storage, and virtualization projections. It is independent from workspace revision persistence.
- `databases/catalog.sqlite`: disposable local search index built from verified signed Registry artifacts.
- `databases/persistence-engine.json`: private activation marker recording the active engine, independent database schema versions, migration backup, and activation time.

SQLite relationships use positive numeric primary and foreign keys. Runtime identifiers such as `server:7` exist only at API and view boundaries. Core connections use WAL mode, enforce foreign keys, validate integrity on startup, and keep bounded in-process read caches rather than loading the complete database as a mutable object graph.

## Migrations

The server checks the activation marker and each database schema on startup. Committed, checksummed migrations run in order and create a verified backup before changing data.

This lets a deployment skip app versions without manually applying every intermediate migration.

See [SQLITE_MIGRATION.md](SQLITE_MIGRATION.md) and [MIGRATIONS.md](MIGRATIONS.md) for pre-upgrade, verification, Docker, interruption recovery, and rollback procedures.

### Schema 7 Compatibility Data

Schema 7 adds normalized hardware compatibility profiles and deterministic host resource allocations. The migration creates a backup before it:

- normalizes compatibility fields stored on hosts and components;
- calculates allocations for compatible existing RAM, storage, GPU, and network-card assignments; and
- preserves existing assignments, including legacy assignments that would be blocked if created or changed under the current rules.

Compatibility enforcement applies to new or changed assignments after migration. Missing compatibility fields remain unknown and produce warnings rather than blocking normal use.

The official catalog remains optional. Disabled registry mode performs no catalog requests, Offline file mode verifies a manually supplied signed artifact, and Connected mode checks only the official registry endpoint. Private templates provide sanitized local reuse without changing inventory relationships.

### Schema 15 Registry Data

Schema 15 originally added `stores/registry.json` to legacy installations. Its data now imports into normalized SQLite Registry tables. Private templates, official sources, inventory links, and contribution records use positive numeric IDs and explicit foreign keys. Private templates and contribution payloads contain only reusable hardware identity, specifications, compatibility, and physical port structure. Device properties, addresses, notes, assignments, connections, canvas positions, agent data, and smart-device instance configuration are excluded.

Verified signed artifacts are retained as immutable generations under `/data/catalog/generations`. Each generation keeps its signed snapshot, digest index, and disposable SQLite search index together, while `/data/catalog/active-generation.json` identifies the active generation. The backend can recover that pointer and rebuild a missing search index from the verified artifacts after an interrupted update. Catalog links never use names or UI keys as relationships.

The app creates `/data/registry/installation-instance.json` with a random UUID v4 and mode `0600`, then retains it for the lifetime of that deployment. When automatic contributions are explicitly enabled, `/data/registry/installation-ed25519.pem` and `/data/registry/installation-credentials.json` are also created with mode `0600`. The UUID identifies the logical installation while Ed25519 keys authenticate it; it is never derived from a hostname, address, or hardware fingerprint. The private key and short-lived token never enter SQLite or browser API responses. Authenticated rotation changes the key without changing the installation UUID, and a missing key enters owner-reviewed recovery instead of enrolling a duplicate installation.

### Schema 16 Physical RAM Records

Schema 16 converts each legacy RAM kit into one inventory record and one assignment per physical stick. The first stick retains the original numeric ID; additional sticks and assignments receive new positive numeric IDs. Existing physical slot positions and total capacity are preserved and validated. Obsolete RAM catalog links, projections, and contribution records are removed because kit-level identity cannot safely identify either stick.

The migration refuses ambiguous or inconsistent kit data instead of guessing. A failure restores the pre-migration stores and prevents the app from starting with a partially converted database.

### Schema 21 Owner Authentication

Schema 21 originally added `stores/authentication.json` with numeric primary and foreign keys. Existing installations still migrate with authentication disabled so an unattended Docker update cannot lock out the owner. A genuinely fresh production data directory starts with one-time owner setup enabled. OIDC client secrets remain outside SQLite under `/data/auth` with mode `0600`.

### Schema 23 Multi-User Authorization

Schema 23 upgrades the authentication store to relational accounts, local credentials, OIDC identities, global roles, role-permission relationships, account-role assignments, invitations, and identity-link requests. It creates built-in Owner, Administrator, Editor, and Viewer roles, preserves the existing authentication mode and original account, and assigns the protected Owner role to that account. The migration creates a backup first and retains positive numeric primary and foreign keys throughout.

The application compiles canonical SQLite authorization relationships into an in-memory Casbin policy at startup and after access changes. SQLite remains the authority; Casbin policy is derived runtime state and is never persisted as a second authority.

## Backups

Portable user backups are written under:

```txt
/data/backups/user
```

Create and restore them from **Settings > Backup & Restore**. Complete archives contain every portable section; custom archives can contain selected logical domains, Registry credentials, signed catalog state, Agents, telemetry, metadata, or the routing cache. The Agent telemetry section includes the latest Agent projection and a versioned export of every retained telemetry table. A complete archive can be partially restored later. Restore replaces selected sections and never merges records.

The restore preflight validates archive bounds, paths, hashes, schema compatibility, and dependencies before writes begin. The app then creates a complete pre-restore backup and uses maintenance mode plus a durable journal so failed or interrupted replacement can be rolled back. Backup history itself is excluded from archives to prevent recursion.

Sensitive archives require a passphrase for download. Registry-enrollment and complete archives include the installation UUID, signing key, and credentials together and validate their relationship before restore. Notification exports include policy, incident history, encrypted contact credentials, and `/data/notifications/master-key` as one validated dependency set; they cannot be exported unencrypted. Optional encrypted stored copies use scrypt and AES-256-GCM. Authentication is excluded from custom archives by default and cannot be exported unencrypted; complete archives include it. Scheduled complete backups can run daily or weekly at a configured time with a configurable retention count. Docker `TZ` is authoritative when set. Scheduled backups require `BACKUP_ENCRYPTION_PASSPHRASE` once authentication or notification secrets exist.

User backup directories are mode `0700` and files are mode `0600`. Migration and pre-restore recovery backups remain separate from ordinary portable archives.

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
