export type ReleaseNoteChannel = 'latest' | 'stable' | 'release'

export type ReleaseNoteEntry = {
  version: string
  date: string
  channel: ReleaseNoteChannel
  title: string
  highlights: string[]
  fixes: string[]
  notes?: string[]
}

export type UnreleasedReleaseNotes = {
  highlights: string[]
  fixes: string[]
  notes: string[]
}

const RELEASE_0_2_0_DETAILS: UnreleasedReleaseNotes = {
  highlights: [
    'A shared Rust/WASM workspace engine now runs in a dedicated browser worker and on the Bun server, establishing a faster deterministic foundation for upcoming routing, compatibility, topology, and inventory operations.',
    'Project changes now carry persisted revisions and committed-update events so open browsers can reconcile incremental changes or rebuild safely after a missed update.',
    'Canvas overlap checks, multi-item movement, nearest placement, and auto-arrangement now run in the shared Rust/WASM worker using an indexed geometry model.',
    'Network, display, and power cables now use short orthogonal paths around canvas equipment while still allowing cable crossings.',
    'Selected cable segments support double-click manual anchors, per-bend removal, Reset route, and Undo or Redo for every routing edit.',
    'General workspace preferences now offer optional 12 px cable snapping and 24 px canvas-item snapping, both disabled by default.',
    'Individual cables can now avoid long horizontal and vertical overlap with other routes while keeping crossings and shared endpoint approaches available.',
    'General workspace preferences can now apply cable collision avoidance to the entire canvas without changing saved per-cable choices.',
    'NAS equipment can now use either a direct internal-PSU connection or a manually assigned external power adapter.',
    'NAS canvas cards expose the active power path without rendering inactive adapter slots or duplicate electrical endpoints.',
    'Inspector audit findings can now be ignored or restored in place while acknowledged findings remain visible for context.',
    'Power strips can now enable smart mode with a device display name, management IP, MAC address, and custom names for individual outlets.',
    'Smart power-strip identity appears on the canvas while outlet chips remain compact and expose custom names in their tooltips and Inspector details.',
    'Network, power, and display cables now have independent visibility controls in the canvas toolbar and General workspace settings.',
    'Cable pathfinding, lane separation, manual bend editing, and route caching now run in the shared Rust/WASM worker instead of duplicate browser-side routing engines.',
    'Connection endpoints, port occupancy, compatibility filtering, validation, negotiated network speeds, path tracing, and power findings now run in the shared Rust/WASM worker.',
    'Topology results are coordinated per project revision so canvas and Inspector interactions reuse one deterministic snapshot instead of recalculating connection state in the browser.',
  ],
  fixes: [
    'Workspace startup and recovery now show explicit loading, rebuilding, unsupported-browser, and failed states instead of allowing interaction with an unavailable or stale engine.',
    'Project-name autosave now uses an optimistic revision-checked command and rolls back to canonical data after a conflict without retrying the mutation automatically.',
    'Canvas geometry uses an independent transient revision and fingerprinted synchronization so ordinary Inspector edits do not rebuild placement state or add undo history.',
    'The production image now compiles and optimizes WASM in an isolated Rust builder while excluding Rust source, tests, build tools, and WASM development data from the non-root runtime image.',
    'Automatic cable detours preserve valid manual bends, recover temporarily covered anchors, and reroute only after equipment movement commits.',
    'Automatic routes now honor configured endpoint sides, use measured card boundaries, and avoid traveling beneath source or destination equipment.',
    'Overlap-aware cable routing resolves deterministic separate lanes without moving manual anchors or persisting generated bends.',
    'Cable planning now runs in a background worker with a stable canvas activity indicator, while pan and zoom no longer serialize every measured port handle.',
    'Resetting or editing one cable route now preserves unrelated canvas nodes, route objects, and React Flow edges instead of making the entire cable layer blink.',
    'Cable paths now remain stable during cable clicks, equipment focus, Inspector opening, hover, and canvas deselection instead of briefly moving or disappearing.',
    'Moving a cable segment now collapses clear endpoint staircases into the fewest bends without routing through other equipment.',
    'Creating power adapters and other powered inventory now materializes their canonical numeric power ports before relational validation.',
    'New OEM power adapters retain one draggable AC-input endpoint for connections to UPS and power-strip outlets.',
    'Assigned server power adapters now use the power-equipment color treatment and expose their AC input directly on the server canvas card.',
    'Changing a NAS power mode now previews affected cables and adapters, then applies the confirmed cleanup as one Undo-compatible project change.',
    'Canvas AC input chips now use the compact AC label instead of AC-INPUT.',
    'Disabling smart mode now requires confirmation and removes only smart-device metadata without changing outlets, cables, or canvas layout.',
    'Cable routes now require prior selection and meaningful pointer movement before they can be repositioned, preventing ordinary clicks from shifting power, network, or video cables.',
    'New connections no longer open the Inspector by default; users can restore automatic opening for every connection workflow in General workspace preferences.',
    'External power-adapter cables now attach to the adapter port chip, while direct internal PSU cables remain attached to the host header port.',
    'Removing an assigned component with connected ports now requires confirmation and removes its cable relationships atomically so the project cannot retain dangling endpoints.',
    'Inventory drag previews now match the canvas zoom and final placement footprint so constrained drops no longer rely on an oversized representation.',
    'Changing one cable now recalculates only that route and later lane-dependent routes, preserving unrelated cable geometry and reducing canvas stalls.',
    'Removed duplicate browser-side topology implementations and retained legacy network normalization only for ordered historical data migrations.',
    'Externally committed connection changes now replay incrementally through the local worker without rebuilding the complete workspace engine.',
    'Existing power strips with a canonical AC input at slot zero no longer prevent the workspace engine from starting.',
    'Moving one or several selected canvas items now saves one atomic placement patch without clearing the canvas or rebuilding unrelated equipment and cable routes.',
    'Topology, geometry, handles, and cable planning now retain prior results and refresh only when their relevant project inputs change.',
    'Routing and synchronization activity now appears in a delayed top-left canvas indicator instead of adding and removing a slot from the bottom toolbar.',
    'Component assignment saves and later canvas moves now share one canonical persistence queue, preventing optimistic revision conflicts and lost updates.',
    'Routine workspace synchronization now keeps the canvas interactive instead of briefly showing a centered rebuilding overlay.',
    'Component assignment now refreshes only affected host cards and nearby cable geometry, while expected engine synchronization retains existing routes instead of flashing a false routing error.',
    'Transient canvas routing and synchronization activity now logs to the browser console even when it completes too quickly to display visually.',
    'Assigning, moving, swapping, or removing a component now commits one incremental WASM change while retaining optimistic canvas references, preventing repeated routing and workspace synchronization after a single drop.',
    'Clean-checkout tests and Docker publishing now build WASM before integration tests, preventing missing-artifact races on hosted runners.',
    'The production runtime image now includes the canonical engine snapshot and legacy migration normalizer while omitting the removed browser negotiated-speed module.',
  ],
  notes: [
    'Local development now uses the standard ignored data directory after the isolated WASM migration, with DATA_DIR still available for explicit overrides.',
  ],
}

const RELEASE_0_3_0_DETAILS: UnreleasedReleaseNotes = {
  highlights: [
    'Settings now links directly to the public roadmap, private feature proposal form, and GitHub bug reporting from a dedicated Feedback section.',
    'Fresh workspaces can now explore a complete fictional homelab or start empty with an adaptive create, place, and connect checklist.',
    'A three-step guide demonstrates host inspection, network cabling, and power delivery, then offers to keep the example or remove all sample-owned records and relationships.',
    'Project settings can review an active example, restart Getting Started, or dismiss the checklist without interrupting normal workspace use.',
  ],
  fixes: [
    'The fictional example now opens with a deliberately spaced topology and a one-time fit-to-view so equipment and cable paths are immediately readable.',
    'Connections remain visible while attachment-side changes are recalculated by retaining the prior route and rendering a temporary orthogonal fallback when needed.',
    'Explicit cable sides such as Top to Bottom now use side-aware WASM pathfinding without dangling, backtracking, or self-overlapping endpoint segments.',
    'Resetting cable bends now discards cached manual geometry and rebuilds clear endpoint trunks outside equipment boundaries.',
    'Tall equipment cards now include their external Top and Bottom portals in the bounded WASM search area, preventing valid cable routes from failing or falling back through equipment.',
  ],
  notes: [
    'Feedback links include only the public app version and source label; inventory records and diagnostics are never attached.',
    'Schema 14 stores onboarding progress locally with the project, dismisses existing nonempty installations automatically, and creates no telemetry.',
    'The bundled example uses fictional hardware and can be removed atomically without deleting inventory records created by the user.',
  ],
}

