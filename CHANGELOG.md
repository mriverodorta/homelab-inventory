# Changelog

All notable changes to Homelab Inventory should be documented here.

This project follows semver-style Docker tags. The `stable` image points at the stable branch, `latest` points at main, and numbered tags are intended to remain immutable.

## Unreleased

### Added

- Added a permanent random installation UUID for registry enrollment, owner-reviewed lost-key recovery states, and explicit approval checks in Registry settings.

### Changed

- Registry key rotation now uses the authenticated rotation protocol and preserves the current key and credentials byte-for-byte unless the registry accepts the replacement.
- Complete and registry-enrollment backups now include and validate the stable installation UUID together with the signing key and credentials.

### Fixed

- Existing registry installations adopt the stable UUID with their current Ed25519 key, and deleted public registry state rebuilds without creating another remote installation.
- Private local/live synchronization now moves only allowlisted business stores while preserving each destination environment's registry UUID, key, credentials, and public enrollment projection.
- Contribution delivery remains stopped during pending or rejected key recovery and public demo sessions cannot enroll, rotate, recover, or contribute.

## [0.8.5] - 2026-08-05

### Fixed

- Restored independent scrolling in all three desktop catalog panes by giving the catalog dialog a stable viewport-bounded height and a strictly constrained pane layout.

### Security

- Restored the pinned distroless Bun runtime and removed Debian package-management layers from the published image.
- Added a mandatory local pre-push and CI security gate that builds, boots, and scans both amd64 and arm64 runtime images with Docker Scout and Trivy, failing on any known vulnerability at any severity.

## [0.8.4] - 2026-08-04

### Changed

- The official catalog browser now keeps filters, result lists, and item details in independently scrollable desktop panes while preserving the compact mobile filter sheet.
- Assigned expansion cards now lead with the hardware name and a compact PCIe, M.2, or USB interface pill, with connector chips kept on their own row.

### Fixed

- Single-socket CPUs now use the full host-card width, while multi-socket CPUs retain a compact two-column layout without overflowing their chip labels.
- Registry-link indicators and assignment remove controls now share a nonintrusive top-right overlay; remove controls appear on hover, keyboard focus, or touch selection, and audit counts remain clear at the bottom-right corner.

## [0.8.3] - 2026-08-04

### Fixed

- Concurrent catalog searches now reuse one snapshot service and update the active catalog pointer without temporary-file collisions.
- Updated the IP address parser used by request rate limiting to close CVE-2026-69192, CVE-2026-54272, and CVE-2026-69198.

### Security

- Docker publication now blocks fixable medium, high, and critical runtime vulnerabilities before any image is pushed, while a daily monitor rescans both `latest` and `stable` for vulnerabilities disclosed after release.
- The final Bun runtime now applies current Debian security updates during each release build before the image is scanned.

## [0.8.2] - 2026-08-03

### Added

- Added category-first official catalog browsing with category-specific multi-select and numeric-range filters, local search, and explicit paginated loading for large registries.

### Changed

- Connected catalogs can consume an optional signed, revision-bound facet index and build local SQLite filter indexes, keeping inventory searches private and off the registry service.

## [0.8.1] - 2026-08-03

### Added

- Added first-class OEM workstation contract v5 and conventional-server contract v6 support, including Compact, SFF, Tower, Rack Workstation, MicroServer, Tower Server, and Rack Server physical classes while keeping local usage roles independent.
- Added complete host-topology editing, inspection, auditing, compatibility, canvas, and catalog-import support for multi-socket CPUs, per-CPU memory layouts, ECC and module types, storage backplanes and controllers, hot-swap and direct-connect bays, risers and CPU-dependent expansion, boot devices, PSU redundancy, cooling profiles, and management controllers.
- Multi-socket hosts now expose one assignable CPU position per physical socket on the canvas and enforce the declared population and CPU-dependency rules.

### Changed

- OEM registry matching now prioritizes an existing link, then motherboard or complete topology evidence, then a unique high-confidence normalized identity. Systems with the same model name are never merged by model alone.
- Homelab Inventory now reports OEM contract version 6 and accepts signed catalog fingerprints through v6 while explicitly rejecting newer unsupported contracts.

### Data migration

- Schema 24 creates and verifies a pre-migration backup before initializing the new topology collections and numeric relational IDs. The ordered migration preserves unknown registry fields, existing assignments, placements, cables, hardware classes, and usage roles, and rolls back from the verified backup if validation fails.

## [0.8.0] - 2026-08-03

### Added

