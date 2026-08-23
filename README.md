# Homelab Inventory

[![Docker Pulls](https://img.shields.io/docker/pulls/mriverodorta/homelab-inventory?logo=docker)](https://hub.docker.com/r/mriverodorta/homelab-inventory)
[![Docker Image Version](https://img.shields.io/docker/v/mriverodorta/homelab-inventory?sort=semver&logo=docker)](https://hub.docker.com/r/mriverodorta/homelab-inventory/tags)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Homelab Inventory is a self-hosted visual workbench for documenting, assembling, validating, and monitoring homelab hardware.

It gives you one practical view of what you own, what is installed in each machine, how network, display, and power paths are connected, and whether monitored hosts are healthy.

## Project Links

- Official website: [homelabinventory.com](https://homelabinventory.com/)
- Live demo: [demo.homelabinventory.com](https://demo.homelabinventory.com/)
- Source code: [GitHub](https://github.com/mriverodorta/homelab-inventory)
- Container image: [Docker Hub](https://hub.docker.com/r/mriverodorta/homelab-inventory)

> [!WARNING]
> Do not expose Homelab Inventory directly to the public internet without HTTPS and access controls. Built-in multi-user authentication is available but optional on upgraded installations, and it does not provide TLS. Use a trusted LAN, VPN, or TLS reverse proxy.

## What You Can Do

### Document the physical lab

- Organize one installation into multiple projects, each with a fixed Systems view and one or more reorderable, named, color-coded Canvas workspaces.
- Place servers, NAS devices, custom PC builds, monitors, switches, patch panels, UPS systems, and power strips on an infinite canvas.
- Assemble hosts from reusable CPUs, motherboards, cooling, RAM, storage, GPUs, wired or radio Network Adapters, sound cards, cases, power supplies, and OEM power adapters.
- Connect individual network, display, and power endpoints with color-coded, orthogonally routed cables and inspect each connection from either endpoint.
- Use the searchable desktop or mobile inventory drawer to create, duplicate, archive, restore, and safely remove equipment.
- Keep equipment project-bound, expose selected records through the global inventory library, or create a clean independent copy in another project.

### Validate hardware before changing it

- Check CPU socket, generation, and power limits; memory generation, capacity, speed, ECC, physical DIMM or SO-DIMM fit, electrical module type, and slot allocation; storage bays and interfaces; and expansion-slot fit across PCIe, M.2, Mini PCIe, USB, OCP, mezzanine, onboard, and proprietary Network Adapter interfaces.
- See deterministic resource allocations, known incompatibilities, and incomplete-data warnings before an assignment changes project data.
- Review or ignore individual audit findings, or disable compatibility checks for a specific host when documenting an intentional exception.
- Import complete OEM systems and retail motherboards with their physical topology preserved instead of flattening them into generic machines.
- Define private typed custom fields and reusable colored tags for inventory, then search, filter, and build saved Systems views from that metadata without contributing it to the public Registry.

### Reuse trusted hardware definitions

- Search the optional signed hardware catalog locally by category and hardware-specific filters, then import independent inventory records linked to a verified template revision, including exact physical RAM sticks identified by manufacturer part number.
- Review catalog updates before applying them while preserving local names, assignments, canvas positions, cables, and instance-only fields.
- Keep an installation fully offline with a signed catalog snapshot, or use reusable private templates with checksummed JSON import and export.
- Optionally contribute sanitized, deduplicated hardware definitions without sending serials, addresses, labels, assignments, topology, or agent evidence.

### Monitor compute hosts

- Use the dense Systems workspace to compare host type, identity, assigned CPU, memory, primary storage, Registry linkage, Agent status, and attention findings without opening every machine.
- Build account-synchronized saved views from dynamic host, Agent, Registry, tag, and custom-field filters, with useful local defaults when authentication is disabled.
- Enroll an outbound-only Agent on systemd Linux, Alpine/OpenRC, FreeBSD, or OPNsense hosts and view one-minute health, heartbeat history, CPU, memory, uptime, and operating-system details.
- Receive live Systems utilization and Inspector telemetry through one authenticated server-sent event stream after the initial compact snapshot, without recurring browser polling.
- Inspect local storage usage by physical device and mount point, including partition tables and LVM or RAID topology, without mixing in remote shares or container mounts.
- Discover locally installed services and opt into bounded Docker or Podman container telemetry through a loopback proxy or reviewed direct socket access.
- Run a separate reviewed hardware scan and apply detected motherboard, CPU, DIMM, storage, PCI, network, GPU, or power values one field at a time with normal Undo support.
- Update agents manually through verified commands, unlink an agent without losing history, or explicitly remove only that host's retained telemetry.
- Receive opt-in Ntfy or generic webhook alerts for host outages and selected service, container, or physical-storage changes, with quiet hours, reminders, retries, and persisted incident history.

### Operate and share it safely

- Enable local-password, OpenID Connect, or hybrid authentication with invitations, sessions, built-in roles, and custom permission groups.
- Publish explicitly selected Systems and Canvas views to lab.gd through a local privacy preview, with public or unlisted access, immutable or replaceable revisions, manual or debounced synchronization, expiration, embeds, and opt-in metadata.
- Create complete or section-based portable backups, restore selected sections with dependency checks and rollback, and schedule encrypted backups with configurable retention.
- Keep all application state outside the image in a persistent `/data` volume with ordered migrations and verified pre-migration backups.
- Follow `stable`, test `latest`, or pin an immutable version tag; in-app update checks remain optional and anonymous.

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
LABGD_ENABLED=true
LABGD_ORIGIN=https://lab.gd
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
  sharing/
    installation-instance.json
    installation-ed25519.pem
    installation-credentials.json
    public-id-key.json
  stores/                       # retained legacy migration sources
```

Only one app container should write to a mounted data directory.

Existing JSON installations migrate automatically on first startup after a verified complete backup. The original JSON files remain unchanged but stop being active stores after SQLite activation. See [docs/SQLITE_MIGRATION.md](docs/SQLITE_MIGRATION.md) for verification, backup compatibility, and rollback instructions.

`agents.json` may contain private hardware evidence from a user-confirmed one-time agent scan, including raw serials used for local matching. It is excluded from demo data, treated as sensitive in portable backups, and never enters public registry contributions.

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

If the original owner is locked out, stop the application before creating a recovery grant so only one process writes the SQLite databases:

```bash
docker compose stop homelab-inventory
docker compose run --rm homelab-inventory bun run auth:reset-owner
docker compose start homelab-inventory
```

The command prints a recovery URL valid for 15 minutes. Authentication data is excluded from custom backups by default and can be exported only in an encrypted archive. Complete backups include it. Once authentication data exists, scheduled backups require `BACKUP_ENCRYPTION_PASSPHRASE`.

## lab.gd Sharing

Production installations create a separate random sharing identity and enroll with [lab.gd](https://lab.gd) automatically after the local app is ready. Enrollment sends no inventory or project content and never publishes a share. Every share must be configured, rendered locally, reviewed through its exact privacy summary, and approved before publication.

Sharing is available in **Settings > Sharing**. Choose specific Systems or Canvas views, public or unlisted visibility, immutable or replaceable publication, manual or one-minute debounced synchronization, expiration, and exact HTTPS embed origins. Tags, custom fields, and a one-time Systems resource snapshot remain excluded unless selected explicitly. Serials, network identifiers, credentials, Agent identity, telemetry history, audit history, Registry enrollment, and private application identity never enter the share payload.

Set `LABGD_ENABLED=false` before first startup to prevent sharing identity creation, enrollment, and all lab.gd traffic. Turning the Settings connection off later retains the stable local identity so reconnecting does not create another installation. Demo and staging modes always disable enrollment and publication regardless of persisted settings. See [docs/sharing.md](docs/sharing.md) for identity, backup, permission, retry, and synchronization details.

## Backup And Restore

Open **Settings > Backup & Restore** to create a complete portable backup or choose individual sections such as inventory, project topology, registry state, sharing configuration and identity, agents, telemetry, catalog data, and the disposable cable-routing cache. A complete archive can later be restored in full or used to replace only selected sections.

Restore is replacement-only. Before changing live data, the app validates archive paths, sizes, checksums, schema compatibility, and section dependencies; creates a complete pre-restore recovery backup; enters maintenance mode; and records a durable restore journal. A failed or interrupted restore rolls back automatically. Connected browsers reload after a successful restore.

Portable archives use the `.hlibackup` format. Registry-enrollment backups include the stable installation UUID, signing key, and credentials as one validated set. Backups containing registry enrollment or agent credentials require a passphrase before download. Stored copies may also be encrypted with scrypt and AES-256-GCM. Keep that passphrase outside the app because it cannot be recovered.

SQLite deployments export format 2 logical archives with separate core, telemetry, and catalog schema versions, while supported format 1 archives remain importable. Restore stages selected logical sections in an isolated database and never replaces the active database with an untrusted uploaded SQLite file.

Daily or weekly complete backups can run at a configurable time with a configurable retention count. Set `TZ` in Docker Compose to make the deployment timezone authoritative, or choose an IANA timezone in Settings. Set `BACKUP_ENCRYPTION_PASSPHRASE` to at least 12 characters to encrypt scheduled stored backups. It is mandatory for scheduled backups once owner-authentication material exists.

User-managed backups live under `/data/backups/user` with private directory and file permissions. Backup history is never included recursively. Migration and pre-restore recovery backups remain separate from ordinary portable backups. Public demo sessions can download only their disposable inventory and project data and cannot schedule, upload, restore, or export credentials.

## Hardware Compatibility

Compatibility rules help prevent known-invalid assignments while keeping partially documented hardware usable:

- **Compatible** means the known component requirements fit the host and any required resource was allocated deterministically.
- **Incompatible** means a verified rule conflicts, such as a CPU socket mismatch, unsupported RAM generation, unavailable storage bay, or unsuitable expansion slot. New or changed assignments are blocked.
- **Unknown** means one or more required fields are not documented. The assignment remains available with an amber warning so incomplete inventory does not stop normal work.

Servers and NAS devices expose compatibility details in their inspectors. Component inspectors show requirements and the current host allocation, while Audit identifies assigned hardware that is incompatible or needs more data.

Compatibility fields are entered when an inventory item is created or edited. Private templates can reuse local definitions, while verified official definitions can be imported from a signed offline snapshot or synchronized in Connected mode. Ordered migrations preserve existing assignments and report legacy combinations that would be blocked if newly created or changed.

## Registry And Private Templates

Add Hardware supports three sources:

- **Catalog** searches a verified official snapshot through a disposable local SQLite index. Search terms never leave the installation.
- **Manual** keeps the complete local type-specific editor and remains available in every mode.
- **Private templates** store sanitized reusable hardware definitions in `/data` and support checksummed JSON import/export.

Registry mode defaults to **Disabled**, which makes no catalog requests. Private templates never include device properties, IP or MAC addresses, notes, assignments, connections, canvas positions, agent data, or smart-device instance configuration.

**Offline file** mode imports the same signed immutable snapshot used by connected installations without making outbound requests. **Connected** mode checks only the fixed official registry endpoint and atomically retains the previous catalog if a checksum, signature, schema, expiry, or size check fails. Catalog imports create independent local inventory records linked by numeric IDs to the verified template revision; newer definitions are reviewed before application, and local-only properties remain unchanged.

Linked-catalog updates are classified by their final non-destructive merge. Installations can keep manual review, automatically accept safe enrichments, or trust compatible Registry updates while retaining local names, private metadata, assignments, numeric resource identities, canvas placements, cables, and route cache. The review center lazy-loads field-level changes and keeps applied, declined, review-required, and blocked decisions visible.

Automatic catalog contributions are a separate explicit opt-in available only in Connected mode. The Bun backend allowlists reusable hardware fields, removes instance-owned data, checks the signed published/pending/suppressed digest index locally, and delivers bounded signed batches asynchronously. Inventory saves never wait for registry delivery. The settings view shows queued, retrying, delivered, accepted, rejected, and suppressed totals and provides pause, enrollment revocation, and installation-key rotation controls.

Before delivery, eligible inventory is projected by hardware category and grouped by normalized product identity. Case, whitespace, manufacturer aliases, and private display names do not create duplicate candidates. Identical physical copies remain separate inventory records but produce one contribution candidate, while different board variants and RAM speeds remain distinct. Unidentified generic storage and ambiguous records are withheld locally. Exact matches to a published catalog definition link every matching local copy without asking the user to merge physical inventory.

Each deployment keeps a random stable UUID in `/data/registry/installation-instance.json` beside its Ed25519 private key and short-lived contribution credentials. All three files are backend-only mode-`0600` enrollment state. The UUID is not derived from the host or inventory, key rotation preserves the same logical installation, and lost keys require registry-owner approval before contributions resume. Private keys and tokens are never stored in `registry.json`, returned to the browser, or included in catalog searches. The registry intake quarantines submissions behind deterministic validation and rate limits; intake does not invoke an AI model synchronously and no contribution is published without the registry moderation workflow.

An enrolled Connected installation also reports catalog adoption at startup, after catalog activation, and every six hours. This signed operational check-in contains only the application version, active catalog revision, and request timestamp. It never includes inventory, topology, labels, addresses, hardware identifiers, Agent data, or host identity, and a failed check-in does not block the application.

## Projects And Workspaces

The project switcher in the header selects the active project. Every project starts with a fixed **Systems** workspace and a **Canvas** workspace. Systems remains first and provides a structured compute-host view; Canvas workspaces retain the visual equipment, assignment, and cabling workbench. Additional Canvas workspaces can be renamed, assigned a curated icon and color, and reordered from the bottom workbook bar.

Systems uses a dense, resizable table with sortable columns, compact Agent and Registry state, animated CPU, segmented memory, and storage utilization, and a shared compatibility-attention count. Optional tag and typed custom-field columns can be shown per saved view. Metadata edits autosave, participate in application-wide Undo and Redo, and use an independent persistence revision so they do not rebuild the workspace engine or reroute unchanged cables.

Each project can choose its default workspace. An optional browser preference instead reopens the last workspace used in that project. Navigation uses project/workspace URLs, so refresh and browser history preserve the selected workbook context.

New projects include global inventory by default, but global records appear only after an explicit project membership is added. Project-bound records remain owned by one project. Promoting a record makes it reusable; duplicating it to another project creates a clean independent item and intentionally omits serials, Registry links, Agent identity, telemetry, assignments, Canvas placement, and cables.

## Docker Tags And Release Channels

- `mriverodorta/homelab-inventory:stable` is promoted from the `stable` branch after local production-shaped staging. Use this for regular homelab deployments and Watchtower.
- `mriverodorta/homelab-inventory:latest` is promoted from the `main` branch after local staging. It is the newest development image and can be unstable.
- `mriverodorta/homelab-inventory:<X.Y.Z>` is an immutable stable release image for pinned deployments.
- `mriverodorta/homelab-inventory:<X.Y>` follows the newest stable patch in that minor series.

Recommended Compose image:

```yaml
image: mriverodorta/homelab-inventory:stable
```

GitHub is the source of truth for source and CI; release construction is local and exact-artifact based:

- Pull requests validate lint, tests, and production build.
- Approved releases from `main` move the `latest` Docker image after ARM64 staging and two-platform vulnerability verification.
- Approved promotions from `stable` publish `stable`, immutable `X.Y.Z`, and the moving `X.Y` series alias.
- Docker Hub receives the exact ARM64 and AMD64 OCI manifests that passed local smoke and zero-vulnerability checks; publication does not rebuild them.
- Stable promotion creates the matching `vX.Y.Z` Git tag and GitHub Release only after both Docker architectures are verified.
- Existing numbered Docker images are never overwritten; historical restoration must use the same guarded local pipeline.

Release process details: [docs/RELEASES.md](docs/RELEASES.md)

Before upgrading a Docker deployment across schema versions, back up the complete mounted `/data` directory. Schema migrations create an internal backup before changing data, but that does not replace an external copy or filesystem snapshot.

The migration guide documents compatibility normalization, physical RAM records, registry identity, Agent relationships, and current motherboard-topology migrations. See [docs/MIGRATIONS.md](docs/MIGRATIONS.md) before upgrading across multiple schema versions.

## Update Notifications

Homelab Inventory checks Docker Hub at startup and every six hours for a newer image on `UPDATE_CHANNEL`. The default is `stable`; use `latest` only when you intentionally follow the fast-moving main channel.

The backend makes an anonymous, read-only request for `mriverodorta/homelab-inventory` metadata. It does not send inventory data, IP addresses, credentials, or an installation identifier. Set `UPDATE_CHECK_ENABLED=false` for an offline installation.

When an update is available, the canvas toolbar shows an update notice with release highlights, a manual **Check now** action, copyable `docker compose pull` / `docker compose up -d` commands, and **Skip this version**. Skipping suppresses only that exact version; a later version is shown automatically. Watchtower users can continue using their existing automatic-update workflow.

## Agent

The optional Homelab Inventory Agent uses outbound-only HTTPS and scopes one Ed25519 device identity to one server, NAS device, or custom PC build. Signed protocol-v1 heartbeats are stored independently in `/data/databases/telemetry.sqlite`; they do not create workspace history or advance the project revision. CPU and memory retain exactly 30 one-minute slots. Services, containers, filesystems, GPUs, sensors, system facts, load, uptime, and storage health are kept as current state, while meaningful lifecycle and health transitions remain available to notifications. Network and disk-I/O history are not retained.

Open a compute host's **Agent** tab to create a one-time enrollment and copy the generated Linux or FreeBSD/OPNsense installation command. The Linux installer detects systemd or OpenRC and supports Alpine Linux 3.22 without installing packages. Each application image embeds a pinned, reproducibly built release for Linux AMD64, Linux ARM64, and FreeBSD AMD64. The server verifies every embedded artifact before startup and serves immutable versioned downloads from your own installation.

An enrolled host can expose these capability-driven views:

- **Agent**: health state, 30-minute heartbeat history, operating-system version, host uptime, CPU and memory history, aggregate local-storage usage, enrollment details, and available updates.
- **Services**: locally installed or system services with independent scope and runtime-state filters.
- **Containers**: opt-in Docker or Podman state, health, uptime, Compose service, CPU, memory, published ports, and network metadata.
- **Storage usage**: physical-device and mount-level capacity, partition tables, filesystems, and LVM or RAID topology for confidently mapped inventory drives.

Container telemetry is disabled by default. Setup can use a credential-free Docker-compatible proxy bound to loopback or, after a clear warning, direct access to an allowlisted local runtime socket. The protocol excludes arbitrary labels, environment variables, commands, arguments, mounts, secrets, addresses, and raw inspect responses.

Updated agents hash capabilities, send only changed state between six-hour reconciliations, and receive acknowledgements only in responses to their own outbound requests. Existing full-heartbeat agents remain compatible and are compacted at the application boundary. Upgrading an existing installation automatically replaces legacy telemetry history with the bounded schema after integrity verification; no operator migration is required.

The normal Linux or FreeBSD service is unprivileged. Complete hardware discovery is a separate, explicit `sudo homelab-inventory-agent inventory` command that previews a component summary and asks before sending. The application keeps the latest evidence private, shows the complete JSON for troubleshooting, and offers individual field suggestions with replacement confirmation and Undo. Raw serials and hardware fingerprints never enter registry contributions.

Agent upgrades are always explicit. Older installations receive a one-time verified installer upgrade command; current releases use `sudo homelab-inventory-agent update`. Unlinking stops delivery and retains telemetry by default, with a separate unchecked option to delete only that host's history.

The independently maintained source is public at [mriverodorta/homelab-inventory-agent](https://github.com/mriverodorta/homelab-inventory-agent). The application pins an exact source revision, while normal users install the verified binary served by their own Homelab Inventory instance. Inventory, canvas layout, compatibility, and cabling continue to work without an Agent.

## Notifications

Notifications are an explicit opt-in workspace feature built on Agent telemetry. Configure reusable **Ntfy** or generic **Webhook** contact points under **Settings > Notifications**, then assign them to rules for host outages and selected service, container, or physical-storage health changes.

The server persists normalized states, debounce transitions, incidents, acknowledgements, per-resource cooldowns, reminders, delivery jobs, and redacted attempts. A host outage inhibits child-resource alerts, recovery is delivered only to destinations that received the opening alert, and failed HTTP delivery uses bounded backoff before appearing for manual retry in the toolbar **Notification Center**. Quiet hours and temporary host mutes suppress delivery without discarding incident history. Persisted sequence cursors reject replayed and stale buffered samples across restarts while accounting for stable agent clock offset.

Per-host controls live in the compute host's **Agent** tab. A host can inherit workspace rules, select specific reported resources with custom overrides, or disable notifications. Selected services ask the agent for one-minute service collection; hosts without selected services retain the normal ten-minute service cadence. The app shows the desired policy revision as pending until a later outbound agent heartbeat acknowledges that it was applied.

Contact credentials and generic webhook destination URLs are encrypted at rest under `/data/notifications` with a local key restricted to mode `0600`. Public APIs and logs redact these values, complete/custom backups enforce the key and encrypted store dependency, and demo sessions cannot create credentials or deliver notifications. Keep HTTPS and the normal trusted-network deployment boundary in place because webhook delivery leaves the application server.

## Security

Built-in multi-user authentication can protect the UI and browser API, but it is optional on upgraded installations and does not terminate TLS. Keep the app behind a trusted network boundary, VPN, or HTTPS reverse proxy. Machine agent registration and heartbeat endpoints retain their separate scoped-token authentication.

Read [SECURITY.md](SECURITY.md) before deploying outside localhost.

## Contributing

Issues and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).