const RELEASE_0_12_0_DETAILS: UnreleasedReleaseNotes = {
  highlights: [
    'Core application state, Agent telemetry, and the local Registry catalog now use independent SQLite databases with typed relational data, numeric foreign keys, checksummed migrations, WAL mode, and bounded read caches.',
    'Existing JSON installations migrate automatically after a verified complete backup, with semantic validation for inventory, topology, Registry identity, access control, notifications, telemetry, and catalog state before atomic activation.',
    'Multiple projects now share one workbook shell with a compact project switcher, a fixed Systems workspace, multiple reorderable Canvas workspaces, per-project defaults, and bottom tabs that preserve the familiar canvas workflow.',
    'Inventory can remain project-bound or be promoted into the global library for explicit reuse, while clean cross-project duplication creates an independent record without copying instance identity, assignments, placement, cables, or telemetry.',
    'Registry catalog contract v9 uses exact canonical integers for measurable hardware specifications while retaining v2-v8 catalog compatibility, identity aliases, and linked-item continuity.',
  ],
  fixes: [
    'The production image now pins its Bun runtime and verifies the complete SQLite capability contract during distroless image construction and multi-architecture release preflight.',
    'Journaled SQLite restores now checkpoint WAL state and recover interrupted file swaps without exposing partial data, while normalized authentication tables preserve every account, identity, role, invitation, and security record.',
    'Project compatibility rules, Canvas preferences, topology, audits, manual cable bends, and route caches now remain isolated by numeric project and workspace IDs across navigation, restart, backup, restore, and disposable demo sessions.',
    'Large Agent histories migrate through indexed, memory-bounded keyset batches so mature installations do not stall during first-start SQLite conversion.',
    'Interrupted first-start migrations now reclaim locks from a previous container instance even when the replacement process also runs as PID 1.',
    'Historical Agent samples with repeated interface, disk, or mount keys now migrate into deterministic unique query projections while retaining the original raw evidence.',
    'Canonical Registry values import directly into SQLite without scaling, conflicting or precision-losing representations are rejected, and familiar units remain available through display-only adapters.',
    'Registry contributions no longer expose local adapter keys or project scope while unknown public product fields remain available for forward-compatible catalog records.',
  ],
  notes: [
    'Portable backups now use logical format 2 archives with independent database schema versions, retain supported format 1 imports, and preserve dependency-aware selective restore without copying uploaded SQLite files over active data.',
    'Initial workspace loading now uses permission-aware application and workbook bootstraps after authentication, keeping normal multi-project startup within three API requests before scheduled background refreshes.',
    'The original JSON files remain byte-identical after successful migration but are no longer active stores; the SQLite migration guide documents verification and rollback.',
    'Connected enrolled installations now send a signed six-hour catalog adoption check-in containing only the application version, catalog contract version, active catalog revision, and request timestamp; failures never block startup, inventory work, or catalog browsing.',
    'The application reports catalog contract 9; Registry publication remains owner-controlled and catalogs requiring a newer contract are rejected explicitly.',
  ],
}

const RELEASE_0_12_1_DETAILS: UnreleasedReleaseNotes = {
  highlights: [],
  fixes: [
    'First-start SQLite migration now preserves large Agent telemetry databases in a separate verified SQLite snapshot and transforms their history in bounded batches, preventing mature installations from exceeding portable-backup limits or exhausting memory.',
    'The migration backup path no longer opens or upgrades telemetry before its rollback set is complete, and records the archive, telemetry snapshot, hashes, permissions, and schema in one private manifest.',
    'Revoked Agent identities now remain historical host bindings when a replacement Agent is active on the same host.',
    'Failed first-start retries now retain only the newest verified rollback set instead of accumulating duplicate telemetry snapshots.',
  ],
  notes: [],
}

const RELEASE_0_12_2_DETAILS: UnreleasedReleaseNotes = {
  highlights: [],
  fixes: [
    'Agent container views now collapse duplicate IPv4/IPv6 port bindings and show each unique host-to-container mapping with its protocol in one compact chip.',
  ],
  notes: [],
}

const RELEASE_0_12_3_DETAILS: UnreleasedReleaseNotes = {
  highlights: [],
  fixes: [
    'Catalog categories now open without the previous cold-start delay by sharing one verified local catalog runtime, warming its compact filter index at startup, and prefetching revision-specific category data before the Add Hardware dialog opens.',
  ],
  notes: [],
}

export const UNRELEASED_RELEASE_NOTES: UnreleasedReleaseNotes = {
  highlights: [],
  fixes: [],
  notes: [],
}

const RELEASE_0_11_2_DETAILS: UnreleasedReleaseNotes = {
  highlights: [],
  fixes: [
    'Embedded Agent 0.3.1 keeps its supervised FreeBSD and OPNsense service running by tracking the correct supervisor process, and reports a sanitized service status before rolling back a genuine startup failure.',
  ],
  notes: [],
}

const RELEASE_0_11_1_DETAILS: UnreleasedReleaseNotes = {
  highlights: [],
  fixes: [
    'Fresh public demo sessions now initialize a valid empty agent-status store, so the connected registry catalog remains available without carrying production host telemetry into the sandbox.',
  ],
  notes: [],
}

const RELEASE_0_11_0_DETAILS: UnreleasedReleaseNotes = {
  highlights: [
    'Catalog contract v8 imports and preserves exact physical RAM sticks with manufacturer part-number identity, complete reusable specifications, and structured memory requirements.',
    'RAM forms and inspectors now separate DIMM or SO-DIMM physical fit from UDIMM, RDIMM, or LRDIMM electrical type and validate ECC requirements independently.',
    'Opt-in agent notifications now support reusable Ntfy and generic webhook destinations, persisted incidents, quiet hours, per-host policies, selected service/container/storage monitoring, and a toolbar Notification Center.',
    'Notification rules can configure severity, debounce, per-resource and per-destination cooldowns, optional reminders, and bounded delivery retries without coupling incident detection to a specific provider.',
    'Embedded Agent 0.3.0 applies revisioned monitoring policies from outbound heartbeat responses and acknowledges the active revision on a later heartbeat.',
  ],
  fixes: [
    'Agent hardware suggestions now map DIMM part numbers to the exact number field and expose independently reviewable capacity, DDR generation, MT/s speed, form factor, module type, ECC, rank, and voltage values.',
    'Generic RAM without a reliable manufacturer part number stays local, while identical eligible sticks deduplicate into one sanitized registry candidate without losing their physical source references.',
    'Host outages now inhibit child-resource alerts and reminders, inhibited alerts resume after recovery, and recovery is sent only to destinations that received the opening alert.',
    'Persisted sequence cursors reject replayed or stale buffered evidence across restarts while tolerating stable agent clock offsets, preventing duplicate incidents and false host recovery during reconnects.',
  ],
  notes: [
    'Schema 29 creates a verified backup, migrates RAM speed to speedMt, canonicalizes SO-DIMM spelling, and separates legacy host form factors from electrical module types while preserving numeric IDs and project topology.',
    'The application now reports catalog contract 8; signed catalogs requiring a newer contract remain blocked.',
    'Notifications are disabled by default. Contact credentials and generic webhook destination URLs are encrypted with a local mode-0600 key, included only in encrypted dependency-complete backups, and unavailable in public demo sessions.',
    'Schema 28 adds notification permissions to existing built-in roles without changing custom roles, inventory, topology, cables, agent identity, or telemetry.',
  ],
}

const RELEASE_0_10_0_DETAILS: UnreleasedReleaseNotes = {
  highlights: [
    'Retail motherboards can now be imported from catalog contract v7 with complete CPU, memory, storage, expansion, fixed-I/O, and board-power topology, then edited through dedicated motherboard tabs.',
    'Assigned motherboard topology now drives custom PC compatibility, including PSU lead requirements, and unsafe registry revisions are blocked until incompatible installed parts are resolved.',
    'Agent-connected hosts now show aggregate local-storage usage, while mapped storage items gain a Usage tab with per-mount capacity, partition-table, physical-device, and block-topology details.',
    'Embedded agent 0.2.0 preserves raw disk, partition, filesystem, LVM/RAID, and mount evidence on Linux and FreeBSD so the backend can offer independent inventory-field suggestions.',
  ],
  fixes: [
    'Local-storage totals exclude remote shares, container and runtime mounts, loop images, pseudo filesystems, and duplicate bind mounts while avoiding duplicate ZFS and Btrfs capacity.',
    'Storage vendor aliases are interpreted server-side, and serial numbers remain local-only instead of entering registry contributions or reusable catalog hashes.',
  ],
  notes: [
    'Schema 27 validates motherboard resource relationships after a pre-migration backup while preserving existing inventory, assignments, canvas placements, cables, registry links, and route caches.',
    'Motherboard catalog search includes aliases, chipset, socket, CPU generation, and board revision; contract versions newer than v7 remain explicitly unsupported.',
  ],
}

const RELEASE_0_9_9_DETAILS: UnreleasedReleaseNotes = {
  highlights: [],
  fixes: [
    'Agent hardware review now contains complete JSON evidence inside its dialog, maps detected DIMMs to assigned RAM by physical slot order, identifies each suggestion source, and resolves verified JEDEC module IDs into readable manufacturers.',
  ],
  notes: [],
}

const RELEASE_0_9_8_DETAILS: UnreleasedReleaseNotes = {
  highlights: [
    'Detected hardware evidence can now be inspected as complete formatted JSON from the Agent tab, while the inventory scan command remains available for future hardware changes.',
  ],
  fixes: [
    'Heartbeat history now follows the agent cadence and online grace period, so a healthy latest report no longer appears as a red missed interval at wall-clock minute boundaries.',
    'Agent field suggestions now disappear after their complete proposed value is applied and return only when the field differs again.',
  ],
  notes: [
    'The scan-data viewer shows the complete locally stored evidence, which can include serial numbers and hardware fingerprints; opening it does not transmit that data.',
  ],
}

const RELEASE_0_9_7_DETAILS: UnreleasedReleaseNotes = {
  highlights: [],
  fixes: [
    'Native agent updates can now read the public current-release descriptor when application access control is enabled, without making write operations or unknown release routes public.',
  ],
  notes: [
    'Agent 0.1.6 remains the current release. Hosts affected by the 0.1.5 contract-cache issue can recover with sudo homelab-inventory-agent update after the application updates to 0.9.7.',
  ],
}

const RELEASE_0_9_6_DETAILS: UnreleasedReleaseNotes = {
  highlights: [],
  fixes: [
    'Agent upgrades now replace an incompatible derived contract cache only after fetching and validating the current contract, preserving identity, enrollment, configuration, and queued telemetry.',
    'Linux and FreeBSD installers now verify sustained service health after restart and roll back rather than reporting success for an agent that immediately exits.',
  ],
  notes: [
    'Hosts left offline by the 0.1.5 contract-cache incompatibility recover through the normal 0.1.6 upgrade command; no manual cache deletion or reenrollment is required.',
  ],
}

const RELEASE_0_9_5_DETAILS: UnreleasedReleaseNotes = {
  highlights: [
    'Registered agents now support a native manual update command and a dedicated unlink workflow with optional host-scoped telemetry deletion.',
  ],
  fixes: [
    'Agent setup is hidden after enrollment, update instructions appear only for a newer release, and legacy versus native commands are selected from reported capabilities.',
  ],
  notes: [
    'The first native-update release still requires the existing curl or fetch upgrade command once; later releases update with sudo homelab-inventory-agent update while preserving identity, configuration, and queued state.',
    'Unlinking retains saved telemetry by default. Permanent deletion requires selecting the explicit checkbox in the confirmation dialog and affects only that host.',
  ],
}

