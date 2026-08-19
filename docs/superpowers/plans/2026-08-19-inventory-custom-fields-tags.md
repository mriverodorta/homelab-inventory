# Inventory Custom Fields And Tags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add installation-wide typed custom fields and reusable colored tags to inventory items, with relational persistence, private metadata, filtering, saved Systems views, SSE updates, and complete lifecycle support.

**Architecture:** Store definitions, applicability, options, typed scalar values, option relationships, tags, and item-tag relationships in normalized core SQLite tables. Expose them through a focused metadata service and ETag-aware API, integrate item mutations with project history, and keep list payloads compact through lazy values and SSE invalidation. Extend existing shadcn Settings, inventory dialogs, Inspector, Inventory discovery, and TanStack-powered Systems views.

**Tech Stack:** Bun, bun:sqlite, Drizzle schema/migrations, Hono/Express-compatible server routes, React, TypeScript, TanStack Query/Table/Virtual, shadcn/ui, Lucide, Vitest, Bun test.

## Global Constraints

- Definitions and tags are installation-wide.
- Custom metadata applies only to inventory items.
- Required fields, defaults, formulas, and computed fields are excluded.
- All IDs and relationships persist as positive safe integers.
- Metadata is private and must never enter Registry contributions or hashes.
- No metadata polling; use compact reads, ETags, lazy loading, and SSE.
- Existing inventory identity, project state, assignments, placements, cables, route cache, private fields, Registry links, catalog state, authentication state, and telemetry must survive migration unchanged.
- Use existing shadcn components and established application interaction patterns.
- Add structured unreleased notes and changelog entries; do not bump the version before deployment.

---

### Task 1: Relational Schema, Migration, And Permission

**Files:**
- Create: `server/persistence/core/schema/inventory-metadata.ts`
- Create: `server/persistence/core/migrations/generated/0025_inventory_metadata.sql`
- Modify: `server/persistence/core/schema/index.ts`
- Modify: `server/persistence/core/migrations/manifest.ts`
- Modify: `server/auth/permission-catalog.mjs`
- Create: `server/persistence/core/schema/inventory-metadata.bun_spec.ts`
- Test: `server/auth/permission-catalog.test.mjs`

**Interfaces:**
- Produces Drizzle tables `customFieldDefinitions`, `customFieldApplicability`, `customFieldOptions`, `inventoryCustomFieldValues`, `inventoryCustomFieldOptionValues`, `inventoryTags`, and `inventoryItemTags`.
- Produces permission key `inventory.metadata.manage` with stable numeric ID `206`.

- [ ] Write failing schema tests that insert every valid field type and reject duplicate names, wrong typed columns, inapplicable item values, cross-definition options, multiple single-select options, invalid numeric bounds, and assignments to archived definitions/tags.
- [ ] Run `bun test server/persistence/core/schema/inventory-metadata.bun_spec.ts` and confirm the schema exports are missing.
- [ ] Add focused Drizzle declarations with positive-ID foreign keys, checks, indexes, optimistic revisions, archive timestamps, and normalized-name uniqueness.
- [ ] Generate or hand-author migration `0025_inventory_metadata.sql`, including SQLite triggers for cross-table type, applicability, option ownership, cardinality, and numeric enforcement.
- [ ] Register the migration using its actual SHA-256 and export the schema from `schema/index.ts`.
- [ ] Add permission `206 inventory.metadata.manage`; grant it to Owner and Administrator while leaving Editor unchanged.
- [ ] Run schema, migration integrity, and permission tests.
- [ ] Commit as `feat: add inventory metadata schema`.

### Task 2: Domain Contract And Repository

**Files:**
- Create: `server/inventory-metadata/contract.mjs`
- Create: `server/inventory-metadata/repository.mjs`
- Create: `server/inventory-metadata/repository.bun_spec.mjs`
- Modify: `server/persistence/core/repositories/index.ts`
- Modify: `server/persistence/core/repositories/repository-context.ts`