- Added multi-user access administration with local or OIDC invitations, built-in Owner, Administrator, Editor, and Viewer roles, and reusable custom global roles composed from a static permission catalog.
- Added explicit identity linking so one account can use both local and OIDC sign-in without automatically merging accounts that happen to share an email address.
- Added permission-aware navigation and controls across inventory, canvas, connections, projects, registry, backups, agents, audits, updates, authentication, users, and roles.

### Security

- API authorization now uses a server-side Casbin policy with default-deny route classification and operation-specific workspace-engine permissions; hidden frontend actions are never the enforcement boundary.
- The original owner account and Owner role remain protected, delegated roles and resent invitations cannot grant permissions the acting administrator does not possess, and concurrent access-policy writes are serialized and rolled back atomically if policy compilation or persistence fails.
- Access-administration APIs remain unavailable while authentication is disabled, preserving the legacy open workspace without exposing account, role, or invitation metadata.

### Data migration

- Schema 23 backs up and upgrades the authentication store with numeric role, permission, assignment, invitation, and identity-link relationships. Existing authentication mode and owner access are preserved, while demo sessions remain open and omit Access administration entirely.

## [0.7.2] - 2026-08-02

### Added

- Added OEM catalog fingerprint v4 support with lossless motherboard evidence, fixed and optional port origins, memory ECC capabilities, storage and expansion topology, proprietary riser details, optional module slots, and power requirements.
- Added deterministic OEM variant matching that prioritizes exact board evidence and complete hardware topology, while presenting ambiguous product-family matches for explicit review instead of silently linking the wrong variant.
- Added host topology, ECC, riser, optional-module, and power fields to shared inventory editors, plus a suppressible Lenovo ThinkCentre M720q warning when PCIe expansion and a 2.5-inch SATA drive are assigned together.

### Changed

- Physical hardware class remains separate from local usage role, allowing desktop-class mini PCs to keep server, desktop, workstation, or other workspace roles without changing catalog identity.
- Fixed equipment ports and assignment-dependent module ports now retain explicit provenance so catalog imports and canvas behavior activate each port at the correct lifecycle stage.

### Fixed

- Catalog updates preserve local names and project topology, and previously published fingerprint-v2 or fingerprint-v3 definitions can still adopt equivalent v4 inventory without changing historical hashes.

### Data migration

- Schema 22 backs up and upgrades existing stores automatically, assigning relational compatibility resource IDs, port provenance, host class and usage-role defaults, and registry variant state without changing assignments, placements, or cables.

## [0.7.1] - 2026-08-02

### Fixed

- Public demo sessions now show authentication as an enforced read-only disabled policy instead of exposing setup controls that can never be applied.

## [0.7.0] - 2026-08-02

### Added

- Added optional single-owner authentication with local Argon2id credentials, OpenID Connect Authorization Code flow with PKCE, or both methods in hybrid mode.
- Added first-run owner setup for fresh production installations, authenticated session management, local security activity, password changes, OIDC owner binding, and a 15-minute recovery CLI.

### Security

- Browser API access is denied until first-run setup is complete and requires an authenticated owner session whenever protection is enabled. Health checks and separately authenticated machine-agent registration and heartbeat routes retain their dedicated access rules.
- Authentication exports are excluded from custom backups by default and require encrypted archives. Scheduled backups cannot be combined with owner-authentication material until `BACKUP_ENCRYPTION_PASSPHRASE` is configured.

### Notes

- Schema 21 adds a relational authentication store. Existing installations upgrade with authentication disabled to prevent lockout, while genuinely fresh production data directories require one-time owner setup. Public demo sessions keep authentication unavailable.

## [0.6.2] - 2026-08-02

### Added

- Added a dedicated **Backup & Restore** settings area for complete or custom portable archives, stored-backup verification and download, partial replacement restores, and separate recovery and restore history.
- Added daily or weekly complete backup scheduling with configurable time, weekday, IANA timezone, and retention count. Docker `TZ` remains authoritative when configured.

### Security

- Sensitive registry-enrollment and agent sections require passphrase-protected downloads; encrypted archives use scrypt and AES-256-GCM.
- Restore now validates archive paths, types, sizes, counts, checksums, schema compatibility, and relational dependencies before entering maintenance mode.

### Fixed

- Protected restores create a complete pre-restore backup, journal each replacement, roll back failed or interrupted operations automatically, and reload connected clients only after a successful commit.
- The production Docker image includes the backup and restore runtime modules required by the new management API and scheduler.

### Notes

