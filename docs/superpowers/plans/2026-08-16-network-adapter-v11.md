# Network Adapter Catalog Contract v11 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt registry network-adapter contract v11 through one normalized SQLite model, automatically migrate wireless inventory into network adapters, and use canonical BPS units through persistence, runtime, and WASM.

**Architecture:** Extend the shared catalog protocol and the relational core with strict network-adapter, host-interface, port-topology, radio, capability, and extension relations. Migrate existing `network` and `wireless` records into that model while preserving numeric identities and relationships. Reuse the unified model across compatibility, connections, forms, inspectors, canvas, catalog updates, contributions, exports, and backups.

**Tech Stack:** Bun 1.3.14, TypeScript, React 19, Hono, Drizzle ORM, `bun:sqlite`, Rust/WASM domain engine, Vitest, Bun test.

## Global Constraints

- Report `APPLICATION_CATALOG_CONTRACT_VERSION=11` only after every contract test passes.
- Use `network` as the only network-adapter inventory type; remove `wireless` from active runtime and persistence types.
- Persist all known v11 fields in normalized SQLite relations, not JSON columns.
- Preserve unknown signed fields through typed relational extension rows.
- Preserve all positive safe-integer IDs, assignments, placements, connections, route cache, registry links, agents, telemetry, settings, and local port overrides.
- Use `negotiatedSpeedBps` and `negotiated_speed_bps` throughout active runtime and engine contracts.
- Accept Mbps only in versioned legacy import adapters.
- Do not bump the application version, tag, push, or deploy.
- Update `CHANGELOG.md` Unreleased and the structured unreleased release-note draft.

---

### Task 1: Shared Network Adapter v11 Catalog Contract

**Files:**
- Copy: `packages/catalog-protocol/test/fixtures/server-specs-inventory-network-v11.json`
- Modify: `packages/catalog-protocol/src/types.ts`
- Modify: `packages/catalog-protocol/src/contract.ts`
- Modify: `packages/catalog-protocol/src/canonical-units.ts`
- Modify: `packages/catalog-protocol/src/hash.ts`
- Modify: `packages/catalog-protocol/src/projector.ts`
- Modify: `packages/catalog-protocol/src/facets.ts`
- Create: `packages/catalog-protocol/test/network-v11.test.ts`
- Modify: `packages/catalog-protocol/test/snapshot.test.ts`

**Interfaces:**
- Produces `canonicalizeCatalogItemV11(value: unknown): CatalogTemplateItem`.
- Produces `assertCanonicalCatalogItemV11(value: unknown): void`.
- Extends catalog item/port types with v11 network fields and BPS values.
- Preserves v9/v10 behavior for older fingerprint versions.

- [ ] **Step 1: Copy the frozen registry fixture without modification**

Copy the exact bytes from `ServerSpecsInventoryRegistry/test/fixtures/catalog-import/network/server-specs-inventory-network-v11.json` into the protocol test fixture path and verify both files have the same SHA-256 digest.

- [ ] **Step 2: Add failing exact-hash and canonicalization tests**

Test that X710-DA2 and AX210.NGWG retain every structured field and produce the handoff's exact identity/content hashes. Test family-specific host-interface validation, positive numeric port IDs, sorted unique speed/mode/media sets, radio no-port semantics, unknown-field preservation, and canonicalization idempotence.

- [ ] **Step 3: Run the focused protocol tests and confirm failure**

Run:

```bash
bunx vitest run packages/catalog-protocol/test/network-v11.test.ts
```

Expected: failures because v11 canonicalization and hashing are not implemented.

- [ ] **Step 4: Implement strict v11 canonicalization and projection**

Add the supported technology, host-interface, connector, media, and capability vocabularies. Canonicalize integer BPS fields without floating conversion. Require physical ports for wired/fabric adapters and reject physical ports on v11 Wi-Fi/cellular records. Route fingerprint version 11 through v11 canonicalization and keep older versions unchanged.

- [ ] **Step 5: Add v11 facet keys and snapshot preservation**

