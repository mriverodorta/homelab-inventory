# Security Policy

## Supported Versions

Security fixes target the latest Docker image and the newest semver tag.

## Deployment Warning

Do not expose Homelab Inventory directly to the public internet.

The app currently has no built-in user authentication. It is intended for a trusted LAN, VPN, or reverse proxy that provides authentication and TLS. Built-in authentication is planned and coming soon.

## Sensitive Data

The `/data` directory can contain private infrastructure details, including IP addresses, device names, serial numbers, service lists, and agent credentials.

Never commit or publish a real `/data` directory.

## Recommended Controls

- Run behind Tailscale, WireGuard, a private LAN, or an authenticated reverse proxy.
- Use HTTPS/TLS when accessing it outside localhost.
- Keep `/data` backed up and private.
- Restrict filesystem permissions on the mounted data directory.
- Keep only one running container writing to a data directory.

## Reporting A Vulnerability

Open a private report through GitHub Security Advisories if available. If not, open an issue with minimal reproduction details and avoid posting secrets, tokens, real IPs, or private inventory data.
