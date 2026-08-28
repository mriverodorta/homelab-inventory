# Changelog

All notable changes to Homelab Inventory should be documented here.

This project follows semver-style Docker tags. The `stable` image points at the stable branch, `latest` points at main, and numbered tags are intended to remain immutable.

## Unreleased

### Fixed

- Demo, test, staging, candidate-image, and container-security runtimes now disable LabGD, Registry identity and contributions, Registry refresh, and update checks through one fail-closed policy; isolated smoke containers have no network or host port and fail if external identity files are created.
- LabGD credentials now renew proactively before expiration, the installation event stream reconnects with bounded persisted backoff across network failures and restarts, and stale expired connections no longer appear connected while retaining the same installation UUID and Ed25519 key.
- LabGD event streaming is now demand-driven: installations with no active shares or account/recovery work remain enrolled but dormant, with no SSE reconnect or credential-renewal loop until remote events are needed again.

### Changed

- Local releases now reuse checksum-verified portable WASM and Agent bundles when their complete inputs are unchanged, while verified Rust format, Clippy, and test receipts avoid recompilation without retaining Cargo or Docker compiler caches.
- Release preparation records phase timings and probes the exact staged image's HTML shell, immutable assets, bootstrap response, health metadata, and server-sent event stream before approval.
- Deployment-triggered validation now runs locally; GitHub Actions remains available for pull requests, scheduled CodeQL analysis, and scheduled monitoring of published Docker images.
- Two-platform dry runs validate immutable OCI archives directly, and the Trivy database is retained only between an approved ARM64 candidate and its AMD64 publication step before final cleanup.
- Independent Vitest and Bun test families now run concurrently under one fail-fast supervisor with private disposable logs.
- Release validation now loads runtime images from the attested OCI archive through a digest-checked local conversion, then proves the exact config digest, ordered rootfs diff IDs, platform, and release labels without a temporary Registry.
- The ARM64 approval boundary now strictly prunes every BuildKit record while retaining the empty builder runtime for the later cold AMD64 build; reset, failure, and publication cleanup still remove all release-owned builder state.
- Candidate receipts now break validation time into OCI runtime proof, smoke test, vulnerability database, Docker Scout, and Trivy phases without persisting scanner output.

## [0.16.6] - 2026-08-28

### Fixed

- Canvas viewport persistence now accepts the full 10%–200% zoom range, so views saved at either endpoint restore correctly after a reload.

## [0.16.5] - 2026-08-28

### Changed

- Editable and shared Canvas views now use the same 10%–200% zoom range, making large layouts easier to review without changing saved viewport or fit-to-view behavior.

## [0.16.4] - 2026-08-27

### Fixed

- Parked warm Canvas layers now use non-overridable paint isolation, preventing equipment from another Canvas from appearing over the selected workspace during tab switches.

## [0.16.3] - 2026-08-27

### Changed

- Inventory rendering now mounts only the active desktop or mobile presentation and virtualizes category and item rows, keeping filters, collapsed groups, and multi-selection state while sharply reducing off-screen DOM, drag hooks, menus, and listeners.
- Inventory search, filters, sorting, metadata filters, and collapsed categories now persist independently for each Canvas and return after visiting Systems, while bulk selections reset safely between canvases.
- Parked Canvas surfaces retain their warm React Flow view but suspend compatibility queries, geometry measurement, cable routing, viewport registration, and interactive controls until reactivated.
- Cable obstacle measurements now use stable typed geometry tuples instead of serializing and parsing every measured node update.
- Canvas route caches now persist only compact route results and reconstruct planner inputs from current measured geometry, reducing transferred cache data while safely rebuilding older caches.
- Signed catalog facets now use immutable revision-and-digest URLs, while narrowly consolidating Lucide modules reduces Systems and Canvas script-request fan-out without making Canvas code eager.
- Parked warm Canvas layers now ignore active-workspace-only updates, preserving instant tab returns without repeatedly committing hidden React trees.
- Systems no longer initializes the Canvas drag-and-drop provider when opened directly.
- Direct Systems startup now skips the full Canvas project, Registry link map, Agent detail, notifications, and catalog facets until a Canvas or explicit settings flow needs them.
- Production responses now negotiate Brotli or gzip compression, while content-addressed frontend assets use immutable one-year browser caching and the HTML shell always revalidates.
- Systems live updates preserve keyed row order and stable row objects, avoid repeated default-view sorting, and share one animation scheduler and reduced-motion observer across utilization meters.

### Fixed

- Recently used Canvas tabs now retain their rendered React Flow surfaces behind the persistent workbook shell, eliminating repeated blank, preparing, and loading states during warm Canvas and Systems navigation.
- Lazy workspace modules now reuse one resolved component identity across retained surfaces instead of recreating a suspense boundary for every mount.
- Route-cache reads and writes now require exact project and Canvas workspace scope, preventing one retained Canvas from reading or replacing another Canvas route cache.
- Warm Canvas eviction now removes the matching full project query snapshot, keeping browser memory bounded to the retained runtime pool.
- The Canvas inventory command now reports the visible desktop sidebar or mobile sheet state correctly, and empty inventory searches explain when availability filters are hiding matches.

## [0.16.2] - 2026-08-26

### Added

- The browser keeps the three most recently used Canvas runtimes warm, including their scoped engine, topology, cable routing state, and server-sent event stream.

### Changed

- Returning to Systems or a recently used Canvas restores its view state immediately after the initial load instead of rebuilding the workspace engine and rerouting unchanged cables.
- Opening a fourth Canvas evicts the least recently used inactive runtime, while active saves and mutations remain protected until completion.

## [0.16.1] - 2026-08-25

### Fixed

- Default and project-scoped Canvas reads now expose the same canonical project and workspace IDs, preventing false cross-project errors when copying host configurations.
- Copying a host configuration now starts from the current Canvas, targets a selected different Canvas, and places the same physical host automatically while preserving independent components, optional cables, and undo/redo.
- Numeric inventory searches now match visible product names and models, while `#ID` continues to perform an exact inventory lookup.

## [0.16.0] - 2026-08-25

### Added

- Each Canvas now maintains independent installed components, occupied slots, cable connections, manual routes, compatibility findings, and Systems attention state while continuing to reference the same physical inventory.
- Host Inspectors expose their canonical inventory ID, support copying an existing host configuration from another Canvas, and optionally copy compatible cable connections as one undoable change.
- Systems can filter hosts and installed-hardware summaries by Canvas, with canvas selection retained in saved views and browser preferences.

### Changed

- New manual and Registry-imported inventory defaults to the current project, while existing single-project global items migrate automatically to project ownership.
- Inventory search accepts exact canonical item identifiers such as `#48`, and canvas-specific Systems changes use scoped server-sent events.