Support all handoff facet keys and prove signed snapshots/digest inputs preserve v11 records and unknown extension fields.

- [ ] **Step 6: Run focused tests**

```bash
bunx vitest run packages/catalog-protocol/test/network-v11.test.ts packages/catalog-protocol/test/snapshot.test.ts
```

Expected: all pass with exact hashes.

- [ ] **Step 7: Commit**

```bash
git add packages/catalog-protocol
git commit -m "feat: add network adapter catalog contract v11"
```

### Task 2: Canonical BPS Runtime And WASM Protocol

**Files:**
- Modify: `src/types/inventory.ts`
- Modify: `shared/engine/protocol.d.mts`
- Modify: `rust/crates/protocol/src/lib.rs`
- Modify: `rust/crates/domain-core/src/lib.rs`
- Modify: `server/engine/snapshot.mjs`
- Modify: `src/engine/project-patches.ts`
- Modify: `src/hooks/use-topology-query.ts`
- Modify: `server/persistence/core/projections/legacy-project.ts`
- Modify: `server/persistence/sqlite-store.ts`
- Modify: `src/lib/canvas-node-dependencies.ts`
- Modify: `src/lib/cables.ts`
- Modify: `src/components/canvas/use-canvas-flow-edges.ts`
- Modify: `server/db/legacy-network-normalization.ts`
- Modify: `server/db/validation.mjs`
- Modify: `server/onboarding/example-workspace.mjs`
- Modify: `server/persistence/parity/report.ts`
- Modify: `server/persistence/fixtures/schema-29-production-shape.ts`
- Modify: `server/engine/snapshot.test.mjs`
- Modify: `src/test/project-patches.test.ts`
- Modify: `src/test/engine-topology.test.ts`
- Modify: `src/test/engine-wasm-integration.test.ts`
- Modify: `src/test/topology-query-fixture.ts`
- Modify: `server/db/store.test.mjs`
- Modify: `src/test/negotiated-speed.test.ts`
- Modify: `src/test/cables.test.ts`
- Modify: `server/persistence/sqlite-store.bun_spec.ts`

**Interfaces:**
- Replaces runtime `negotiatedSpeedMbps?: number` with `negotiatedSpeedBps?: number`.
- Replaces engine `negotiated_speed_mbps` with `negotiated_speed_bps`.
- Legacy import adapters convert Mbps exactly once using `value * 1_000_000`.

- [ ] **Step 1: Change tests to require BPS runtime fields**

Update engine snapshot, patch, topology, cable appearance, persistence, and integration tests to expect values such as `1_000_000_000` and `10_000_000_000` under BPS field names. Add a boundary test that imports legacy `negotiatedSpeedMbps: 2500` as `2_500_000_000` BPS.

- [ ] **Step 2: Run focused tests and confirm failure**

```bash
bunx vitest run src/test/negotiated-speed.test.ts src/test/engine-wasm-integration.test.ts src/test/project-patches.test.ts
bun test server/engine/snapshot.test.mjs server/persistence/sqlite-store.bun_spec.ts
```

- [ ] **Step 3: Rename and convert the TypeScript/server contract**

Remove active Mbps projections. Read/write `project_connections.negotiated_speed_bps` directly. Keep conversion only in legacy JSON import and legacy-store boundaries.

- [ ] **Step 4: Rename the Rust protocol and domain fields**

Update serialized field names, generated TypeScript declarations, equality/patch logic, and benchmarks. Do not change routing geometry behavior.

- [ ] **Step 5: Update cable appearance and validation**

Key color/style lookup by canonical BPS values and accept any positive safe integer negotiated from valid endpoint intersections rather than the previous four-value Mbps allowlist.

- [ ] **Step 6: Run focused TypeScript, Bun, and Rust tests**

```bash
bun run build:wasm
bunx vitest run src/test/negotiated-speed.test.ts src/test/engine-wasm-integration.test.ts src/test/project-patches.test.ts src/test/cables.test.ts
bun test server/engine/snapshot.test.mjs server/persistence/sqlite-store.bun_spec.ts
cargo test --manifest-path rust/Cargo.toml --workspace
```

