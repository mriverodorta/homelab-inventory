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

## [0.1.25] - 2026-07-19

### Added

- Added quantity creation and clean duplication for every inventory category.
- Added per-item and batch archive, restore, and permanent-delete controls.
- Added Archived and All inventory views plus dependency-aware lifecycle confirmation dialogs.

### Changed

- Archived records remain in their category tables but are unavailable for editing, dragging, assigning, placement, or connection until restored.
- Inventory lifecycle commands now run transactionally on the server and return a complete authoritative project snapshot.
- Inventory lifecycle changes reset canvas undo and redo history to prevent stale project state from restoring removed records.

### Fixed

- Archive and deletion are blocked when records still have canvas placements, host relationships, cable connections, configured port metadata, agent registration, or agent runtime status.
- Permanent deletion now requires the record to be archived first and never cascades into dependent data.
- Duplicated records no longer inherit runtime labels, notes, IP addresses, assignments, placements, connections, or agent state.
- Added confirmed Agent-tab cleanup controls so registrations and saved telemetry can be removed before archiving a server.
- Fixed active multi-select contrast and vertically centered inventory row icons, action menus, and selection checkboxes.

## [0.1.24] - 2026-07-19

### Changed

- Added realistic, category-specific examples to Add Item and editable inspector forms for every inventory type.

### Fixed

- CPU, RAM, storage, GPU, network card, NAS, switch, and patch-panel forms no longer display server-specific name, manufacturer, and model placeholders.
- Numeric hardware fields now show relevant examples without initializing or persisting those example values.

## [0.1.23] - 2026-07-19

### Fixed

- Separated the mobile inventory drawer's Add and Close controls so their touch targets no longer overlap.

## [0.1.22] - 2026-07-18

### Changed

- The desktop inventory sidebar now animates open and closed while the canvas resizes smoothly with it.
- The floating canvas command bar now shares the bottom alignment used by the React Flow canvas controls.

### Fixed

- Inventory visibility changes no longer blink abruptly between the expanded and collapsed workspace layouts.

## [0.1.21] - 2026-07-18

### Added

- Added a responsive, icon-only command bar centered at the bottom of the canvas on desktop and mobile.
- Added a persistent desktop inventory toggle that restores the sidebar at its previously saved width.

### Changed

- Moved save status, history, update, audit, centering, arrangement, and cable visibility controls out of the crowded top-right canvas area.
- Removed the cable color legend while retaining the cable visibility control.

## [0.1.20] - 2026-07-15

### Added

- Added immutable `X.Y.Z` Docker images, moving `X.Y` aliases, matching Git tags, and GitHub Releases for newly promoted stable versions.
- Added a guarded manual workflow for restoring historical numbered releases from their original source commits.

### Changed

- Docker update checks now distinguish newer channel images, exact matches, revision-only rebuilds, and installations ahead of the selected channel.
- The update dialog identifies the published `latest` or `stable` image instead of labeling every channel result as an available update.
- Docker Compose update instructions only appear when an update is actually available.
- `main` now publishes only `latest`; `stable` owns release promotion and publishes `stable`, immutable `X.Y.Z`, and the moving `X.Y` alias.

### Fixed

- Older channel versions are no longer presented as available updates when the running installation is newer.
- Same-version images built from a different known revision are detected as revision-only updates.
- Current and ahead-of-channel results no longer show an empty release-details placeholder.
- Release publication now stops before overwriting an existing numbered Docker tag or reusing a Git tag from a different commit.
- Historical backfills are restricted to an authoritative version-to-commit map and do not expose Docker credentials while historical dependency or build scripts run.

## [0.1.19] - 2026-07-14

### Added

- Added editable tabbed inspectors for servers, switches, NAS devices, patch panels, CPUs, RAM, storage, GPUs, and network cards.
- Reused the Add Item form fields, validated selects, and port-group controls throughout inventory inspectors.
- Added debounced complete-item saves while keeping select and toggle changes immediate.

### Changed

- Server, switch, NAS, and patch-panel inspectors now organize specifications, slots, ports, connections, network details, services, and agent state into focused tabs.
- Switch management uses canonical management choices while preserving legacy values until they are changed.
- Large switches and patch panels retain support for port groups of up to 128 ports.

### Fixed

- Inspector edits preserve inventory IDs, assignments, canvas placement, port metadata, and existing cable connections.
- NAS devices no longer expose server-only agent enrollment actions.
- Pending debounced edits are saved when an inspector closes or switches to another item.
- Port-count fields can be cleared and replaced without deleting or multiplying the existing port group.

## [0.1.18] - 2026-07-14

### Added

- Added global request limiting across API routes, static assets, and the SPA fallback.
- Added configurable `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`, and `TRUST_PROXY` runtime settings.
- Added standard rate-limit response headers and structured `429` API responses.

### Security

- Restricted the CI workflow token to read-only repository contents.
- Rejects unsafe `TRUST_PROXY=true` configuration and falls back from invalid numeric rate-limit values.

### Fixed

- Included the request-limiting middleware in the production Docker runtime stage.

## [0.1.17] - 2026-07-13

### Changed

- Connection destination lists now include only compatible, unoccupied ports on hosts placed on the canvas.
- Assigned NIC and GPU ports are grouped beneath their server or NAS host.
- Server and NAS board ports, hosted expansion ports, switch ports, and patch-panel front/back endpoints now use explicit labels.

### Fixed

- Unassigned expansion cards no longer appear as standalone connection targets.
- Hosts without an actionable compatible port no longer appear in the destination selector.
- Connection selectors preserve valid choices and reset stale choices after the source endpoint changes.

## [0.1.16] - 2026-07-12

### Added

- Added anonymous Docker Hub update checks for the configurable `stable` and `latest` channels.
- Added a canvas update notification with release highlights, manual refresh, copyable Docker Compose commands, and exact-version skipping.
- Added persisted successful-check metadata and skipped-version state without exposing inventory data.
- Added OCI version, revision, source, and channel metadata to published images with CI verification.

### Security

- Update checks use fixed read-only Docker Hub endpoints, strict response limits, and no Docker socket or registry credentials.
- Offline installations can disable outbound update checks with `UPDATE_CHECK_ENABLED=false`.

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