- Schema 20 adds a backup-management metadata store without changing existing inventory or project relationships. Portable files live under `/data/backups/user`, backup history is excluded from archives, and public demo sessions remain export-only.

## [0.6.1] - 2026-08-02

### Fixed

- Connected clients now preserve and verify the complete official CPU specification contract, allowing signed enriched CPU catalogs to activate without weakening hash or signature validation.

## [0.6.0] - 2026-08-01

### Added

- Connected catalogs now distinguish hardware variants within the same product family by trusted motherboard identity, complete structural topology, or explicit OEM PCIe expansion support, so systems such as standard and discrete-graphics Dell OptiPlex Micro 7090 boards can be reviewed, published, searched, and imported separately.
- Catalog search results and item details show concise motherboard or topology variant labels when a product family contains multiple verified definitions.

### Changed

- Automatic catalog contributions use fingerprint-v3 product-family and variant evidence, deduplicating equivalent local copies while keeping materially different motherboards or complete expansion topologies separate.
- Existing fingerprint-v2 identities remain valid aliases, while ambiguous generic-family records require review instead of silently attaching to a specific variant.

### Fixed

- Existing signed catalog revisions retain the publisher's original content digest after client protocol upgrades, preventing valid last-known-good catalogs from being rejected or blocking automatic contributions.
- Pending contribution batches reconcile automatically when stronger hardware evidence splits a previously generic family into separate variants, preventing one stale candidate from blocking unrelated submissions.
- Previously delivered local definitions now become reviewable catalog-adoption links when their normalized hardware variant is later published, instead of being skipped as already contributed.
- Applying a reviewed catalog definition now updates only the linked inventory record and registry relationship, preserving the project revision, assignments, placements, and cables without unnecessary workspace-engine synchronization.

### Data migration

- Schema 19 preserves existing fingerprint-v2 catalog links and contribution records while enabling fingerprint-v3 variant evidence and aliases. Startup creates a backup and applies the migration automatically before catalog refresh or contribution discovery.

## [0.5.1] - 2026-07-31

### Added

- Connected catalogs now recognize equivalent local hardware by canonical identity and offer an explicit review before adopting verified registry fields.
- OEM and custom computers now separate their physical hardware class (desktop or server) from their local usage role (server, desktop, or workstation), so a mini PC can remain a server in the workspace while matching a desktop catalog definition.

### Fixed

- Every physical copy of an identity-matched component receives its own registry link indicator and adoption record without creating duplicate catalog contributions.
- The production image now includes the complete ordered schema 17 and 18 migration chain required to upgrade existing `/data` stores safely.
- Public demo sessions now replace required smart-outlet names with neutral labels while omitting private smart-device metadata, keeping sanitized schema 18 sandboxes valid.

### Notes

- Schema 17 preserves existing inventory and registry links while adding a reviewable catalog-adoption relationship state.
- Schema 18 classifies existing server records as desktop hardware used as servers while preserving every numeric ID, assignment, placement, port, cable, and local registry relationship.

## [0.5.0] - 2026-07-31

### Added

- Added a disposable LowDB routing cache that restores calculated cable paths immediately after refresh, hydrates the WASM planner, and safely rebuilds outdated or damaged cache data without changing canonical project data.
- General workspace settings can now align all equipment to the nearest collision-free grid position, clear every manual cable bend, or restore automatic endpoint sides as confirmed, Undo-compatible project actions.
- Inspector connection cards now include an **Open cable** action for direct route review and editing.

### Changed

- The workbench now lazy-loads the canvas, drag-and-drop runtime, inventory, Inspector, Settings, onboarding, and secondary dialogs. Retryable loading states and CI bundle budgets protect startup performance.
- Cable endpoint sides are resolved and persisted as explicit Top, Right, Bottom, or Left values. Routes prefer the center of the selected port face, use 12 px alternatives only when they simplify the path, and preserve manual bend anchors.

### Fixed