- [ ] **Step 7: Commit**

```bash
git add src shared server rust
git commit -m "refactor: use canonical bps connection speeds"
```

### Task 3: Normalized Network Adapter SQLite Schema

**Files:**
- Modify: `server/persistence/core/schema/inventory-network.ts`
- Modify: `server/persistence/core/schema/inventory-components.ts`
- Modify: `server/persistence/core/schema/index.ts`
- Modify: `server/persistence/core/schema/schema.bun_spec.ts`
- Modify: `server/persistence/core/inventory/field-contract.ts`
- Modify: `server/persistence/core/inventory/field-contract.bun_spec.ts`
- Generate: `server/persistence/core/migrations/generated/0017_network_adapter_v11.sql`
- Generate/update: `server/persistence/core/migrations/generated/meta/*`
- Modify: `server/persistence/core/migrations/manifest.ts`
- Modify: `scripts/check-database-migrations.bun_spec.mjs`

**Interfaces:**
- Produces normalized Drizzle tables named in the approved design.
- Removes `wireless` from `inventorySubtypeTables` and active field contracts.
- Keeps `inventoryPorts.id` as the physical endpoint identity.

- [ ] **Step 1: Add failing schema contract tests**

Assert table existence, foreign keys, uniqueness, value checks, family-specific host-interface checks, positive port ownership, local-override separation, and typed extension-row constraints. Assert `wireless` is absent from active subtype mappings.

- [ ] **Step 2: Run schema tests and confirm failure**

```bash
bun test server/persistence/core/schema/schema.bun_spec.ts server/persistence/core/inventory/field-contract.bun_spec.ts
```

- [ ] **Step 3: Define the normalized Drizzle schema**

Use integer columns for BPS and MHz, nullable scalar columns for partial local records, strict checks for linked complete records at service boundaries, and child relations with numeric IDs and unique parent/value constraints. Add typed extension rows with owner scope, optional numeric port ID, canonical path, value kind, scalar columns, and ordinal.

- [ ] **Step 4: Generate the ordered migration**

Run:

```bash
bunx drizzle-kit generate --name network_adapter_v11
```

Verify Drizzle creates the ordered `0017_network_adapter_v11.sql` migration, register its SHA-256 in the manifest, and do not edit prior migration files.

- [ ] **Step 5: Run schema and migration archive checks**

```bash
bun test server/persistence/core/schema/schema.bun_spec.ts server/persistence/core/inventory/field-contract.bun_spec.ts scripts/check-database-migrations.bun_spec.mjs
bun run db:migrations:check
```

- [ ] **Step 6: Commit**

```bash
git add server/persistence/core scripts/check-database-migrations.bun_spec.mjs
git commit -m "feat: add relational network adapter schema"
```

### Task 4: Wireless-To-Network Migration And Persistence

**Files:**
- Modify: `server/persistence/migration/core-importer.ts`
- Modify: `server/persistence/migration/core-importer.bun_spec.ts`
- Modify: `server/persistence/migration/core-verifier.ts`
- Modify: `server/persistence/sqlite-store.ts`
- Modify: `server/persistence/sqlite-store.bun_spec.ts`
- Modify: `server/persistence/core/projections/legacy-project.ts`
- Modify: `server/persistence/core/repositories/inventory-repository.ts`
- Modify: `server/persistence/legacy/legacy-store.mjs`
- Modify: `server/db/inventory-input.mjs`
- Create: `server/db/network-adapter-normalization.mjs`
- Create: `server/db/network-adapter-normalization.test.mjs`
- Modify: production-shaped migration fixtures under `server/persistence/fixtures/`.

**Interfaces:**
- Produces deterministic `normalizeLegacyNetworkAdapter(item)` boundary conversion.
- Projects all active adapters as `type: "network"`.
- Resolves legacy `wireless:<id>` aliases to the migrated network item.

- [ ] **Step 1: Add production-shaped migration failures first**

