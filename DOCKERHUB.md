# Homelab Inventory

Homelab Inventory is a self-hosted visual workbench for documenting homelab hardware. It is meant for people who want a practical map of what they own, what is installed where, and how network/display ports are connected.

You can model servers, NAS devices, CPUs, RAM kits, storage, GPUs, network cards, switches, patch panels, physical ports, and cables on an infinite canvas.

Live demo: https://lab.hkloud.org/

## Source Code

The public source repository is available on GitHub:

https://github.com/mriverodorta/homelab-inventory

GitHub is the source of truth for CI/CD. Docker Hub images are built and published by GitHub Actions from the `main` and `stable` branches, with numbered releases created during stable promotion.

## Security Notice

Do not expose Homelab Inventory directly to the public internet.

The app is currently designed for a trusted LAN, VPN, or a reverse proxy that provides authentication and TLS. Built-in user authentication is not available yet; it is planned and coming soon. Until then, anyone who can reach the web UI can view and change inventory data.

Recommended deployment:

- Put it behind Tailscale, WireGuard, a private LAN, or a reverse proxy with auth.
- Terminate HTTPS/TLS at the reverse proxy if accessing it outside localhost.
- Keep the `/data` directory private and backed up.

## AI Development Disclaimer

This project is being actively built with AI-assisted development. The app is usable, but it should be treated as an evolving homelab tool rather than a finished enterprise CMDB. Review backups before major upgrades, keep the `/data` directory persistent, and report issues when behavior does not match your environment.

## What It Is For

Homelab Inventory helps answer questions like:

- Which components are installed in each server or NAS?
- Which RAM, storage, GPU, or NIC is still unassigned?
- Which switch or patch panel port is connected to which device?
- Which equipment is on the canvas and how is it wired?
- Which servers have an enrolled telemetry agent?

It is designed for local/home infrastructure documentation, planning, rebuilds, and hardware swaps.

## How It Works

The app has three main parts:

- **Inventory**: hardware records such as servers, CPUs, RAM, storage, NICs, GPUs, NAS devices, switches, and patch panels.
- **Canvas**: a visual workspace where inventory items are placed, assigned, connected, moved, and inspected.
- **JSON database**: lowdb-backed JSON stores under `/data`, kept separate from the container image.

Inventory items can be created from the web interface. Once hardware exists in the inventory, you can drag servers, NAS devices, switches, and patch panels onto the canvas. Components such as CPU, RAM, storage, GPU, and network cards can be assigned to compatible hosts. Ports can be connected with color-coded cables.

The container serves the web app and writes changes asynchronously to the mounted data directory.

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
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=600
TRUST_PROXY=false
```

You normally do not need to set those environment variables in Compose.

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
  backups/
```

Only one app container should write to the same mounted `/data` directory.

## Updates And Schema Migrations

The image is intended to work well with Watchtower:

- Use `mriverodorta/homelab-inventory:stable` for regular automatic updates from the stable branch.
- Use `mriverodorta/homelab-inventory:latest` for the newest image from `main`. This channel can be unstable.
- Use an immutable version such as `mriverodorta/homelab-inventory:0.1.20` to pin a specific release.
- Use a minor alias such as `mriverodorta/homelab-inventory:0.1` to follow the newest stable patch in that series.

New package versions promoted through `stable` publish `stable`, immutable `X.Y.Z`, and moving `X.Y` tags. The matching Git tag and GitHub Release are created only after the multi-platform image is verified. Existing numbered images are never overwritten.

The app tracks a database schema version in `/data/meta.json`. When schema changes are introduced, migrations run on startup and create backups before modifying data.

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
