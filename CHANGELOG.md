# Changelog

All notable changes to Homelab Inventory should be documented here.

This project follows semver-style Docker tags. The `stable` image points at the stable branch, `latest` points at main, and numbered tags are intended to remain immutable.

## Unreleased

- Added a shared deterministic Rust/WASM domain-engine foundation that runs the same module in a dedicated browser worker and in the Bun persistence authority.
- Added persisted project revisions, binary command transport, committed-update streaming, and canonical rebuilds when a browser misses or conflicts with a project revision.
- Added visible loading, rebuilding, unsupported-browser, and recoverable engine-failure states while keeping normal canvas interaction blocked until the local engine is ready.
- Migrated project-name autosave to an optimistic, revision-checked WASM command without resaving the complete project document.
- Added schema 13 migration and validation for monotonic project revisions, including automatic pre-migration backups.
- Added an optimized multi-stage Rust/WASM Docker build while keeping Rust tools, source, tests, development data, and generated build trees out of the distroless runtime image.
- Added Rust formatting, clippy, unit tests, WASM packaging checks, and non-blocking engine benchmark artifacts to CI.
- Added obstacle-aware shortest-path routing for network, display, and power cables while allowing cable crossings and shared lanes.
- Added double-click cable anchors, individual bend removal, Reset route, and Undo/Redo support for manual routing changes.
- Added browser-local cable and canvas-item snapping preferences, disabled by default, using 12 px cable lanes and the 24 px item grid.
- Preserved manual cable anchors during automatic rerouting and deferred expensive obstacle routing until equipment movement or cable edits commit.
- Fixed automatic routes to respect source and destination sides, use measured card boundaries, and avoid traveling beneath endpoint equipment.
- Added optional per-cable lane avoidance so automatic routes can separate long parallel overlaps while preserving clean crossings and shared endpoint approaches.
- Added a browser-local global cable-collision preference that applies lane avoidance to every cable without overwriting individual cable settings.
- Moved cable planning into a background worker, retained existing paths while rerouting, and added a non-blocking routing status indicator.
- Fixed canvas pan and zoom lag caused by serializing every measured cable handle on viewport updates.
- Prevented single-cable bend edits from rerouting, rebuilding, or visibly blinking unrelated cables and equipment.
- Prevented cable paths from moving, disappearing, or blinking during cable clicks, equipment focus, Inspector opening, hover, and canvas deselection.
- Simplified redundant endpoint staircases after manual cable movement while retaining obstacle-safe endpoint approaches.
- Fixed connection inspector drawer spacing after the server inspector redesign.
- Documented normal production deployment and persistent data setup.
- Added GitHub Actions Docker publishing for `latest`, `stable`, and semver image tags.
- Documented `main` as the fast-moving channel and `stable` as the recommended deployment channel.
- Prepared the project for public GitHub publishing.
- Added repository documentation, issue templates, CI, and security guidance.
- Clarified Docker deployment, data persistence, and development setup.
- Materialized canonical numeric power ports before validating newly created power equipment.
- Restored creation of power adapters with one draggable AC-input endpoint for UPS and power-strip connections.
- Fixed assigned server power adapters to use power-equipment styling and expose their draggable AC input on the canvas.
- Added internal-PSU and external-power-adapter configurations for NAS equipment.
- Added a conditional external-adapter slot to NAS canvas cards while internal-PSU NAS devices expose their AC input directly in the card header.
- Added confirmed, atomic NAS power-mode changes that remove affected power cables and return assigned adapters to inventory.
- Added Ignore and Unignore controls to Inspector audit findings while keeping acknowledged findings visible for context.
- Shortened AC input labels on canvas port chips from `AC-INPUT` to `AC`.
- Added optional smart mode for power strips with device identity, management addressing, and custom outlet names.
- Added a shared Smart tab to power-strip creation and inspection while keeping outlet chips compact on the canvas.
- Added a destructive confirmation before clearing smart power-strip metadata without affecting ports, cables, or layout.
- Fixed power, network, and video cable routes so they require prior selection and meaningful pointer movement before being repositioned.
- Changed new connections to keep the current Inspector state by default and added an opt-in General workspace preference for automatic connection inspection.
- Fixed hosted external power-adapter cables to attach to the adapter's visible AC port chip while internal PSU cables remain attached to the host header chip.
- Added confirmation and atomic cable cleanup when removing an assigned component that still owns connected ports.
- Fixed inventory drag previews to match the canvas zoom and final placement footprint, making constrained equipment placement predictable.
- Added independent, browser-persistent toolbar and workspace controls for network, power, and display cable visibility.