Cover network records, wireless records, assignments, registry links, hosted endpoint references, ports, route cache, agent bindings, global/project memberships, backup restoration, ID collisions, malformed aliases, and second-start byte identity.

- [ ] **Step 2: Run migration/persistence tests and confirm failure**

```bash
bun test server/persistence/migration/core-importer.bun_spec.ts server/persistence/sqlite-store.bun_spec.ts server/db/network-adapter-normalization.test.mjs
```

- [ ] **Step 3: Implement deterministic legacy normalization**

Map exact legacy network speeds and interfaces to canonical fields. Convert wireless records to technology `wifi`, preserve known Wi-Fi generation and Bluetooth presence without inventing a Bluetooth version, parse only recognized host-interface text, and retain unknown source text in relational extension/property rows.

- [ ] **Step 4: Implement transactional relationship rewriting**

Preserve inventory IDs. Rewrite type-bearing assignment, registry-link, identity-alias, port-alias, endpoint, fixed-component, and import references. Keep `wireless:<id>` aliases resolvable while all new projections emit `network:<id>`.

- [ ] **Step 5: Implement relational write/read paths**

Write adapter scalar and child relations atomically. Bulk-read all network child tables and merge local overrides without N+1 queries. Preserve unknown typed extensions and exact child ordering.

- [ ] **Step 6: Add rollback and restart proofs**

Force failures after schema creation, record conversion, and relationship rewriting; verify restoration of the complete database set and absence of duplicate rows after restart.

- [ ] **Step 7: Run focused persistence tests**

```bash
bun test server/persistence/migration/core-importer.bun_spec.ts server/persistence/sqlite-store.bun_spec.ts server/db/network-adapter-normalization.test.mjs
```

- [ ] **Step 8: Commit**

```bash
git add server/persistence server/db
git commit -m "feat: migrate wireless inventory to network adapters"
```

### Task 5: Host Interface Compatibility And Assignment

**Files:**
- Modify: `src/types/compatibility.ts`
- Modify: `shared/compatibility/index.d.mts`
- Modify: `shared/compatibility/index.mjs`
- Modify: `src/lib/compatibility.ts`
- Modify: `src/lib/compatibility-policy.ts`
- Modify: `src/lib/constraints.ts`
- Modify: `src/lib/pc-build-resources.ts`
- Modify: `src/lib/pc-build.ts`
- Modify: `src/test/compatibility-rules.test.ts`
- Modify: `src/test/compatibility-allocation.test.ts`
- Modify: `src/test/compatibility-workflows.test.ts`
- Modify: `src/test/pc-build-compatibility.test.ts`

**Interfaces:**
- Expands `ExpansionInterfaceFamily` to every v11 family.
- Evaluates a structured expansion requirement without display-string inference for linked v11 items.
- Treats sufficient electrical lanes as compatible without a warning.

- [ ] **Step 1: Add table-driven failing tests for every interface family**

Cover PCIe generation/lanes/height/width/power, M.2 A/E and B/M key/size, mini-PCIe, USB generation/connector, OCP version, mezzanine/proprietary keys, onboard resources, partial local data, and insufficient electrical lanes.

- [ ] **Step 2: Run focused tests and confirm failure**

```bash
bunx vitest run src/test/compatibility-rules.test.ts src/test/compatibility-allocation.test.ts src/test/compatibility-workflows.test.ts src/test/pc-build-compatibility.test.ts
```

- [ ] **Step 3: Implement normalized compatibility matching**

Extend resource and requirement types and evaluate family-specific fields. Keep legacy text parsing only in normalization boundaries. Ensure Wi-Fi/cellular adapters can occupy compatible replaceable resources while exposing no physical endpoint.

- [ ] **Step 4: Update assignment constraints**

Replace wireless-specific branches with unified network-adapter behavior for servers, NAS, workstations, desktops, and custom PCs.

- [ ] **Step 5: Run focused tests**