### Fixed

- Returning equipment to inventory on one Canvas no longer removes installed components, connections, placements, or route cache from another Canvas.
- Registry updates and relationship migrations validate every affected Canvas; shared views, selective restoration, and compatibility projections retain their original canvas ownership.

## [0.15.6] - 2026-08-24

### Fixed

- lab.gd account status reconciliation now has an explicit protected authorization policy, allowing connected GitHub account details to refresh without failing with a missing-policy error.

## [0.15.5] - 2026-08-24

### Added

- Claimed lab.gd installations can unlink their GitHub account while retaining the stable sharing connection and choosing to keep, unpublish, or permanently delete all remote shares.

### Security

- Account unlink uses signed installation authentication, binding-revision concurrency control, durable idempotency, exact destructive confirmation, resumable SSE reconciliation, and identity-bound backup state.

### Fixed

- lab.gd account claims now reconcile as installation-level state, close the claim dialog after completion, remain connected after refresh or restart, and display the verified GitHub username without requiring a share to exist.
- Reopening account connection for an already claimed installation now converges on the existing owner instead of creating another claim.
- Distroless production images now verify that the complete lab.gd account-unlink service is present before an image can be published.

## [0.15.4] - 2026-08-23

### Fixed

- Settings navigation and content now remain clipped inside the dialog with independent scrolling, and the share editor uses its intended responsive desktop width instead of collapsing to a narrow form.

## [0.15.3] - 2026-08-23

### Fixed

- Agent setup now offers Alpine Linux as a first-class platform and generates root-shell install, update, and hardware-inventory commands without `sudo`.
- Expired lab.gd credentials now reactivate the existing installation UUID and Ed25519 key before resuming the same pending publication operation, preventing replacement identities or public share IDs.

## [0.15.2] - 2026-08-23

### Added

- Embedded Agent 0.3.4 adds Alpine Linux 3.22 and capability-based OpenRC support for AMD64 and ARM64 hosts, including unprivileged service management, rollback-safe updates, and OpenRC service telemetry.

### Changed

- Linux hardware inventory now remains useful when optional `dmidecode`, `lspci`, or `smartctl` tools are absent and recognizes trusted Alpine paths for `lsblk` and `ip` without installing host packages.
- Explicit direct Docker or Podman socket setup grants only verified supplementary-group access to the unprivileged Agent account and never changes socket ownership or permissions.

## [0.15.1] - 2026-08-23

### Fixed

- Automatic lab.gd enrollment now succeeds while remote publication remains safely gated, while publication writes continue to fail closed until LabGD explicitly enables publication.
- The coordinated rollout verifier now distinguishes connected enrollment readiness from the later publication-enabled certification phase.

## [0.15.0] - 2026-08-22

### Added

- Production installations can automatically enroll a separate stable Ed25519 identity with lab.gd, then configure privacy-reviewed public or unlisted Systems and Canvas shares without exposing the Homelab Inventory server.
- Sharing supports exact local previews, immutable or replaceable revisions, manual or one-minute debounced synchronization, expiration, exact iframe origins, and optional one-time resource snapshots.
- Sharing configuration and identity are independent selectable backup sections, while environment synchronization preserves each destination installation identity.
- Sharing now negotiates lab.gd capabilities and operation scopes explicitly, including protected-share handoff, remote lifecycle controls, GitHub account claiming, owner analytics, and resumable installation events.
- Claimed installations can manage revision-safe remote settings, protected passwords, unpublish/delete/republish lifecycle actions, and 90-day daily owner analytics directly from Homelab Inventory.
- Remote share state resumes from a transactionally committed SSE cursor without polling or duplicate event application.
- A read-only coordinated rollout verifier checks app health, lab.gd readiness, connected automatic enrollment, package-backed publication, and exact capability agreement without publishing data.

### Changed

- Optional sharing controls fail closed until lab.gd explicitly advertises the matching contract capability, and older installation credentials refresh before a newly scoped operation.
- Account claiming now uses lab.gd's single-use code, verification URL, and expiration contract instead of reconstructing an account URL locally.
- Lifecycle operations reuse stable idempotency keys across reconnects and restarts, and stale remote revisions reload instead of overwriting authoritative state.

### Fixed

- The final distroless image includes the resumable lab.gd installation-event coordinator required by the production sharing runtime.

### Security

- Tags and custom fields remain excluded unless selected, and the sharing projector allowlists public fields while excluding serials, addresses, credentials, Agent identity, telemetry history, audit data, and Registry enrollment.
- Demo, staging, and `LABGD_ENABLED=false` modes prevent sharing identity creation, enrollment, recovery, publication, and remote traffic.
- Complete and Sharing identity backups now preserve the deterministic public-ID key, and data synchronization proves that UUIDs, signing keys, credentials, recovery keys, and public-ID keys never cross environments.
- Installation tokens, events, claims, share controls, and analytics remain isolated by installation identity; claim codes stay out of URLs and protected-share plaintext passwords are never persisted locally.

## [0.14.1] - 2026-08-22

### Added

- Deterministic versioned share contracts, immutable read models, and reusable read-only React viewers now provide the public Systems, Canvas, workbook, Inspector, deep-link, and responsive rendering foundation for lab.gd.
- The canonical catalog protocol is available as a public, independently versioned package so external viewers can verify exact signed Registry revisions with Homelab Inventory's normalization, hashing, and contract rules.

### Changed

- Homelab Inventory now consumes the same shared ordering, identifier, and presentation helpers intended for the public viewer, with frozen cross-project fixtures guarding labels, ports, placements, connection endpoints, and private-data boundaries.
- Public catalog consumers receive verification code only; Registry private signing keys remain isolated to the Registry publication worker and are never packaged or shared with viewers.

### Fixed

- Catalog protocol `0.1.1` reconciles Homelab Inventory runtime fixtures with the Registry's frozen publication vectors, preserves the `0.1.0` public API, and establishes one deterministic package for signed catalog hashing and verification.
- First-run owner setup and subsequent authentication mutations now reconcile SQLite records by stable numeric ID without deleting protected built-in roles or the owner's required role assignment.

## [0.14.0] - 2026-08-19

### Added

- Installation-wide custom fields support short and long text, numbers with units and bounds, booleans, dates, date-times, URLs, and single- or multi-select options across applicable inventory types.
- Reusable colored inventory tags and typed metadata can be edited from item forms and Inspector tabs, searched and filtered in Inventory, and exposed as optional Systems columns and saved-view filters.

### Changed