**Interfaces:**
- Produces `FIELD_TYPES`, `COLOR_TOKENS`, `normalizeFieldDefinitionInput`, `normalizeTagInput`, and `normalizeMetadataValueInput`.
- Produces `createInventoryMetadataRepository(context)` with definition, option, tag, item-value, impact, archive, restore, and permanent-delete methods.

- [ ] Write failing contract tests for all field types, URL scheme restrictions, canonical dates/date-times, number bounds/precision, normalized names, and bounded text lengths.
- [ ] Implement pure normalizers returning frozen canonical values and structured `InventoryMetadataError` instances with HTTP-ready codes.
- [ ] Write failing repository tests for CRUD, ordering, optimistic revisions, applicability impact, type immutability after first use, archive/restore preservation, and atomic permanent deletion.
- [ ] Implement repository transactions with current-state rechecks and exact affected counts.
- [ ] Add item metadata reads that return active editable definitions plus current scalar/option/tag values using stable numeric IDs.
- [ ] Add item metadata replacement that changes only metadata rows and returns affected project IDs.
- [ ] Run focused repository tests and `bun run db:migrations:check`.
- [ ] Commit as `feat: add inventory metadata domain service`.

### Task 3: API Authorization, ETag Reads, And SSE

**Files:**
- Create: `server/inventory-metadata/routes.mjs`
- Create: `server/inventory-metadata/routes.test.mjs`
- Create: `server/live-events/inventory-metadata-payloads.mjs`
- Modify: `server/auth/api-permissions.mjs`
- Modify: `server/live-events/topics.mjs`
- Modify: `server/index.mjs`
- Create: `server/live-events/topics.test.mjs`

**Interfaces:**
- Adds `GET /api/inventory-metadata/catalog` with ETag support.
- Adds definition/tag CRUD, archive, restore, impact, and permanent-delete endpoints.
- Adds `GET` and `PUT /api/inventory/items/:type/:id/metadata`.
- Adds project-scoped topic `inventory-metadata:<projectId>`.

- [ ] Write route tests proving view/edit/manage permission separation, open-mode access, ETag `304`, stale-revision `409`, validation `400`, impact `409`, and permanent deletion authorization.
- [ ] Add every route to `api-permissions.mjs` before mounting it; assert there is no `authorization-policy-missing` response.
- [ ] Implement compact DTO mappers that never expose normalized-name internals or deleted values.
- [ ] Publish SSE events containing only project, item, definition, tag, and revision IDs after committed writes.
- [ ] Add topic parsing and authorization tests, including maximum payload enforcement.
- [ ] Run route, authorization, event-bus, and SSE tests.
- [ ] Commit as `feat: expose inventory metadata api`.

### Task 4: Inventory History, Duplication, And Registry Privacy

**Files:**
- Modify: `server/engine/command-service.mjs`
- Modify: `server/engine/snapshot.mjs`
- Modify: `server/db/inventory-lifecycle.mjs`
- Modify: `server/inventory-routes.mjs`
- Modify: `server/registry/contribution-service.mjs`
- Modify: `server/registry/local-catalog-mapping.mjs`
- Test: `server/db/inventory-lifecycle.test.mjs`
- Test: `server/db/inventory-commands.test.mjs`
- Test: `server/registry/contribution-service.test.mjs`

**Interfaces:**
- Adds metadata to inventory edit forward/inverse history without adding it to Registry template identity.
- Duplicates metadata through canonical item IDs.

- [ ] Add failing tests proving metadata edits advance affected project revisions, undo/redo restore exact values/tags, and unrelated project state remains byte-identical.
- [ ] Add failing lifecycle tests proving duplicate copies metadata, archive/scope/membership preserve it, and permanent item deletion cascades it.
- [ ] Implement metadata-aware commands and lifecycle transactions using repository IDs rather than labels.
- [ ] Add contribution tests with private-looking definitions and values; assert sanitized payloads and content hashes remain unchanged.
- [ ] Add linked-catalog update tests proving metadata survives refresh and template replacement.
- [ ] Run focused engine, lifecycle, and Registry tests.
- [ ] Commit as `feat: preserve custom metadata through inventory lifecycle`.