```bash
bunx vitest run src/test/compatibility-rules.test.ts src/test/compatibility-allocation.test.ts src/test/compatibility-workflows.test.ts src/test/pc-build-compatibility.test.ts src/test/constraints.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/types/compatibility.ts shared/compatibility src/lib src/test
git commit -m "feat: validate network adapter host interfaces"
```

### Task 6: Port Modes, Speeds, Endpoints, And Passive Paths

**Files:**
- Modify: `src/types/inventory.ts`
- Create: `src/lib/network-adapter-ports.ts`
- Create: `src/test/network-adapter-ports.test.ts`
- Modify: `server/db/legacy-network-normalization.ts`
- Modify: `src/test/negotiated-speed.test.ts`
- Modify: `src/lib/cables.ts`
- Modify: `src/lib/project.ts`
- Modify: `src/lib/cable-routing.ts`
- Modify: `src/lib/canvas-project-index.ts`
- Modify: affected endpoint and routing tests.

**Interfaces:**
- Produces `negotiateNetworkConnection(first, second): { mode: string; speedBps: number } | null`.
- Produces `isPhysicalNetworkAdapterPort(port): boolean`.
- Exposes assigned physical ports only.

- [ ] **Step 1: Add failing negotiation and endpoint tests**

Cover connector mismatch, mode mismatch, greatest speed intersection, converged modes, passive patch panels, open passive paths, radio PHY exclusion, assigned/unassigned adapters, radio-only adapters, stable numeric port IDs, and legacy singleton-speed fallback.

- [ ] **Step 2: Run focused tests and confirm failure**

```bash
bunx vitest run src/test/network-adapter-ports.test.ts src/test/negotiated-speed.test.ts src/test/connection-endpoints.test.ts src/test/cable-routing.test.ts
```

- [ ] **Step 3: Implement canonical negotiation**

Require connector compatibility and shared operating mode before intersecting supported BPS values. Select the greatest shared speed. Treat patch panels as passive. Never use `maxPhyRateBps` for endpoint, cable, or appearance behavior.

- [ ] **Step 4: Update endpoint and route indexing**

Create handles only for assigned adapters with physical ports. Keep assigned radio rows visible without handles and avoid adding them to routing dependencies.

- [ ] **Step 5: Run focused tests**

```bash
bunx vitest run src/test/network-adapter-ports.test.ts src/test/negotiated-speed.test.ts src/test/connection-endpoints.test.ts src/test/cable-routing.test.ts src/test/canvas-project-index.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src server/db/legacy-network-normalization.ts
git commit -m "feat: negotiate network adapter ports by mode and speed"
```

### Task 7: Unified Network Adapter Forms, Inspector, And Canvas

**Files:**
- Modify: `src/components/inventory-form/options.ts`
- Modify: `src/components/inventory-form/model.ts`
- Modify: `src/components/inventory-form/type-fields.tsx`
- Modify: `src/components/inventory-form/pc-component-fields.tsx`
- Modify: `src/components/inventory-form/compatibility-fields.tsx`
- Modify: `src/components/inventory-form/dialog-tab-policy.ts`
- Create: `src/components/inventory-form/network-adapter-fields.tsx`
- Create: `src/components/inventory-form/network-adapter-host-interface-fields.tsx`
- Create: `src/components/inventory-form/network-adapter-radio-fields.tsx`
- Create: `src/components/inventory-form/network-adapter-capability-fields.tsx`
- Modify: `src/components/inventory-form/port-groups-editor.tsx`
- Modify: `src/components/component-inspector-tabs.tsx`
- Modify: `src/components/component-compatibility-tab.tsx`
- Modify: `src/components/inspector/network/server-network-options.ts`
- Modify: `src/components/inspector/network/server-network-tab.tsx`
- Modify: `src/components/server-card.tsx`
- Modify: `src/components/nas-card.tsx`
- Modify: `src/components/pc-build-card.tsx`
- Modify: `src/components/inventory-sidebar.tsx`
- Modify: `src/components/inventory/catalog-category-picker.tsx`
- Modify: `src/components/inventory/catalog-filter-panel.tsx`
- Modify: `src/components/inventory/catalog-browser-model.ts`
- Modify: focused component/model tests.

