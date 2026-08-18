# Catalog Contract v12 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt the frozen catalog contract v12 for physical M.2 A/E socket compatibility while preserving all relational topology and presenting physical compatibility separately from OEM intended use.

**Architecture:** Extend the existing catalog protocol and canonical compatibility audit rather than adding a parallel v12 adapter. Persist canonical socket keys, semantic key aliases, tri-state bus evidence, and component bus requirements relationally in core SQLite; evaluate assignments against their exact numeric resource slots; and reuse the existing atomic Registry update resolution path for in-place resource reclassification.

**Tech Stack:** Bun, TypeScript, JavaScript ES modules, SQLite through `bun:sqlite`, Drizzle schema plus ordered SQL migrations, React, TanStack Query, Vitest, Bun test.

## Global Constraints

- Implement frozen contract commit `a46477d3ec007a2f9537257a2e99958ad5424c89` without semantic changes.
- Report `APPLICATION_CATALOG_CONTRACT_VERSION=12` only after the complete application implementation and tests are present.
- Canonical public fields are `keyAliases` and `socketKeys`; legacy `aliases` and `acceptedKeys` are import-boundary inputs only.
- Preserve absent, explicit-empty, and populated `availableBuses` as distinct states.
- Persist every primary and foreign key as a positive safe integer.
- Preserve numeric resource IDs, physical slot IDs, assignments, placements, cables, route cache, private fields, and Registry links.
- Missing evidence is informational and non-blocking; proven conflicts are actionable.
- `intendedModuleKinds` is descriptive for M.2 A/E and cannot block assignment or drag-and-drop.
- Do not weaken strict `acceptedModuleKinds` behavior for unrelated optional-slot families.
- Do not bump the application version until deployment is explicitly requested.

---

## File Map

Create:

- `packages/catalog-protocol/src/m2-ae-v12.ts`: canonical USB vocabulary, key matrix, v12 validation, and canonicalization helpers.
- `packages/catalog-protocol/test/m2-ae-v12.test.ts`: protocol, hashing, snapshot, and alias regression coverage.
- `server/persistence/core/migrations/generated/0022_m2_ae_contract_v12.sql`: ordered relational schema/data migration.
- `server/registry/m2-ae-v12-migration.bun_spec.mjs`: Registry update reclassification and preservation tests.
- `src/components/compatibility/m2-ae-compatibility-summary.tsx`: focused physical fit, required bus, and intended-use presentation.
- `src/components/compatibility/m2-ae-compatibility-summary.test.tsx`: presentation and accessibility coverage.

Modify:

- `packages/catalog-protocol/src/types.ts`, `index.ts`, `canonical-units.ts`, `hash.ts`, `projector.ts`, `sanitize.ts`, and `snapshot.ts`: fingerprint 12, canonical fields, deterministic hashing, and signed artifact support.
- `server/app-health.mjs`: report catalog contract 12.
- `src/types/registry.ts`: accept fingerprint 11 and 12 in linked records.
- `src/types/compatibility.ts`: canonical optional-slot fields and plural bus requirements.
- `server/persistence/core/schema/resources.ts`: bus evidence state and canonical child tables.
- `server/persistence/core/schema/inventory-network.ts`: relational component required-bus table.
- `server/persistence/core/schema/index.ts`: export new tables.
- `server/persistence/core/migrations/manifest.ts`: register migration `0023_m2_ae_contract_v12` with its verified digest.
- `server/persistence/migration/core-importer.ts`: canonical import plus legacy boundary normalization.
- `server/persistence/core/projections/legacy-project.ts`: canonical project projection with tri-state evidence.
- `server/backup/sqlite-section-exporter.ts` and `server/backup/sqlite-restore-staging.ts`: include and remap new relational tables.
- `shared/compatibility/index.mjs` and `index.d.mts`: socket matrix and required-bus evaluation.
- `server/registry/catalog-runtime-projection.mjs`, `catalog-update-semantics.mjs`, `update-service.mjs`, and `wlan-resource-migration.mjs`: runtime v12 projection and atomic canonical resource migration.
- `src/components/host-compatibility-tab.tsx` and `src/components/component-compatibility-tab.tsx`: render the shared physical/bus/intended-use model.
- `src/components/inventory-form/resource-group-editor.tsx` and `compatibility-fields.tsx`: edit canonical v12 fields without emitting legacy names.
- `src/release-notes.ts` and `CHANGELOG.md`: document user-visible v12 behavior and automatic migration.

### Task 1: Add Canonical Protocol v12

**Files:** protocol files listed above and `packages/catalog-protocol/test/m2-ae-v12.test.ts`.

**Interfaces:**

- Produces `M2_AE_FINGERPRINT_VERSION = 12`.
- Produces `canonicalizeCatalogItemV12(value): CatalogTemplateItem`.
- Produces `moduleKeyFitsSocket(moduleKey, socketKey): boolean`.
- Produces `normalizeUsbGenerationV12(value, { legacyBoundary }): string | undefined`.
- Produces typed `CatalogBusEvidence`, `CatalogRequiredBus`, and canonical optional-module resource fields.

- [ ] Write failing tests for A/E key matching, canonical USB names, legacy USB aliases, unknown legacy generation preservation, tri-state buses, invalid duplicate bus families, and deterministic order.
- [ ] Add fingerprint 12 to every supported-version gate and snapshot/digest parser.
- [ ] Implement canonical v12 validation and deterministic sorting without modifying historical v2-v11 canonicalizers.
- [ ] Make v12 identity material include physical resource topology and component host-interface requirements while excluding `keyAliases` and `intendedModuleKinds` from identity.
- [ ] Verify alias-only and intended-use changes preserve identity but change content.
- [ ] Run `bunx vitest run packages/catalog-protocol/test/m2-ae-v12.test.ts packages/catalog-protocol/test/snapshot.test.ts`.