- Systems saved views persist metadata filters and dynamic columns by numeric IDs, refresh through SSE, and keep tags below Name unless the dedicated Tags column is visible.
- Custom metadata and tags autosave after a short debounce, participate in application-wide Undo or Redo, and remain excluded from Registry contributions, template identity, and catalog refresh merges.
- Project presentation, workspace presentation, compatibility policy, inventory metadata, and descriptive inventory edits now use independent persistence revisions instead of advancing the workspace-engine topology revision.
- Empty Inspector metadata sections now open Settings directly on the matching Tags or Custom fields tab for users allowed to manage metadata.

### Fixed

- Archiving metadata definitions or tags preserves assigned values, while confirmed permanent deletion removes their values and saved-view references atomically without leaving invalid filters or column order.
- Date-time filters persist canonical UTC boundaries while retaining local browser input presentation.
- Non-topology Inspector and settings changes no longer rebuild the Rust/WASM workspace engine, clear unrelated selection state, or recalculate unchanged cable routes.
- Canvas placement Undo or Redo restores exact engine coordinates and reconciles the durable route cache without persisting transient empty geometry during remeasurement.
- Registry catalog definition enrichment advances linked inventory row versions without advancing project topology when assignments, ports, placements, and connections are unchanged.
- Embedded Agent binaries now build with the pinned Go 1.26.7 security patch before the zero-vulnerability container gate runs.
- Inventory metadata autosave now reuses its authoritative response and data-bearing SSE event instead of issuing duplicate item reads after every tag or custom-field change.
- Inspector metadata empty states no longer repeat internal Registry-boundary guidance or leave users without a direct creation path.

## [0.13.19] - 2026-08-19

### Fixed

- Switching between Systems and Canvas now starts a fresh workspace engine session without losing the selected item or Inspector, reusing stale topology, or showing false engine-not-ready warnings; automatic selection centering resumes after the new session is ready.

## [0.13.18] - 2026-08-19

### Fixed

- Systems Type and Name columns now scroll with the table on mobile while remaining pinned on desktop, keeping operational columns accessible on narrow screens.

## [0.13.17] - 2026-08-19

### Fixed

- CPU compatibility now recognizes exact and canonical ordinal generations across mixed host support lists, preventing valid combinations such as the Dell OptiPlex Micro 7010 and Intel Core i7-12700T from being rejected.
- Existing compatibility findings are rebuilt automatically after upgrade under evaluator version 2 without changing inventory, assignments, resource slots, workspace topology, private fields, or Registry links.
- Storage compatibility findings now retain the assigned numeric resource ID when a specific bay or slot is incompatible.

## [0.13.16] - 2026-08-18

### Fixed

- Systems CPU, memory, and storage meters now animate SSE-driven utilization changes with synchronized whole-number percentages while respecting reduced-motion preferences.

## [0.13.15] - 2026-08-18

### Fixed

- Catalog revision 24 refreshes now reconcile deterministic legacy and canonical M.2 A/E projections before strict v12 evaluation instead of failing after activation.
- Startup migration removes superseded WLAN-only acceptance constraints from canonical M.2 A/E resources while preserving their descriptive intended use, numeric resource and slot IDs, assignments, and linked inventory state.
- Registry updates now preserve assigned slots by their current canonical semantic key while retaining historical resource aliases only as identity fallbacks.

## [0.13.14] - 2026-08-18

### Fixed

- Catalog revision 24 now activates with byte-exact Registry fingerprint-v12 topology and content hashes while preserving canonical OEM names, tri-state bus evidence, and every signed historical identity alias.

## [0.13.13] - 2026-08-18

### Added

- Catalog contract v12 adds first-class physical M.2 A/E socket keying, tri-state PCIe and USB bus evidence, plural component bus requirements, and descriptive OEM intended use.
- Systems, Inspector, Canvas, and the Audit drawer now share one persisted server-side compatibility projection that updates through scoped SSE invalidations instead of independently recalculating host findings.
- Compatibility findings distinguish actionable incompatibilities from missing metadata, with informational findings available through Host Compatibility and the Audit drawer without inflating attention badges.

### Changed

- Existing WLAN-labeled M.2 A/E resources migrate automatically to canonical `m2-ae-slot` resources while preserving numeric resource and slot identities; A+E modules can fit A-key or E-key sockets when all declared bus requirements are satisfied.
- Compatibility checks now evaluate components against their assigned physical resource, understand canonical CPU-generation aliases, use a single-slot host expansion budget when appropriate, and treat unspecified ordinary memory ECC as non-ECC while retaining strict registered-memory checks.
- Canonical M.2 A/E resources describe the physical slot, accepted keys, buses, sizes, and intended module kinds without reducing the slot to WLAN-only use.

### Fixed

- The final distroless image now includes the canonical compatibility audit service and routes required by the shared Systems, Inspector, Canvas, and Audit projection.
- M.2 A/E OEM intended use no longer blocks physically compatible wired adapters, while missing bus evidence remains informational and proven key, size, lane, generation, or bus conflicts remain actionable.
- Unambiguous legacy component allocations are persisted automatically only when exactly one compatible destination exists; ambiguous allocations remain unchanged and actionable.
- Project backups and selective restores preserve compatibility finding relationships through semantic resource-slot remapping, while the retired wireless collection remains present at the schema-29 archive boundary.

## [0.13.12] - 2026-08-18

### Fixed

- Deterministic Registry topology migrations shown in review-required groups can now be resolved and applied through the same atomic workflow as blocked updates.

## [0.13.11] - 2026-08-18

### Fixed

- Empty OEM WLAN slot migrations are now shown and applied as one deterministic resource reclassification instead of a misleading expansion-slot removal and unrelated optional-module addition; the original numeric resource identity is preserved with or without assignments.
- Existing pending Registry reviews are reevaluated once after update semantics change, so Watchtower upgrades replace stale review payloads automatically without repeated work on later restarts.

## [0.13.10] - 2026-08-18

### Changed

- Systems and an open Agent Inspector now receive committed host rows, minute samples, and changed telemetry entities directly through the authenticated SSE stream; full REST snapshots are limited to initial load and recovery.
- Registry update comparisons now retain the signed source fingerprint as provenance while using the projected runtime canonical version for merge, policy, and review calculations.

### Fixed

- Systems utilization rows now use a compact 3.5-character percentage track with no artificial gap and retain a 125 px minimum width so short hardware labels cannot collapse their graphs.
- Opening a new SSE topic no longer immediately duplicates its initial REST request, while reconnects and missed stream generations still perform one authoritative resynchronization.
- OEM Registry reviews now compare the current inventory item with the final non-destructively merged proposal, preventing retained canonical power, CPU, and memory fields from appearing as removed.
- Legacy M.2 A/E WLAN assignments now move atomically to the canonical `optionalModuleSlots.wlan-m2` resource when the relationship is unambiguous, without changing the assigned component, workspace topology, route cache, private fields, or Registry link.

