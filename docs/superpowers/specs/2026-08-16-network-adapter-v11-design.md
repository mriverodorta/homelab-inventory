# Network Adapter Catalog Contract v11 Design

## Objective

Adopt registry catalog contract v11 as the application's single network-adapter model. The application will support Ethernet, Wi-Fi, Fibre Channel, InfiniBand, converged, and cellular adapters through normalized SQLite persistence, compatibility, canvas topology, catalog browse/import, linked updates, contributions, and backup/export workflows.

The implementation raises `APPLICATION_CATALOG_CONTRACT_VERSION` to `11` only after the complete contract is implemented and verified. This work remains unreleased until an explicit deployment request.

## Product Decisions

- `network` is the only inventory type for network adapters.
- The existing `wireless` inventory type is retired through an automatic migration.
- Existing wireless records become network records while preserving numeric item IDs and every relationship.
- The UI uses the label **Network Adapter** rather than **Network Card** or **Wireless Card**.
- Wi-Fi and cellular adapters are radio-only unless the catalog record explicitly contains a physical port. Contract-v11 Wi-Fi and cellular templates do not expose ports or cable endpoints.
- Physical network connections require a compatible connector, at least one shared operating mode, and at least one shared supported speed.
- Runtime and WASM connection negotiation use integer bits per second through `negotiatedSpeedBps` and `negotiated_speed_bps`. Legacy imports may accept Mbps only at their adapter boundary.

## Architecture

### Unified Inventory Model

All new, migrated, and imported adapters use `InventoryItem.type = "network"`. No v11-only subtype or parallel adapter representation will be introduced.

The runtime network-adapter model exposes:

- product identity: manufacturer, family, model, aliases;
- technology: Ethernet, Wi-Fi, Fibre Channel, InfiniBand, converged, cellular, or other;
- controller, form factor, lifecycle state, and adapter operating modes;
- one family-specific host-interface definition;
- wired/fabric physical ports and their material topology;
- radio characteristics for Wi-Fi and cellular products;
- stable capability flags and lists;
- structured compatibility requirements;
- local instance overrides that are not catalog-owned.

Incomplete user-managed records remain editable. Registry-owned v11 templates must satisfy the complete strict contract.

### Normalized SQLite Schema

The v11 model will not store its structured fields as a JSON document. It extends the relational core with focused tables:

- `network_adapters`: one row per network inventory item, with technology, controller, form factor, lifecycle, maximum wired speed, maximum radio PHY rate, spatial streams, Bluetooth version, antenna topology, and scalar capability flags.
- `network_adapter_host_interfaces`: one row per adapter, with the interface family and nullable family-specific fields for PCIe, M.2, USB, OCP, mezzanine, onboard, and proprietary attachment.
- `network_adapter_operating_modes`: adapter-level operating-mode set.
- `network_adapter_wifi_generations`: Wi-Fi generation set.
- `network_adapter_frequency_bands`: frequency bands stored as exact integer MHz values and projected deterministically to the contract's GHz values.
- `network_adapter_rdma_modes`: stable RDMA-mode set.
- `network_adapter_offloads`: stable offload set.
- `network_adapter_ports`: one-to-one extension of `inventory_ports`, containing the catalog-owned key, connector, slot number, technology, maximum speed, and module origin.
- `network_adapter_port_supported_speeds`: canonical BPS speed set for a physical port.
- `network_adapter_port_operating_modes`: per-port operating-mode set.
- `network_adapter_port_media`: per-port media set.
- `network_port_local_overrides`: local label, notes, IP address, MAC address, role, and connection-state data, separated from catalog-owned topology.
- `network_adapter_extension_values`: typed relational path/value rows for forward-compatible signed fields that are not yet part of the known v11 schema. Rows identify adapter, host-interface, or numeric port ownership and preserve object/array ordering without a JSON column.

Every primary and foreign key remains a positive safe integer. Set tables use their own numeric primary keys and unique constraints over their parent ID and canonical value. Existing generic inventory properties preserve noncanonical user fields. Unknown signed registry fields use typed extension rows with a canonical path, value kind, scalar value, and array ordinal so they can round-trip without replacing normalized v11 columns or storing a JSON document.

Family-specific check constraints ensure that required fields exist only for the relevant interface family:

- PCIe: generation, connector lanes, minimum electrical lanes;
- M.2 A/E and B/M: key and module size;
- USB: generation and connector;
- OCP: OCP version;
- mezzanine and proprietary: interface key.

Registry templates must pass these checks before import. User-managed partial records may omit unknown values but cannot persist contradictory family-specific values.

## Automatic Migration

The ordered startup migration performs the following transactionally:

