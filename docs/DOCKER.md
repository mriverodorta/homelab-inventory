# Docker Deployment

Homelab Inventory is designed to run as a single container with a persistent data volume.

## Normal Production Compose

```yaml
services:
  homelab-inventory:
    image: mriverodorta/homelab-inventory:stable
    container_name: homelab-inventory
    restart: unless-stopped
    ports:
      - "8798:8798"
    volumes:
      - /data/stack/homelab-inventory/data:/data
```

The image already sets these defaults:

```txt
NODE_ENV=production
PORT=8798
DATA_DIR=/data
SAVE_DEBOUNCE_MS=500
APP_MODE=production
```

You only need environment variables when overriding defaults.

## Public Demo Sandbox Mode

Public demo mode is intended for a disposable internet-facing sandbox, not for your real homelab data. Do not expose regular production directly to the internet; keep it behind a trusted LAN, VPN, or reverse proxy with authentication and TLS. Built-in authentication is planned and coming soon.

Run the demo as a separate stack from production:

```yaml
services:
  homelab-inventory-demo:
    image: mriverodorta/homelab-inventory:latest
    container_name: homelab-inventory-demo
    restart: unless-stopped
    ports:
      - "8799:8798"
    volumes:
      - /data/stack/homelab-inventory-demo/data:/data
      - /data/stack/homelab-inventory-demo/source:/read-only-data:ro
    environment:
      - APP_MODE=demo
      - NODE_ENV=production
```

The host port is `8799`; the app still listens on container port `8798`.

The writable `/data` mount stores per-browser demo sandboxes under the demo container. The `/read-only-data` mount must exist before startup and must contain:

```txt
/read-only-data
  meta.json
  stores/
    inventory.json
    project.json
```

Demo mode copies and sanitizes only the inventory, project, and metadata stores into each sandbox. It does not copy source agent enrollment data, agent status, or backups. Demo visitors are tracked with browser cookie sessions, and each writable sandbox expires after 30 minutes.

## Data Directory Permissions

The container runs as uid/gid `10001`.

```bash
sudo mkdir -p /data/stack/homelab-inventory/data
sudo chown -R 10001:10001 /data/stack/homelab-inventory/data
```

For demo mode, make the writable data directory writable by uid/gid `10001`. The source directory can be read-only, but the container must be able to read it.

## First Start

Production Docker starts with empty stores when `/data` is empty. It does not include personal data or sample inventory in the image.

To migrate an existing local project:

```bash
rsync -av ./data/ user@server:/data/stack/homelab-inventory/data/
```

Then start the container.

## Watchtower

Use `stable` when you want automatic updates from the stable release channel:

```yaml
services:
  watchtower:
    image: containrrr/watchtower
    container_name: watchtower
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    command: --interval 300 --cleanup homelab-inventory
```

Use `latest` only when you want the newest development image from `main`:

```yaml
image: mriverodorta/homelab-inventory:latest
```

Use a semver tag when you want to lock the version:

```yaml
image: mriverodorta/homelab-inventory:0.1.9
```

## CI/CD Release Channels

GitHub is the source of truth for builds:

- Pull requests run lint, tests, and a production build.
- Pushes to `main` publish `mriverodorta/homelab-inventory:latest`.
- Pushes to `stable` publish `mriverodorta/homelab-inventory:stable`.
- Tags like `v0.2.0` publish `mriverodorta/homelab-inventory:0.2.0` and `mriverodorta/homelab-inventory:0.2`.

The Docker publish workflow requires this GitHub repository secret:

```txt
DOCKERHUB_TOKEN
```

The token should be a Docker Hub access token for `mriverodorta` with permission to push `mriverodorta/homelab-inventory`.

See [RELEASES.md](RELEASES.md) for the full release process.

## Reverse Proxy

Do not expose this app directly to the public internet. Place it behind a trusted LAN, VPN, or a reverse proxy with authentication and TLS.

Example headers to add at the proxy layer:

- `Strict-Transport-Security`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- `Permissions-Policy` with only the browser features you need

The app also uses Helmet server-side, but a reverse proxy should still own TLS and external access control.
