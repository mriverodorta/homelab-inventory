# Inventory Custom Fields And Tags Design

**Date:** 2026-08-19

**Status:** Approved design
**Roadmap:** Proposal 10, Custom fields, tags, and saved filters

## Objective

Add installation-wide custom-field definitions and reusable colored tags to inventory items. The feature must support typed values, efficient search and filtering, Systems saved views, private local metadata, normalized SQLite persistence, safe backup and restore, and future PostgreSQL portability.

This design completes the remaining work in roadmap proposal 10. Systems saved views already exist and are extended rather than replaced.

## Scope

Included:

- Installation-wide custom-field definitions with inventory-type applicability.
- Short text, long text, number, Yes/No, date, date-time, single-select, multi-select, and URL field types.
- Optional numeric units, minimum, maximum, and decimal precision.
- Stable colored options for select fields.
- Installation-wide reusable colored tags applicable to every inventory type.
- Custom metadata editing in inventory dialogs and Inspector.
- Inventory and Systems search and filtering.
- Optional hidden-by-default Systems columns for custom fields and tags.
- Saved-view persistence for custom metadata filters and columns.
- Archive, restore, deletion-impact, and confirmed permanent deletion workflows.
- Optimistic concurrency, permissions, SSE updates, backup, restore, migration, and Registry privacy.

Excluded:

- Required custom fields.
- Default values.
- Formulas, computed values, or automation.
- Project-, workspace-, user-, port-, connection-, assignment-, agent-, or Registry-template custom fields.
- Canvas tag badges.
- CSV import and export, which remains a separate roadmap proposal.
- Sharing custom metadata with the public Registry.

## Ownership And Applicability

Definitions and tags belong to the installation, not to an account or project. This avoids conflicts when global inventory appears in multiple projects.

Each custom-field definition declares one or more applicable inventory types through numeric relationships to `inventory_item_types`. Tags have no type restriction and can be assigned to any inventory item.

Custom-field names are case-insensitively unique across the installation. Tag names are also case-insensitively unique. Option labels are case-insensitively unique within their definition.

## Relational Model

### `custom_field_definitions`

- Positive numeric `id`.
- Unique normalized name and display name.
- Optional description.
- Enumerated field type.
- Global display order.
- Optional numeric unit, minimum, maximum, and precision.
- Archive timestamp.
- Optimistic revision.
- Created and updated timestamps.

Field-specific columns must be null for unrelated field types. Number minimum must not exceed maximum, and precision must be a bounded non-negative integer.

### `custom_field_applicability`

- Positive numeric `id`.
- Definition foreign key.
- Inventory-item-type foreign key.
- Unique definition/type relationship.

### `custom_field_options`

- Positive numeric `id`.
- Definition foreign key.
- Unique normalized label within the definition.
- Display label.
- Valid color token from the application palette.
- Display order.
- Archive timestamp.
- Optimistic revision.
- Created and updated timestamps.

Only single-select and multi-select definitions may own options.

### `inventory_custom_field_values`

- Positive numeric `id`.
- Inventory-item foreign key.
- Definition foreign key.
- Typed nullable columns for text, number, boolean, date, date-time, and URL values.
- Optimistic revision.
- Created and updated timestamps.
- Unique item/definition relationship.

Exactly one typed column is populated, and it must match the definition type. Dates use canonical `YYYY-MM-DD` text. Date-times use epoch milliseconds. URLs store normalized absolute URLs and accept only `http` and `https` schemes.

### `inventory_custom_field_option_values`

- Positive numeric `id`.
- Inventory-item foreign key.
- Definition foreign key.
- Option foreign key.
- Created timestamp.
- Unique item/definition/option relationship.

Single-select definitions permit at most one option per item. Multi-select definitions permit multiple unique options. The option must belong to the referenced definition.

### `inventory_tags`

- Positive numeric `id`.
- Unique normalized name and display name.
- Optional description.
- Valid color token.
- Display order.
- Archive timestamp.
- Optimistic revision.
- Created and updated timestamps.

### `inventory_item_tags`

- Positive numeric `id`.
- Inventory-item foreign key.
- Tag foreign key.
- Created timestamp.
- Unique item/tag relationship.

## Database Enforcement

SQLite foreign keys, checks, unique indexes, and triggers enforce:

