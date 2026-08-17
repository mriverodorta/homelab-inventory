# Systems Workspace Operations Design

**Date:** 2026-08-17  
**Status:** Approved design  
**Scope:** Systems workspace attention triage, saved views, configurable columns, table ergonomics, and column-alignment repair

## Objective

Turn the Systems workspace into a scalable operational fleet view without adding bulk inventory actions. The workspace must help a user find systems needing attention, switch between reusable table configurations, customize visible information, and navigate large fleets efficiently.

This work must also correct the current compact-column sizing and sortable-header alignment defects before adding more table behavior.

## Scope

Included:

- An immutable Needs Attention system view.
- Private, synchronized saved views with create, replace, rename, delete, reset, and default-view behavior.
- Configurable visibility and ordering for Systems columns.
- Browser-local column widths.
- Dense and Comfortable row densities.
- Pinned Type and Name columns.
- Keyboard navigation and row virtualization.
- A compact Attention column and Inspector Attention tab.
- A materialized per-host Attention projection.
- Intrinsic-width compact columns and exact header/body alignment.

Excluded:

- Multi-select and bulk actions.
- Shared team views.
- Project duplication or movement from Systems.
- Server-side pagination.
- New notification detection rules.
- Changes to inventory, assignment, Canvas, cable, or telemetry-history ownership.

## Chosen Architecture

Use TanStack Table for column, sorting, visibility, order, pinning, and sizing state. Use TanStack Virtual when more than 100 rows remain after filtering. Keep TanStack Query for server state and the existing shadcn components for controls, dialogs, menus, and tooltips.

Do not introduce a full grid product or build a custom table-state engine.

## Toolbar

Systems uses one compact operational toolbar below the title, ordered as follows:

1. Saved View selector.
2. System Type filter.
3. Agent filter.
4. Registry filter.
5. Column configuration control.
6. Density control.
7. Search, anchored to the right.

Search remains ephemeral and browser-local. It is not included in a saved view.

The Saved View selector contains:

- All Systems, which is immutable.
- Needs Attention, which is immutable.
- The current owner's custom saved views.

Changing filters, sorting, visible columns, column order, or density after selecting a saved view marks the configuration as Modified. A modified view offers:

- Update view.
- Save as new view.
- Reset to saved configuration.

Custom views also support rename, delete, and Set as default.

## Saved View Ownership

Saved views synchronize through the server.

- With authentication enabled, a view is private to its numeric account ID.
- With authentication disabled, a view belongs to the installation's open-mode profile and is therefore shared by browsers using that installation.
- Views are project-specific.
- Each owner has at most one default view per project.
- A project without a configured default opens All Systems.
- Names are case-insensitively unique per owner and project.
- Writes use optimistic revisions so one browser cannot silently overwrite another browser's changes.
- When authentication is enabled after open-mode views exist, those views transfer atomically to the administrator enabling authentication.

The synchronized view contains:

- Filter selections.
- Sort column and direction.
- Visible columns.
- Column order.
- Row density.

The synchronized view excludes:

- Search text.
- Pixel column widths.
- Temporary unsaved state.

## Saved View Persistence

Use normalized relational tables with positive numeric primary and foreign keys:

### `systems_saved_views`

- `id`
- `project_id`
- `owner_scope`: account or open installation
- `account_id`, nullable only for open installation ownership
- `name`
- `sort_key`
- `sort_direction`
- `density`
- `is_default`
- `revision`
- `created_at`
- `updated_at`

### `systems_saved_view_filters`

- `id`
- `saved_view_id`
- `filter_category`
- `filter_value`

### `systems_saved_view_columns`

- `id`
- `saved_view_id`
- `column_key`
- `visible`
- `display_order`

Enforce one default per owner/project, unique names per owner/project, valid enumerated filter values, valid column keys, and unique display orders.

Pixel widths are stored in browser preferences keyed by user/open-mode scope, project ID, saved-view ID, and column key. Widths do not synchronize across devices.

## Column Model

The initial column library is:

- Type.
- Name.
- Manufacturer / Model.
- CPU.
- RAM.
- Storage.
- Attention.
- Agent.
- Registry.
- Operating System, hidden by default.
- Uptime, hidden by default.
- LAN IP, hidden by default.

Type and Name are mandatory, visible, ordered first, and pinned left. All other columns can be hidden and reordered.

Type, Attention, Agent, and Registry use intrinsic `max-content` sizing unless the user explicitly resizes Agent. Content columns use bounded flexible widths until resized.

