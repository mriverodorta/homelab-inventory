# Changelog

All notable changes to Homelab Inventory should be documented here.

This project follows semver-style Docker tags. The `stable` image points at the stable branch, `latest` points at main, and numbered tags are intended to remain immutable.

## Unreleased

- Fixed connection inspector drawer spacing after the server inspector redesign.
- Documented normal production deployment and persistent data setup.
- Added GitHub Actions Docker publishing for `latest`, `stable`, and semver image tags.
- Documented `main` as the fast-moving channel and `stable` as the recommended deployment channel.
- Prepared the project for public GitHub publishing.
- Added repository documentation, issue templates, CI, and security guidance.
- Clarified Docker deployment, data persistence, and development setup.

## [0.1.15] - 2026-07-12

### Fixed

- The What's New dialog now lists releases from newest to oldest.
- Only the most recent displayed release receives the `LATEST` badge.

## [0.1.14] - 2026-07-10

### Added

- Added persisted negotiated network speeds for cable connections.
- Added a light-purple cable color for negotiated 5G links.
- Added required advertised speeds and practical defaults for switch RJ45, SFP, and SFP+ port groups.

### Changed

- Cable speed now uses the lowest advertised speed across switches, servers, NAS devices, hosted NICs, and transparent patch-panel paths.
- Legacy network-capable connections are normalized as network cables during schema migration and project writes.

### Fixed

- Slower endpoints now update every cable color across both sides of a patch-panel keystone.
- Existing 10G switch-to-switch SFP+ links now render blue instead of neutral.

## [0.1.13] - 2026-07-10

### Added

- Added a tabbed switch inspector with editable switch identity, management, capacity, cooling, ports, and connections.
- Added grouped switch port controls for count, type, speed, and role.

### Fixed

- Switch port count corrections now preserve retained port IDs and existing cable assignments.
- Port group reductions now stop before deleting connected ports or ports with saved labels, notes, or IP details.

## [0.1.12] - 2026-07-10

### Added

- Added a patch panel inspector action to swap the visual front/back row order on the canvas.

## [0.1.10] - 2026-07-09

### Added

- Added structured release notes for the in-app "What's New" dialog.
- Added release-note acknowledgement tracking in `/data/meta.json`.
- Added CI and Docker publish checks that require meaningful runtime changes to include structured release notes.

### Changed

- GitHub Actions Docker publishing now refuses versions that do not have a matching structured release-note entry.

## 0.1.9

- Current local version before public repository preparation.
