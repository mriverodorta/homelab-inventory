# Changelog

All notable changes to Homelab Inventory should be documented here.

This project follows semver-style Docker tags. The `stable` image points at the stable branch, `latest` points at main, and numbered tags are intended to remain immutable.

## Unreleased

- Added GitHub Actions Docker publishing for `latest`, `stable`, and semver image tags.
- Documented `main` as the fast-moving channel and `stable` as the recommended deployment channel.
- Prepared the project for public GitHub publishing.
- Added repository documentation, issue templates, CI, and security guidance.
- Clarified Docker deployment, data persistence, and development setup.

## [0.1.10] - 2026-07-09

### Added

- Added structured release notes for the in-app "What's New" dialog.
- Added release-note acknowledgement tracking in `/data/meta.json`.
- Added CI and Docker publish checks that require meaningful runtime changes to include structured release notes.

### Changed

- Docker/manual build publishing now refuses versions that do not have a matching structured release-note entry.

## 0.1.9

- Current local version before public repository preparation.