The header and rows share one generated CSS grid template. The header remains outside the vertically scrolling row viewport and mirrors its horizontal scroll position.

Header cell wrappers own horizontal padding. Sort buttons fill the wrapper, use no additional horizontal padding or negative margin, and align according to their column. Compact header controls and compact row cells are centered.

This shared grid contract prevents the current defects where compact columns absorb unused width and sortable labels no longer align with body content.

## Column Configuration

The column manager provides:

- Visibility toggles.
- Drag ordering for configurable columns.
- Locked indicators for Type and Name.
- Reset to default columns.

Column order changes are part of the current saved-view configuration. Pixel resizing is performed with header resize handles and remains browser-local. Double-clicking a resize handle removes the local override and restores content-fit or default flexible sizing.

## Density And Virtualization

Two synchronized density values are supported:

- Dense, the default one-line operational layout.
- Comfortable, with taller rows and additional spacing for two-line content.

Both densities use fixed row heights. When the filtered result contains more than 100 rows, TanStack Virtual renders the visible range with a small overscan. Lists of 100 rows or fewer render normally.

Virtualization must preserve semantic row accessibility, pinned columns, selected-row styling, tooltips, keyboard focus, and Inspector selection.

## Keyboard Behavior

- Arrow Up and Arrow Down move row focus.
- Home and End move to the first or last filtered row.
- Enter opens the focused row's Inspector.
- Escape closes the Inspector and restores focus to its originating row.
- If a virtual row is outside the viewport during focus restoration, it is scrolled into view first.
- `/` focuses Search only when no input, editable surface, menu, or dialog owns focus.

## Needs Attention View

Needs Attention includes a system when any of the following is true:

- Agent is stale or offline.
- Agent update is available.
- A Registry update is awaiting review or blocked.
- The system assembly has a compatibility or audit finding.
- An active notification incident belongs to the system assembly.

Agent state and Agent update availability remain represented in the Agent column and are not included in the Attention count.

## Attention Column

The compact header uses the same Lucide warning-triangle icon as application alerts.

The row count is the sum of individual findings from:

- Registry updates awaiting review or blocked.
- Compatibility and audit findings.
- Active notification incidents.

The count covers the complete system assembly:

- Host inventory record.
- Assigned CPU, memory, storage, GPU, network, power, and other components.
- Relationships and compatibility between those records.
- Host, service, container, and storage notification incidents.

A positive count is a button that opens the selected host's Inspector on the Attention tab. A zero count renders a blank cell with no action and no muted zero.

## Inspector Attention Tab

The Attention tab groups materialized findings into:

- Registry.
- Compatibility & Audit.
- Notifications.

Each finding contains a stable key, severity, affected inventory reference, concise explanation, and an Inspector destination. Actions navigate to Registry review, the relevant Compatibility or Audit section, or Notifications without duplicating those workflows.

The Attention tab is reachable directly from a positive Attention count and remains in Inspector navigation while the selected host has findings or a previous projection is refreshing or failed. It is omitted when the host has no non-Agent findings. Agent-only problems remain in the Agent tab.

## Materialized Attention Projection

Do not evaluate every host assembly during Systems rendering.

### `system_attention_summaries`

- `id`
- `project_id`
- `host_type`
- `host_id`
- `registry_count`
- `audit_count`
- `notification_count`
- `total_count`
- `input_fingerprint`
- `state`: current, refreshing, or failed
- `evaluated_at`
- `updated_at`

### `system_attention_findings`

- `id`
- `summary_id`
- `category`
- `finding_key`
- `affected_item_type`
- `affected_item_id`
- `severity`
- `destination`
- Normalized display fields required by the Attention tab

### `system_attention_dirty_hosts`

- `id`
- `project_id`
- `host_type`
- `host_id`
- `reason`
- `created_at`

Inventory changes, assignment changes, Registry link/update transitions, compatibility-policy changes, and notification incident transitions mark only affected hosts dirty. A bounded reconciler recalculates each dirty host and atomically replaces its findings and summary.

The previous valid summary remains readable while refresh is in progress. The table shows a subtle spinner beside the existing positive count. It must not clear the count, block Systems, or evaluate assemblies in the request loop.

On failure, retain the previous valid projection and surface its stale/failed state only inside the Attention tab. Missing projections are backfilled automatically.

## Systems Read Models

The initial Systems response adds static or infrequently changing values:

- Operating System.
- LAN IP.
- Saved-view-independent static host data already used by the table.

The compact 30-second live response adds only:

- Uptime.
- Attention total and projection revision/state.
- Existing Agent status, version, and utilization values.