const RELEASE_0_9_4_DETAILS: UnreleasedReleaseNotes = {
  highlights: [
    'Agent inspectors now show the host operating-system version and uptime, filter services independently by installation scope and runtime state, and present container CPU, memory, uptime, Compose service, published ports, and network metadata.',
  ],
  fixes: [
    'Agent CPU and memory charts now render complete percentage labels instead of clipping every numeric tick.',
  ],
  notes: [
    'Service classification and container metadata are optional protocol-v1 additions, so older agents remain compatible while updated agents provide richer telemetry without broader Docker API permissions.',
  ],
}

const RELEASE_0_9_3_DETAILS: UnreleasedReleaseNotes = {
  highlights: [],
  fixes: [
    'Fresh agent setup now replaces a stale device identity and its queued sequence state transactionally, preventing repeated setup commands from failing with an invalid-agent HTTP 401.',
    'A failed agent replacement restores the previous identity, queue, configuration, binary, and service files byte-for-byte, while normal upgrades continue to preserve the active identity.',
  ],
  notes: [
    'Agent release validation now runs the real installer in Ubuntu 24.04 with disabled telemetry, Docker-proxy telemetry, failed-activation rollback, stale-identity replacement, and identity-preserving upgrade coverage.',
  ],
}

const RELEASE_0_9_2_DETAILS: UnreleasedReleaseNotes = {
  highlights: [],
  fixes: [
    'Embedded agent 0.1.2 now starts and enrolls correctly when optional container telemetry is disabled instead of dereferencing an unset container collector.',
  ],
  notes: [
    'Failed first-time installations continue to roll back partial configuration and identity files; generate a fresh setup command before retrying.',
  ],
}

const RELEASE_0_9_1_DETAILS: UnreleasedReleaseNotes = {
  highlights: [],
  fixes: [
    'Embedded agent 0.1.1 now negotiates the Docker-compatible API version advertised by each runtime instead of assuming a fixed version, with one bounded renegotiation when the supported range changes.',
    'Agent heartbeats now accept standards-compliant RFC 3339 UTC timestamps with up to nanosecond precision and return a controlled authentication error for malformed signed metadata.',
    'The open Agent inspector now refreshes host status, heartbeat history, and metrics every minute across online, unknown, stale, and offline states.',
  ],
  notes: [
    'Agent upgrades remain manual and preserve the existing device identity, enrollment, configuration, and queued telemetry.',
  ],
}

const RELEASE_0_9_0_DETAILS: UnreleasedReleaseNotes = {
  highlights: [
    'The next-generation Homelab Inventory Agent foundation now supports typed enrollment for servers, NAS devices, and custom PC builds with a capability-driven protocol contract.',
    'Signed one-minute telemetry can be persisted atomically in a dedicated WAL-mode SQLite database with indexed latest state and bounded historical retention.',
    'The Linux agent now collects bounded host, filesystem, disk, network, sensor, battery, systemd, GPU, eMMC, mdraid, and opt-in SMART telemetry for AMD64 and ARM64 hosts.',
    'Reproducible agent packages now cover Linux AMD64/ARM64 and FreeBSD AMD64 with hardened unprivileged services, verified upgrades, rollback, uninstall, SBOMs, and provenance.',
    'FreeBSD and OPNsense hosts now report bounded generic host telemetry, rc.d services, and sanitized PCI/storage details without inspecting firewall configuration or hidden processes.',
    'An explicit one-time privileged scan can detect motherboard, chassis, BIOS, CPU, DIMM, storage, PCI, network, GPU, and power hardware, preview it locally, and submit it only to its assigned host for review.',
    'Detected hardware now produces host-scoped field suggestions using opaque fingerprints, physical locators, and safe one-to-one component matching without silently editing inventory.',
    'Capability-driven Agent, Services, and Containers tabs now provide a 30-minute heartbeat timeline, one-minute CPU and memory charts, health states, and detected-hardware summaries only when the assigned agent supports them.',
    'Inventory editors can apply individual detected-hardware values with explicit replacement confirmation and normal Undo support.',
    'Optional Docker and Podman telemetry can use a credential-free loopback proxy or an advanced local socket while transmitting only a strict allowlist of operational container fields.',
    'Each application image now embeds and verifies a pinned agent release for Linux AMD64, Linux ARM64, and FreeBSD AMD64, then serves immutable installers directly from the user\'s own instance.',
    'The Agent inspector now generates platform-specific setup commands and backend-escaped manual upgrade commands for an enrolled host when a newer embedded agent is available.',
  ],
  fixes: [
    'Agent telemetry no longer shares the workspace persistence path, so heartbeat history cannot advance the project revision or modify inventory, placements, assignments, or cables.',
    'Heartbeat requests now authenticate their exact compressed body, endpoint, timestamp, and sequence with Ed25519 and reject replay, cross-host use, malformed compression, oversized payloads, and unsafe container fields.',
    'Lost heartbeat responses no longer leave the agent queue blocked: a machine-confirmed replay is treated as the acknowledgement for that exact signed sample.',
    'Detected-hardware suggestions stay pinned to their exact assigned host and edit session, preventing evidence from one device from appearing on another inventory item.',
  ],
  notes: [
    'Schema 25 migrates existing server-agent relationships to typed numeric host references while preserving legacy endpoints during the transition.',
    'SMART remains disabled unless both the application contract and the host allowlist enable it; standby checks do not wake disks, and raw serial numbers or WWNs are never sent by normal telemetry.',
    'OPNsense identity is stored under /conf so upgrades preserve enrollment; restricted process visibility is shown as unavailable instead of misleading zero-valued service usage.',
    'Schema 26 retains only the latest private hardware snapshot per host plus bounded non-sensitive change summaries. Complete or Agents backups treat this evidence as sensitive.',
    'Container collection is disabled by default and never sends environment variables, labels, commands, arguments, mounts, secrets, or raw inspect payloads.',
    'Complete and Agent telemetry backups include a validated versioned export of the retained SQLite history and restore it transactionally without changing workspace relationships.',
  ],
}

const RELEASE_0_8_7_DETAILS: UnreleasedReleaseNotes = {
  highlights: [],
  fixes: [
    'Cable routing now repairs legacy endpoint bends that reverse across a port, persists the corrected terminal anchor as one Undo-compatible change, and leaves valid manual bends untouched.',
    'Derived route caches now accept only current measured endpoint candidates and one route-or-failure outcome per cable, preventing stale geometry and impossible routes from being presented as valid.',
    'Private local/live synchronization keeps each destination environment\'s browser-measured routing cache instead of transferring it with project data.',
  ],
  notes: [
    'Routing planner version 12 performs one bounded cache refresh after upgrade; subsequent starts render matching cached routes immediately while the WASM worker synchronizes in the background.',
  ],
}

const RELEASE_0_8_6_DETAILS: UnreleasedReleaseNotes = {
  highlights: [
    'Registry enrollment now has a permanent random installation UUID and owner-reviewed lost-key recovery with actionable status in Registry settings.',
    'Complete and registry-enrollment backups now carry the stable UUID, signing key, and credentials as one validated identity set.',
  ],
  fixes: [
    'Existing connected installations adopt the stable identity using their current Ed25519 key, and deleted public registry state rebuilds without creating a duplicate remote installation.',
    'Authenticated key rotation preserves the active key and credentials unless the registry successfully accepts and returns the replacement identity.',
    'Contribution delivery stops during pending or rejected recovery, while private local/live synchronization preserves the destination registry identity in both directions.',
  ],
  notes: [
    'Public demo sessions remain unable to enroll, rotate, recover, or contribute.',
  ],
}

const RELEASE_0_8_5_DETAILS: UnreleasedReleaseNotes = {
  highlights: [],
  fixes: [
    'The official catalog once again keeps filters, result cards, and item details independently scrollable after a category is selected.',
  ],
  notes: [
    'The published container is back on a pinned distroless runtime, with mandatory amd64 and arm64 smoke tests plus zero-vulnerability Docker Scout and Trivy gates before release.',
  ],
}

const RELEASE_0_8_4_DETAILS: UnreleasedReleaseNotes = {
  highlights: [
    'The official catalog browser now keeps filters, results, and hardware details in independently scrollable desktop panes, while assigned expansion cards present their hardware name, interface, and connector chips in a clearer hierarchy.',
  ],
  fixes: [
    'Canvas component cards now use the full width for single CPUs, compact multi-socket CPU chips without overflow, and place registry, remove, and audit controls in consistent nonoverlapping corners.',
  ],
  notes: [],
}

const RELEASE_0_8_3_DETAILS: UnreleasedReleaseNotes = {
  highlights: [],
  fixes: [
    'Concurrent catalog searches now share one snapshot service and update the active catalog pointer atomically without temporary-file collisions.',
    'Updated the IP address parser used by request rate limiting to the patched release that closes three trust-boundary bypass vulnerabilities.',
  ],
  notes: [
    'Docker releases now apply current Debian security updates and fail before publication when the runtime contains a fixable medium-or-higher vulnerability. The latest and stable images are also rescanned daily for newly disclosed issues.',
  ],
}

const RELEASE_0_8_2_DETAILS: UnreleasedReleaseNotes = {
  highlights: [
    'The official catalog now starts with a hardware category chooser, then provides category-specific multi-select and numeric-range filters with explicit Load more pagination.',
  ],
  fixes: [],
  notes: [
    'Catalog facets and filtered searches are verified and indexed locally, so browsing never sends search terms or filter selections to the registry service.',
  ],
}