## [0.13.9] - 2026-08-18

### Fixed

- Embedded Agent 0.3.3 now reports Linux availability counters and FreeBSD page-class plus ZFS ARC counters so every supported host can calculate the same reclaimable-aware memory pressure.
- Systems memory utilization now reports kernel-estimated memory pressure consistently across Linux, FreeBSD, and OPNsense, keeping reclaimable cache, inactive pages, and ZFS ARC in available capacity instead of making healthy hosts appear full.
- Systems utilization percentages now use an exact four-character label track with a compact two-pixel gap before the graph, removing the oversized empty space between each value and its bar.

## [0.13.8] - 2026-08-18

### Fixed

- Systems CPU, memory, and storage percentages now align with the hardware text above them while a fixed four-character label track keeps every utilization bar anchored.
- Systems memory bars now separate live Linux used memory, buffers, and cache into compact colored segments while FreeBSD, OPNsense, offline, and incomplete Agents retain the clear green-and-gray utilization bar.

## [0.13.7] - 2026-08-17

### Added

- One authenticated Server-Sent Events connection now carries scoped invalidation signals for Systems, Agent fleet and host telemetry, notification summaries and incidents, release status, and demo-session changes.

### Changed

- Browser interval polling has been removed from application data flows; per-topic cursors resynchronize only affected queries after missed events, server restarts, and tab visibility changes.
- Systems live responses omit unchanged unregistered hosts and repeated Agent update commands, and Canvas fetches only notification counts while full notification configuration and incident pages load on demand.
- Agent online, stale, and offline transitions now follow the nearest server-side lifecycle deadline rather than waiting for a browser refresh interval.

### Fixed

- Systems CPU, memory, and storage utilization bars now show stable whole-number percentage labels without shifting the graph tracks.
- The distroless production image now includes the application live-event runtime required by the authenticated SSE endpoint.

## [0.13.6] - 2026-08-17

### Added

- The Systems workspace now provides a dense sortable and filterable host table with dedicated system, Agent, and Registry status icons; assigned CPU, memory, and storage summaries; current utilization; Agent version awareness; and whole-row Inspector access.
- Systems saved views now synchronize per account and project, with installation-wide ownership when authentication is disabled; views preserve filters, sorting, column visibility and order, density, and an optional default without synchronizing search text or browser-specific widths.
- Systems now includes an immutable Needs Attention view, configurable columns, Dense and Comfortable layouts, pinned Type and Name columns, keyboard row navigation, and virtualized rendering for fleets larger than 100 hosts.
- A cached per-host Attention projection combines pending Registry updates, compatibility and audit findings, and active notification incidents without reevaluating every system during table rendering; positive counts open a dedicated Inspector Attention tab.

### Changed

- Systems live state now uses compact project-scoped endpoints with conditional ETag responses and refreshes every 30 seconds only while the Systems workspace is active, visible, and online; Agent enrollment and unlinking appear without a page reload.
- The Inventory sidebar is available only on Canvas workspaces, with its open state and width retained independently per user, browser, project, and Canvas workspace.
- Opening a host from Systems now slides the Inspector into a responsive desktop split view that shrinks the table instead of covering it, while smaller screens retain the full overlay drawer.
- Systems title, filters, search, and table now share one consistent page gutter; filters and search occupy one toolbar row, and the table header remains outside the independently scrolling rows.

### Fixed

- Reloading a Systems workspace no longer starts or blocks on the Canvas domain engine, and switching back to Canvas starts a fresh workspace-scoped engine normally.
- Systems telemetry is attached only to hosts with an active Agent binding; unregistered, unknown, stale, and offline hosts keep single-line hardware summaries without misleading utilization bars.
- Compact system type, Agent, and Registry columns now keep their icon-led content centered as the table responds to the Inspector width.
- Systems headers and rows now share one column layout, keeping sortable labels aligned with compact and content columns while custom widths and pinned columns remain stable.
- Opening a Systems Inspector no longer attempts Canvas geometry synchronization or shows a misleading "Workspace engine is not ready" warning while the Canvas engine is intentionally disabled.
- Systems column resizing now changes the visible track width even when the Inspector is closed, while untouched columns continue distributing spare table width responsively.
- The distroless production image now includes every Systems API module required by the application server.

## [0.13.5] - 2026-08-17

### Fixed

- Agent heartbeat history now keeps the latest successful minute green throughout the configured online grace period and adds a missed slot only after the next heartbeat is genuinely overdue.

## [0.13.4] - 2026-08-16

### Fixed

- Registry catalog revision 21 now imports PCIe network adapters whose functional electrical minimum is unknown, without inferring that their full connector width is required.
- PCIe compatibility audits now enforce only evidenced `minimumElectricalLanes` values, so the Intel X520-DA2 is correctly accepted in the Synology DS1621+ x8-mechanical/x4-electrical slot.

## [0.13.3] - 2026-08-16

### Fixed

- Fractional Linux host uptime is now normalized to whole seconds at the telemetry ingestion boundary, preventing strict SQLite storage from rejecting otherwise valid Agent heartbeats.

## [0.13.2] - 2026-08-16

### Added

- Agent telemetry now uses acknowledged capability hashes, per-family state revisions, changed-record delivery, and six-hour full reconciliation while preserving outbound-only communication and compatibility with existing agents.
- Embedded Agent 0.3.2 persists compact synchronization state and sends unchanged capabilities and resource families only when requested or during reconciliation.

### Changed

- CPU and memory history is bounded to exactly 30 one-minute slots per host; services, containers, filesystems, GPUs, sensors, system facts, load, uptime, and storage health now update compact current-state records instead of repeating complete heartbeat payloads.
- Existing telemetry databases migrate automatically to verified schema 3 storage on startup, retaining manual hardware evidence and virtualization state while removing obsolete network, disk-I/O, per-core, and repeated snapshot history.

### Fixed

- Agent telemetry APIs now return fixed heartbeat and metric buckets plus an explicitly reconstructed current-state view instead of transferring historical payload objects on every inspector refresh.
- Service and container metric changes no longer create false lifecycle events, and canonical host relationships are resolved before telemetry persistence.
- Registry update evaluation now canonicalizes linked Network Adapters from the app runtime view before applying v11 validation, preventing legacy speed fields from blocking catalog startup recovery.

## [0.13.1] - 2026-08-16

### Fixed

- Startup now repairs unambiguous M.2 keying and module-size metadata omitted from upgraded wired Network Adapters and host expansion slots, preventing false compatibility alerts without overwriting curated values.

