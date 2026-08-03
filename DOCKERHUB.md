# Homelab Inventory

Homelab Inventory is a self-hosted visual workbench for documenting homelab hardware. It is meant for people who want a practical map of what they own, what is installed where, and how network/display ports are connected.

You can model servers, NAS devices, free-form PC builds, monitors, UPS systems, power strips, components, physical ports, and network, display, or power cables on an infinite canvas.

## Project Links

- Official website: https://homelabinventory.com/
- Live demo: https://demo.homelabinventory.com/
- Source code: https://github.com/mriverodorta/homelab-inventory
- Container image: https://hub.docker.com/r/mriverodorta/homelab-inventory

## Source Code

The public source repository is available on GitHub:

https://github.com/mriverodorta/homelab-inventory

GitHub is the source of truth for CI/CD. Docker Hub images are built and published by GitHub Actions from the `main` and `stable` branches, with numbered releases created during stable promotion.

## Security Notice

Do not expose Homelab Inventory directly to the public internet.

The app includes optional multi-user authentication using local passwords, OpenID Connect, or both. It supports invitations, built-in and custom global roles, and server-enforced permissions. Upgraded installations remain open until the owner opts in, and built-in authentication does not provide TLS. Anyone who can reach an installation with authentication disabled can view and change inventory data.

Recommended deployment:

- Put it behind Tailscale, WireGuard, a private LAN, or a TLS reverse proxy. Use built-in authentication or proxy authentication for access control.
- Terminate HTTPS/TLS at the reverse proxy if accessing it outside localhost.
- Keep the `/data` directory private and backed up.

## AI Development Disclaimer

This project is being actively built with AI-assisted development. The app is usable, but it should be treated as an evolving homelab tool rather than a finished enterprise CMDB. Review backups before major upgrades, keep the `/data` directory persistent, and report issues when behavior does not match your environment.

## What It Is For

Homelab Inventory helps answer questions like:

- Which components are installed in each server, NAS, or custom PC build?
- Which RAM, storage, GPU, or NIC is still unassigned?
- Which switch or patch panel port is connected to which device?
- Which equipment is on the canvas and how is it wired?
- Which UPS or power-strip outlet supplies each powered device?
- Which servers have an enrolled telemetry agent?

It is designed for local/home infrastructure documentation, planning, rebuilds, and hardware swaps.

## How It Works

The app has three main parts:

- **Inventory**: hardware records such as servers, NAS devices, custom PC builds, reusable components, monitors, UPS systems, power strips, switches, and patch panels.
- **Canvas**: a visual workspace where inventory items are placed, assigned, connected, moved, and inspected.
- **JSON database**: lowdb-backed JSON stores under `/data`, kept separate from the container image.

Inventory items can be created from the web interface. Once hardware exists in the inventory, you can place hosts and standalone equipment on the canvas, assemble custom PC builds from reusable components, and connect compatible network, display, and power endpoints directly.

The container serves the web app and writes changes asynchronously to the mounted data directory.

Add Hardware also supports reusable private templates and an optional verified hardware catalog. Connected catalog use and automatic sanitized contributions are explicit opt-ins; Disabled mode makes no catalog requests, and Offline file mode verifies a downloaded signed snapshot without outbound access.

## Hardware Compatibility

Homelab Inventory validates documented CPU, RAM, storage, GPU, and network-card requirements when components are assigned:

- **Compatible** assignments fit the known host capabilities and receive deterministic resource allocations.
- **Incompatible** assignments have a verified conflict and are blocked before project data changes.
- **Unknown** assignments are missing one or more compatibility fields and remain usable with a warning.

Compatibility inspector tabs explain requirements, host capabilities, and allocations. Audit highlights assigned hardware with incompatible or incomplete data. Existing assignments are preserved during schema migration, including legacy combinations that would be blocked if newly created or changed.

Compatibility fields are entered when inventory is created or edited. Users can also reuse private templates or import verified definitions from the optional official catalog. Catalog search always runs against the local index.

## Registry And Privacy

Eligible opt-in contributions are normalized by hardware category and deduplicated before delivery. Identical physical copies remain separate local inventory records but create one contribution candidate. Private display names, device properties, addresses, serials, notes, assignments, topology, agents, and smart-device instance configuration are excluded. Different board variants and RAM speeds remain separate products, while unidentified generic storage and ambiguous records are withheld locally.

Registry mode defaults to **Disabled**. **Offline file** mode verifies a signed immutable catalog without making outbound requests. **Connected** mode communicates only with the fixed official registry endpoint, keeps catalog search local, and retains the last-known-good catalog if verification fails. Automatic contributions require separate explicit consent and never block an inventory save.

## Normal Production

Use the `stable` image for regular homelab deployments:

```yaml
services:
  homelab-inventory:
    image: mriverodorta/homelab-inventory:stable
    container_name: homelab-inventory
    ports:
      - "8798:8798"
    volumes:
      - /data/stack/homelab-inventory/data:/data
    restart: unless-stopped
```

The container runs as a non-root user. If you bind-mount a host directory, make sure the container can write to it:

```bash
sudo mkdir -p /data/stack/homelab-inventory/data
sudo chown -R 10001:10001 /data/stack/homelab-inventory/data
```