- Reworked WASM cable planning for dense layouts: bounded searches expand progressively, straight and one-turn routes win over unnecessary detours, facing ports share nearby grid lanes, and reordered patch panels or rotated power equipment use their measured geometry without routing through cards.
- Cable rendering now preserves the last validated route while handles are measured or individual paths are recalculated. Partial failures remain isolated, successful routes persist incrementally, and unrelated cables stay visible when equipment or another connection is focused.
- Routing invalidation and continuation are now geometry-driven and bounded. Pan, zoom, selection, Inspector state, and filters no longer trigger recalculation; large cable sets resume completed batches instead of restarting, timing out, or entering idle render loops.
- LowDB writes now retry transient failures, expose degraded persistence health, and recover interrupted multi-store saves through a write-ahead journal. Inventory, project, catalog-link, and routing-cache mutations roll back together when validation or persistence fails.
- Registry enrollment, contribution delivery, catalog refresh, and private-template creation now contain background failures, validate bounded remote responses, preserve the last-known-good catalog and identity, and serialize relational ID allocation.
- Undo and Redo now rebase onto the latest project revision, while UPS and power-strip orientation changes validate the projected footprint before persistence.
- Browser and workspace-engine requests now time out into recoverable states; invalid runtime configuration fails fast; graceful shutdown drains schedules, event streams, registry work, and pending stores; and local development no longer applies the production request limiter.

### Security

- Browser mutations now require a same-origin context, unexpected API errors return sanitized responses, and authenticated agent or command-line workflows remain supported.
- Agent enrollment validates HTTP and HTTPS origins, writes configuration without shell evaluation, and bounds and rate-limits heartbeat telemetry.
- Public demo sandboxes now remove smart-device addresses, custom names, labels, notes, and metadata across every equipment type while serializing and limiting sandbox creation.

### Notes

- Generated routes are stored separately from canonical project data and do not advance project revisions or enter Undo and Redo history. The cache can be deleted or rebuilt safely.

## [0.4.9] - 2026-07-29

### Fixed

- Existing registry stores now receive newly introduced preference defaults before strict validation, preventing an upgrade restart loop.

## [0.4.8] - 2026-07-29

### Added

- Registry settings can optionally show a compact canvas marker on catalog-linked equipment and assigned components; the marker is hidden by default.

## [0.4.7] - 2026-07-29

### Fixed

- **Send now** can perform one explicit catalog contribution delivery while automatic background delivery is paused.
- Disabling automatic catalog contributions now waits for any active delivery to settle before confirming the paused state.

## [0.4.6] - 2026-07-29

### Fixed

- Locally overridden catalog items now reconnect to their existing numeric catalog link after the exact sanitized definition is published, while pending and non-published hashes remain detached.
- Catalog update previews now restore category information omitted by the normalized category-array store, allowing verified revisions to be reviewed and applied without a sanitization failure.

## [0.4.5] - 2026-07-29

### Added

- Connected installations now refresh the signed official catalog at startup and every six hours with bounded jitter, one shared in-flight operation, and an optional `REGISTRY_REFRESH_INTERVAL_MS` override.

### Fixed

- Failed catalog refreshes now preserve the last-known-good snapshot, expose a sanitized operational error, and refuse activation if Connected mode is disabled while a download is in progress.

## [0.4.4] - 2026-07-28

### Fixed

- New public demo sessions now activate the verified official catalog automatically on first use while remaining available when the registry is temporarily unreachable.

## [0.4.3] - 2026-07-28

### Fixed

- Public demo sessions now trust the official catalog signing key, stay locked to Connected registry mode, and prohibit automatic catalog contributions while keeping manual catalog refresh available.

## [0.4.2] - 2026-07-28

### Fixed

- Registry enrollment failures now appear directly beside the Automatic catalog contributions control instead of being hidden below the rest of the Registry settings panel.
- Official catalog refreshes now use the same frozen fingerprint-v2 CPU normalization contract as the registry, allowing verified templates such as Intel Core i5-10500T to activate without hash mismatches.

## [0.4.1] - 2026-07-27

### Fixed

- Refreshing or importing the verified hardware catalog now preserves database schema and migration status in Registry settings.

## [0.4.0] - 2026-07-27

### Added

- Added source tabs to Add Hardware for the official Catalog, the complete Manual editor, and reusable Private templates.
- Added sanitized private templates that can be created from inventory items, searched locally, duplicated, exported, imported, and instantiated with a quantity.
- Added Registry settings for Disabled, Offline file, and Connected modes plus a preferred Add Hardware source.
- Added a shared versioned catalog protocol with deterministic normalization, manufacturer aliases, allowlist sanitization, and separate identity/content hashes.
- Added Ed25519-verified official catalog snapshots for connected refresh and offline import, with atomic last-known-good activation and a disposable local SQLite search index.
- Added verified catalog search, linked inventory creation, update detection, field-level review, and dependency-safe catalog update application.
- Added explicit opt-in automatic catalog contributions with backend-only Ed25519 installation identity, signed replay-protected delivery, a durable bounded outbox, retry backoff, revocation, key rotation, and aggregate delivery status.
- Added signed digest-index synchronization so published, pending, and suppressed hardware hashes are eliminated locally before contribution delivery.
- Added deterministic privacy allowlists and adversarial filtering for device names, addresses, serials, notes, topology, assignments, agents, and smart-device instance configuration.
- Added category-aware registry identity projection that groups identical physical copies without merging inventory, separates board variants and RAM speeds, and withholds ambiguous or unidentified hardware.
- Added physical RAM slot controls with one inventory record per stick, exact-slot placement, occupied-slot swapping, and visible unknown-slot warnings.