## [0.13.0] - 2026-08-16

### Added

- Catalog contract v11 imports Ethernet, Wi-Fi, cellular, Fibre Channel, InfiniBand, and converged Network Adapters with canonical host-interface topology, physical port capabilities, radio specifications, and typed forward-compatible fields.
- Network cable negotiation now uses compatible connector families, shared operating modes, and the greatest common canonical speed in bits per second.

### Changed

- Network cards and historical wireless cards now share one Network Adapter inventory category; startup migration preserves assignments, placements, cable connections, Registry links, and backward-compatible `wireless:<id>` aliases while emitting only `network:<id>` references.
- PCIe, M.2 A/E, M.2 B/M, Mini PCIe, USB, OCP, mezzanine, onboard, and proprietary adapter interfaces use dedicated compatibility fields and relational SQLite records instead of opaque JSON.
- Wi-Fi and cellular adapters remain assignable hardware but do not expose physical cable endpoints; wired and fabric adapters expose only their declared physical ports.

### Fixed

- Registry contributions exclude local Network Adapter labels, addresses, roles, notes, and administrative state, while linked updates preserve those local overrides and require review for attachment, host-interface, or radio-topology changes.
- Negotiated network speeds now use canonical `negotiatedSpeedBps` at the application boundary and `negotiated_speed_bps` in the engine, with Mbps accepted only when importing historical data.

## [0.12.14] - 2026-08-15

### Fixed

- Catalog range filters now index exact canonical measurements from historical signed templates, so RAM capacity and other numeric filters return the correct inclusive results after an automatic local index rebuild.
- Ambiguous historical measurement text remains available for display without making the verified catalog unavailable; only exact values participate in canonical range filters.
- Persisted inventory values that remain valid but are not in a curated option list are shown with their original name instead of an artificial `(Legacy)` suffix.
- NAS devices with internal power or fixed external adapters now show one `AC 01` header endpoint without a duplicate body power row, regardless of the endpoint's relational port position.

## [0.12.13] - 2026-08-15

### Fixed

- Blocked Registry updates now identify each changed field and impact, explain the exact blocking reason, and show the complete relationship migration before Resolve and apply is confirmed.
- Registry resource-key renames preserve assignments when the resource type and numeric ID are unchanged; fixed-power transitions move existing cables to the host endpoint and return obsolete adapters to inventory in the same atomic update.

## [0.12.12] - 2026-08-15

### Added

- Blocked Registry updates with a deterministic topology migration now offer a confirmed Resolve and apply workflow that previews cable remaps, assignment changes, and components returned to inventory before committing atomically.

### Changed

- Registry update review now uses compact paginated group lists, server-side filters, and lazy per-group details instead of transferring every current and proposed definition when the dialog opens.
- Catalog updates now compare canonical units, enums, identity enrichment, nested compatibility, fixed components, and ports semantically while preserving local instance fields and unknown supported Registry fields.

### Fixed

- Registry update counts and tabs now derive from one authoritative current projection, so historical evaluations no longer duplicate pending work and successful approvals remain Applied after closing, reopening, refreshing, or restarting.
- Approval and decline actions now use exact group membership, catalog hashes, and project revisions; only the clicked item shows progress, stale decisions fail explicitly, and an Applied receipt is returned only after every linked item proves the target revision was committed.
- Port slot zero is preserved as ordering metadata for canonical power inputs without weakening positive numeric ID and foreign-key validation.
- The first startup after this change performs one restart-safe semantic reevaluation, automatically applies newly safe trusted updates, and keeps relationship-changing updates blocked until they are explicitly resolved.

## [0.12.11] - 2026-08-15

### Fixed

- Fixed external NAS adapters are now recognized by the topology engine as host-owned power inputs, preventing false assigned-adapter audit warnings.

## [0.12.10] - 2026-08-15

### Added

- Catalog contract v10 imports complete NAS topology with fixed or soldered components, relational replaceable storage resources, canonical dimensions and mass, lifecycle metadata, and explicit external-adapter ownership.
- NAS canvas cards and inspectors show locked built-in CPU, memory, storage, and bundled power hardware separately from replaceable slots.
- NAS memory compatibility records OEM-supported and independently verified capacity limits separately, with a per-project opt-in for verified limits.

### Changed

- Fixed external NAS adapters now expose a host-owned AC endpoint, while replaceable adapters retain the existing inventory assignment and adapter-owned endpoint workflow.
- Existing NAS adapter assignments migrate as replaceable, and topology-changing catalog updates require review or are blocked when they would orphan assigned hardware.
- Portable selective and complete backups preserve every NAS v10 field and relational reference.
- Global Agent status polling now follows the one-minute heartbeat cadence and transfers only compact host state; detailed telemetry loads only for the host currently open in the Inspector.

### Fixed

- Compatibility checks now recognize equivalent storage form-factor labels and only alert on PCIe electrical lanes when a card's declared minimum is not met.
- Registry update decisions are retry-safe, show progress only on the selected group, remove completed groups immediately, refresh only affected projects, and avoid returning or refetching the complete update payload after every decision.

## [0.12.9] - 2026-08-14

### Added

- Verified official catalog updates can now apply automatically when compatibility, occupied slots, connected ports, assignments, and topology remain valid.
- A permanent Registry updates toolbar action groups changes by catalog template revision and provides Review, Applied, and Declined views with group approval, decline, and reconsider actions; the Notification Center summarizes the latest persisted run.

### Changed

- Automatic safe official updates are enabled by default, forced on in demo sessions, and can be disabled from Registry settings on regular installations.
- Registry update runs and decisions are persisted in SQLite and included in registry configuration backups so update processing is atomic across every affected project, idempotent, and restart-safe.

## [0.12.8] - 2026-08-14

### Fixed

- SQLite compatibility projection now keeps storage and expansion PCIe generations distinct, so compatible GPUs, network cards, sound cards, and wireless cards use their recorded numeric slots instead of reporting that slot generation is missing.

## [0.12.7] - 2026-08-14

### Fixed

- Assigned components and cable connections can now be removed when SQLite also cascades dependent slot, endpoint, or bend-point rows, without reporting a false missing-record error or rolling back the change.

## [0.12.6] - 2026-08-13

### Fixed

- Rebuilt all embedded Agent binaries with Go 1.26.6, removing eight newly disclosed Go standard-library vulnerabilities from the production image.

### Security

- Release preflight now rejects a superseded pinned Go patch and refreshes Trivy vulnerability data before scanning exact ARM64 and AMD64 OCI candidates.

## [0.12.5] - 2026-08-13

### Changed