- Positive numeric primary and foreign keys.
- Valid field types and color tokens.
- Case-insensitive uniqueness.
- Correct typed-value storage.
- Definition applicability to the item's inventory type.
- Numeric limits and decimal precision.
- Option ownership and select cardinality.
- No value or assignment to archived metadata.
- Transactional cascades for confirmed permanent deletion.

Service validation produces user-facing errors before constraints execute. Database enforcement remains the final integrity boundary.

## Definition Lifecycle

New definitions are optional for every item. Required fields are not part of this release.

A definition may be renamed, described, reordered, reconfigured within its type, or assigned to additional inventory types. Its field type becomes immutable after its first value is stored. An unused definition may change type transactionally after incompatible options and configuration are cleared.

Removing applicability is blocked when affected items contain values. The impact response includes item counts by type. An administrator may explicitly choose **Remove type and delete values**, which removes only values for the removed applicability in one transaction.

Archiving is reversible. Archived definitions and options cannot receive new values and disappear from normal forms and filter choices, while stored relationships remain intact for restoration. Restoring reactivates preserved values.

Permanent deletion is available after archiving, even when the definition or tag remains in use. The confirmation presents affected item, option, assignment, project, and saved-view counts and requires typing the exact name. The operation atomically deletes the definition or tag and all dependent values and filter references.

Select-option renames and reordering preserve values through stable IDs. Archiving preserves existing selections. Permanent option deletion requires impact confirmation and removes that option from all items.

## Permissions

Add the static permission:

- `inventory.metadata.manage`: create, edit, reorder, archive, restore, and permanently delete definitions, options, and tags.

Owner and Administrator receive it by default. It remains assignable to custom roles. Editor does not receive it by default.

Existing permissions apply as follows:

- `inventory.view`: read metadata and use it in search and filtering.
- `inventory.edit`: assign and remove item values and tags.
- `inventory.metadata.manage`: administer the shared metadata vocabulary.

Open mode retains its current unrestricted-owner behavior. Every new API route must be declared in the authorization policy catalog.

## Management Interface

Add **Settings > Inventory metadata** with two views.

### Custom Fields

The dense management table supports search and shows name, field type, applicable inventory types, usage count, and status. Actions include create, edit, reorder, archive, restore, inspect deletion impact, and permanent deletion.

The editor exposes common definition fields, applicability, and type-specific configuration. Select definitions include an ordered option editor with stable colors. A destructive applicability change or deletion uses a separate confirmation dialog rather than overloading the edit form.

### Tags

The dense management table supports search and shows name, color, description, assignment count, and status. Actions include create, edit, reorder, archive, restore, inspect deletion impact, and permanent deletion.

All controls use existing shadcn components and the established Settings layout.

## Item Editing

Every inventory add/edit dialog and Inspector includes a **Metadata** tab.

The tab contains:

1. A searchable reusable-tag multi-select.
2. Active applicable custom fields in global display order.

Number inputs show configured units and validate limits and precision. Select controls display option colors and labels. Date and date-time controls preserve exact canonical values. URL fields validate before save and open only safe schemes.

Metadata participates in existing dirty-state protection. Value and tag changes use the inventory command/history path, advance every affected project revision, and participate in undo and redo. Definition administration is recorded as an installation audit event and is not part of canvas undo history.

Item duplication copies tags and custom-field values and lists them in the duplicate preview. Archive, restore, scope changes, and project-membership changes preserve metadata. Permanent item deletion cascades its metadata relationships.

## Inventory And Systems Presentation

Inventory rows show up to two colored tags plus `+N`. Tags use text labels and never communicate meaning by color alone. Full values remain in the Metadata tab.

Systems exposes:

- One optional Tags column, hidden by default.
- One optional column per custom field applicable to Server, NAS, or PC Build, hidden by default.

While the Tags column is hidden, up to two tags plus `+N` appear below Name. Enabling the Tags column moves the same content into that column and removes it from Name, preventing duplication.

Custom columns use display-formatted values, preserve dense-row dimensions, and truncate with accessible tooltips. Existing horizontal overflow, column-order, visibility, resizing, mobile, virtualization, and saved-view behavior remains authoritative.

Canvas cards do not display tags or custom fields.

## Search And Filters

General inventory search matches:

- Tag names.
- Select-option labels.
- Human-readable custom-field values.

Inventory and Systems expose metadata filters. Multiple values within one filter use OR; different filters combine with AND.