const RELEASE_0_8_1_DETAILS: UnreleasedReleaseNotes = {
  highlights: [
    'OEM workstations and conventional servers now preserve their complete physical topology through catalog import, inventory editing, compatibility checks, auditing, inspection, and canvas workflows.',
    'Compact, SFF, Tower, Rack Workstation, MicroServer, Tower Server, and Rack Server hardware classes remain independent from each machine\'s local server, desktop, workstation, or other usage role.',
    'Multi-socket hosts now expose assignable CPU socket positions and support per-CPU memory layouts, ECC and module types, storage backplanes and controllers, risers, boot devices, redundant power, cooling profiles, and management controllers.',
  ],
  fixes: [
    'OEM registry matching now uses existing links, motherboard or complete topology evidence, and only then a unique high-confidence normalized identity; systems are never merged by model name alone.',
    'Signed catalogs through OEM contract version 6 are accepted losslessly, while unsupported future contracts fail explicitly instead of dropping unknown topology.',
  ],
  notes: [
    'Schema 24 verifies a complete pre-migration backup before assigning new numeric topology IDs and preserves existing assignments, placements, cables, physical classes, usage roles, and unknown registry fields.',
  ],
}

const RELEASE_0_8_0_DETAILS: UnreleasedReleaseNotes = {
  highlights: [
    'Access settings now support invited local or OIDC users, built-in roles, and reusable custom global roles composed from explicit permissions.',
    'One account can link local and OIDC sign-in methods through a confirmed identity-link workflow without automatically merging matching email addresses.',
    'Inventory, canvas, connections, projects, registry, backups, agents, audits, updates, authentication, users, and roles now expose only the actions permitted for the signed-in account.',
  ],
  fixes: [
    'Server-side Casbin authorization now protects browser APIs with default-deny route classification and operation-specific workspace-engine permissions.',
    'The original owner and Owner role cannot be delegated or removed, administrators and resent invitations cannot grant permissions the acting user does not possess, and concurrent access changes commit without overwriting each other.',
    'Access-administration APIs remain unavailable while authentication is disabled, so the legacy open workspace does not expose account, role, or invitation metadata.',
  ],
  notes: [
    'Schema 23 backs up and upgrades authentication data with numeric role, permission, invitation, and identity-link relationships while preserving existing authentication mode and owner access.',
    'Public demo sessions remain open and do not expose Access administration.',
  ],
}

const RELEASE_0_7_2_DETAILS: UnreleasedReleaseNotes = {
  highlights: [
    'Connected catalogs now preserve complete OEM hardware variants, including motherboard evidence, fixed and optional ports, memory ECC support, storage and expansion topology, proprietary risers, optional modules, and power requirements.',
    'Ambiguous product families now require an explicit variant selection, while exact board evidence and complete hardware topology link deterministically without using installed components as identity selectors.',
    'Inventory editors now expose OEM topology, riser, optional-module, and power capabilities, with a suppressible Lenovo ThinkCentre M720q warning for mutually exclusive PCIe expansion and 2.5-inch SATA configurations.',
  ],
  fixes: [
    'Catalog adoption and reviewed updates preserve local names, assignments, placements, and cables while retaining compatibility with previously published fingerprint-v2 and fingerprint-v3 definitions.',
    'Equipment-owned ports and assignment-dependent module ports now retain separate provenance so each port becomes active at the correct point in the host lifecycle.',
  ],
  notes: [
    'Schema 22 creates a pre-migration backup and upgrades existing compatibility resources, port provenance, hardware class, usage role, and registry variant state automatically and idempotently.',
  ],
}

const RELEASE_0_7_1_DETAILS: UnreleasedReleaseNotes = {
  highlights: [],
  fixes: [
    'Public demo sessions now show authentication as an enforced read-only disabled policy instead of exposing setup controls that cannot be applied.',
  ],
  notes: [
    'Demo authentication remains unavailable, and the empty per-session authentication store is deleted with the disposable demo session.',
  ],
}

const RELEASE_0_7_0_DETAILS: UnreleasedReleaseNotes = {
  highlights: [
    'Authentication can now protect Homelab Inventory with a local owner password, OpenID Connect, or both methods together.',
    'Fresh production installations include guided owner setup, while Authentication settings provide session review, password changes, OIDC owner binding, and recovery support.',
  ],
  fixes: [
    'Browser API access now requires the owner session whenever authentication is enabled, with separate scoped access retained for machine agent registration and heartbeat.',
    'Authentication data is excluded from custom backups by default, cannot be exported without encryption, and requires an environment encryption passphrase before scheduled backups can be enabled.',
  ],
  notes: [
    'Schema 21 keeps authentication disabled on upgraded installations to prevent lockout. Fresh production data directories require one-time setup, and public demo sessions keep authentication unavailable.',
  ],
}

const RELEASE_0_6_2_DETAILS: UnreleasedReleaseNotes = {
  highlights: [
    'Settings now includes Backup & Restore for complete or custom portable archives, stored-backup verification and download, and partial replacement restores.',
    'Complete backups can run daily or weekly at a configurable time with a configurable IANA timezone and retention count; Docker TZ remains authoritative when configured.',
  ],
  fixes: [
    'Protected restores now validate archive bounds, checksums, schemas, and dependencies before creating a complete recovery backup, entering maintenance mode, and applying a journaled atomic replacement with automatic rollback.',
    'Sensitive registry-enrollment and agent data now requires passphrase-protected download, with optional scrypt and AES-256-GCM encryption for stored portable backups.',
    'The production Docker image includes the backup and restore runtime modules required by the management API and scheduler.',
  ],
  notes: [
    'Schema 20 adds backup-management metadata without changing inventory or project relationships. Portable files live under /data/backups/user, backup history is excluded from archives, and public demo sessions remain export-only.',
  ],
}

const RELEASE_0_6_1_DETAILS: UnreleasedReleaseNotes = {
  highlights: [],
  fixes: [
    'Verified CPU catalog updates now preserve the complete official specification set and activate without false content-hash failures.',
  ],
  notes: [],
}

const RELEASE_0_6_0_DETAILS: UnreleasedReleaseNotes = {
  highlights: [
    'The verified catalog now distinguishes product variants by trusted motherboard identity, complete structural topology, or explicit OEM PCIe expansion support, keeping standard and expansion-capable versions of the same model separate without using installed components or local server roles as identity.',
    'Catalog search and item details now expose concise variant labels so similar model families remain understandable when importing verified hardware.',
  ],
  fixes: [
    'Catalog matching preserves fingerprint-v2 identities as aliases while preventing ambiguous generic-family records from silently attaching to a specific motherboard or topology variant.',
    'Automatic contributions now deduplicate equivalent local copies while submitting materially different motherboard and expansion variants as separate review candidates.',
    'Existing signed catalog revisions retain the publisher\'s original content digest after client protocol upgrades, so valid catalogs continue refreshing and automatic contributions remain available.',
    'Pending contribution batches now reconcile automatically when stronger hardware evidence splits a previously generic family into separate variants, preventing one stale candidate from blocking unrelated submissions.',
    'Previously delivered local definitions now become reviewable catalog-adoption links when their normalized hardware variant is later published, instead of being skipped as already contributed.',
    'Applying a reviewed catalog definition now preserves the project revision and topology while updating only the linked inventory record and registry relationship.',
  ],
  notes: [
    'Schema 19 preserves existing fingerprint-v2 catalog links, contribution state, inventory IDs, assignments, placements, and cables while enabling fingerprint-v3 evidence through the normal backup-first startup migration.',
  ],
}

const RELEASE_0_5_1_DETAILS: UnreleasedReleaseNotes = {
  highlights: [
    'Connected catalogs now recognize equivalent local hardware by canonical identity and offer an explicit review before adopting verified registry fields.',
    'Computers now separate physical hardware class from local usage role, allowing desktop mini PCs to serve as servers or workstations while matching the correct catalog product.',
  ],
  fixes: [
    'Every physical copy of an identity-matched component now receives its own registry link indicator and reviewable adoption record without creating duplicate catalog contributions.',
    'The production image now carries the complete ordered schema 17 and 18 migration chain required to upgrade existing data stores safely.',
    'Public demo sessions now use neutral smart-outlet labels and omit private smart-device metadata so sanitized schema 18 sandboxes remain valid.',
  ],
  notes: [
    'Schema 17 extends registry relationships with a reviewable adoption state; existing links and inventory records are preserved.',
    'Schema 18 classifies existing server records as desktop hardware used as servers without changing numeric IDs, assignments, placements, ports, cables, or registry links.',
  ],
}

const RELEASE_0_5_0_DETAILS: UnreleasedReleaseNotes = {
  highlights: [
    'Cable routing is now more predictable in dense layouts, with explicit endpoint sides, center-first port attachment, shorter orthogonal paths, equipment avoidance, and better handling for reordered patch panels and rotated power equipment.',
    'Calculated cable paths now persist in a disposable cache, restore immediately after refresh, and recalculate only when equipment geometry or routing preferences actually change.',
    'General workspace settings can now align all equipment to the nearest collision-free grid position, clear every manual cable bend, or restore automatic endpoint sides as confirmed actions that support Undo.',
    'Inspector connection cards now open their cable directly for route review and editing.',
    'The workbench now loads the canvas, drag-and-drop runtime, inventory, Inspector, Settings, onboarding, and secondary dialogs on demand for a smaller and more resilient startup.',
  ],
  fixes: [
    'Cable routes remain visible while ports are measured or individual paths are recalculated, and one blocked connection no longer hides or restarts unrelated cables.',
    'Large workspaces now route in bounded continuation batches without repeated retries, render loops, or recalculation caused by pan, zoom, selection, Inspector state, or filtering.',
    'LowDB persistence now retries transient failures and recovers interrupted saves while multi-store inventory and registry changes roll back together instead of leaving partial data.',
    'Registry enrollment, contribution delivery, catalog refresh, and private templates now handle failures safely, validate remote data, preserve trusted state, and avoid duplicate IDs.',
    'Browser writes, agent enrollment, public demo sessions, runtime validation, request timeouts, and shutdown handling have been hardened without disrupting supported automation workflows.',
    'Undo, Redo, and power-equipment orientation changes now validate against the latest project revision and canvas footprint before saving.',
  ],
  notes: [
    'The derived routing cache is stored separately from project data, is safe to delete, and does not affect project revisions or Undo and Redo history.',
  ],
}