**Interfaces:**
- Presents one Network Adapter category and shared editor sections.
- Hides port controls for Wi-Fi/cellular.
- Renders wired adapter ports and radio-only adapter rows consistently.

- [ ] **Step 1: Add failing form/model tests**

Verify complete X710 and AX210 round trips, dynamic host-interface controls, radio/port mutual exclusion, registry-owned read-only fields, local override editability, and removal of Wireless Card from category/type options.

- [ ] **Step 2: Add failing canvas/inspector tests**

Verify a wired adapter renders all independent handles, a radio adapter renders no handles, both remain visible under their assigned host, and local port data remains visible/editable.

- [ ] **Step 3: Run focused tests and confirm failure**

```bash
bunx vitest run src/test/inventory-form-model.test.ts src/test/inventory-item-dialog.test.tsx src/test/inventory-sidebar.test.tsx src/test/inspector-panel.test.tsx src/test/pc-build-card.test.tsx
```

- [ ] **Step 4: Implement focused form components**

Keep conditional logic in model/controller modules and keep TSX components single-purpose. Use existing shadcn controls and Lucide icons. Remove the active wireless editor and map legacy imported values before the form boundary.

- [ ] **Step 5: Implement canvas and inspector presentation**

Use compact rows, stable dimensions, no hidden handles, and no extra routing calculations for radio-only adapters. Keep registry indicator and audit/remove controls in their established overlay positions.

- [ ] **Step 6: Implement v11 catalog filters**

Consume signed facet definitions for the Network Adapter category, keep independent dialog-column scrolling, paginate with Load More, and lazy-load item details.

- [ ] **Step 7: Run focused tests and build**

```bash
bunx vitest run src/test/inventory-form-model.test.ts src/test/inventory-item-dialog.test.tsx src/test/inventory-sidebar.test.tsx src/test/inspector-panel.test.tsx src/test/pc-build-card.test.tsx src/test/catalog-browser-model.test.ts
bun run build
```

- [ ] **Step 8: Commit**

```bash
git add src
git commit -m "feat: unify network adapter inventory experience"
```

### Task 8: Registry Updates, Contributions, Backup, And Export

**Files:**
- Modify: `server/registry/catalog-runtime-projection.mjs`
- Modify: `server/registry/catalog-update-semantics.mjs`
- Modify: `server/registry/catalog-update-policy.mjs`
- Modify: `server/registry/update-service.mjs`
- Modify: `server/registry/contribution-service.mjs`
- Modify: `server/registry/catalog-runtime-projection.bun_spec.mjs`
- Modify: `server/registry/catalog-update-semantics.test.mjs`
- Modify: `server/registry/catalog-update-policy.test.mjs`
- Modify: `server/registry/update-service.test.mjs`
- Modify: `server/registry/contribution-service.test.mjs`
- Modify: `server/backup/backup-sections.mjs`
- Modify: `server/backup/backup-sections.test.mjs`
- Modify: `server/backup/sqlite-section-exporter.ts`
- Modify: `server/backup/sqlite-restore-staging.ts`
- Modify: `server/backup/restore-preflight.test.mjs`
- Modify: `server/backup/restore-journal.test.mjs`
- Modify: `server/backup/sqlite-backup.bun_spec.ts`
- Modify: `server/registry/snapshot-service.mjs`
- Modify: `server/registry/snapshot-service.bun_spec.mjs`
- Modify: `server/persistence/legacy/snapshot-reader.bun_spec.ts`

**Interfaces:**
- Applies v11 catalog-owned fields without changing local override relations.
- Classifies identity-bearing topology/radio changes as review-required.
- Blocks orphaning updates with resolvable affected IDs.
- Sanitizes all instance-specific contribution data.

- [ ] **Step 1: Add failing update and sanitization tests**

Cover safe capability/speed corrections, identity-bearing topology changes, connected-port removal, assigned host-interface change, alias-only updates, local override preservation, radio changes, OEM aliases, and private-field removal.