Open:

```txt
http://<server-ip>:8798
```

Production starts empty. Create inventory items from the web interface, or copy an existing `/data` directory into the mounted volume.

## Data Storage

The image defaults are:

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

You normally do not need to set those environment variables in Compose. A fresh production data directory requires one-time owner setup. Configure a bootstrap code or retrieve the generated code with `docker compose logs homelab-inventory`. Existing upgraded installations keep authentication disabled until it is enabled in Settings.

Local login uses Argon2id password hashing. OIDC uses Authorization Code flow with PKCE and the callback `https://your-inventory.example/api/auth/oidc/callback`. After owner setup, **Settings > Access** manages local or OIDC invitations, users, built-in roles, and custom permission sets. Matching emails are linked only through an explicit authenticated flow. `*_FILE` secrets take precedence over inline environment values and become read-only in the UI. If the original owner is locked out, stop the service and run `docker compose run --rm homelab-inventory bun run auth:reset-owner` before starting it again.

When running behind a reverse proxy, set `TRUST_PROXY` to the exact proxy hop count or trusted proxy range so rate limits use the correct client address. Do not set it to `true`.

Production starts with empty inventory data. Create items from the web interface, or copy an existing `/data` directory into the mounted volume.

The Docker image does not include sample inventory data. Local source checkouts include a fictional seed under `server/seed` for development and testing only.

The data layout is:

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
```

Only one app container should write to the same mounted `/data` directory.

## Backup And Restore

**Settings > Backup & Restore** creates portable `.hlibackup` archives. Use a complete backup for every portable section or select only inventory, project topology, registry configuration and enrollment, catalog state, agents, telemetry, application metadata, or the disposable cable-routing cache. Restore can replace the complete backup or only selected sections from it.

Every restore performs bounded archive and checksum validation, a dependency-aware preflight, a complete pre-restore recovery backup, maintenance mode, and a journaled atomic replacement. Failed or interrupted restores roll back automatically. Archives containing registry enrollment or agent credentials require a passphrase before download and use scrypt with AES-256-GCM when encrypted.

Daily or weekly complete backups support a configurable time, weekday, timezone, and retention count. Docker `TZ` takes precedence over the UI timezone. Set `BACKUP_ENCRYPTION_PASSPHRASE` to at least 12 characters to encrypt scheduled stored backups. It is required for scheduled backups once owner-authentication material exists. Authentication is omitted from custom archives by default and can be exported only with archive encryption. Keep encryption passphrases outside the app.

Backup history is never archived recursively. Migration and pre-restore recovery backups are listed separately. Public demo sessions are export-only and cannot access credentials, server-side backup storage, schedules, uploads, or restore.

## Updates And Schema Migrations

The image is intended to work well with Watchtower:

- Use `mriverodorta/homelab-inventory:stable` for regular automatic updates from the stable branch.
- Use `mriverodorta/homelab-inventory:latest` for the newest image from `main`. This channel can be unstable.
- Use an immutable version such as `mriverodorta/homelab-inventory:0.1.20` to pin a specific release.
- Use a minor alias such as `mriverodorta/homelab-inventory:0.1` to follow the newest stable patch in that series.

New package versions promoted through `stable` publish `stable`, immutable `X.Y.Z`, and moving `X.Y` tags. The matching Git tag and GitHub Release are created only after the multi-platform image is verified. Existing numbered images are never overwritten.

The app tracks a database schema version in `/data/meta.json`. When schema changes are introduced, migrations run on startup and create backups before modifying data.

Schema 7 normalizes hardware compatibility profiles and calculates deterministic allocations for compatible existing assignments. It preserves all existing assignments and reports incomplete or incompatible legacy data through inspectors and Audit rather than removing hardware.

Schema 16 converts legacy RAM kits into one inventory record and assignment per physical stick. The migration preserves slot positions and total capacity, clears obsolete RAM catalog links, refuses ambiguous conversions, and records a safe migration summary. Review the full [migration guide](https://github.com/mriverodorta/homelab-inventory/blob/main/docs/MIGRATIONS.md) before upgrading across this schema.

Back up the complete mounted `/data` directory before upgrading across schema versions. The automatic migration backup is useful for recovery, but it should not be the only copy of operational inventory data.

### Update notifications

Homelab Inventory checks Docker Hub at startup and every six hours for a newer image on `UPDATE_CHANNEL`. The default is `stable`; set it to `latest` only when you intentionally follow the newest main-channel image.

The backend sends an anonymous, read-only metadata request only for `mriverodorta/homelab-inventory`. It does not send inventory data, IP addresses, credentials, or an installation identifier. Set `UPDATE_CHECK_ENABLED=false` for an offline installation.

When an update exists, the app provides **Check now**, **Skip this version**, and copyable Docker Compose update commands. Skipping applies only to the displayed version. Watchtower remains supported for automatic updates.

## Agent

A selected server can generate a scoped Linux agent install command. The command includes the selected server id, the app endpoint, and a one-time token. The agent can report keepalive status and host telemetry for that specific server.

The agent is optional. The inventory and canvas work without installing it.

## Notes

- Local development can use fictional seeded sample data.
- Production Docker starts empty.
- Keep `/data` backed up if the inventory becomes important to your lab operations.