const RELEASE_0_4_9_DETAILS: UnreleasedReleaseNotes = {
  highlights: [],
  fixes: [
    'Existing registry stores now receive newly introduced preference defaults before strict validation, preventing an upgrade restart loop.',
  ],
  notes: [],
}

const RELEASE_0_4_8_DETAILS: UnreleasedReleaseNotes = {
  highlights: [
    'Registry settings can optionally mark catalog-linked equipment and assigned components on the canvas with a compact link indicator, hidden by default.',
  ],
  fixes: [],
  notes: [],
}

const RELEASE_0_4_7_DETAILS: UnreleasedReleaseNotes = {
  highlights: [],
  fixes: [
    'Send now can perform one explicit catalog contribution delivery while automatic background delivery is paused.',
    'Disabling automatic catalog contributions now waits for any active delivery to settle before confirming the paused state.',
  ],
  notes: [],
}

const RELEASE_0_4_6_DETAILS: UnreleasedReleaseNotes = {
  highlights: [],
  fixes: [
    'A locally overridden catalog item now reconnects to its verified catalog identity automatically when that exact sanitized definition is later published.',
    'Catalog update previews now restore the item category at the database adapter boundary so linked category-array records can be reviewed and applied reliably.',
  ],
  notes: [],
}

const RELEASE_0_4_5_DETAILS: UnreleasedReleaseNotes = {
  highlights: [
    'Connected installations now refresh the verified official hardware catalog at startup and every six hours, with bounded jitter and a single shared operation for automatic and manual refreshes.',
  ],
  fixes: [
    'Failed catalog refreshes now preserve the last-known-good catalog, record a safe visible status, and cannot activate after the installation leaves Connected mode.',
  ],
  notes: [
    'Operators can set REGISTRY_REFRESH_INTERVAL_MS to a custom interval or zero to disable automatic refreshes while retaining the manual Refresh action.',
  ],
}

const RELEASE_0_4_4_DETAILS: UnreleasedReleaseNotes = {
  highlights: [],
  fixes: [
    'New public demo sessions now activate the verified official catalog automatically on first use while remaining available when the registry is temporarily unreachable.',
  ],
  notes: [],
}

const RELEASE_0_4_3_DETAILS: UnreleasedReleaseNotes = {
  highlights: [],
  fixes: [
    'Public demo sessions now trust the official catalog signing key, stay locked to Connected registry mode, and prohibit automatic catalog contributions while keeping manual catalog refresh available.',
  ],
  notes: [],
}

const RELEASE_0_4_2_DETAILS: UnreleasedReleaseNotes = {
  highlights: [],
  fixes: [
    'Registry enrollment failures now appear directly beside the Automatic catalog contributions control instead of being hidden below the rest of Registry settings.',
    'Official catalog refreshes now share the registry\'s frozen fingerprint-v2 CPU normalization contract, preventing verified CPU templates from being rejected with a declared-hash mismatch.',
  ],
  notes: [],
}

const RELEASE_0_4_1_DETAILS: UnreleasedReleaseNotes = {
  highlights: [],
  fixes: [
    'Refreshing or importing the verified hardware catalog now preserves database schema and migration status in Registry settings.',
  ],
  notes: [],
}

const RELEASE_0_4_0_DETAILS: UnreleasedReleaseNotes = {
  highlights: [
    'Add Hardware now combines a locally searched verified Catalog, the complete Manual editor, and reusable Private templates in one source-aware dialog.',
    'Inventory items can be saved as sanitized private templates, searched locally, duplicated, exported, imported, and reused with quantity creation.',
    'Registry settings now control Disabled, Offline file, or Connected modes and the preferred Add Hardware tab while preserving a fully local workflow.',
    'Offline installations can import signed official snapshots, while connected installations can refresh the same catalog and keep all searches on the local SQLite index.',
    'Catalog-created inventory remains linked to its verified revision and exposes field-level review before applying a newer catalog definition.',
    'Connected installations can explicitly opt in to automatic sanitized hardware contributions with signed delivery, local deduplication, retry status, pause, revocation, and key rotation controls.',
    'Automatic contributions now group identical physical copies by category-aware product identity without merging local inventory, while preserving distinct board variants and RAM speeds.',
    'RAM is now modeled as individual physical sticks with exact slot placement, two-column host layouts, occupied-slot swapping, and warnings for unknown legacy positions.',
  ],
  fixes: [
    'Atomic JSON persistence now uses collision-resistant temporary files so simultaneous store writes cannot interfere with each other.',
  ],
  notes: [
    'Schema 15 adds an independent registry store for catalog preferences, private templates, signed snapshot metadata, and numeric catalog links without changing canvas, assignment, or cable relationships.',
    'Disabled registry mode makes no catalog requests. Private templates remove instance properties, addresses, notes, topology, and other local-only data before persistence or export.',
    'Invalid, expired, oversized, or untrusted snapshots cannot replace the last-known-good catalog, and the disposable SQLite search cache rebuilds from the verified artifact when needed.',
    'Automatic contributions are disabled by default. When enabled, the backend removes local-only data, checks a signed digest index, queues delivery without blocking inventory saves, and signs each replay-protected batch with a backend-only installation key.',
    'Installation private keys and short-lived registry tokens remain in mode-0600 files under the configured data directory and are never exposed through the browser API.',
    'Schema 16 converts legacy RAM kits into physical sticks and one-slot assignments after creating a locked backup. It preserves capacity and known slot positions, refuses ambiguous data, and restores the original stores if migration fails.',
    'Existing RAM catalog links and queued RAM contributions are cleared during conversion because a kit-level identity cannot safely represent either physical stick.',
  ],
}

const RELEASE_0_2_2_DETAILS: UnreleasedReleaseNotes = {
  highlights: [],
  fixes: [
    'Connected network, power, and display cables now remain visible when moving equipment changes their automatically selected attachment side.',
  ],
  notes: [],
}

const RELEASE_0_2_1_DETAILS: UnreleasedReleaseNotes = {
  highlights: [],
  fixes: [
    'Newly created or edited inventory equipment now synchronizes with the local workspace engine before canvas interaction, preventing immediate drops from being rolled back by a revision conflict.',
    'The server now refreshes stale in-memory WASM state after inventory changes before accepting the next canvas command.',
    'Delayed inventory update events no longer rebuild a workspace revision that the browser has already loaded.',
  ],
  notes: [],
}