- [ ] **Step 2: Add failing backup/export tests**

Round-trip every v11 relation, typed extension, BPS value, wireless legacy alias, assignment, port, and local override through complete and selective backup/restore and offline catalog bundles.

- [ ] **Step 3: Run focused tests and confirm failure**

```bash
bun test server/registry/catalog-update-semantics.test.mjs server/registry/catalog-update-policy.test.mjs server/registry/contribution-service.test.mjs server/backup/backup-sections.test.mjs
```

- [ ] **Step 4: Implement v11 update semantics**

Canonicalize fingerprint version 11, separate catalog-owned and local fields, classify topology/radio identity changes, report affected numeric IDs, and prevent silent orphaning.

- [ ] **Step 5: Implement contribution and round-trip preservation**

Include only complete product identity/topology/radio/capability data. Strip IP, MAC, label, notes, assignment, host, connection, service, agent, serial, and location data. Preserve all normalized relations and typed extensions in backup/export staging.

- [ ] **Step 6: Run focused tests**

```bash
bun test server/registry/catalog-update-semantics.test.mjs server/registry/catalog-update-policy.test.mjs server/registry/contribution-service.test.mjs server/backup/backup-sections.test.mjs server/backup/restore-preflight.test.mjs
```

- [ ] **Step 7: Commit**

```bash
git add server/registry server/backup
git commit -m "feat: preserve network v11 registry lifecycle"
```

### Task 9: Contract Gate, Documentation, And Full Verification

**Files:**
- Modify: `server/app-health.mjs`
- Modify: `server/app-health.test.mjs`
- Modify: `src/types/registry.ts`
- Modify: `CHANGELOG.md`
- Modify: `src/release-notes.ts`
- Modify: `README.md`
- Modify: `DOCKERHUB.md`
- Create or modify production-shaped end-to-end tests under `server/persistence/` and `src/test/`.

**Interfaces:**
- Reports application catalog contract version 11.
- Documents automatic Wireless Card to Network Adapter migration and BPS canonicalization.

- [ ] **Step 1: Add the final contract-gate test**

Require health, registry status, snapshot receipts, and catalog metadata to report contract 11 only when the v11 fixture, schema, migration, and update paths are active.

- [ ] **Step 2: Run the contract test and confirm failure at version 10**

```bash
bun test server/app-health.test.mjs server/registry/snapshot-service.bun_spec.mjs
```

- [ ] **Step 3: Raise the contract and update documentation**

Set the application contract to 11. Add consolidated unreleased notes covering the unified category, migration, compatibility, physical/radio endpoint behavior, registry updates, and BPS engine contract.

- [ ] **Step 4: Run migration and persistence benchmarks**

```bash
bun run benchmark:sqlite
bun run benchmark:engine
```

Compare against repository thresholds and confirm bulk network projection adds no N+1 behavior or canvas routing work for radio-only adapters.

- [ ] **Step 5: Run complete repository verification**

```bash
bun run lint
bun run test
bun run build
```

Expected: all checks pass; only explicitly accepted existing lint warnings may remain.

- [ ] **Step 6: Review tracked changes and private-data boundaries**

Verify no runtime data, database copy, identity file, IP/MAC address, serial, credential, private screenshot, or `.env` file is tracked.

- [ ] **Step 7: Commit**

```bash
git add server/app-health.mjs server/app-health.test.mjs src/types/registry.ts CHANGELOG.md src/release-notes.ts README.md DOCKERHUB.md
git commit -m "feat: adopt network adapter catalog contract v11"
```

## Completion Criteria

- Every checklist item is complete.
- The frozen v11 hashes match exactly.
- Existing wireless items are network adapters after one automatic startup migration.
- No active `wireless` runtime or persistence type remains.
- Known v11 fields are relational and no v11 JSON document column is introduced.
- Runtime, SQLite, API, export, and WASM use BPS.
- Production-shaped migration, rollback, and second-start idempotency pass.
- Full lint, tests, and build pass.
- Unreleased notes are current and no version/tag/deployment exists.
