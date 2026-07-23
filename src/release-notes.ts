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

export const UNRELEASED_RELEASE_NOTES: UnreleasedReleaseNotes = {
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
  ],
  notes: [],
}

export const RELEASE_NOTES: ReleaseNoteEntry[] = [
  {
    version: '0.1.38',
    date: '2026-07-21',
    channel: 'latest',
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
