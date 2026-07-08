# Docker Deployment

Homelab Inventory is designed to run as a single container with a persistent data volume.

## Compose

```yaml
services:
  homelab-inventory:
    image: mriverodorta/homelab-inventory:latest
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
```

You only need environment variables when overriding defaults.

## Data Directory Permissions

The container runs as uid/gid `10001`.

```bash
sudo mkdir -p /data/stack/homelab-inventory/data
sudo chown -R 10001:10001 /data/stack/homelab-inventory/data
```

## First Start

Production Docker starts with empty stores when `/data` is empty. It does not include personal data or sample inventory in the image.

To migrate an existing local project:

```bash
rsync -av ./data/ user@server:/data/stack/homelab-inventory/data/
```

Then start the container.

## Watchtower

Use `latest` when you want automatic updates:

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

Use a semver tag when you want to lock the version:

```yaml
image: mriverodorta/homelab-inventory:0.1.9
```

## Reverse Proxy

Do not expose this app directly to the public internet. Place it behind a trusted LAN, VPN, or a reverse proxy with authentication and TLS.

Example headers to add at the proxy layer:

- `Strict-Transport-Security`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- `Permissions-Policy` with only the browser features you need

The app also uses Helmet server-side, but a reverse proxy should still own TLS and external access control.
