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
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=600
TRUST_PROXY=false
AUTH_BOOTSTRAP_CODE=
AUTH_BOOTSTRAP_CODE_FILE=
AUTH_EXTERNAL_URL=
OIDC_CLIENT_SECRET=
OIDC_CLIENT_SECRET_FILE=
```

You only need environment variables when overriding defaults.

When running behind a reverse proxy, set `TRUST_PROXY` to the exact proxy hop count or trusted proxy range so rate limits use the correct client address. Do not set it to `true`.

## Data Directory Permissions

The container runs as uid/gid `10001`.

```bash
sudo mkdir -p /data/stack/homelab-inventory/data
sudo chown -R 10001:10001 /data/stack/homelab-inventory/data
```

## First Start

Production Docker starts with empty stores when `/data` is empty. It does not include personal data or sample inventory in the image.

A fresh data directory requires one-time owner setup. Set `AUTH_BOOTSTRAP_CODE` or mount a Docker secret and set `AUTH_BOOTSTRAP_CODE_FILE`; otherwise the server generates a code and prints it once to the container log:

```bash
docker compose logs homelab-inventory
```

Installations upgraded from a release without built-in authentication remain open. Enable local, OIDC, or hybrid login later from **Settings > Authentication**.

To migrate an existing local project:

```bash
rsync -av ./data/ user@server:/data/stack/homelab-inventory/data/
```

Then start the container.

## Authentication And OIDC

Local owner credentials are stored only as Argon2id hashes. OIDC uses Authorization Code flow with PKCE and an exact issuer/subject binding. Configure the identity provider callback as:

```txt
https://inventory.example.com/api/auth/oidc/callback
```

Use `AUTH_EXTERNAL_URL=https://inventory.example.com` when the public URL is not configured through the UI. OIDC secrets entered in Settings are stored below `/data/auth` with mode `0600`. `OIDC_CLIENT_SECRET_FILE` takes precedence over `OIDC_CLIENT_SECRET`; either environment override locks the secret field in Settings.

To recover the only owner, stop the application before running the one-time recovery command:

```bash
docker compose stop homelab-inventory
docker compose run --rm homelab-inventory bun run auth:reset-owner
docker compose start homelab-inventory
```

The printed URL expires after 15 minutes. Configure `BACKUP_ENCRYPTION_PASSPHRASE` before combining authentication with scheduled backups.

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

Do not expose this app directly to the public internet without HTTPS and access controls. Built-in owner authentication is optional for upgraded installations and does not provide TLS. Place the app behind a trusted LAN, VPN, or TLS reverse proxy.

Example headers to add at the proxy layer:

- `Strict-Transport-Security`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- `Permissions-Policy` with only the browser features you need

The app also uses Helmet server-side, but a reverse proxy should still own TLS and external access control.
