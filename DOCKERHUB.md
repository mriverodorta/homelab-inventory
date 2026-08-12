# Homelab Inventory

Homelab Inventory is a self-hosted visual workbench for documenting, assembling, validating, and monitoring homelab hardware. It gives you a practical map of what you own, what is installed in each machine, how network, display, and power paths are connected, and whether monitored hosts are healthy.

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

## Features

- **Visual inventory:** Arrange servers, NAS devices, PC builds, switches, patch panels, monitors, UPS systems, and power strips on an infinite canvas.
- **Projects and workspaces:** Keep multiple lab plans in one installation with a fixed Systems view, reorderable Canvas tabs, per-project defaults, and browser-local last-active restoration.
- **Reusable inventory:** Keep equipment project-bound, add selected global records to other projects, or make clean independent cross-project copies.
- **Component assignments:** Build hosts from reusable CPUs, motherboards, RAM, storage, GPUs, network cards, cooling, cases, power supplies, and OEM adapters.
- **Physical cabling:** Connect individual network, display, and power endpoints with inspectable color-coded cable routes.
- **Compatibility and audit:** Block known-invalid CPU, memory, storage, and expansion assignments, including physical RAM form factor, electrical module type, ECC, and slot limits.
- **Hardware catalog:** Search a signed verified catalog locally, import exact physical RAM by manufacturer part number, review linked updates, use an offline snapshot, or keep reusable private templates.
- **Host Agent:** Monitor Linux, FreeBSD, and OPNsense health, uptime, CPU, memory, local storage, services, and opt-in Docker or Podman containers.
- **Notifications:** Send opt-in host and selected resource alerts through reusable Ntfy or webhook destinations, with persisted incidents, quiet hours, reminders, and bounded retries.
- **Hardware discovery:** Run a reviewed one-time scan and apply detected component values field by field without automatic inventory changes.
- **Multi-user access:** Enable local passwords, OpenID Connect, or both with invitations, sessions, built-in roles, and custom permissions.
- **Backup and restore:** Export complete or selected sections, schedule encrypted backups, and restore with dependency checks and automatic rollback.
- **Safe upgrades:** Keep data in `/data`, use ordered startup migrations, follow `stable` or `latest`, or pin an immutable version tag.

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

The app has four main parts:

- **Projects**: independent lab plans selected from the header, each with its own workspaces, compatibility policy, topology, and inventory memberships.
- **Inventory**: project-bound hardware plus explicitly reusable global records.
- **Workspaces**: a fixed Systems view and one or more reorderable Canvas tabs where equipment is placed, assigned, connected, moved, and inspected.
- **SQLite persistence**: independent core, telemetry, and local catalog databases under `/data`, kept separate from the container image.

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

Each deployment keeps a random stable UUID, Ed25519 signing key, and short-lived credentials as mode-`0600` backend files under `/data/registry`. The UUID is not derived from the host or inventory. Authenticated key rotation preserves the logical installation, while a missing key stops delivery until registry-owner recovery approval. Private keys and tokens are never returned to the browser.

Connected enrolled installations send a signed catalog-adoption check-in at startup, after catalog activation, and every six hours. It contains only the application version, active catalog revision, and request timestamp. It never contains inventory, topology, labels, addresses, hardware identifiers, Agent data, or host identity, and failure does not block the app.

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
AGENT_TELEMETRY_RETENTION_DAYS=7
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
  databases/
    homelab-inventory.sqlite
    telemetry.sqlite
    catalog.sqlite
    persistence-engine.json
  backups/
  auth/
  registry/
    installation-instance.json
    installation-ed25519.pem
    installation-credentials.json
  stores/                       # retained legacy migration sources
