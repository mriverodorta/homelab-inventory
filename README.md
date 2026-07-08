# Homelab Inventory

[![Docker Pulls](https://img.shields.io/docker/pulls/mriverodorta/homelab-inventory?logo=docker)](https://hub.docker.com/r/mriverodorta/homelab-inventory)
[![Docker Image Version](https://img.shields.io/docker/v/mriverodorta/homelab-inventory?sort=semver&logo=docker)](https://hub.docker.com/r/mriverodorta/homelab-inventory/tags)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Homelab Inventory is a self-hosted visual workbench for documenting homelab hardware, component assignments, ports, patch panels, and cabling.

It is built for people who want a practical map of what they own, what is installed where, and how network or display ports are connected.

> [!WARNING]
> Do not expose Homelab Inventory directly to the public internet. It is currently intended for a trusted LAN, VPN, or reverse proxy that provides authentication and TLS. Built-in authentication is planned and coming soon.

## Features

- Infinite canvas for servers, NAS devices, switches, patch panels, and cables.
- Searchable inventory sidebar with in-app item creation.
- Drag components into compatible hosts: CPU, RAM, storage, GPU, and network cards.
- Individual port chips for servers, expansion cards, NAS devices, switches, and patch panels.
- Color-coded cable routing for network and display connections.
- JSON database stored outside the app image under a persistent `/data` volume.
- lowdb-backed split stores with schema migrations and automatic backups.
- Optional Linux agent enrollment per server for keepalive and hardware telemetry.
- Mobile-friendly inventory drawer and long-press drag behavior for touch devices.

## AI Development Notice

This project is being actively built with AI-assisted development. It is usable, but should be treated as an evolving homelab tool rather than a finished enterprise CMDB. Keep your `/data` directory backed up, review release notes before major upgrades, and report issues when behavior does not match your environment.

## Quick Start With Docker

Create a Compose file:

```yaml
services:
  homelab-inventory:
    image: mriverodorta/homelab-inventory:latest
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
```

Production starts empty. Create inventory items from the web interface, or copy an existing `/data` directory into the mounted volume.

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
  backups/
```

Only one app container should write to a mounted data directory.

More data details: [docs/DATA.md](docs/DATA.md)

## Docker Tags

- `mriverodorta/homelab-inventory:latest` tracks the newest published image and is suitable for Watchtower.
- `mriverodorta/homelab-inventory:<semver>` pins a specific release.

The local `build.sh` helper publishes both tags.

```bash
./build.sh
./build.sh --ver 0.2.0
```

## Agent

From a selected server in the inspector, use `Setup Agent` to generate a scoped install command. The command includes the selected server id, endpoint, and a one-time enrollment token. The installed Linux agent stores a device token locally and can only update that specific server.

The agent is optional. Inventory, canvas layout, and cabling work without it.

## Security

Homelab Inventory currently has no built-in user authentication. Keep it behind a trusted network boundary or reverse proxy.

Read [SECURITY.md](SECURITY.md) before deploying outside localhost.

## Contributing

Issues and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).