The Attention tab loads one host's materialized findings on demand. The list endpoint must not include full finding objects.

Use ETags for saved-view lists, Systems initial/live projections, and Attention findings. Successful saved-view or system mutations invalidate only their relevant TanStack Query keys.

## API Contract

Saved-view endpoints are project-scoped and resolve ownership from the authenticated account or open-mode installation profile:

- `GET /api/projects/:projectId/systems/views`
- `POST /api/projects/:projectId/systems/views`
- `PATCH /api/projects/:projectId/systems/views/:viewId`
- `DELETE /api/projects/:projectId/systems/views/:viewId`
- `POST /api/projects/:projectId/systems/views/:viewId/default`

Create and update requests contain normalized filter values, sorting, density, visible columns, and display order. Update, delete, and default requests include the expected view revision. A stale revision returns HTTP 409 with code `systems-view-conflict`. Duplicate names return HTTP 409 with code `systems-view-name-conflict`.

Attention details use:

- `GET /api/projects/:projectId/systems/:hostType/:hostId/attention`

The endpoint returns one summary and its materialized findings. It never triggers synchronous evaluation. Missing or refreshing projections return their persisted state and last valid findings when available.

The existing initial and live Systems endpoints retain their current routes and add only the fields defined in this design.

## Failure And Concurrency Behavior

- A failed saved-view mutation preserves the current local configuration and offers retry.
- An optimistic revision conflict requires reload or explicit replacement.
- A saved view deleted in another browser falls back to All Systems without deleting unsaved browser state.
- An unavailable Attention projection does not block the Systems list.
- A failed projection refresh retains the last valid count and findings.
- Empty custom-view results use the existing filtered empty state.
- Unauthorized accounts cannot read or mutate another account's saved views.
- Enabling authentication transfers open-mode views to the enabling administrator in the same transaction as the authentication mode change.

## Migration

Add an ordered SQLite migration that creates saved-view and Attention-projection tables, constraints, indexes, and migration ledger entries.

On first startup:

1. Create a verified pre-migration backup through the existing migration framework.
2. Apply the schema transactionally.
3. Create no custom views automatically.
4. Queue every current compute host for bounded Attention backfill.
5. Register the open-mode-to-administrator ownership transfer with the existing authentication-mode transition service.
6. Preserve inventory, projects, workspaces, assignments, placements, cable connections, routing cache, Registry enrollment, and telemetry.
7. Verify foreign keys, unique constraints, and relational references before activation.

The migration must be idempotent, rollback-capable, and safe during Docker image replacement.

## Testing And Acceptance

Required automated coverage:

1. Migration applies once and remains idempotent across restart.
2. Existing inventory, assignments, workspaces, placements, cables, and telemetry remain unchanged.
3. Authenticated users can access only their own project views.
4. Open mode synchronizes installation-owned views across browsers.
5. Enabling authentication transfers open-mode views to the enabling administrator without exposing them to other accounts.
6. Default-view uniqueness is enforced per owner/project.
7. Case-insensitive duplicate names are rejected.
8. Optimistic replacement conflicts cannot overwrite newer saved views silently.
9. Search text and pixel widths are absent from server persistence.
10. Type and Name cannot be hidden, unpinned, or reordered behind optional columns.
11. Compact columns fit their content and do not absorb remaining table width.
12. Header and body content share exact horizontal alignment.
13. Horizontal scrolling keeps header and rows synchronized.
14. Dense and Comfortable modes remain stable with and without virtualization.
15. Virtualization activates only above 100 filtered rows.
16. Keyboard navigation and focus restoration work across virtual boundaries.
17. Needs Attention includes all five approved operational conditions.
18. Agent-only conditions do not increase the Attention count.
19. Zero Attention renders an empty noninteractive cell.
20. Positive Attention opens the correct host and Attention tab.
21. Host and assigned-component changes invalidate only affected summaries.
22. Registry and notification transitions invalidate all and only affected hosts.
23. Unchanged hosts reuse the materialized projection without audit reevaluation.
24. Projection refresh serves the last valid count until atomic replacement.
25. Projection failure does not block Systems.
26. The Systems list reads summaries with bounded queries and no per-row evaluation.
27. Initial, live, saved-view, and Attention payload budgets remain compact.
28. Desktop Inspector split behavior and smaller-screen overlay behavior remain intact.
29. Table, toolbar, menus, dialogs, and Attention tab meet keyboard and screen-reader requirements.

## Documentation And Release Notes

Implementation must update the Unreleased changelog and structured release notes. No version bump is made until the user explicitly requests deployment.