- Docker releases now use an ARM64-first local staging pipeline that refreshes and sanitizes a consistent live-data snapshot, runs the exact distroless candidate at `127.0.0.1:8799`, requires explicit digest-bound approval, and postpones AMD64 construction until approval.
- Docker Hub publication now promotes the exact locally smoke-tested and zero-vulnerability OCI candidates without rebuilding; GitHub Actions retains source CI and scheduled published-image monitoring but no longer writes release images.

### Fixed

- Registry-linked DDR3L memory now survives SQLite import and restart without being collapsed to DDR3; existing affected hosts and modules repair automatically while preserving their Registry links.
- Single-slot hosts now render their installed memory across the full canvas-card width.
- Equal semantic versions no longer present an update solely because their image revision labels differ.
- Audit and Inspector now share one responsive drawer width and close each other when opened.

### Security

- Production-shaped staging strips authentication, identities, credentials, Agent bindings, Registry delivery state, notification secrets, and backup archives, and disables every outbound side effect before the candidate can start.

## [0.12.4] - 2026-08-12

### Changed

- Unchanged catalog generations now use a versioned verification receipt, streaming artifact hashes, and bounded SQLite integrity checks at startup instead of re-parsing the complete signed catalog. Full signature and topology validation still runs on activation and one-time legacy upgrades.
- Catalog corruption is isolated behind a catalog-only recovery state after the HTTP listener starts, keeping inventory, canvas, authentication, agents, telemetry, and settings available while a trusted local index is rebuilt.

### Fixed

- Selected workbook tabs now apply their configured color to the complete tab surface, including the reserved action-menu area, without a white block at rest or on hover.

## [0.12.3] - 2026-08-12

### Changed

- Catalog categories are now verified and warmed once during application startup, shared across Registry consumers, and prefetched in the browser before the Add Hardware dialog opens, removing the long first-open delay without retaining the full catalog in memory.

## [0.12.2] - 2026-08-12

### Fixed

- Agent container views now collapse duplicate IPv4/IPv6 port bindings and show each unique mapping in one directional chip with its protocol instead of separate host, container, and protocol chips.

## [0.12.1] - 2026-08-12

### Fixed

- First-start SQLite migration now snapshots large telemetry databases as a separate verified SQLite file instead of loading them into the size-limited portable archive, preventing mature Agent installations from entering a restart loop.
- The pre-migration backup path no longer opens or upgrades telemetry before the complete rollback set exists, and telemetry rekeying now runs in bounded batches instead of loading the full history into memory.
- Revoked Agent identities now remain historical host bindings when a replacement Agent is active on the same host during SQLite cutover.
- Failed first-start retries now retain only the newest verified pre-SQLite rollback set instead of accumulating another telemetry snapshot after every restart.
- Large telemetry migrations now use indexed keyset batches for historical samples and component events, avoiding progressively slower offset scans during first startup.
- Interrupted container migrations now distinguish process instances instead of trusting PID 1 alone, allowing an immediate safe retry after container recreation.
- Legacy telemetry with duplicate network, storage, or filesystem keys now keeps the first deterministic query projection while preserving the complete raw sample unchanged.

## [0.12.0] - 2026-08-12

### Added

- Replaced active LowDB persistence with normalized SQLite databases for core application state, telemetry, and the local catalog index, using typed relational tables, numeric foreign keys, WAL-mode connections, bounded read caches, and checksummed Drizzle migrations.
- Added automatic first-start migration with a verified encrypted backup, semantic parity checks, protected Registry identity preservation, atomic activation, and explicit recovery from interrupted migration or restore stages.
- Added multi-project workbooks with a compact project switcher, a fixed Systems workspace, multiple reorderable Canvas workspaces, per-project defaults, browser-local last-active workspace restoration, and Excel-style tabs at the bottom of the viewport.
- Added project-bound and global inventory scopes, explicit global-library membership, and clean cross-project duplication that omits serials, Registry links, Agent identity, telemetry, assignments, placement, and cabling.
- Connected installations now report only their application version and active catalog revision through a signed six-hour Registry adoption check-in.
- Added Registry catalog contract v9 with exact integer units for clocks, memory, storage, networking, power, voltage, dimensions, temperature, percentages, display refresh, and apparent power.

### Changed

- Portable backups now export logical format 2 archives with independent core, telemetry, and catalog schema versions while retaining format 1 import compatibility and dependency-aware selective restore.
- Initial workspace hydration now shares permission-aware application and workbook bootstrap responses after authentication, keeping normal multi-project startup within three API requests before background polling.
- Project compatibility policy, Canvas viewport and preferences, memberships, placements, assignments, connections, audits, manual cable bends, and route caches now belong to their numeric project and workspace records.
- New Registry contributions use fingerprint v9 while existing v2-v8 templates, links, identity aliases, and signed catalog revisions remain readable and reconcilable.
- Catalog filters and inventory forms format canonical values into familiar units without changing their exact persisted or comparison values.

### Fixed

- Pinned every Bun Docker build stage to one immutable runtime and added executable SQLite capability checks to final distroless image construction and the amd64/arm64 release preflight.
- Authentication users, credentials, OIDC identities, sessions, roles, permissions, invitations, and security history now round-trip through normalized relational tables instead of partial metadata projections.
- Interrupted SQLite restores now checkpoint WAL state and complete or roll back their journaled file swap without exposing a partial database.
- Multi-project restore remaps relational inventory, port, endpoint-face, and resource-slot identities through stable typed aliases, rejects malformed workbook columns, and preserves all project topology without copying internal SQLite pages.
- Registry v9 imports write canonical integers directly into SQLite, reject conflicting or precision-losing dual representations, preserve unknown public fields, and keep private installation identifiers out of contribution payloads.

## [0.11.2] - 2026-08-11

### Fixed

- Embedded Agent 0.3.1 now keeps its supervised FreeBSD and OPNsense `rc.d` service running by validating the supervisor PID against `daemon(8)`, instead of incorrectly treating a healthy agent as stopped and rolling back the installation.
- FreeBSD installation failures now include the final service status before rollback without exposing enrollment credentials or agent identity material.

## [0.11.1] - 2026-08-10

### Fixed

- Fresh public demo sessions now initialize the current empty agent-status store shape, keeping registry catalog access available without exposing production host telemetry.

## [0.11.0] - 2026-08-10

### Added