## [0.1.38] - 2026-07-21

### Added

- Added a persisted per-item horizontal or vertical canvas orientation for UPS and power-strip equipment.
- Added an Inspector control that swaps UPS battery-backed and surge-only groups between rows in horizontal layouts or columns in vertical layouts.
- Added Undo and Redo history support for persisted power-equipment layout edits.

### Fixed

- Matched collision, auto-arrange, centering, and minimap geometry to the rendered dimensions of power equipment in either orientation.
- Improved the Inspector layout selector with explicit single-choice semantics and mobile-friendly interaction targets.
- Ordered immediate Inspector saves so rapid layout changes cannot be overwritten by an older response.
- Preserved UPS and power-strip ports and connections exactly when changing canvas orientation or UPS outlet-group order.

## [0.1.37] - 2026-07-21

### Changed

- Precomputed canvas audit, endpoint, power-topology, and cable-handle indexes once per project revision.
- Mounted only the active Inspector tab instead of keeping every hidden tab in the DOM.
- Reused unchanged React Flow nodes and stable interaction callbacks across transient selections and endpoint drags.
- Enabled viewport culling so offscreen equipment does not remain mounted in the live canvas DOM.

### Fixed

- Reduced the live project from 1,928 React Flow handles to the 68 handles required by persisted cable routes.
- Removed default cable drop shadows from unselected connections to reduce SVG paint work.
- Updated dynamic React Flow node internals when persisted cable handles change.

## [0.1.36] - 2026-07-21

### Changed

- Existing UPS and power equipment now receive persisted numeric power ports automatically when their database upgrades to schema 11.

### Fixed

- UPS outlet chips now resolve as real power endpoints when connecting power strips instead of producing a mixed-endpoint validation error.
- UPS records that only declare a total outlet count now receive conservative surge-only endpoints, while monitor display ports and other non-power ports remain intact.

### Data migration

- Schema 11 creates a backup before repairing incomplete power-port topology records.

## [0.1.35] - 2026-07-21

### Changed

- Moved the power strip's single AC input connector into the canvas card header beside the drag grip.
- Removed the redundant dedicated power-input row without changing endpoint identity or cable behavior.

## [0.1.34] - 2026-07-20

### Changed

- Converted persisted inventory, project, agent, power endpoint, and compatibility relationships to positive numeric identifiers.
- Separated stable semantic resource keys from numeric relational IDs and kept typed string keys confined to runtime UI adapters.

### Fixed

- Schema 10 now rejects unresolved, ambiguous, duplicate, and colliding legacy relationships rather than silently associating the wrong records.
- Current store writes use strict relational validation while legacy imports and migrations retain a dedicated normalization path.

### Data migration

- A pre-migration backup is created before schema 10 converts existing stores.
- Compatibility allocations, power connections, agent records, and hosted component assignments are migrated together so their foreign-key relationships remain intact.

## [0.1.33] - 2026-07-20

### Added

- Added a dedicated draggable AC input to every power strip on the canvas and in the Inspector.
- Added UPS-to-power-strip connections through the existing directional power endpoint workflow.

### Fixed

- Existing power strip inventory records now receive the synthetic input automatically without changing outlet counts.
- Power strip inputs accept only one upstream power connection while downstream outlet behavior remains unchanged.

## [0.1.32] - 2026-07-20

### Added

- Added an Inspector action that returns placed equipment to inventory without deleting its inventory record.
- Added a confirmation dialog that previews removed placements, released hosted components, and removed cable connections.

### Changed

- Returning a server, NAS, or PC Build now releases its direct assignments and removes cables attached to the host or its hosted components.
- The complete return operation is recorded as one project history entry for atomic Undo and Redo.

### Fixed

- Stale return requests now fail safely when the selected equipment is no longer placed on the canvas.
- Returning equipment clears stale item, connection, pending endpoint, preview, and network trace selections.

## [0.1.31] - 2026-07-20

### Added

- Added type-aware Specs, Compatibility, Resources, and Ports tabs to the Add Inventory Item dialog.
- Added horizontally scrollable dialog tabs for mobile and narrow viewports.

### Changed

- Kept the inventory type selector and action footer fixed while limiting scrolling to the active form panel.
- Equipment types now show only the creation tabs relevant to their fields and capabilities.

### Fixed

- Validation now switches to the tab containing the first invalid field and focuses that control for correction.
- Hidden native scrollbar chrome from the horizontally scrollable Add Item tab strip.

## [0.1.30] - 2026-07-20

### Added