### Data migration

- Schema 15 adds `/data/stores/registry.json` for registry preferences, private templates, numeric catalog links, signed snapshot metadata, and contribution state without changing project topology or inventory relationships.
- Disabled mode makes no catalog network requests. Offline import performs no outbound request. Connected contributions remain off by default and contact only the fixed official registry endpoint after separate explicit consent.
- Installation private keys and short-lived registry tokens are stored only in mode-`0600` backend files under `/data/registry`; they are not written to lowdb or returned by the public app API.
- Schema 16 automatically converts legacy RAM kits into physical sticks and one-slot assignments while preserving IDs where possible, slot positions, and total capacity. It creates a locked pre-migration backup, rejects ambiguity, restores failed writes, and records a safe migration summary.
- Added a migration guide covering backup, automatic startup behavior, verification, Docker and Watchtower upgrades, interruption recovery, and rollback.

### Fixed

- Prevented simultaneous atomic JSON writes from selecting the same temporary file during migrations or rapid persistence.

## [0.3.0] - 2026-07-25

### Added

- Added a dedicated Settings feedback section linking to the public roadmap, private feature proposal workflow, and GitHub bug-report form.
- Limited self-hosted proposal context to the public app version and source label without attaching inventory records or diagnostics.
- Added an optional first-run choice between exploring a complete fictional homelab workspace and starting with an empty inventory checklist.
- Added a three-step example guide covering host inspection, network cabling, and power delivery, with a final choice to keep the workspace or remove every sample-owned record and relationship.
- Added persistent Getting Started controls in Project settings so onboarding can be reviewed, restarted, or dismissed without interrupting existing installations.

### Fixed

- Opened the fictional example with a deliberately spaced topology and a one-time fit-to-view so equipment and cable paths are immediately readable.
- Kept connections visible while attachment-side changes are recalculated by retaining the prior route and rendering a temporary orthogonal fallback when needed.
- Fixed explicit cable sides such as `Top` to `Bottom` so WASM pathfinding approaches both ports from the requested directions without dangling, backtracking, or self-overlapping endpoint segments.
- Resetting manual bends now invalidates cached route geometry, and automatic endpoint trunks remain outside equipment boundaries instead of preserving a broken pre-reset path.
- Included equipment-edge portals in the bounded WASM search area so Top and Bottom routes on tall patch panels, switches, and other cards no longer fail or fall back through equipment.

### Data migration

- Schema 14 adds project-scoped onboarding state to the local metadata store. Existing nonempty workspaces are dismissed automatically, while fresh empty workspaces receive the optional invitation.
- The example contains fictional hardware only, creates no telemetry, and can be removed atomically while preserving user-created inventory records.

## [0.2.2] - 2026-07-24

### Fixed

- Kept connected network, power, and display cables visible when moving equipment changes their automatically selected attachment side.

## [0.2.1] - 2026-07-23

### Fixed

- Synchronized inventory CRUD responses with the local WASM workspace revision before allowing canvas interaction, preventing newly created equipment from returning to inventory after an immediate drop with a revision-conflict error.
- Refreshed the Bun server's cached WASM handle whenever inventory CRUD advances the canonical project revision, so the next canvas command is evaluated against current data.
- Ignored delayed inventory invalidation events when the browser has already loaded the matching revision, avoiding a redundant workspace rebuild.

## [0.2.0] - 2026-07-23

This release moves the workspace's computational core into a shared Rust/WASM engine used by both the browser worker and Bun server. It also completes the associated cable-routing, topology, power-equipment, persistence, and interaction-performance work accumulated since `0.1.38`.

### Highlights

