# Systems Workspace Operational Table

## Status

Approved design for replacing the initial Systems workspace table with a dense,
project-scoped operational view. This design also makes workspace sidebars
workspace-type aware so the Canvas inventory drawer does not appear in Systems.

## Goals

- Give the Systems workspace the complete width of the workbook surface.
- Keep Canvas inventory-drawer state independent for every Canvas workspace.
- Present project compute hosts as a dense, sortable, filterable operational
  table.
- Show assigned CPU, installed memory, primary storage, agent state, registry
  linkage, and current utilization without loading telemetry history.
- Refresh live values every 30 seconds with a purpose-built compact endpoint.
- Open the existing host inspector from the entire row and close it with Escape.
- Establish one shared compute-host icon policy for the entire application.

## Non-Goals

- Historical CPU or memory charts in the Systems table.
- A Systems-specific sidebar.
- Changing the existing detailed Agent inspector charts.
- Adding rack, network, or other future workspace sidebar implementations.
- Server-persisted personal table-layout preferences.
- Replacing the current inspector or inventory-management workflows.

## Workspace Sidebar Contract

The workbook shell owns a generic sidebar slot. Each workspace type declares
whether it has a sidebar and which component fills it.

For this release:

- Canvas workspaces expose the Inventory sidebar and its toggle.
- Systems exposes no sidebar and no sidebar toggle.
- Systems occupies the complete workspace width.
- Hiding a sidebar because the active workspace does not support one does not
  mutate another workspace's saved open state or width.
- Returning to a Canvas workspace restores that Canvas workspace's saved
  sidebar state and width.

Sidebar preferences are stored browser-locally and keyed by the authenticated
user, project ID, and workspace ID. This permits future workspace types to use
the same physical sidebar region for different content without sharing state.

## Shared Compute-Host Icons

One application-level resolver determines the icon for compute hosts anywhere
the project UI needs a host-type icon:

| Host | Icon |
|---|---|
| NAS | Lucide `Database` |
| PC or workstation | Lucide `MonitorCog` |
| PC or workstation used as a server | Lucide `Server` |
| Conventional server | Lucide `Server` |

Usage role `server` overrides a PC or workstation physical class. A PC or
workstation without an explicit usage role defaults to `MonitorCog`.

## Table Layout

The Systems workspace uses a dense full-width table with these columns:

```text
Type | Name | Manufacturer / Model | CPU | RAM | Storage | Agent | Registry
```

Column sizing rules:

- Type and Registry use intrinsic `max-content` widths.
- Agent uses only the width needed by its status icon, version, and optional
  update action.
- Name, Manufacturer/Model, CPU, RAM, and Storage divide the remaining width.
- Cells never have independent scrollbars.
- Text values use single-line truncation and expose their complete value in a
  tooltip.
- A narrow viewport scrolls the complete table horizontally. Columns are not
  silently removed.
- Dynamic content cannot change column widths or row height.

The entire row is interactive. Click, Enter, or Space opens the selected host in
the existing inspector. The previous action column is removed. Interactive
controls inside a row stop propagation. Escape closes the inspector when no
modal or higher-priority overlay is active.

## Cell Definitions

### Type

Render only the shared host icon. The cell includes a tooltip and accessible
label describing the resolved host type.

### Name

The first line is the host display name. The second line reports the count of
components assigned to the host.

### Manufacturer And Model

Preserve the compact two-line manufacturer and model treatment. Missing values
use the existing neutral fallback.

### CPU

List the assigned processor manufacturer and model. Identical processors in a
multi-socket host collapse into a quantity, for example:

```text
2x Intel Xeon Gold 6230
```

When current telemetry is available, render one text-line-height utilization
bar below the label. The bar represents only the latest CPU percentage. CSS
provides divisions at 0, 25, 50, 75, and 100 percent; no historical points are
sent to the table.

### RAM

Summarize installed physical modules as total capacity, generation, and the
lowest installed transfer rate:

```text
32 GB DDR4 2666 MT/s
```

The lowest speed represents the effective negotiated ceiling for mixed-speed
modules. Current memory utilization uses the same latest-value segmented bar as
CPU.

### Storage

Prefer the storage device that the agent identifies as the boot drive. If the
agent is unavailable or cannot identify and map the boot drive, use the first
assigned storage item. The label combines capacity and interface, for example:

```text
1 TB NVMe
```

Current storage utilization uses these colors:

- Green below 80 percent.
- Amber from 80 through 89.9 percent.
- Red at 90 percent or higher.

CPU, RAM, and Storage omit their utilization row entirely when no current value
exists. They never display an empty bar or a fabricated zero.

### Agent

| State | Icon | Color |
|---|---|---|
| Online | Lucide `Link2` | Green |
| Stale | Lucide `Link2` | Amber |
| Offline | Lucide `Link2Off` | Red |
| Unknown or unregistered | Lucide `Ban` | Gray |

Show the installed agent version beside the icon. A current version is green;
an outdated version is amber. An outdated agent exposes an icon button that
copies its applicable update command. The button has a tooltip, accessible
name, and confirmation toast, and does not open the row inspector.

### Registry

Use a green Lucide `Link` for an active registry link and a gray Lucide
`Link2Off` for local, detached, or otherwise unlinked inventory. Both states
have tooltips and accessible labels.

## Search, Filters, And Sorting

The search field matches host name, manufacturer, model, CPU label, RAM label,
and storage label.

Filters are independent:

- System type is a multi-select containing only host types present in the
  unfiltered project data.
- Agent offers All, Registered, and Unregistered.
- Registry offers All, Linked, and Unlinked.

System-type options remain stable while search and other filters change. A
clear-filters command restores the default view.