### Task 5: Logical Backup, Restore, And Migration Safety

**Files:**
- Modify: `server/backup/sqlite-section-exporter.ts`
- Modify: `server/backup/sqlite-restore-staging.ts`
- Modify: `server/backup/restore-preflight.mjs`
- Modify: `server/backup/backup-sections.mjs`
- Modify: `server/persistence/sqlite/migrator.bun_spec.ts`
- Test: `server/backup/sqlite-backup.bun_spec.ts`
- Test: `server/backup/backup-sections.test.mjs`
- Test: `server/backup/restore-preflight.test.mjs`

**Interfaces:**
- Inventory logical archives carry a versioned `metadata` section containing all seven relational tables.
- Inventory restore validates metadata before staged database activation.

- [ ] Write failing complete and Inventory-only archive tests with every field type, archived records, options, tags, and saved-view references.
- [ ] Extend the logical Inventory export with deterministic table ordering and stable numeric relationships.
- [ ] Extend restore staging to import definitions before options/values and validate applicability, option ownership, type storage, and saved-view references.
- [ ] Add malformed, duplicate, missing-FK, invalid-URL, and zip-bomb-boundary tests.
- [ ] Add migration tests comparing pre/post hashes for inventory identity, projects, assignments, placements, connections, route cache, Registry links, private fields, authentication, and telemetry.
- [ ] Prove interrupted migration rollback and second-start idempotency.
- [ ] Run backup, restore, and migrator suites.
- [ ] Commit as `feat: include inventory metadata in portable backups`.

### Task 6: Frontend Contracts And Query Layer

**Files:**
- Create: `src/types/inventory-metadata.ts`
- Create: `src/lib/inventory-metadata-api.ts`
- Create: `src/lib/inventory-metadata-query.ts`
- Create: `src/lib/inventory-metadata-query.test.ts`
- Modify: `src/lib/fetch-with-timeout.ts`

**Interfaces:**
- Produces typed catalog, definition, option, tag, item metadata, impact, and mutation DTOs.
- Produces TanStack query keys and SSE invalidation/update handlers.

- [ ] Add failing Zod/parser tests for valid DTOs and malformed IDs, revisions, colors, values, and impact payloads.
- [ ] Implement strict parsers and ETag-aware API calls.
- [ ] Add query-key factories for catalog, item values, project filters, and definition-value columns.
- [ ] Implement SSE handlers that patch supplied previews or invalidate only affected queries.
- [ ] Add tests proving no timer or polling interval is created.
- [ ] Commit as `feat: add inventory metadata client contracts`.

### Task 7: Settings Management Interface

**Files:**
- Create: `src/components/settings/inventory-metadata/inventory-metadata-settings.tsx`
- Create: `src/components/settings/inventory-metadata/custom-fields-table.tsx`
- Create: `src/components/settings/inventory-metadata/custom-field-dialog.tsx`
- Create: `src/components/settings/inventory-metadata/custom-field-options-editor.tsx`
- Create: `src/components/settings/inventory-metadata/tags-table.tsx`
- Create: `src/components/settings/inventory-metadata/tag-dialog.tsx`
- Create: `src/components/settings/inventory-metadata/metadata-delete-dialog.tsx`
- Modify: `src/components/settings-dialog.tsx`
- Create: `src/test/inventory-metadata-settings.test.tsx`

**Interfaces:**
- Adds Settings category `Inventory metadata` gated by `inventory.metadata.manage` for mutations and `inventory.view` for reading.

- [ ] Write failing UI tests for create/edit/reorder, field-specific controls, select colors, archive/restore, impact refresh, name-typed deletion, permission-disabled states, and stale conflicts.
- [ ] Build the two-view Settings surface from existing shadcn table, tabs, dialog, select, checkbox, input, tooltip, and alert-dialog components.
- [ ] Keep components single-purpose and move form normalization to focused model files rather than TSX.
- [ ] Render destructive impact counts without rendering deleted private values.
- [ ] Verify keyboard focus restoration, mobile containment, and no nested cards.
- [ ] Commit as `feat: add inventory metadata settings`.