- Added a shared deterministic Rust/WASM domain-engine foundation that runs the same module in a dedicated browser worker and in the Bun persistence authority.
- Added persisted project revisions, binary command transport, committed-update streaming, and canonical rebuilds when a browser misses or conflicts with a project revision.
- Added visible loading, rebuilding, unsupported-browser, and recoverable engine-failure states while keeping normal canvas interaction blocked until the local engine is ready.
- Migrated project-name autosave to an optimistic, revision-checked WASM command without resaving the complete project document.
- Added schema 13 migration and validation for monotonic project revisions, including automatic pre-migration backups.
- Added an optimized multi-stage Rust/WASM Docker build while keeping Rust tools, source, tests, development data, and generated build trees out of the distroless runtime image.
- Added Rust formatting, clippy, unit tests, WASM packaging checks, and non-blocking engine benchmark artifacts to CI.
- Moved canvas collision checks, group movement validation, nearest placement, and auto-arrangement into the shared Rust/WASM worker.
- Added a transient indexed geometry revision so canvas calculations remain deterministic without creating persisted project revisions or undo entries.
- Required the domain engine for browser and server runtimes and removed the duplicate TypeScript placement and arrangement implementations.
- Added obstacle-aware shortest-path routing for network, display, and power cables while allowing cable crossings and shared lanes.
- Added double-click cable anchors, individual bend removal, Reset route, and Undo/Redo support for manual routing changes.
- Added browser-local cable and canvas-item snapping preferences, disabled by default, using 12 px cable lanes and the 24 px item grid.
- Preserved manual cable anchors during automatic rerouting and deferred expensive obstacle routing until equipment movement or cable edits commit.
- Fixed automatic routes to respect source and destination sides, use measured card boundaries, and avoid traveling beneath endpoint equipment.
- Added optional per-cable lane avoidance so automatic routes can separate long parallel overlaps while preserving clean crossings and shared endpoint approaches.
- Added a browser-local global cable-collision preference that applies lane avoidance to every cable without overwriting individual cable settings.
- Moved cable planning into a background worker, retained existing paths while rerouting, and added a non-blocking canvas activity indicator.
- Moved obstacle pathfinding, lane separation, route caching, manual bend insertion, and segment-drag previews into the shared Rust/WASM worker.
- Replaced full-canvas cable recalculation with targeted dependency invalidation so unchanged and unrelated routes retain their cached geometry.
- Removed the duplicate TypeScript cable pathfinder and standalone cable-routing worker.
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
- Moved endpoint indexing and occupancy, compatible-port filtering, connection validation and commands, negotiated network speeds, network traces, and power-topology findings into the shared Rust/WASM worker.
- Added revision-scoped TanStack Query coordination for topology results so canvas selection, panning, zooming, and Inspector navigation reuse the same deterministic worker snapshot.
- Removed duplicate browser-side topology, network-trace, power-topology, and negotiated-speed implementations while retaining a frozen normalizer only for historical data migrations.
- Added synthetic topology benchmarks for endpoint catalogs, compatibility, validation, connection commands, negotiated state, tracing, power findings, and worker indexing.
- Replayed externally committed connection patches through the local worker without rebuilding the complete engine snapshot.
- Fixed workspace-engine startup for existing power strips whose canonical AC input uses display slot zero.
- Fixed multi-item canvas moves to persist one atomic placement patch instead of replacing and rebuilding the complete workspace snapshot.
- Preserved unchanged equipment cards, topology results, and cable routes across placement commits and engine recovery so canvas moves no longer clear or blink unrelated content.
- Narrowed geometry, topology, handle, and route invalidation to the project data each calculation actually uses.
- Moved transient routing and synchronization activity out of the bottom toolbar into a delayed top-left canvas indicator so calculations no longer resize or flicker the toolbar.
- Fixed revision conflicts when a component assignment change is followed immediately by moving canvas equipment by coordinating legacy saves with canonical WASM commands.
- Kept routine workspace-engine synchronization nonblocking while reserving centered blocking states for startup and unrecoverable failures.
- Scoped component-assignment rendering and handle updates to affected hosts, retained unrelated cable routes during expected engine synchronization, and added browser-console diagnostics for transient canvas activity.
- Moved component assignment, transfer, swap, and removal saves to atomic revision-checked WASM commands so one component drop no longer resaves the whole project, rebuilds the workspace engine, or reroutes cables repeatedly.
- Returned local development to the standard ignored `data/` directory after completing the isolated WASM migration, while retaining explicit `DATA_DIR` overrides.
- Fixed clean-checkout tests and Docker publishing to build WASM before integration tests, preventing missing-artifact races on hosted runners.
- Fixed production runtime packaging to include the canonical engine snapshot and legacy migration normalizer while omitting the removed browser negotiated-speed module.

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
