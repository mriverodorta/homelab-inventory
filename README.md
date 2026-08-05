# Homelab Inventory

[![Docker Pulls](https://img.shields.io/docker/pulls/mriverodorta/homelab-inventory?logo=docker)](https://hub.docker.com/r/mriverodorta/homelab-inventory)
[![Docker Image Version](https://img.shields.io/docker/v/mriverodorta/homelab-inventory?sort=semver&logo=docker)](https://hub.docker.com/r/mriverodorta/homelab-inventory/tags)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Homelab Inventory is a self-hosted visual workbench for documenting homelab hardware, component assignments, ports, patch panels, and cabling.

It is built for people who want a practical map of what they own, what is installed where, and how network or display ports are connected.

## Project Links

- Official website: [homelabinventory.com](https://homelabinventory.com/)
- Live demo: [demo.homelabinventory.com](https://demo.homelabinventory.com/)
- Source code: [GitHub](https://github.com/mriverodorta/homelab-inventory)
- Container image: [Docker Hub](https://hub.docker.com/r/mriverodorta/homelab-inventory)

> [!WARNING]
> Do not expose Homelab Inventory directly to the public internet without HTTPS and access controls. Built-in multi-user authentication is available but optional on upgraded installations, and it does not provide TLS. Use a trusted LAN, VPN, or TLS reverse proxy.

## Features

- Infinite canvas for servers, NAS devices, custom PC builds, monitors, UPS systems, power strips, switches, patch panels, and cables.
- Searchable inventory sidebar with in-app item creation.
- Reusable private hardware templates with local search and checksummed JSON import/export.
- Optional verified hardware catalog with automatic category-aware contribution deduplication and a fully offline signed-snapshot mode.
- Drag components into compatible hosts, including CPU, cooling, motherboard, RAM, storage, GPU, network, wireless, sound, case, power supply, and OEM power adapters.
- Validate known CPU, RAM, storage, and expansion-card incompatibilities before assignment.
- Explain compatibility requirements, deterministic resource allocations, and unknown-data warnings in inspectors and Audit.
- Individual port chips for servers, expansion cards, NAS devices, switches, and patch panels.
- Color-coded cable routing for network and display connections, plus directional power connections between outlets and equipment inputs.
- JSON database stored outside the app image under a persistent `/data` volume.
- lowdb-backed split stores with schema migrations and automatic backups.
- Portable complete or custom backups with protected partial restore, optional encryption, scheduling, and retention controls.
- Optional multi-user authentication with local passwords, OpenID Connect, or both, plus invitations, custom roles, session management, and one-time owner recovery.
- Optional Linux agent enrollment per server for keepalive and hardware telemetry.
- Mobile-friendly inventory drawer and long-press drag behavior for touch devices.

## AI Development Notice

This project is being actively built with AI-assisted development. It is usable, but should be treated as an evolving homelab tool rather than a finished enterprise CMDB. Keep your `/data` directory backed up, review release notes before major upgrades, and report issues when behavior does not match your environment.

## Quick Start With Docker

### Normal Production

Create a Compose file:

```yaml
services:
  homelab-inventory:
    image: mriverodorta/homelab-inventory:stable
    container_name: homelab-inventory
    restart: unless-stopped
    ports:
      - "8798:8798"
    volumes:
      - ./data:/data
```

Start it:

```bash
docker compose up -d
```

Open:

```txt
http://<server-ip>:8798
```

The image defaults to:

```txt
NODE_ENV=production
PORT=8798
DATA_DIR=/data
SAVE_DEBOUNCE_MS=500
APP_MODE=production
UPDATE_CHANNEL=stable
UPDATE_CHECK_ENABLED=true
REGISTRY_REFRESH_INTERVAL_MS=21600000
TZ=UTC
BACKUP_ENCRYPTION_PASSPHRASE=
AUTH_BOOTSTRAP_CODE=
AUTH_BOOTSTRAP_CODE_FILE=
AUTH_EXTERNAL_URL=
OIDC_CLIENT_SECRET=
OIDC_CLIENT_SECRET_FILE=
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=600
TRUST_PROXY=false
```

Connected registry mode refreshes the verified official catalog at startup and approximately every six hours. Set `REGISTRY_REFRESH_INTERVAL_MS=0` to disable automatic catalog refreshes while retaining the manual Refresh action.

When running behind a reverse proxy, set `TRUST_PROXY` to the exact proxy hop count or trusted proxy range so rate limits use the correct client address. Do not set it to `true`.

Production starts empty. Create inventory items from the web interface, or copy an existing `/data` directory into the mounted volume.

On a fresh production data directory, the first page opens owner setup. Supply `AUTH_BOOTSTRAP_CODE` or `AUTH_BOOTSTRAP_CODE_FILE`, or read the generated one-time code from `docker compose logs homelab-inventory`. Existing installations upgraded from an earlier release remain open until authentication is enabled in **Settings > Authentication**.

More deployment details: [docs/DOCKER.md](docs/DOCKER.md)

## Local Development

This project uses Bun.

```bash
bun install
bun run dev
```

Open `http://127.0.0.1:5173`.

Useful commands:

```bash
bun run lint
bun run test
bun run build
```

More development details: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)

## Data Storage

The app keeps user data out of the application image. Runtime data lives in `/data` for Docker and `./data` for local development.

```txt
/data
  meta.json
  stores/
    inventory.json
    project.json
    agents.json
    agent-status.json
    registry.json
    routing-cache.json
    backup-management.json
    authentication.json
  backups/
  auth/
  registry/
    installation-instance.json
    installation-ed25519.pem
    installation-credentials.json
```

Only one app container should write to a mounted data directory.

More data details: [docs/DATA.md](docs/DATA.md)

Upgrade and rollback guidance: [docs/MIGRATIONS.md](docs/MIGRATIONS.md)

## Authentication

Homelab Inventory supports multiple accounts with three optional authentication modes:

- **Local** uses a username and an Argon2id password of at least 12 characters.
- **OIDC** uses Authorization Code flow with PKCE and binds the exact issuer and subject returned by the provider.
- **Hybrid** allows an account to link both methods after explicitly confirming the second identity.

Fresh production installations require one-time local owner setup. Existing upgraded installations default to **Disabled** so an image update cannot lock out an established deployment. Enable or change methods in **Settings > Authentication**. The protected original owner can then invite local or OIDC users from **Settings > Access**, assign built-in roles, or compose custom global roles from the static permission catalog. Public demo sessions always bypass authentication and omit Access administration.

Invitations choose one initial login method. Matching email addresses are not merged automatically; an authenticated account must explicitly link the second local or OIDC identity. The original owner and Owner role cannot be reassigned or removed. API permissions are enforced on the server with default-deny routing, independently of which controls are visible in the browser.

OIDC requires a public HTTPS application URL. Configure the provider callback as:

```txt
https://inventory.example.com/api/auth/oidc/callback
```

The client secret can be entered in Settings and stored as a mode-`0600` backend file, or supplied through `OIDC_CLIENT_SECRET` / `OIDC_CLIENT_SECRET_FILE`. File values take precedence and environment-managed secrets are read-only in the UI. Set `AUTH_EXTERNAL_URL` when the externally visible URL cannot be inferred from the deployment.

If the original owner is locked out, stop the application before creating a recovery grant so only one process writes the lowdb stores:

```bash
docker compose stop homelab-inventory
docker compose run --rm homelab-inventory bun run auth:reset-owner
docker compose start homelab-inventory
```

The command prints a recovery URL valid for 15 minutes. Authentication data is excluded from custom backups by default and can be exported only in an encrypted archive. Complete backups include it. Once authentication data exists, scheduled backups require `BACKUP_ENCRYPTION_PASSPHRASE`.

## Backup And Restore

Open **Settings > Backup & Restore** to create a complete portable backup or choose individual sections such as inventory, project topology, registry state, agents, telemetry, catalog data, and the disposable cable-routing cache. A complete archive can later be restored in full or used to replace only selected sections.

Restore is replacement-only. Before changing live data, the app validates archive paths, sizes, checksums, schema compatibility, and section dependencies; creates a complete pre-restore recovery backup; enters maintenance mode; and records a durable restore journal. A failed or interrupted restore rolls back automatically. Connected browsers reload after a successful restore.

Portable archives use the `.hlibackup` format. Registry-enrollment backups include the stable installation UUID, signing key, and credentials as one validated set. Backups containing registry enrollment or agent credentials require a passphrase before download. Stored copies may also be encrypted with scrypt and AES-256-GCM. Keep that passphrase outside the app because it cannot be recovered.

Daily or weekly complete backups can run at a configurable time with a configurable retention count. Set `TZ` in Docker Compose to make the deployment timezone authoritative, or choose an IANA timezone in Settings. Set `BACKUP_ENCRYPTION_PASSPHRASE` to at least 12 characters to encrypt scheduled stored backups. It is mandatory for scheduled backups once owner-authentication material exists.

User-managed backups live under `/data/backups/user` with private directory and file permissions. Backup history is never included recursively. Migration and pre-restore recovery backups remain separate from ordinary portable backups. Public demo sessions can download only their disposable inventory and project data and cannot schedule, upload, restore, or export credentials.

## Hardware Compatibility

Compatibility rules help prevent known-invalid assignments while keeping partially documented hardware usable:

- **Compatible** means the known component requirements fit the host and any required resource was allocated deterministically.
- **Incompatible** means a verified rule conflicts, such as a CPU socket mismatch, unsupported RAM generation, unavailable storage bay, or unsuitable expansion slot. New or changed assignments are blocked.
- **Unknown** means one or more required fields are not documented. The assignment remains available with an amber warning so incomplete inventory does not stop normal work.

Servers and NAS devices expose compatibility details in their inspectors. Component inspectors show requirements and the current host allocation, while Audit identifies assigned hardware that is incompatible or needs more data.

Compatibility fields are entered when an inventory item is created or edited. Private templates can reuse local definitions, while verified official definitions can be imported from a signed offline snapshot or synchronized in Connected mode. Existing assignments are preserved when upgrading to schema 7, even if a current rule would block creating the same assignment today.

## Registry And Private Templates

Add Hardware supports three sources:

- **Catalog** searches a verified official snapshot through a disposable local SQLite index. Search terms never leave the installation.
- **Manual** keeps the complete local type-specific editor and remains available in every mode.
- **Private templates** store sanitized reusable hardware definitions in `/data` and support checksummed JSON import/export.

Registry mode defaults to **Disabled**, which makes no catalog requests. Private templates never include device properties, IP or MAC addresses, notes, assignments, connections, canvas positions, agent data, or smart-device instance configuration.

**Offline file** mode imports the same signed immutable snapshot used by connected installations without making outbound requests. **Connected** mode checks only the fixed official registry endpoint and atomically retains the previous catalog if a checksum, signature, schema, expiry, or size check fails. Catalog imports create independent local inventory records linked by numeric IDs to the verified template revision; newer definitions are reviewed before application, and local-only properties remain unchanged.

Automatic catalog contributions are a separate explicit opt-in available only in Connected mode. The Bun backend allowlists reusable hardware fields, removes instance-owned data, checks the signed published/pending/suppressed digest index locally, and delivers bounded signed batches asynchronously. Inventory saves never wait for registry delivery. The settings view shows queued, retrying, delivered, accepted, rejected, and suppressed totals and provides pause, enrollment revocation, and installation-key rotation controls.

Before delivery, eligible inventory is projected by hardware category and grouped by normalized product identity. Case, whitespace, manufacturer aliases, and private display names do not create duplicate candidates. Identical physical copies remain separate inventory records but produce one contribution candidate, while different board variants and RAM speeds remain distinct. Unidentified generic storage and ambiguous records are withheld locally. Exact matches to a published catalog definition link every matching local copy without asking the user to merge physical inventory.

Each deployment keeps a random stable UUID in `/data/registry/installation-instance.json` beside its Ed25519 private key and short-lived contribution credentials. All three files are backend-only mode-`0600` enrollment state. The UUID is not derived from the host or inventory, key rotation preserves the same logical installation, and lost keys require registry-owner approval before contributions resume. Private keys and tokens are never stored in `registry.json`, returned to the browser, or included in catalog searches. The registry intake quarantines submissions behind deterministic validation and rate limits; intake does not invoke an AI model synchronously and no contribution is published without the registry moderation workflow.

## Docker Tags And Release Channels

- `mriverodorta/homelab-inventory:stable` is built from the `stable` branch. Use this for regular homelab deployments and Watchtower.
- `mriverodorta/homelab-inventory:latest` is built from the `main` branch. It is the newest development image and can be unstable.
- `mriverodorta/homelab-inventory:<X.Y.Z>` is an immutable stable release image for pinned deployments.
- `mriverodorta/homelab-inventory:<X.Y>` follows the newest stable patch in that minor series.

Recommended Compose image:

```yaml
image: mriverodorta/homelab-inventory:stable
```

CI/CD uses GitHub as the source of truth:

- Pull requests validate lint, tests, and production build.
- Merges to `main` publish the `latest` Docker image.
- A new package version merged to `stable` publishes `stable`, immutable `X.Y.Z`, and the moving `X.Y` series alias.
- Stable promotion creates the matching `vX.Y.Z` Git tag and GitHub Release only after both Docker architectures are verified.
- Existing numbered Docker images are never overwritten; historical restoration uses a guarded manual backfill workflow.

Release process details: [docs/RELEASES.md](docs/RELEASES.md)

Before upgrading a Docker deployment across schema versions, back up the complete mounted `/data` directory. Schema migrations create an internal backup before changing data, but that does not replace an external copy or filesystem snapshot.

Schema 16 converts legacy RAM kits into one inventory record and one assignment per physical stick. It preserves original slot positions and total capacity, refuses ambiguous conversions, and records a safe migration summary. See [docs/MIGRATIONS.md](docs/MIGRATIONS.md) before upgrading across this schema.

## Update Notifications

Homelab Inventory checks Docker Hub at startup and every six hours for a newer image on `UPDATE_CHANNEL`. The default is `stable`; use `latest` only when you intentionally follow the fast-moving main channel.

The backend makes an anonymous, read-only request for `mriverodorta/homelab-inventory` metadata. It does not send inventory data, IP addresses, credentials, or an installation identifier. Set `UPDATE_CHECK_ENABLED=false` for an offline installation.

When an update is available, the canvas toolbar shows an update notice with release highlights, a manual **Check now** action, copyable `docker compose pull` / `docker compose up -d` commands, and **Skip this version**. Skipping suppresses only that exact version; a later version is shown automatically. Watchtower users can continue using their existing automatic-update workflow.

## Agent

From a selected server in the inspector, use `Setup Agent` to generate a scoped install command. The command includes the selected server id, endpoint, and a one-time enrollment token. The installed Linux agent stores a device token locally and can only update that specific server.

The agent is optional. Inventory, canvas layout, and cabling work without it.

## Security

Built-in multi-user authentication can protect the UI and browser API, but it is optional on upgraded installations and does not terminate TLS. Keep the app behind a trusted network boundary, VPN, or HTTPS reverse proxy. Machine agent registration and heartbeat endpoints retain their separate scoped-token authentication.

Read [SECURITY.md](SECURITY.md) before deploying outside localhost.

## Contributing

Issues and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).