### Task 8: Inventory And Inspector Metadata Editing

**Files:**
- Create: `src/components/inventory-form/metadata-tab-content.tsx`
- Create: `src/components/inventory-form/custom-field-input.tsx`
- Create: `src/components/inventory-form/tag-multi-select.tsx`
- Create: `src/components/inventory-form/metadata-form-model.ts`
- Modify: `src/components/inventory-form/dialog-tab-policy.ts`
- Modify: `src/components/inventory-item-dialog.tsx`
- Modify: `src/components/inspector/equipment/server-inspector-tabs.tsx`
- Modify: `src/components/inspector/equipment/nas-inspector-tabs.tsx`
- Modify: `src/components/inspector/equipment/pc-build-inspector-tabs.tsx`
- Modify: `src/components/inspector/equipment/switch-inspector-tabs.tsx`
- Modify: `src/components/inspector/equipment/patch-panel-inspector-tabs.tsx`
- Modify: `src/components/inspector/equipment/standalone-power-equipment-tabs.tsx`
- Modify: `src/components/inspector/equipment/component-item-editor.tsx`
- Modify: `src/components/inspector/inspector-panel.tsx`
- Create: `src/test/inventory-metadata-editor.test.tsx`
- Test: `src/components/inventory-form/dialog-tab-policy.test.ts`

**Interfaces:**
- Adds dialog and Inspector tab ID `metadata`.
- Produces one shared item metadata editor used by create, edit, and Inspector surfaces.

- [ ] Write failing tests for all input types, units, limits, precision, URL validation, option colors, tags, dirty state, save, undo/redo, archived-data omission, and lazy loading.
- [ ] Add `metadata` to the dialog policy for all inventory types without changing existing tab order semantics beyond appending Metadata.
- [ ] Build field controls from definition DTOs with accessible labels and color-independent option text.
- [ ] Integrate create/edit payloads and item duplication preview.
- [ ] Add the shared Metadata tab to every Inspector type without duplicating per-type logic.
- [ ] Commit as `feat: edit custom metadata on inventory items`.

### Task 9: Inventory Search And Filtering

**Files:**
- Create: `server/inventory-metadata/filter-service.mjs`
- Create: `server/inventory-metadata/filter-service.bun_spec.mjs`
- Create: `src/components/inventory/inventory-metadata-filters.tsx`
- Create: `src/components/inventory/inventory-tag-preview.tsx`
- Modify: `src/components/inventory-sidebar.tsx`
- Modify: `src/lib/sort.ts`
- Test: `src/test/inventory-sidebar.test.tsx`
- Create: `src/test/inventory-metadata-filters.test.tsx`

**Interfaces:**
- Produces canonical filter clauses keyed by numeric definition, option, and tag IDs.
- Returns compact matching item references and tag previews.

- [ ] Write failing server tests for OR within one filter, AND across filters, set/not-set operators, text contains, number/date ranges, booleans, select options, and archived metadata exclusion.
- [ ] Implement parameterized SQL queries with bounded input counts and indexes; never interpolate field labels or values into SQL.
- [ ] Add Inventory filter controls and tag previews limited to two plus `+N`.
- [ ] Add search coverage for tags, select labels, and display-formatted values.
- [ ] Verify metadata values are requested only for active filters and visible detail.
- [ ] Commit as `feat: filter inventory by custom metadata`.

### Task 10: Systems Columns, Filters, Saved Views, And SSE