```

Only one app container should write to the same mounted `/data` directory.

Existing JSON installations migrate automatically on first startup after a verified complete backup. The original JSON files remain unchanged but stop being active stores after SQLite activation. Review the [SQLite migration guide](https://github.com/mriverodorta/homelab-inventory/blob/main/docs/SQLITE_MIGRATION.md) before upgrading.

## Backup And Restore

**Settings > Backup & Restore** creates portable `.hlibackup` archives. Use a complete backup for every portable section or select only inventory, project topology, registry configuration and enrollment, catalog state, agents, telemetry, application metadata, or the disposable cable-routing cache. Agent telemetry includes the retained SQLite sample and service/container/storage-health history. Restore can replace the complete backup or only selected sections from it.

Every restore performs bounded archive and checksum validation, a dependency-aware preflight, a complete pre-restore recovery backup, maintenance mode, and a journaled atomic replacement. Failed or interrupted restores roll back automatically. Registry-enrollment backups carry the stable installation UUID, signing key, and credentials as one validated set. Archives containing registry enrollment or agent credentials require a passphrase before download and use scrypt with AES-256-GCM when encrypted.

SQLite deployments export format 2 logical archives with independent core, telemetry, and catalog schema versions. Supported format 1 archives remain importable, and uploaded SQLite files are never copied directly over the active database.

Daily or weekly complete backups support a configurable time, weekday, timezone, and retention count. Docker `TZ` takes precedence over the UI timezone. Set `BACKUP_ENCRYPTION_PASSPHRASE` to at least 12 characters to encrypt scheduled stored backups. It is required for scheduled backups once owner-authentication material exists. Authentication is omitted from custom archives by default and can be exported only with archive encryption. Keep encryption passphrases outside the app.

Backup history is never archived recursively. Migration and pre-restore recovery backups are listed separately. Public demo sessions are export-only and cannot access credentials, server-side backup storage, schedules, uploads, or restore.

## Updates And Schema Migrations

The image is intended to work well with Watchtower:

- Use `mriverodorta/homelab-inventory:stable` for regular automatic updates from the stable branch.
- Use `mriverodorta/homelab-inventory:latest` for the newest image from `main`. This channel can be unstable.
- Use an immutable version such as `mriverodorta/homelab-inventory:0.1.20` to pin a specific release.
- Use a minor alias such as `mriverodorta/homelab-inventory:0.1` to follow the newest stable patch in that series.

New package versions promoted through `stable` publish `stable`, immutable `X.Y.Z`, and moving `X.Y` tags. The matching Git tag and GitHub Release are created only after the multi-platform image is verified. Existing numbered images are never overwritten.

The app tracks independent core, telemetry, and catalog schema versions in SQLite. Checksummed migrations run on startup and create verified backups before modifying data.

Ordered startup migrations cover compatibility profiles, physical RAM records, stable registry identity, typed Agent relationships, and current motherboard topology. They create verified backups and preserve inventory relationships before changing persisted data. Review the full [migration guide](https://github.com/mriverodorta/homelab-inventory/blob/main/docs/MIGRATIONS.md) before upgrading across multiple schema versions.

Back up the complete mounted `/data` directory before upgrading across schema versions. The automatic migration backup is useful for recovery, but it should not be the only copy of operational inventory data.

### Update notifications

Homelab Inventory checks Docker Hub at startup and every six hours for a newer image on `UPDATE_CHANNEL`. The default is `stable`; set it to `latest` only when you intentionally follow the newest main-channel image.

The backend sends an anonymous, read-only metadata request only for `mriverodorta/homelab-inventory`. It does not send inventory data, IP addresses, credentials, or an installation identifier. Set `UPDATE_CHECK_ENABLED=false` for an offline installation.

When an update exists, the app provides **Check now**, **Skip this version**, and copyable Docker Compose update commands. Skipping applies only to the displayed version. Watchtower remains supported for automatic updates.

## Agent

The Agent tab on a server, NAS device, or custom PC build creates a one-time enrollment and generates the appropriate Linux or FreeBSD/OPNsense install command. Every application image embeds pinned, checksummed binaries for Linux AMD64, Linux ARM64, and FreeBSD AMD64. Downloads are served by your own Homelab Inventory instance, and each Ed25519 device identity is permanently scoped to one host record.

Signed one-minute telemetry is outbound-only and stored independently in `/data/databases/telemetry.sqlite`, so it does not modify inventory, canvas history, assignments, or cables. Agent views can show health and heartbeat history, OS version, uptime, CPU, memory, local storage and mounts, filtered services, and opt-in Docker or Podman container details. Container telemetry supports a credential-free loopback proxy or reviewed direct-socket access and excludes secrets, commands, environment variables, mounts, addresses, and raw inspect payloads.

Complete hardware discovery is a separate reviewed `sudo homelab-inventory-agent inventory` command. Detected data remains private and is offered as individual inventory-field suggestions rather than changing records automatically. Updates are explicit and verified, and unlinking retains telemetry unless the administrator selects the separate deletion option.

Agent source is available for inspection at [github.com/mriverodorta/homelab-inventory-agent](https://github.com/mriverodorta/homelab-inventory-agent). The Agent is optional; inventory, compatibility, canvas layout, and cabling work without it.

## Notifications

Opt-in Agent notifications support reusable Ntfy and generic webhook destinations for host outages and selected service, container, and physical-storage health changes. Workspace rules provide severity, debounce, per-resource cooldown, optional reminders, quiet hours, and bounded retries; per-host Agent settings provide inheritance, custom resource selection, temporary mute, or disablement. Replay-safe evaluation, host-outage inhibition, recipient-specific recovery, and active/historical incidents are handled by the persisted server-side state machine and toolbar Notification Center.

Contact credentials and generic webhook destination URLs are encrypted at rest with a local mode-`0600` key and remain redacted from APIs and logs. Public demo sessions cannot create notification credentials or deliver alerts. Notification state and secrets participate in dependency-aware encrypted backups.

## Notes

- Local development can use fictional seeded sample data.
- Production Docker starts empty.
- Keep `/data` backed up if the inventory becomes important to your lab operations.