- Added catalog contract v8 support for exact physical RAM sticks, including manufacturer part-number identity, capacity, DDR generation, MT/s speed, DIMM or SO-DIMM form factor, UDIMM/RDIMM/LRDIMM electrical type, ECC, rank, voltage, and structured memory requirements.
- RAM add/edit and inspector workflows now expose the complete v8 specification, while host memory compatibility records physical form factors separately from electrical module types.
- Added an opt-in notification system for agent host availability and selected service, container, and physical-storage health changes, with persisted incidents, transitions, acknowledgements, cooldowns, reminders, and delivery attempts.
- Added reusable Ntfy and generic webhook contact points, workspace rules, severity overrides, quiet-hours schedules, per-host policies and temporary mutes, and a toolbar Notification Center for active and historical incidents.
- Embedded Agent 0.3.0 receives and acknowledges a revisioned monitoring policy that increases service collection to one minute only when selected services require it and otherwise retains the ten-minute service cadence.

### Changed

- Agent hardware suggestions now map exact DIMM part numbers to `number` and interpret SMBIOS capacity, generation, effective speed, physical form factor, module type, ECC, rank, and voltage as independent reviewable fields.
- Registry contribution discovery uses RAM fingerprint v8, deduplicates identical physical sticks while retaining every local source reference, and keeps generic or unidentified RAM local and detached.
- Host outages inhibit child service, container, and storage notifications; inhibited alerts resume after recovery, recovery messages are sent only to destinations that received the opening alert, and failed deliveries use bounded persisted retries before requiring manual action.
- Notification evaluation now rejects replayed sequences and stale buffered evidence without treating agent clock offset as an outage, preventing reconnect backlogs or process restarts from duplicating incidents or falsely recovering hosts.
- Agent contract negotiation remains backward-compatible during staggered app and Agent upgrades, so existing Agents keep reporting while newer Agents opt into revisioned monitoring acknowledgements.
- Complete and custom backups can include notification configuration, encrypted credentials, incident history, and the local encryption key as a validated dependency-aware section.

### Security

- Contact-point credentials and generic webhook destination URLs are encrypted at rest with a local mode-`0600` AES-256-GCM key, remain redacted from APIs and logs, and are never created or delivered in public demo sessions.

### Data migration

- Schema 29 migrates legacy RAM `speed` to `speedMt`, canonicalizes `SODIMM` as `SO-DIMM`, and separates host `formFactors` from `moduleTypes` after a verified pre-migration backup without changing inventory IDs, assignments, slot positions, placements, cables, registry links, or route caches.
- Schema 28 grants the new static notification permissions to existing built-in roles while preserving custom roles, accounts, assignments, inventory, canvas placement, cables, agent identity, and telemetry.

## [0.10.0] - 2026-08-09

### Added

- Added catalog contract v7 support for retail motherboards, including exact registry import and contribution identity for aliases, board revisions, chipset and form factor, fixed I/O, CPU and memory limits, storage and expansion topology, and internal board-power requirements.
- Motherboard Add Hardware and inspector forms now share dedicated Specs, CPU, Memory, Storage, Expansion, Ports, Power, and Compatibility tabs, while power supplies can record the ATX and CPU leads they provide.
- Embedded agent 0.2.0 now reports raw physical storage, partition, filesystem, LVM/RAID, and mount topology on Linux and FreeBSD without normalizing evidence on the host.
- Agent-connected hosts now show aggregate local-storage usage, and confidently mapped storage items gain a Usage tab with physical-device details, mount-level capacity bars, partition tables, and block topology.

### Changed

- Assigned motherboards now authoritatively validate custom PC CPU, RAM, storage, expansion-card, and PSU compatibility. Registry topology updates are blocked when they would make installed parts incompatible, without changing assignments, canvas placement, cables, local labels, or project policy.
- Catalog search now finds motherboards by alias, chipset, socket, CPU generation, and board revision, and assigned motherboard network and display ports remain available as PC Build connection endpoints.
- Storage suggestions resolve known vendor aliases such as SPCC to readable manufacturers and can fill model, capacity, interface, partition table, and locally stored serial fields independently.
- Filesystem totals exclude remote shares, container/runtime mounts, loop images, pseudo filesystems, and duplicate bind mounts; ZFS and Btrfs storage is counted once while eligible mount points remain inspectable.

### Security

- Storage serial numbers and other private device identifiers remain available only in local inventory and agent evidence; registry contribution payloads and hashes continue to omit them.

### Data migration

- Schema 27 validates the v7 motherboard and numeric resource relationships after creating the standard pre-migration backup, preserving existing inventory, assignments, placements, cables, registry links, and route-cache entries unchanged.

## [0.9.9] - 2026-08-08

### Fixed

- Agent hardware review now keeps complete JSON evidence inside its dialog, maps detected DIMMs to assigned RAM by natural physical slot order, identifies each suggestion's source slot, and resolves verified JEDEC module IDs into readable manufacturer names without suggesting opaque codes.

## [0.9.8] - 2026-08-08

### Changed

- The Agent inspector keeps the elevated hardware inventory command available after a scan, refreshes scan evidence while the tab is open, and provides a local full-JSON evidence viewer for troubleshooting.

### Fixed

- Heartbeat history now follows the agent's reporting cadence and online grace period instead of wall-clock minute boundaries, preventing the newest healthy heartbeat from appearing missed.
- Agent field suggestions disappear once the complete proposed value has been applied and return only when the field differs again.

## [0.9.7] - 2026-08-08

### Fixed

- Native agent updates can now read the public current-release descriptor when application authentication and authorization are enabled, while unknown and non-read release operations remain denied.

## [0.9.6] - 2026-08-08

### Fixed

- Agent upgrades now recover automatically when an older embedded schema makes the derived contract cache incompatible, fetching and atomically activating the current contract without changing identity, enrollment, configuration, or queued telemetry.
- Linux and FreeBSD installers now require sustained post-restart service health and roll back instead of reporting success when an updated agent immediately enters a restart loop.

## [0.9.5] - 2026-08-08

### Added

- Registered Linux and FreeBSD agents can now advertise native manual updates, allowing administrators to use `sudo homelab-inventory-agent update` after the one-time transition from a legacy release.
- The Agent inspector now provides a dedicated unlink action with an optional, unchecked control to permanently delete telemetry history for only that host.

### Changed

- Agent setup is hidden after a host is registered, update instructions appear only when a newer compatible release exists, and command selection is based on reported agent capabilities instead of a hardcoded version.

### Security

- Native agent updates verify the configured application origin, protocol, platform, file sizes, and SHA-256 digests before atomically replacing root-owned files, with automatic rollback if the updated service is unhealthy.
- Revoked agents persist a dormant state and stop delivery retries; unlinking retains telemetry unless an administrator explicitly opts into host-scoped deletion.

## [0.9.4] - 2026-08-08

### Added

- Agent inspectors now show the host operating-system version and uptime, provide independent service scope and runtime-state filters, and display container CPU, memory, uptime, Compose service, published ports, and network metadata.