- Added free-form PC Build hosts with assignable motherboard, CPU cooler, power supply, case, sound card, wireless card, and existing CPU, RAM, storage, GPU, and network components.
- Added explicit motherboard resource allocations for CPU sockets, DIMM positions, storage connectors, and expansion slots.
- Added standalone monitor, UPS, and power-strip equipment with individually addressable power inputs and outlets.
- Added directional power connections, upstream and downstream tracing, and power-topology audit findings.
- Added assignable OEM server and NAS power adapters with one exposed AC input and an implicit host-side DC connection.

### Changed

- Canvas placement, collision checks, search, inventory lifecycle controls, inspectors, and audit behavior now treat PC Builds and power equipment as first-class inventory.
- PC Build operating system remains editable host metadata instead of a draggable component.
- PC Build completion requires a motherboard, CPU, CPU cooler, RAM, storage, and power supply; a case is optional.

### Fixed

- Physical motherboard resource limits remain enforced when a PC Build opts out of compatibility guidance.
- Power topology rejects occupied inputs, outlet-to-outlet connections, self-connections, and loops without guessing missing electrical ratings.

## [0.1.29] - 2026-07-20

### Changed

- Simplified Settings to General, Project, Updates, and About.
- Expanded About with the app's hardware inventory, visual layout, compatibility, cabling, and mounted-data purpose.
- Removed repetitive Environment, Project, and This Browser scope pills while retaining read-only lock guidance.

### Removed

- Removed the redundant System settings category and the unused `/api/system-info` runtime-information endpoint.

## [0.1.28] - 2026-07-19

### Added

- Added a responsive global Settings dialog with General, Project, Updates, System, and About categories.
- Added persistent browser preferences for inventory visibility and width, selection centering, and cable visibility.
- Added confirmed project actions to clear ignored audit findings and enable compatibility checks for all servers and NAS devices.
- Added a read-only `/api/system-info` endpoint exposing a strict allowlist of non-secret runtime settings.
- Added an icon-only Settings command to the floating canvas toolbar.

### Changed

- Canvas cable visibility and selection centering now share the same persistent state used by Settings.
- Environment-derived values are explicitly read-only and explain that Docker Compose or process environment changes require a container recreation or application restart.

### Fixed

- A failure to load runtime information is isolated to the System category so all other settings remain usable.

## [0.1.27] - 2026-07-19

### Added

- Added dedicated Compatibility editing tabs for server and NAS matching policies.
- Added per-server and per-NAS compatibility matching opt-outs.
- Added an Ignored audit view with controls to ignore findings and return them to the active audit.

### Changed

- Compatibility opt-outs suppress only compatibility warnings; other audit findings remain active.
- Ignored warning IDs are stored per project and remain dormant while their findings are absent.

### Fixed

- Physical slot, cardinality, and resource limits remain enforced when hardware compatibility matching is disabled.
- Failed compatibility-policy and audit-ignore saves roll back their optimistic interface changes.
- Deterministic warning IDs include host context so equivalent findings cannot collide across hosts.

### Data

- Upgraded the database to schema 8 with an automatic pre-migration backup before compatibility policies and ignored audit warning IDs are added.
- Docker users should back up the complete `/data` directory before upgrading even though the migration also creates an internal backup.

## [0.1.26] - 2026-07-19

### Added

- Added structured compatibility profiles for host CPU sockets and generations, memory banks, storage bays, and PCIe or expansion resources.
- Added deterministic resource allocation for successful RAM, storage, GPU, and network-card assignments.
- Added Compatibility inspector tabs that explain component requirements, host capabilities, allocations, and grouped findings.
- Added Audit findings for assigned hardware with incompatible or incomplete compatibility data.

### Changed

- Known-invalid component assignments are blocked before project state changes, including atomic CPU and RAM moves or swaps.
- Missing compatibility data produces a nonblocking unknown warning so partially documented hardware remains usable.
- Existing assignments are preserved during migration, even when current rules would reject the same assignment if it were newly created or changed.
- Compatibility data is maintained manually when creating or editing inventory; the app does not perform online lookups or bundle a universal hardware database.

### Fixed

- Official Intel FC package socket names such as `FCLGA1200` are normalized to the matching physical socket name to prevent false incompatibility results.
- Production container images now include the complete project API route set required to load, save, and migrate project data.

### Data

- Upgraded the database to schema 7 with automatic pre-migration backups, normalized compatibility profiles, and deterministic allocations for compatible existing assignments.
- Docker users should back up the complete `/data` directory before upgrading even though the migration also creates an internal backup.

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