export const RELEASE_NOTES: ReleaseNoteEntry[] = [
  {
    version: '0.12.3',
    date: '2026-08-12',
    channel: 'latest',
    title: 'Faster catalog category loading',
    ...RELEASE_0_12_3_DETAILS,
  },
  {
    version: '0.12.2',
    date: '2026-08-12',
    channel: 'release',
    title: 'Clear container port mappings',
    ...RELEASE_0_12_2_DETAILS,
  },
  {
    version: '0.12.1',
    date: '2026-08-12',
    channel: 'release',
    title: 'Reliable large-telemetry SQLite migration',
    ...RELEASE_0_12_1_DETAILS,
  },
  {
    version: '0.12.0',
    date: '2026-08-12',
    channel: 'release',
    title: 'SQLite project workbooks and canonical catalogs',
    ...RELEASE_0_12_0_DETAILS,
  },
  {
    version: '0.11.2',
    date: '2026-08-11',
    channel: 'release',
    title: 'Reliable FreeBSD agent service',
    ...RELEASE_0_11_2_DETAILS,
  },
  {
    version: '0.11.1',
    date: '2026-08-10',
    channel: 'release',
    title: 'Reliable demo catalog startup',
    ...RELEASE_0_11_1_DETAILS,
  },
  {
    version: '0.11.0',
    date: '2026-08-10',
    channel: 'release',
    title: 'Agent notifications and exact RAM catalogs',
    ...RELEASE_0_11_0_DETAILS,
  },
  {
    version: '0.10.0',
    date: '2026-08-09',
    channel: 'release',
    title: 'Motherboard catalogs and storage telemetry',
    ...RELEASE_0_10_0_DETAILS,
  },
  {
    version: '0.9.9',
    date: '2026-08-08',
    channel: 'release',
    title: 'Reliable DIMM hardware evidence',
    ...RELEASE_0_9_9_DETAILS,
  },
  {
    version: '0.9.8',
    date: '2026-08-08',
    channel: 'release',
    title: 'Clearer agent evidence and heartbeat history',
    ...RELEASE_0_9_8_DETAILS,
  },
  {
    version: '0.9.7',
    date: '2026-08-08',
    channel: 'release',
    title: 'Reliable native agent updates',
    ...RELEASE_0_9_7_DETAILS,
  },
  {
    version: '0.9.6',
    date: '2026-08-08',
    channel: 'release',
    title: 'Self-healing agent upgrades',
    ...RELEASE_0_9_6_DETAILS,
  },
  {
    version: '0.9.5',
    date: '2026-08-08',
    channel: 'release',
    title: 'Native agent lifecycle management',
    ...RELEASE_0_9_5_DETAILS,
  },
  {
    version: '0.9.4',
    date: '2026-08-08',
    channel: 'release',
    title: 'Richer host telemetry',
    ...RELEASE_0_9_4_DETAILS,
  },
  {
    version: '0.9.3',
    date: '2026-08-07',
    channel: 'release',
    title: 'Transactional agent setup recovery',
    ...RELEASE_0_9_3_DETAILS,
  },
  {
    version: '0.9.2',
    date: '2026-08-07',
    channel: 'release',
    title: 'Reliable agent enrollment',
    ...RELEASE_0_9_2_DETAILS,
  },
  {
    version: '0.9.1',
    date: '2026-08-07',
    channel: 'release',
    title: 'Agent runtime compatibility',
    ...RELEASE_0_9_1_DETAILS,
  },
  {
    version: '0.9.0',
    date: '2026-08-07',
    channel: 'release',
    title: 'Homelab Inventory Agent',
    ...RELEASE_0_9_0_DETAILS,
  },
  {
    version: '0.8.7',
    date: '2026-08-05',
    channel: 'release',
    title: 'Reliable cable route recovery',
    ...RELEASE_0_8_7_DETAILS,
  },
  {
    version: '0.8.6',
    date: '2026-08-05',
    channel: 'release',
    title: 'Stable registry installation identity',
    ...RELEASE_0_8_6_DETAILS,
  },
  {
    version: '0.8.5',
    date: '2026-08-05',
    channel: 'release',
    title: 'Catalog scrolling and hardened releases',
    ...RELEASE_0_8_5_DETAILS,
  },
  {
    version: '0.8.4',
    date: '2026-08-04',
    channel: 'release',
    title: 'Catalog and canvas layout polish',
    ...RELEASE_0_8_4_DETAILS,
  },
  {
    version: '0.8.3',
    date: '2026-08-04',
    channel: 'release',
    title: 'Catalog reliability and release security',
    ...RELEASE_0_8_3_DETAILS,
  },
  {
    version: '0.8.2',
    date: '2026-08-03',
    channel: 'release',
    title: 'Faceted hardware catalog browsing',
    ...RELEASE_0_8_2_DETAILS,
  },
  {
    version: '0.8.1',
    date: '2026-08-03',
    channel: 'release',
    title: 'OEM workstation and server topology',
    ...RELEASE_0_8_1_DETAILS,
  },
  {
    version: '0.8.0',
    date: '2026-08-03',
    channel: 'release',
    title: 'Multi-user access control',
    ...RELEASE_0_8_0_DETAILS,
  },
  {
    version: '0.7.2',
    date: '2026-08-02',
    channel: 'release',
    title: 'OEM hardware topology and variant fidelity',
    ...RELEASE_0_7_2_DETAILS,
  },
  {
    version: '0.7.1',
    date: '2026-08-02',
    channel: 'release',
    title: 'Demo authentication policy',
    ...RELEASE_0_7_1_DETAILS,
  },
  {
    version: '0.7.0',
    date: '2026-08-02',
    channel: 'release',
    title: 'Optional owner authentication',
    ...RELEASE_0_7_0_DETAILS,
  },
  {
    version: '0.6.2',
    date: '2026-08-02',
    channel: 'release',
    title: 'Portable backup and restore',
    ...RELEASE_0_6_2_DETAILS,
  },
  {
    version: '0.6.1',
    date: '2026-08-02',
    channel: 'release',
    title: 'Verified enriched CPU catalogs',
    ...RELEASE_0_6_1_DETAILS,
  },
  {
    version: '0.6.0',
    date: '2026-08-01',
    channel: 'release',
    title: 'Hardware variant-aware catalogs',
    ...RELEASE_0_6_0_DETAILS,
  },
  {
    version: '0.5.1',
    date: '2026-07-31',
    channel: 'release',
    title: 'Catalog adoption and computer roles',
    ...RELEASE_0_5_1_DETAILS,
  },
  {
    version: '0.5.0',
    date: '2026-07-31',
    channel: 'release',
    title: 'Reliable routing and resilient persistence',
    ...RELEASE_0_5_0_DETAILS,
  },
  {
    version: '0.4.9',
    date: '2026-07-29',
    channel: 'release',
    title: 'Safe registry preference upgrades',
    ...RELEASE_0_4_9_DETAILS,
  },
  {
    version: '0.4.8',
    date: '2026-07-29',
    channel: 'release',
    title: 'Visible catalog-linked hardware',
    ...RELEASE_0_4_8_DETAILS,
  },
  {
    version: '0.4.7',
    date: '2026-07-29',
    channel: 'release',
    title: 'Controlled registry delivery',
    ...RELEASE_0_4_7_DETAILS,
  },
  {
    version: '0.4.6',
    date: '2026-07-29',
    channel: 'release',
    title: 'Complete catalog update reviews',
    ...RELEASE_0_4_6_DETAILS,
  },
  {
    version: '0.4.5',
    date: '2026-07-29',
    channel: 'release',
    title: 'Automatic catalog refresh',
    ...RELEASE_0_4_5_DETAILS,
  },
  {
    version: '0.4.4',
    date: '2026-07-28',
    channel: 'release',
    title: 'Automatic demo catalog activation',
    ...RELEASE_0_4_4_DETAILS,
  },
  {
    version: '0.4.3',
    date: '2026-07-28',
    channel: 'release',
    title: 'Safe public demo registry',
    ...RELEASE_0_4_3_DETAILS,
  },
  {
    version: '0.4.2',
    date: '2026-07-28',
    channel: 'release',
    title: 'Reliable catalog activation',
    ...RELEASE_0_4_2_DETAILS,
  },
  {
    version: '0.4.1',
    date: '2026-07-27',
    channel: 'release',
    title: 'Reliable registry status',
    ...RELEASE_0_4_1_DETAILS,
  },
  {
    version: '0.4.0',
    date: '2026-07-27',
    channel: 'release',
    title: 'Verified hardware catalog and physical RAM',
    ...RELEASE_0_4_0_DETAILS,
  },
  {
    version: '0.3.0',
    date: '2026-07-25',
    channel: 'release',
    title: 'Guided first-run workspace',
    ...RELEASE_0_3_0_DETAILS,
  },
  {
    version: '0.2.2',
    date: '2026-07-24',
    channel: 'release',
    title: 'Reliable cable movement',
    ...RELEASE_0_2_2_DETAILS,
  },
  {
    version: '0.2.1',
    date: '2026-07-23',
    channel: 'release',
    title: 'Reliable inventory placement',
    ...RELEASE_0_2_1_DETAILS,
  },
  {
    version: '0.2.0',
    date: '2026-07-23',
    channel: 'release',
    title: 'Rust/WASM workspace engine',
    ...RELEASE_0_2_0_DETAILS,
  },
  {
    version: '0.1.38',
    date: '2026-07-21',
    channel: 'release',
    title: 'Flexible power equipment layouts',
    highlights: [
      'UPS and power-strip cards can now be arranged horizontally or vertically per canvas item, with the persisted layout restored across sessions.',
      'UPS outlet groups can be swapped between top and bottom rows or left and right columns directly from the Inspector.',
      'Power-equipment layout edits now participate in the canvas Undo and Redo history.',
    ],
    fixes: [
      'Canvas collision, auto-arrange, centering, and minimap geometry now match the rendered dimensions of power equipment in either orientation.',
      'Inspector layout controls now expose clear single-choice semantics and mobile-friendly interaction targets.',
      'Immediate Inspector edits are saved in order so rapid layout changes cannot be overwritten by an older response.',
      'Changing UPS or power-strip canvas layout no longer rebuilds connected outlets or triggers a connected-port validation error.',
    ],
  },
  {
    version: '0.1.37',
    date: '2026-07-21',
    channel: 'release',
    title: 'Responsive canvas interactions',
    highlights: [
      'The hardware canvas now precomputes project audits, connection occupancy, compatibility lookups, and cable handles once per project revision.',
      'Inspector tabs mount only their active content, substantially reducing drawer DOM size and selection latency.',
      'React Flow now omits offscreen equipment from the live DOM until it enters the viewport.',
    ],
    fixes: [
      'Port-to-port dragging and item selection no longer rebuild thousands of unused React Flow handles on every interaction.',
      'Unchanged canvas nodes retain stable data and callback references while cable shadows render only for selected or traced connections.',
    ],
  },
  {
    version: '0.1.36',
    date: '2026-07-21',
    channel: 'release',
    title: 'Reliable power endpoint migration',
    highlights: [
      'Existing UPS and power equipment now receive persisted numeric power ports automatically when their database upgrades to schema 11.',
    ],
    fixes: [
      'UPS outlet chips now resolve as real power endpoints when connecting power strips instead of producing a mixed-endpoint validation error.',
      'Power-port repair now covers UPS records that only declare a total outlet count and preserves existing display or other non-power ports.',
    ],
    notes: [
      'Schema 11 creates a backup before repairing incomplete power-port topology records.',
    ],
  },
  {
    version: '0.1.35',
    date: '2026-07-21',
    channel: 'release',
    title: 'Compact power strip connections',
    highlights: [
      'Power strips now place their single AC input directly in the canvas card header beside the drag grip.',
    ],
    fixes: [
      'Removed the dedicated one-port power-input row while preserving the same persisted endpoint and cable interactions.',
    ],
  },
  {
    version: '0.1.34',
    date: '2026-07-20',
    channel: 'release',
    title: 'Relational data integrity',
    highlights: [
      'Inventory, project, agent, power endpoint, and compatibility relationships now persist as numeric identifiers that map cleanly to future relational database records.',
      'Stable semantic keys remain separate from record identity for compatibility resources and generated power endpoints.',
    ],
    fixes: [
      'Schema migration rejects missing, ambiguous, or colliding legacy relationships instead of silently saving incorrect assignments or connections.',
      'Current writes now validate strict numeric relationships while imports and older stores use an explicit legacy migration path.',
    ],
    notes: [
      'Schema 10 creates a backup before converting existing stores to the stricter relational format.',
      'Typed string keys such as server:1 remain available inside the canvas UI but are converted at the persistence boundary.',
    ],
  },
  {
    version: '0.1.33',
    date: '2026-07-20',
    channel: 'release',
    title: 'Connectable power strip inputs',
    highlights: [
      'Power strips now expose a dedicated draggable AC input on their canvas cards and in the Inspector.',
      'UPS and other compatible power-source outlets can connect directly to the power strip input using the existing directional power cable workflow.',
    ],
    fixes: [
      'Existing power strip records gain a stable AC input automatically without changing their configured outlet counts.',
      'Power strip inputs enforce one upstream connection while all downstream outlets retain their existing availability and fan-out rules.',
    ],
  },
  {
    version: '0.1.32',
    date: '2026-07-20',
    channel: 'release',
    title: 'Return canvas equipment to inventory',
    highlights: [
      'Placed equipment can now be returned to inventory from its Inspector action menu without deleting the inventory record.',
      'The confirmation dialog previews the number of canvas placements, hosted component assignments, and cable connections affected before the change is applied.',
      'Returning a server, NAS, or PC Build releases its hosted components and removes cables attached to the host or those components.',
    ],
    fixes: [
      'The complete return operation is recorded as one atomic project change, so a single Undo or Redo restores or reapplies the placement, assignments, and cables together.',
      'Stale return requests fail safely when the equipment is no longer placed on the canvas.',
    ],
    notes: [
      'Returning equipment preserves every inventory record; released components become available for assignment again.',
    ],
  },
  {
    version: '0.1.31',
    date: '2026-07-20',
    channel: 'release',
    title: 'Tabbed inventory item creation',
    highlights: [
      'The Add Inventory Item dialog now organizes fields into type-aware Specs, Compatibility, Resources, and Ports tabs so each equipment type shows only the sections it needs.',
      'The inventory type selector and action footer remain fixed while only the active tab panel scrolls, keeping long hardware forms easier to navigate.',
      'On smaller screens, the tab row scrolls horizontally without expanding the dialog beyond the viewport.',
    ],
    fixes: [
      'Validation now opens the tab containing the first invalid field and moves focus directly to that control for faster correction.',
      'The horizontally scrollable creation tabs no longer show native scrollbar chrome on narrow screens.',
    ],
  },
  {
    version: '0.1.30',
    date: '2026-07-20',
    channel: 'release',
    title: 'Custom PC builds and power topology',
    highlights: [
      'Free-form PC Builds can now combine a motherboard, CPU, cooler, memory, storage, graphics, power supply, case, sound, network, and wireless components on the canvas.',
      'Motherboards expose explicit CPU sockets, DIMM positions, storage connectors, and expansion slots so assigned components retain deterministic physical allocations.',
      'Monitors, UPS systems, and power strips are now standalone canvas equipment with individually addressable inputs or outlets and directional power connections.',
      'OEM servers and NAS devices can receive a power adapter component without changing their existing CPU, memory, storage, GPU, and network workflows.',
    ],
    fixes: [
      'PC Build assignment checks distinguish compatibility guidance from hard physical resource limits, and compatibility checks can still be disabled per host.',
      'Power connections reject occupied inputs, invalid outlet-to-outlet paths, self-connections, and loops while preserving stable endpoint identifiers.',
      'Inventory creation, lifecycle controls, canvas search, focus, placement, and collision handling recognize every new PC and power equipment category.',
    ],
    notes: [
      'A PC Build requires a motherboard, CPU, CPU cooler, RAM, storage, and power supply to be complete; its case remains optional.',
      'Operating system remains editable PC Build metadata rather than a draggable inventory component.',
    ],
  },
  {
    version: '0.1.29',
    date: '2026-07-20',
    channel: 'release',
    title: 'Focused application settings',
    highlights: [
      'Settings now focuses on General, Project, Updates, and About, with a concise product overview that explains the inventory, canvas, compatibility, and cabling workflows.',
      'About now documents mounted data persistence alongside release-channel guidance and project links.',
    ],
    fixes: [
      'Removed the redundant System category and its unused runtime-information API.',
      'Removed repetitive Environment, Project, and This Browser pills while preserving lock icons and guidance for read-only Docker Compose values.',
    ],
    notes: [
      'Update-channel values remain read-only when configured by Docker Compose or the bare-metal process environment.',
    ],
  },
  {
    version: '0.1.28',
    date: '2026-07-19',
    channel: 'release',
    title: 'Global application settings',
    highlights: [
      'A new Settings workspace organizes browser preferences, shared project actions, update controls, runtime information, and project links in one responsive dialog.',
      'Inventory visibility and width, canvas selection centering, and cable visibility now persist per browser and can be reset together.',
      'Project settings can rename the project, clear ignored audit findings, and re-enable compatibility checks for every server and NAS.',
    ],
    fixes: [
      'The canvas toolbar and Settings switches now share one preference source so cable and centering controls cannot drift out of sync.',
      'Runtime configuration failures are isolated to the System section and no longer prevent other settings from being used.',
      'Only a strict allowlist of non-secret runtime and Docker Compose configuration is exposed by the system information endpoint.',
    ],
    notes: [
      'Environment-derived settings are read-only and must be changed in Docker Compose or the bare-metal process environment before recreating or restarting the app.',
      'The canvas command bar now includes an icon-only Settings action with an accessible label and tooltip.',
    ],
  },
  {
    version: '0.1.27',
    date: '2026-07-19',
    channel: 'release',
    title: 'Compatibility policies and audit acknowledgements',
    highlights: [
      'Dedicated Compatibility editing tabs keep host matching policies separate from general server and NAS specifications.',
      'Individual servers and NAS devices can opt out of hardware compatibility matching without changing global project behavior.',
      'Audit now includes an Ignored view where findings can be ignored or returned to the active audit.',
    ],
    fixes: [
      'Physical slot, cardinality, and resource limits remain enforced when hardware compatibility matching is disabled.',
      'Failed compatibility-policy or audit-ignore saves now roll back the optimistic interface change.',
      'Deterministic warning IDs include host context to avoid collisions between equivalent findings on different hosts.',
    ],
    notes: [
      'Schema 8 migration creates an automatic backup before adding compatibility policies and ignored audit warning IDs.',
      'Ignored warning IDs are project-scoped and remain dormant when their warnings are not currently present.',
      'A host opt-out suppresses only compatibility warnings; other audit findings and physical resource limits remain active.',
    ],
  },
  {
    version: '0.1.26',
    date: '2026-07-19',
    channel: 'release',
    title: 'Hardware compatibility rules',
    highlights: [
      'Known-invalid CPU, RAM, storage, GPU, and network-card assignments are now blocked before project data changes.',
      'Incomplete compatibility data remains usable with clear unknown-data warnings instead of being treated as incompatible.',
      'Compatible assignments now receive deterministic host resource allocations for memory, storage, and expansion slots.',
      'Compatibility inspector tabs explain requirements, host capabilities, allocations, and findings, while Audit reports assigned hardware that needs review.',
    ],
    fixes: [
      'CPU and RAM moves or swaps now validate atomically so a rejected operation leaves both hosts unchanged.',
      'Official Intel FC package socket names such as FCLGA1200 are normalized to the matching physical socket name to prevent false incompatibility results.',
      'Existing assignments are preserved during migration, including legacy assignments that current rules would reject; enforcement applies when an assignment is newly created or changed.',
      'Production container images now include the complete project API route set required to load, save, and migrate project data.',
    ],
    notes: [
      'Schema 7 migration creates an automatic backup before normalizing compatibility profiles and deterministic allocations.',
      'Compatibility details are entered when inventory is created or edited, keeping ongoing upkeep limited to new or corrected hardware records.',
      'Homelab Inventory does not perform online hardware lookups or bundle a universal compatibility database.',
    ],
  },
  {
    version: '0.1.25',
    date: '2026-07-19',
    channel: 'release',
    title: 'Complete inventory lifecycle controls',
    highlights: [
      'Inventory records can now be created in quantities, duplicated, archived, restored, and permanently deleted from the inventory sidebar.',
      'Selection mode adds all-or-nothing batch archive, restore, and delete workflows for the currently filtered inventory.',
      'Archived records remain available in dedicated Archived and All views while staying unavailable for placement, assignment, editing, and connections until restored.',
    ],
    fixes: [
      'Archive and delete operations now report canvas placements, host assignments, hosted components, cables, port metadata, and agent data that must be cleaned up first.',
      'Permanent deletion now requires an archived, dependency-free record and uses a clear confirmation dialog without cascade deletion.',
      'Duplicated hardware receives fresh IDs and clean ports without copying assignments, placements, cables, labels, notes, IP addresses, or agent state.',
      'Inventory lifecycle changes now replace the authoritative project snapshot and reset canvas undo history so stale state cannot restore removed records.',
      'Server Agent tabs now provide confirmed controls to revoke registrations and clear saved telemetry before archiving hardware.',
      'Inventory multi-select now keeps its active icon visible, and item icons and action controls remain vertically centered for one-line and two-line rows.',
    ],
    notes: [
      'Lifecycle commands are transactional and validated by the server; a blocked item prevents the entire selected batch from changing.',
      'Equipment quantities receive numbered names while interchangeable components retain their shared hardware name.',
    ],
  },
  {
    version: '0.1.24',
    date: '2026-07-19',
    channel: 'release',
    title: 'Clearer inventory form examples',
    highlights: [
      'Add Item and editable inspector forms now show realistic examples tailored to the selected hardware category.',
    ],
    fixes: [
      'CPU, RAM, storage, GPU, network card, NAS, switch, and patch-panel forms no longer inherit server name, manufacturer, or model placeholders.',
      'Numeric hardware fields now include relevant examples such as CPU core counts, NAS bay counts, storage capacity, and GPU memory.',
    ],
    notes: [
      'Examples remain placeholders only and are never saved as inventory values.',
    ],
  },
  {
    version: '0.1.23',
    date: '2026-07-19',
    channel: 'release',
    title: 'Clearer mobile inventory controls',
    highlights: [
      'The mobile inventory header now keeps Add and Close as separate, consistently spaced touch targets.',
    ],
    fixes: [
      'The inventory drawer close button no longer overlaps the Add inventory item button on phone-sized screens.',
    ],
  },
  {
    version: '0.1.22',
    date: '2026-07-18',
    channel: 'release',
    title: 'Smoother canvas workspace controls',
    highlights: [
      'The desktop inventory sidebar now opens and closes with a smooth width transition while the canvas resizes alongside it.',
      'The floating canvas command bar now aligns with the bottom edge of the React Flow controls for a tighter, more consistent workspace layout.',
    ],
    fixes: [
      'Inventory visibility changes no longer make the sidebar and canvas blink abruptly between layouts.',
    ],
    notes: [
      'Reduced-motion preferences continue to disable nonessential interface animation.',
    ],
  },
  {
    version: '0.1.21',
    date: '2026-07-18',
    channel: 'release',
    title: 'Responsive canvas command bar',
    highlights: [
      'Canvas actions now live in a responsive, icon-only command bar centered along the bottom of the workspace on desktop and mobile.',
      'Desktop users can hide the inventory sidebar to expand the canvas, then restore it at its previously saved width.',
      'Every command-bar action includes an accessible label and hover tooltip while retaining quick access to history, updates, audits, centering, arrangement, and cable visibility.',
    ],
    fixes: [
      'Removed the crowded top-right canvas controls and the cable color legend while retaining the cable visibility toggle.',
      'The mobile command bar remains usable on narrow screens without wrapping over the canvas.',
    ],
    notes: [
      'Desktop inventory visibility and width persist across browser refreshes.',
    ],
  },
  {
    version: '0.1.20',
    date: '2026-07-15',
    channel: 'release',
    title: 'Accurate Docker update status',
    highlights: [
      'Docker update checks now distinguish newer channel images, exact matches, revision-only rebuilds, and installations ahead of their selected channel.',
      'The update dialog labels the published latest or stable image explicitly and only shows update instructions when an update is actually available.',
      'Stable releases now publish immutable X.Y.Z images, a moving X.Y series alias, a matching Git tag, and GitHub Release only after the Docker image is verified.',
    ],
    fixes: [
      'An older stable or latest image is no longer presented as an available update when the running installation has a higher version.',
      'Images rebuilt from a different commit at the same version can now be detected when both revisions are known.',
      'Up-to-date and ahead-of-channel states no longer show an empty release-details message or unnecessary Docker Compose commands.',
      'Release automation refuses to overwrite an existing numbered Docker image or reuse a Git tag that belongs to another commit.',
      'Historical release restoration now accepts only approved version-to-commit pairs and keeps registry credentials unavailable to historical build scripts.',
    ],
    notes: [
      'UPDATE_CHANNEL remains authoritative; recreate the container after changing Compose environment variables so Docker applies the new configuration.',
      'A guarded manual workflow can restore historical numbered images without changing latest or stable.',
    ],
  },
  {
    version: '0.1.19',
    date: '2026-07-14',
    channel: 'release',
    title: 'Editable inventory inspectors',
    highlights: [
      'Inventory items can now be corrected directly from their inspectors using the same validated fields and select options as the Add Item dialog.',
      'Servers, switches, NAS devices, patch panels, CPUs, RAM, storage, GPUs, and network cards now use focused tabbed editing workflows.',
      'Server and NAS slot, port, network, and agent views remain available alongside the editable hardware specifications.',
    ],
    fixes: [
      'Inspector saves preserve item IDs, assignments, placements, detailed port metadata, and existing cable connections.',
      'Switch port groups retain support for as many as 128 ports and prevent connected or annotated ports from being removed accidentally.',
      'NAS inspectors clearly identify agent setup as unavailable instead of invoking server-only enrollment APIs.',
      'Pending text edits are flushed when an inspector closes or switches items so the final keystrokes are not lost.',
      'Temporarily clearing a port count while typing a replacement no longer removes or multiplies existing ports.',
    ],
    notes: [
      'Text and numeric edits save after a 500 ms pause; select and toggle changes save immediately.',
    ],
  },
  {
    version: '0.1.18',
    date: '2026-07-14',
    channel: 'release',
    title: 'Request rate limiting and CI hardening',
    highlights: [
      'Homelab Inventory now applies a global request limit to API routes, static assets, and the application fallback.',
      'Rate-limit responses include standard headers and return structured JSON for API clients.',
    ],
    fixes: [
      'GitHub Actions CI now declares read-only repository permissions explicitly.',
      'Invalid rate-limit environment values fall back to safe defaults with a server warning.',
      'Production images now include the request-limiting middleware used by the runtime server.',
    ],
    notes: [
      'Deployments can tune RATE_LIMIT_WINDOW_MS and RATE_LIMIT_MAX, and should set TRUST_PROXY to an explicit hop count or proxy range when running behind a reverse proxy.',
    ],
  },
  {
    version: '0.1.17',
    date: '2026-07-13',
    channel: 'release',
    title: 'Connection endpoint filtering',
    highlights: [
      'Manual connection editors now list only compatible, available ports on equipment placed on the canvas.',
      'Assigned NIC and GPU ports are grouped beneath their server or NAS instead of appearing as independent inventory devices.',
      'Patch-panel destinations now identify the port number and front or back side explicitly.',
    ],
    fixes: [
      'Unassigned expansion cards and hosts without an actionable destination no longer appear in connection dropdowns.',
      'Changing the source port now keeps valid selections and resets destinations that are no longer compatible.',
    ],
  },
  {
    version: '0.1.16',
    date: '2026-07-12',
    channel: 'release',
    title: 'Docker update notifications',
    highlights: [
      'Homelab Inventory now checks the configured stable or latest Docker Hub channel and shows when a newer image is available.',
      'The update dialog includes release highlights, a manual check, copyable Docker Compose commands, and an exact-version skip action.',
    ],
    fixes: [],
    notes: [
      'Automatic checks are anonymous, run at startup and every six hours, and can be disabled with UPDATE_CHECK_ENABLED=false.',
    ],
  },
  {
    version: '0.1.15',
    date: '2026-07-12',
    channel: 'release',
    title: "What's New ordering",
    highlights: [],
    fixes: [
      'The What\'s New dialog now lists included releases from newest to oldest.',
      'Only the highest displayed version receives the LATEST badge; historical release channels are no longer presented as recency labels.',
    ],
    notes: [
      'Release-channel metadata remains available internally and is not modified by this presentation fix.',
    ],
  },
  {
    version: '0.1.14',
    date: '2026-07-10',
    channel: 'release',
    title: 'Negotiated network cable speeds',
    highlights: [
      'Network connections now persist their negotiated speed and use the lowest advertised speed across the full connected path.',
      'Patch panels now behave as passive links, so attaching a slower server or NAS updates every cable on both sides of the keystone.',
      'Added a light-purple 5G cable color alongside the existing 1G, 2.5G, and 10G palette.',
      'Switch RJ45, SFP, and SFP+ receptacles now require an advertised speed, with practical defaults for newly added port groups.',
    ],
    fixes: [
      'A 1G server connected to a 2.5G switch now renders the complete path as 1G instead of incorrectly using the faster endpoint.',
      'Legacy switch-to-switch uplinks are repaired as network connections so 10G SFP+ links render blue instead of neutral.',
    ],
    notes: [
      'Schema migrations 4 and 5 backfill negotiated speeds and switch port defaults without changing cable IDs, labels, or routes.',
    ],
  },
  {
    version: '0.1.13',
    date: '2026-07-10',
    channel: 'release',
    title: 'Editable switch inspectors',
    highlights: [
      'Switch inspectors now use focused Specs, Ports, and Connections tabs that match the server inspector workflow.',
      'Switch names, manufacturers, models, management details, switching capacity, cooling, and grouped port definitions can now be edited directly.',
      'Port groups can be resized while preserving the IDs and cable assignments of retained ports.',
    ],
    fixes: [
      'Port reductions are blocked when they would remove a connected port or discard saved labels, notes, or IP details.',
    ],
    notes: [
      'Correcting an accidental port count now updates both the switch canvas card and its detailed port editor.',
    ],
  },
  {
    version: '0.1.12',
    date: '2026-07-10',
    channel: 'release',
    title: 'Patch panel row controls',
    highlights: [
      'Patch panel inspectors can now swap the front and back row display order on the canvas.',
    ],
    fixes: [],
    notes: [
      'The row order is stored as a patch panel display preference, so existing labels, ports, and cable endpoints stay intact.',
    ],
  },
  {
    version: '0.1.11',
    date: '2026-07-09',
    channel: 'release',
    title: 'Public demo sandboxes',
    highlights: [
      'A new APP_MODE=demo runtime creates isolated writable demo sessions from a read-only source data mount.',
      'Demo visitors get their own cookie-based sandbox with a countdown and an extension prompt before expiration.',
    ],
    fixes: [
      'Demo copies exclude backups, agent stores, private IPs, serial numbers, tokens, and secret-like notes.',
      'Agent enrollment and telemetry endpoints return 403 in public demo mode.',
      'The demo extension prompt waits for the active sandbox to actually expire before opening.',
      'Demo-mode runtime files are included in the Docker image and session cookies are handled defensively.',
      'Connection inspector cards now keep consistent drawer padding after the server inspector redesign.',
    ],
    notes: [
      'Adds a public demo mode with sanitized per-browser sandboxes, a visible session timer, and disabled agent enrollment.',
      'GitHub Actions now uses checkout v7 for CI and Docker publishing workflows.',
      'TypeScript dev tooling was updated to 7.0.2.',
      'Node type definitions were updated to 26.1.1.',
    ],
  },
  {
    version: '0.1.10',
    date: '2026-07-09',
    channel: 'stable',
    title: "What's New release notes",
    highlights: [
      'Added structured release notes that power an in-app update dialog.',
      'Added persisted release-note acknowledgement in the deployment data store.',
      'Added CI and Docker publishing checks so meaningful releases include app-readable notes.',
    ],
    fixes: [
      'Prevents GitHub Actions Docker publishing when the package version has no matching release-note entry.',
    ],
    notes: [
      'The dialog appears after upgrades until the deployment acknowledges it with Got it.',
    ],
  },
]

type Semver = {
  major: number
  minor: number
  patch: number
}

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/, '')
}

function parseSemver(version: string): Semver {
  const normalized = normalizeVersion(version)
  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)$/)

  if (!match) {
    throw new Error(`Invalid semver version: ${version}`)
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  }
}

export function compareVersions(left: string, right: string): number {
  const a = parseSemver(left)
  const b = parseSemver(right)

  if (a.major !== b.major) {
    return a.major - b.major
  }

  if (a.minor !== b.minor) {
    return a.minor - b.minor
  }

  return a.patch - b.patch
}

export function hasReleaseNoteForVersion(
  entries: ReleaseNoteEntry[],
  version: string,
): boolean {
  const normalized = normalizeVersion(version)

  return entries.some((entry) => normalizeVersion(entry.version) === normalized)
}

export function getReleaseNotesBetween(
  entries: ReleaseNoteEntry[],
  lastSeenVersion: string,
  currentVersion: string,
): ReleaseNoteEntry[] {
  return entries
    .filter((entry) => compareVersions(entry.version, lastSeenVersion) > 0)
    .filter((entry) => compareVersions(entry.version, currentVersion) <= 0)
    .sort((left, right) => compareVersions(right.version, left.version))
}