### Fixed

- Agent CPU and memory charts now render complete percentage labels instead of clipping every numeric tick.

### Changed

- Updated agents classify services without a hardcoded name allowlist and provide richer optional protocol-v1 container metadata without requiring broader Docker API permissions; older agent payloads remain supported.

## [0.9.3] - 2026-08-07

### Fixed

- Fresh agent setup now replaces stale device identity and queued sequence state transactionally, preventing retries from failing with `Agent identity is invalid` while restoring the previous installation exactly if activation or the first heartbeat fails.
- Agent upgrades continue to preserve the active identity and configuration instead of rotating credentials.

### Changed

- Agent release validation now runs the real installer in Ubuntu 24.04 across disabled telemetry, Docker-proxy telemetry, failed-activation rollback, stale-identity replacement, and upgrade paths.

## [0.9.2] - 2026-08-07

### Fixed

- Embedded agent 0.1.2 now starts and enrolls correctly when optional container telemetry is disabled instead of dereferencing an unset container collector.

## [0.9.1] - 2026-08-07

### Fixed

- Embedded agent 0.1.1 now negotiates the current Docker-compatible API version advertised by each runtime and performs one bounded renegotiation if the supported range changes.
- Agent heartbeats now accept standards-compliant RFC 3339 UTC timestamps with up to nanosecond precision and return a controlled authentication error for malformed signed metadata.
- The open Agent inspector now refreshes host status, heartbeat history, and metrics every minute even while a host is unknown, stale, or offline.

## [0.9.0] - 2026-08-07

### Added

- Added the protocol-v1 foundation for the independent Homelab Inventory Agent, including a versioned capability contract, Ed25519 request signatures, replay protection, bounded gzip heartbeats, and typed enrollment for servers, NAS devices, and custom PC builds.
- Added an isolated WAL-mode SQLite telemetry database with atomic one-minute samples, indexed latest-state projections, service/container/storage transition history, seven-day default retention, and bounded maintenance.
- Added the first Linux agent telemetry profile for CPU and per-core utilization, load, memory and swap, ZFS ARC, filesystems, detailed disk I/O, aggregate and per-interface networking, sensors, batteries, systemd services, averaged GPU metrics, eMMC/mdraid health, and explicitly allowlisted SMART devices.
- Added reproducible, checksummed agent packages for Linux AMD64/ARM64 and FreeBSD AMD64, including hardened unprivileged systemd and rc.d services, identity-preserving upgrades, rollback, uninstall, SBOM, provenance, and vulnerability gates.
- Added FreeBSD and generic OPNsense telemetry for CPU, memory, load, filesystems, disk I/O, networking, sensors, batteries, rc.d services, and sanitized PCI/storage inventory with honest permission-blocked states.
- Added an explicit one-time privileged hardware scan for Linux and FreeBSD that previews detected components before sending motherboard, chassis, BIOS, CPU, DIMM, storage, PCI, NIC, GPU, and power evidence to its assigned host.
- Added host-scoped detected-hardware and field-suggestion APIs that match existing assigned components by opaque fingerprint, physical locator, or safe one-to-one position without changing inventory automatically.
- Added capability-driven Agent, Services, and Containers inspector tabs with a 30-minute heartbeat timeline, one-minute CPU and memory charts, health states, and detected-hardware summaries.
- Added per-field detected-hardware suggestions to inventory editors, including explicit replacement confirmation and normal Undo support.
- Added opt-in, read-only Docker and Podman telemetry through a credential-free loopback proxy or an advanced local socket, with strictly allowlisted container fields.
- Added a pinned, verified agent release inside the application image for Linux AMD64, Linux ARM64, and FreeBSD AMD64, with immutable self-hosted downloads and generated Linux or FreeBSD/OPNsense setup commands.
- Added manual agent update notices and backend-generated upgrade commands when an enrolled host reports an older agent version.

### Changed

- Agent relationships now use explicit compute-host types and numeric relational IDs while legacy server-agent endpoints remain available during the transition to the compiled agent.
- Complete and Agent telemetry backups now preserve the full SQLite sample, service, container, and storage-health history with relational preflight validation and transactional replacement.
- Telemetry persistence completes before an agent sequence is acknowledged, and telemetry writes never advance the project revision or modify inventory, canvas placements, assignments, or cables.
- GPU samples are averaged in agent memory before the normal one-minute heartbeat, services refresh on the contract cadence, and SMART requires both server approval and a local device allowlist.
- Services and Containers tabs appear only when the assigned agent reports the corresponding capability, while Virtualization remains hidden until a collector exists.

### Security

- Protocol-v1 heartbeats authenticate the exact compressed request body, HTTP method, path, timestamp, and monotonic sequence with an enrolled Ed25519 device key. Demo sessions cannot enroll, activate, or submit agent data.
- Linux collector commands use fixed arguments, strict time and output bounds, and no shell. SMART checks avoid waking standby disks and remove raw serial numbers and WWNs before transmission; hardware references use installation-specific opaque identifiers.
- FreeBSD collection uses fixed read-only commands with bounded output and timeouts, omits GEOM identifiers, never reads OPNsense configuration, and never accesses firewall, VPN, routing, gateway, CARP, NAT, configd, or hidden process data.
- The privileged scanner never reads the Ed25519 private key or makes a network request. It submits through a root-authenticated local Unix socket to the unprivileged daemon, which validates the payload again before signing and sending it.
- Container telemetry excludes environment variables, labels, commands, arguments, mounts, secrets, and inspect payloads; collection remains disabled unless both the application contract and local agent configuration permit it.

### Data migration

- Schema 25 automatically converts legacy server-only agent enrollment and status references to typed compute-host relationships without changing agent IDs, token hashes, timestamps, or retained status.
- Schema 26 initializes numeric latest-hardware snapshot and bounded non-sensitive change-event records. Existing inventory, assignments, canvas placements, cables, agent identities, and telemetry remain unchanged.

## [0.8.7] - 2026-08-05

### Fixed

- Cable routing now detects legacy terminal bends that reverse across an endpoint, corrects only the invalid terminal anchor, and saves all repairs as one Undo-compatible project change.
- Persisted route-cache entries must match the currently measured endpoint candidates, and each connection now has exactly one cached outcome so stale or impossible routes are never rendered as valid cables.
- Local/live data synchronization keeps each destination's derived route cache instead of copying browser-measured geometry between environments.

### Changed

- Matching route caches render immediately while the rebuilt WASM worker is synchronized in the background; planner version 12 performs one bounded cache refresh after upgrade.

## [0.8.6] - 2026-08-05

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