- Tags: selected tags, Has tags, No tags.
- Text, long text, URL: Contains, Is set, Not set.
- Number: minimum, maximum, Is set, Not set.
- Date and date-time: before, after, Is set, Not set.
- Yes/No: Yes, No, Not set.
- Single- and multi-select: selected options, Not set.

Systems saved views persist filters and dynamic columns using numeric definition, option, and tag IDs. Search text remains ephemeral under the existing saved-view contract.

Archiving preserves saved-view references but marks them unavailable until restoration. Permanent deletion removes affected saved-view filters and columns transactionally and advances each changed view revision.

## API And Live Data

Definitions and tag vocabulary use a compact ETag-aware installation endpoint. Item metadata loads on demand when the Metadata tab opens.

Inventory and Systems list responses include only tag previews, searchable projections, and values required by active filters or visible columns. Enabling a custom column lazily requests only that field's values rather than expanding the default Systems payload.

Metadata mutations publish compact SSE events with affected item, definition, tag, and project IDs. Subscribers update supplied values or invalidate only the relevant TanStack Query keys. No metadata polling is added.

Every write uses optimistic revisions. Expected API errors are:

- `400` for invalid configuration or values.
- `403` for missing permission.
- `404` for unknown IDs.
- `409` for duplicate names, stale revisions, used-type changes, destructive applicability without confirmation, or concurrent deletion impact changes.

## Privacy And Registry Behavior

Definitions, options, tags, colors, descriptions, and item values are private local metadata.

- Registry contribution sanitization always excludes them.
- Registry enrollment, catalog refresh, linked-template updates, and topology reconciliation never overwrite or remove them.
- Registry identity and content hashes do not include them.
- Logs and audit events record IDs, operation names, actor, timestamps, and affected counts without copying sensitive values.

## Backup, Export, And Restore

Complete and Inventory-section logical archives include definitions, applicability, options, tags, values, assignments, archive states, and revisions.

Metadata is an Inventory dependency in selective export and restore. Restore staging validates every ID, field type, applicability relationship, option relationship, value constraint, and saved-view reference before activation. It never loads untrusted SQLite pages directly.

Demo sessions store metadata only in their disposable SQLite database. Demo expiration removes it with the rest of the session.

## Migration

Add one ordered core-schema migration and update the Drizzle schema and migration manifest.

Startup follows the existing managed migration contract:

1. Create and verify the standard pre-migration backup.
2. Create definitions, applicability, options, values, tags, and relationship tables.
3. Create indexes, checks, and triggers.
4. Seed the new permission and synchronize built-in roles without changing custom-role grants.
5. Validate foreign keys, integrity checks, schema version, and unchanged legacy projections.
6. Activate transactionally.

The migration creates no definitions, tags, or values. It must not change inventory identity, project revisions, assignments, placements, connections, route cache, private fields, Registry links, catalog state, authentication state, or telemetry. Restart and repeated migration execution are idempotent.

## Testing

Required coverage includes:

- Every field type and number constraint.
- Definition and tag case-insensitive uniqueness.
- Applicability and database-trigger enforcement.
- Field-type immutability after first use.
- Applicability removal impact and confirmed deletion.
- Option rename, reorder, archive, restore, and deletion.
- Tag assignment, archive, restore, and deletion.
- Concurrent edits and deletion-impact races.
- Search operators and AND/OR filter semantics.
- Saved-view persistence, archive behavior, and deletion cleanup.
- Dynamic Systems columns and Name/Tags de-duplication.
- Compact ETag reads, lazy value loading, and SSE updates without polling.
- Metadata-tab dirty state and undo/redo.
- Item duplicate, archive, restore, scope, membership, and delete behavior.
- Registry contribution sanitization and linked-update preservation.
- Complete and selective backup/export/restore.
- Permission behavior for open mode, built-in roles, and custom roles.
- Migration rollback, restart idempotency, and projection parity.
- Responsive dialogs, keyboard operation, accessible labels, and color-independent meaning.
- Production and demo smoke coverage.

## Release And Roadmap

This is a user-visible feature requiring structured release notes, the changelog, README and Docker Hub feature summaries, and a minor-version release unless accumulated work changes the semver assessment.

Roadmap proposal 10 may move to Shipped only after production and demo verify custom fields, tags, filters, saved views, Registry privacy, backup/restore, migration, and restart behavior end to end.