Name ascending is the default sort. Every column is sortable. CPU, RAM, and
Storage sort by their current utilization percentages, placing missing values
last in both directions. Icon columns sort by their semantic labels or states,
not icon names.

Search, filters, active sort, sort direction, and supported column preferences
are stored browser-locally per authenticated user and project. Sidebar
preferences remain separate.

## API Design

Add two authenticated, project-scoped read endpoints:

```text
GET /api/projects/:projectId/systems
GET /api/projects/:projectId/systems/live
```

The initial endpoint returns only fields required to render every table row:

- host ID, canonical type, resolved icon key, and display name;
- assigned-component count;
- manufacturer and model;
- formatted CPU, RAM, and storage labels;
- agent state, installed/current version, and an applicable update command only
  when an update is available;
- latest CPU, memory, and primary-storage utilization when present;
- registry linkage state.

The live endpoint returns the current agent release version plus registered
agent rows only:

```json
{
  "latestVersion": "0.3.2",
  "systems": [
    {
      "id": 7,
      "type": "server",
      "state": "online",
      "version": "0.3.2",
      "cpuPercent": 18.2,
      "memoryPercent": 43.1,
      "storagePercent": 84.0
    }
  ]
}
```

An absent host means it is not currently registered. The response does not
contain heartbeat buckets, historical metric points, services, containers,
hardware reports, capabilities, filesystem arrays, or update commands.

Both endpoints use repository-level bulk queries. They must not call existing
HTTP endpoints internally or execute one telemetry query per host.

The live endpoint returns an ETag derived from the selected project's current
registered agent identities, latest accepted sequences, status inputs, selected
metric values, and published agent release version. A matching
`If-None-Match` returns HTTP 304 without a JSON body.

Existing authorization policy must require project read access and agent
telemetry read access. A user cannot retrieve another project's systems through
identifier substitution.

## Client Data Flow

TanStack Query loads the initial Systems model only while Systems is active. A
separate query polls the live endpoint every 30 seconds only when all conditions
are true:

- Systems is the active workspace.
- The document is visible.
- The browser is online.

Changing projects cancels obsolete queries. Query keys include the project ID.
Background refreshes merge dynamic fields into existing rows without replacing
static row objects, resetting filters, resizing cells, or displaying the global
activity indicator. Utilization bars animate their width with a restrained CSS
transition.

## Loading And Failure Behavior

- Initial loading uses stable table-row skeletons matching final column widths.
- A failed initial request shows an inline error and retry action.
- A failed background refresh keeps the last valid values.
- Repeated background failure displays `Live data delayed` in the Systems
  header without clearing the table.
- Recovery removes the delayed indicator automatically.
- Missing telemetry is distinct from zero utilization.
- Clipboard failure produces an actionable toast without changing row state.

## Production Payload Measurement

A read-only measurement against production on 2026-08-17 used 23 systems and
four registered agents:

| Shape | Raw | Gzip |
|---|---:|---:|
| Complete Systems first load | 8,652 bytes | 1,020 bytes |
| Strict dynamic refresh | 556 bytes | 258 bytes |
| Unnecessary 30-point history | 9,673 bytes | 2,152 bytes |

Existing detailed per-host telemetry responses ranged from 47 KB to 234 KB and
are explicitly unsuitable for this table.

Performance tests use per-row budgets rather than a fixed total response size:

- The initial response should remain below 512 uncompressed bytes per system
  for representative fixtures.
- The live response should remain below 256 uncompressed bytes per registered
  agent, excluding the small response envelope.

## Testing

### Backend

- Project isolation and authorization-policy coverage.
- One bounded bulk read path without per-host HTTP or SQL N+1 behavior.
- Initial response contains only approved table fields.
- Live response excludes histories, details, services, containers, filesystem
  arrays, capabilities, and update commands.
- ETag stability, invalidation, and HTTP 304 behavior.
- Registered, stale, offline, unregistered, and missing-telemetry states.
- Multi-socket CPU aggregation.
- RAM total, generation, and lowest-speed calculation.
- Agent boot-drive selection and first-assigned fallback.
- Registry linked and detached semantics.
- Response-size budget checks with small and large fixtures.

### Frontend

- Canvas-only inventory sidebar and per-workspace state restoration.
- Shared host icon resolver in Systems and existing project surfaces.
- Dense intrinsic icon columns and fluid content columns.
- No cell-level horizontal or vertical scrollbars.
- Table-level horizontal scrolling on narrow viewports.
- Search across every approved text field.
- Dynamic system-type options and combined filters.
- Every ascending and descending sort, including missing utilization values.
- Browser-local per-project preference restoration.
- Polling starts only in visible Systems and pauses when hidden, offline, or on
  another workspace.
- HTTP 304 retains current rows without render churn.
- Row mouse and keyboard inspector navigation.
- Nested update-copy action does not open the inspector.
- Escape respects modal priority and closes the inspector.
- Background errors preserve data and recover cleanly.

## Acceptance Criteria

1. Systems has no inventory drawer or inventory toggle and uses full width.
2. Every Canvas workspace restores its own browser-local drawer state and width.
3. The dense table contains exactly the approved eight columns.
4. Icon columns occupy intrinsic width and cells never create scrollbars.
5. All filters, search, and sorting behave as specified and persist per project.
6. Current CPU, memory, and storage values update every 30 seconds only while
   Systems is visible.
7. The table transfers no telemetry history and performs no per-host requests.
8. Unchanged refreshes return HTTP 304.
9. Rows open the inspector and Escape closes it without interfering with
   higher-priority overlays.
10. Production-sized fixtures satisfy the payload budgets and render without
    layout shifts or unnecessary global loading state.