**Files:**
- Modify: `server/persistence/core/schema/systems.ts`
- Create: `server/persistence/core/migrations/generated/0026_systems_metadata_views.sql`
- Modify: `server/systems/read-service.mjs`
- Modify: `server/systems/saved-view-service.mjs`
- Modify: `server/systems/routes.mjs`
- Modify: `src/types/systems.ts`
- Modify: `src/components/workbook/systems/systems-columns.ts`
- Modify: `src/components/workbook/systems/systems-column-menu.tsx`
- Modify: `src/components/workbook/systems/systems-toolbar.tsx`
- Modify: `src/components/workbook/systems/systems-table.tsx`
- Modify: `src/components/workbook/systems/systems-table-model.ts`
- Test: `server/systems/read-service.bun_spec.ts`
- Test: `server/systems/saved-view-service.bun_spec.ts`
- Test: `src/components/workbook/systems/systems-table-model.test.ts`
- Test: `src/components/workbook/systems-workspace.test.tsx`

**Interfaces:**
- Dynamic column keys use `custom-field:<positiveDefinitionId>` and reserved key `tags`.
- Saved metadata filters retain numeric IDs and follow existing optimistic view revisions.

- [ ] Write failing tests for hidden-by-default dynamic columns, applicable host types, lazy values, tag movement between Name and Tags, and dense/mobile behavior.
- [ ] Extend saved-view validation so dynamic keys resolve against active definitions and survive archive without becoming writable.
- [ ] Persist metadata filters relationally by IDs; permanent deletion prunes filters/columns and bumps affected view revisions.
- [ ] Add custom-field and tag filter controls to Systems using the shared filter semantics.
- [ ] Fetch values only for active filters or visible custom columns and merge updates from `inventory-metadata:<projectId>` SSE.
- [ ] Verify Systems base payload remains bounded when hundreds of definitions exist but none are active.
- [ ] Commit as `feat: add custom metadata to systems views`.

### Task 11: Documentation, Release Notes, And End-To-End Verification

**Files:**
- Modify: `src/release-notes.ts`
- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Modify: `DOCKERHUB.md`
- Modify: `docs/DATA.md`
- Modify: `docs/MIGRATIONS.md`
- Modify: `docs/DOCKER.md` if backup guidance changes.
- Test: `src/test/inventory-metadata-settings.test.tsx`
- Test: `src/test/inventory-metadata-editor.test.tsx`
- Test: `src/test/inventory-metadata-filters.test.tsx`
- Test: `src/components/workbook/systems-workspace.test.tsx`

**Interfaces:**
- Completes the unreleased feature documentation without changing package version or Docker tags.

- [ ] Add structured unreleased notes and a concise `Unreleased` changelog section covering custom fields, tags, filters, privacy, migration, and backup behavior.
- [ ] Document permissions, private Registry behavior, archive/delete semantics, and Inventory restore dependency.
- [ ] Run local end-to-end flows for field and tag administration, every field type, item assignment, duplicate, undo/redo, inventory filtering, Systems columns/saved views, archive/restore/delete, Registry refresh, backup/restore, and restart.
- [ ] Verify demo isolation and permission behavior with authentication disabled and enabled.
- [ ] Run `bun run lint`.
- [ ] Run `bun run test`.
- [ ] Run `bun run build`.
- [ ] Run `bun run bundle:check`.
- [ ] Run `bun run security:container`.
- [ ] Confirm `git status` contains no runtime data, secrets, screenshots, generated private files, or unrelated `.superpowers/` changes.
- [ ] Commit as `docs: document inventory custom fields and tags`.

## Final Acceptance

- Definitions and tags are installation-wide and relational.
- Every approved field type, option color, numeric rule, archive/restore/delete rule, and permission works.
- Inventory and Systems search/filter behavior is deterministic and saved views use stable numeric IDs.
- Systems does not duplicate tags between Name and Tags.
- Base list payloads remain compact and no metadata polling exists.
- Registry contributions and catalog updates never expose or overwrite metadata.
- Complete and selective Inventory backup/restore preserve metadata exactly.
- Startup migration is backed up, transactional, idempotent, and preserves every existing relational invariant.
- Production and demo can be verified before proposal 10 is marked Shipped.
