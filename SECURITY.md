# Security Policy

## Supported Versions

Security fixes target the latest Docker image and the newest semver tag.

## Deployment Warning

Do not expose Homelab Inventory directly to the public internet.

The app supports optional single-owner authentication with a local password, OpenID Connect, or both. Existing upgraded installations keep authentication disabled until the owner opts in. Built-in authentication does not provide TLS and is not a substitute for a trusted LAN, VPN, or HTTPS reverse proxy.

## Sensitive Data

The `/data` directory can contain private infrastructure details, including IP addresses, device names, serial numbers, service lists, and agent credentials.

Never commit or publish a real `/data` directory.

## Recommended Controls

- Enable built-in owner authentication or enforce authentication at the reverse proxy.
- Run behind Tailscale, WireGuard, a private LAN, or an HTTPS reverse proxy.
- Use HTTPS/TLS when accessing it outside localhost.
- Keep `/data` backed up and private.
- Restrict filesystem permissions on the mounted data directory.
- Keep only one running container writing to a data directory.
- Encrypt portable authentication backups and configure `BACKUP_ENCRYPTION_PASSPHRASE` before enabling scheduled backups with authentication data.

## Reporting A Vulnerability

Open a private report through GitHub Security Advisories if available. If not, open an issue with minimal reproduction details and avoid posting secrets, tokens, real IPs, or private inventory data.