1. Create and verify the standard pre-migration backup covering core, telemetry, and catalog databases.
2. Create the normalized network-adapter tables, indexes, foreign keys, and check constraints.
3. Convert existing `network` subtype rows into the normalized adapter schema.
4. Convert existing `wireless` inventory items to the `network` type without changing their numeric inventory IDs.
5. Rewrite every type-bearing relationship from `wireless` to `network`, including assignments, registry links, endpoint ownership, identity aliases, project references, fixed-component references, and import aliases.
6. Preserve `wireless:<id>` as a backward-compatible identity alias while emitting and persisting only `network:<id>` after migration.
7. Convert deterministic legacy values to canonical fields. Examples include `10G` to `10000000000` BPS and recognized `M.2 A+E` text to host-interface family `m2-ae`, key `A+E`.
8. Preserve unrecognized local values in relational source-text or inventory-property rows without inventing compatibility facts.
9. Validate referential integrity, inventory counts, assignments, canvas placements, connections, route cache, registry links, agent bindings, telemetry ownership, project state, and catalog state.
10. Delete obsolete `wireless_cards` subtype rows only after all validation succeeds.
11. Restore the complete pre-migration database set if any migration or validation stage fails.

The migration is idempotent. A second startup must produce byte-identical catalog-owned network state and must not create duplicate aliases, child rows, assignments, ports, or links.

## Catalog Protocol

The application copies and consumes the registry's frozen v11 fixture without modification. Canonicalization and hashing must reproduce:

- Intel X710-DA2 identity hash `4d31d779f7ac3e92193b85a4532c5eaea20c58273a86ed89aa649581c3488df4` and content hash `beae60950b946298b6125bec0c5d9a73d6b940b3b59979eb82f0a969d6c404c6`.
- Intel AX210.NGWG identity hash `57298d0705e4c642b57bb40085bef193330778396eb54b50934418e93c8762e9` and content hash `db577935d26e7625763b10dea3b701d0a8e258d82da9c66c2f486f8ca4dcf280`.

Canonical v11 processing preserves host attachment, port ordering, numeric port IDs, connector types, supported speed sets, technologies, modes, media, radio topology, capabilities, lifecycle, aliases, and unknown forward-compatible fields. Unsupported catalog contract versions fail explicitly.

Material identity includes manufacturer/model, technology, host interface, form factor, physical port topology, and radio topology. Speed corrections, capabilities, and lifecycle changes alter content without altering identity. Alias-only changes alter neither identity nor content.

## Assignment And Compatibility

Network adapters remain independent inventory records assignable to server, NAS, workstation, desktop, or custom-PC hosts when a compatible replaceable resource exists.

Compatibility evaluates the structured host-interface requirement against a normalized host resource:

- interface family must match;
- PCIe generation follows the application's compatible-generation policy;
- connector lanes must physically fit;
- electrical lanes must meet the adapter's minimum;
- M.2 key and module size must match;
- USB generation and connector must match;
- OCP version must match;
- mezzanine and proprietary interface keys must match;
- required height, slot width, and power limits must remain satisfied.

A slot with more electrical lanes than the adapter requires is compatible and does not produce an alert. Unknown data produces an unverifiable result; unsupported data produces an incompatibility result.

Only an assigned adapter contributes host-nested endpoints. Unassigned adapters remain inventory-only. Assigned radio-only adapters remain visible under the host but create no cable endpoints.

## Port Ownership And Local Overrides

Catalog-owned material port fields are read-only while an item remains linked:

- stable key and numeric port ID;
- connector type and slot number;
- network technology;
- maximum and supported speeds;
- operating modes and media;
- module origin and physical ordering.

Local instance fields remain independently editable and survive linked updates:

- custom label and notes;
- IP and MAC address;
- local role and connection state.

Runtime projections merge the catalog-owned definition with local overrides. Registry update application modifies only catalog-owned rows and never replaces local override rows.

## Cable Negotiation And WASM Contract

The active runtime, worker protocol, and Rust/WASM engine use BPS exclusively:

- `InventoryConnection.negotiatedSpeedBps`;
- engine field `negotiated_speed_bps`;
- port fields `speedBps` and `supportedSpeedsBps`.

The SQLite `project_connections.negotiated_speed_bps` column remains canonical and no longer converts to Mbps when projected into the active runtime. Legacy JSON imports may read `negotiatedSpeedMbps` and convert it once at the boundary. New persistence, exports, engine messages, and API responses do not emit Mbps fields.

A physical connection is valid only when active endpoints have:

1. compatible connector types;
2. at least one shared operating mode;
3. at least one shared supported speed.

The negotiated speed is the greatest integer in the speed-set intersection. Patch panels are passive and transparently propagate the active endpoints' modes and supported speeds. Open passive segments retain the known active endpoint information. Radio PHY rates never create endpoints, affect wired negotiation, or select cable appearance.

Legacy ports without a supported-speed set may derive a singleton set from an existing valid canonical or boundary-converted legacy speed. The application does not infer arbitrary speed capabilities from connector names for linked v11 records.

Cable appearance uses the negotiated BPS value. Existing connections are preserved during migration and recalculated only when their endpoint topology or canonical capabilities change.

## Linked Updates

Linked updates compare canonical catalog-owned fields separately from local instance fields.

Changes to connector, port count, port order, port IDs, technology, operating modes, host attachment, or radio topology require review. An update that would remove or materially change an assigned resource or connected port is blocked until the user resolves the affected assignment or connection. It cannot silently orphan data.

Applying a safe update preserves:

- inventory IDs and runtime identity;
- assignments and allocation positions;
- canvas placements and route cache;
- cable connections and manual bends;
- local port overrides;
- services, agents, telemetry, and project settings.

Equivalent OEM labels remain identity aliases and do not create duplicate inventory templates or detach existing links.

## Forms, Inspector, Canvas, And Catalog

The UI exposes one **Network Adapter** category. The obsolete Wireless Card category and form are removed after migration.

Add Hardware and inspector editing share focused sections for:

- identity and lifecycle;
- technology, controller, family, model, and form factor;
- family-specific host-interface fields;
- physical ports, supported speeds, media, and operating modes;
- Wi-Fi/cellular radio data;
- capabilities and compatibility.

Selecting Wi-Fi or cellular hides physical-port controls. Wired and fabric adapters expose independently editable port groups for unlinked local records. Linked material fields are read-only until deliberate detachment.

On the canvas, assigned wired adapters render one compact row containing their adapter name, host-interface chip, and one connector chip per physical port. Assigned radio adapters render a compact technology/generation row without handles. The adapter row remains visible even when it has no physical ports.

Catalog browsing uses the signed server-side facet index and paginated endpoints. It supports manufacturer, family, model, technology, host-interface family, form factor, connector, maximum and supported speeds, operating modes, port count, media, stable capabilities, and discontinued state. Detail data remains lazy-loaded; the browser never downloads the complete catalog.

## Contributions And Privacy

Contribution identity and content use canonical v11 fields. Eligible data includes product identity, host interface, topology, canonical speeds, radio fields, capabilities, lifecycle, and aliases.

Sanitization removes assignments, host IDs, IP addresses, MAC addresses, local labels, notes, connection topology, services, agents, serial numbers, and locations. Controller-only identities without a complete board manufacturer and model are not eligible candidates.

## Backup, Export, And Offline Catalog

Complete backups, registry-enrollment backups where applicable, selective exports, selective restores, signed snapshots, digest indexes, and offline catalog bundles preserve every v11 relation and exact integer unit. Restore validation stages all selected sections, checks foreign keys and type aliases, and commits atomically.

Legacy exports containing wireless records or Mbps connection values are accepted only through versioned import adapters. Newly created exports contain unified network records and BPS values.

## Performance

Repository queries bulk-load adapters, host interfaces, ports, set-valued child relations, local overrides, assignments, and registry links. No per-adapter or per-port query loops are allowed.

Canvas projections remain memoized by stable item, assignment, port, and connection revisions. Radio-only adapters create no hidden handles or routing work. Catalog category browsing remains server-side, paginated, and facet-driven.

## Error Handling

- Unsupported catalog contracts fail with an explicit contract-version error.
- Invalid registry v11 records fail atomically before creating inventory or links.
- Contradictory host-interface fields fail validation.
- Topology updates that would orphan relationships remain blocked with affected item, assignment, port, and connection IDs.
- Migration failures restore the complete verified backup and retain a diagnostic receipt without private values.
- Runtime compatibility and connection errors identify the exact structured field that prevented assignment or negotiation.

## Verification

Before reporting application catalog contract 11, automated coverage must prove:

- exact fixture identity and content hashes;
- strict canonicalization and idempotence;
- normalized SQLite round trips for every scalar and child relation;
- automatic wireless-to-network migration with stable numeric IDs;
- preservation of assignments, placements, connections, route cache, links, agents, and telemetry;
- legacy identity alias resolution and import compatibility;
- every host-interface family's assignment rules;
- numeric port-ID stability through migration, restart, update, backup, and restore;
- assigned-only endpoint exposure and radio no-endpoint behavior;
- connector, mode, and greatest-shared-speed negotiation;
- passive patch-panel propagation;
- BPS-only runtime, API, persistence, export, and WASM contracts;
- linked-update preservation and orphan blocking;
- OEM alias deduplication;
- contribution sanitization;
- signed snapshot, digest, offline bundle, and selective export/import round trips;
- server-side facet filtering and pagination;
- migration rollback against production-shaped data;
- second-startup byte identity;
- no full-catalog browser transfer and no N+1 persistence queries.

The standard repository checks remain mandatory:

```bash
bun run lint
bun run test
bun run build
```

Container security preflight runs before a later deployment, not during ordinary implementation.

## Documentation And Release Discipline

Implementation updates the unreleased structured release-note draft and the `Unreleased` changelog section. The user-facing summary covers the unified Network Adapter category, automatic wireless migration, canonical BPS connection negotiation, richer adapter compatibility, and v11 registry support.

No package version, release tag, Docker tag, or deployment is created until explicitly requested.

## Deployment Gate

The registry keeps v11 network drafts unpublished and gated on application contract 11. Deployment order is:

1. Verify registry staging is healthy with v11 drafts unpublished.
2. Deploy the v11-capable application.
3. Verify production and demo migration, contract reporting, assignment, endpoints, negotiation, linked updates, offline catalog, and restart idempotency.
4. Advance the registry application gate to 11.
5. Publish the approved network corpus in one signed catalog revision.
6. Refresh production and demo catalogs and repeat the end-to-end adapter checks.

Older clients must never receive topology they cannot interpret.