### Task 2: Persist v12 Relationally And Migrate Existing Data

**Files:** schema, migration, importer, projection, backup, and restore files listed above.

**Interfaces:**

- Optional resource groups expose `busEvidenceState: 'unknown' | 'recorded'` where `recorded` permits zero bus rows.
- Canonical child rows persist `keyAliases`, `socketKeys`, available buses, intended kinds, and component required buses.
- Legacy `aliases` and `acceptedKeys` are accepted only by `core-importer.ts` and converted before insert.

- [ ] Write failing SQLite round-trip tests proving absent and empty buses remain distinct.
- [ ] Write failing migration fixtures for same-collection `wlan-m2` rename, expansion-to-optional reclassification, assignments, no assignments, collisions, and restart idempotency.
- [ ] Add normalized schema tables/columns with uniqueness, positive-number, family-specific, and host-scoped alias validation.
- [ ] Implement migration `0022_m2_ae_contract_v12.sql` as an in-place reclassification that retains resource and physical slot IDs.
- [ ] Extend importer and projection to emit only `keyAliases` and `socketKeys` while accepting legacy names at the boundary.
- [ ] Include the new tables in complete and selective backup/restore dependency ordering.
- [ ] Register the migration with its SHA-256 and run `bun run db:migrations:check`.

### Task 3: Evaluate Physical Fit And Required Buses

**Files:** `shared/compatibility/index.mjs`, declarations, types, and compatibility tests.

**Interfaces:**

- `normalizeComponentRequirements()` returns `requiredBuses` with AND semantics.
- `evaluateAssignmentCompatibility()` evaluates exact assigned resource, key matrix, size, and bus requirements.
- Findings retain `classification: 'informational' | 'actionable'` and stable rule keys.

- [ ] Add failing tests for all socket/module matrix combinations.
- [ ] Add failing tests for PCIe-only Ethernet and PCIe+USB combination devices.
- [ ] Add tests for absent, empty, partial, sufficient, and insufficient host bus evidence.
- [ ] Replace exact key equality with the frozen matrix for M.2 A/E only.
- [ ] Enforce every declared required bus while treating missing evidence as informational.
- [ ] Ignore M.2 A/E intended-kind mismatches and retain unrelated strict kind checks.
- [ ] Run the focused compatibility rule, normalization, allocation, and workflow suites.

### Task 4: Apply Registry v12 Updates Atomically

**Files:** Registry runtime/update files and `server/registry/m2-ae-v12-migration.bun_spec.mjs`.

**Interfaces:**

- Runtime projection canonicalizes fingerprint 12 with runtime canonical version 12.
- Resolution order is numeric ID, canonical key, unique alias, then unique structural match.
- Reclassification emits one `reclassify-resource` operation and never delete/add pairs.

- [ ] Add tests for the 33 same-collection and 11 cross-collection fixture patterns.
- [ ] Add collision, duplicate alias, count mismatch, and ambiguous structural-match failures.
- [ ] Generalize the legacy WLAN migration to canonical `m2-ae-slot` while retaining old update compatibility.
- [ ] Preserve assignment IDs, resource-slot IDs, item private fields, project topology, route cache, and Registry link state.
- [ ] Verify repeated planning/application is deterministic and produces no second migration.
- [ ] Run Registry update, OEM safety, SQLite store, and migration tests.

### Task 5: Present Physical Compatibility Clearly

**Files:** presentation component, Inspector tabs, and form editors listed above.

**Interfaces:**

- The presentation component consumes canonical host resource plus component requirements and never evaluates persistence itself.
- It presents Physical fit, Required buses, and OEM intended use as separate rows.

- [ ] Add failing component tests for compatible wired Ethernet in an OEM WLAN-intended slot.
- [ ] Render key/size physical fit independently from bus evidence.
- [ ] Render intended use in neutral informational styling with no attention count.
- [ ] Ensure informational missing evidence appears under Unverified details, not actionable alerts.
- [ ] Update editors to save canonical names and preserve explicit empty bus evidence.
- [ ] Run focused Inspector, form, Audit, and Systems attention tests.

### Task 6: Complete Integration, Documentation, And Verification

**Files:** app health, release notes, changelog, shared Registry fixtures, and integration tests.

- [ ] Consume the Registry's frozen v12 fixtures without modifying them when its implementation commit becomes available.
- [ ] Verify the 44 affected templates retain numeric IDs and signed v3/v4/v5 aliases.
- [ ] Set application catalog contract reporting to 12 only after all v12 paths are active.
- [ ] Add release notes describing broader A/E compatibility and automatic topology preservation.
- [ ] Run `bun run lint`.
- [ ] Run `bun run test`.
- [ ] Run `bun run build`.
- [ ] Run `bun run security:container`.
- [ ] Confirm no real data, credentials, private addresses, or runtime stores are included.

## Self-Review

- Every frozen v12 contract section maps to a task above.
- Canonical names and tri-state evidence use one representation across protocol, SQLite, evaluator, update planner, backups, and UI.
- Historical fingerprint versions remain immutable; v12 code is additive.
- The migration retains numeric resources and relationships rather than rebuilding topology.
- No placeholder implementation, parallel adapter, JSON-only persistence, or unrelated refactor is included.

