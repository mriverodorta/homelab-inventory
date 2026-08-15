# Registry Update Semantic Reconciliation

## Objective

Make Registry updates accurate, scalable, and trustworthy for every inventory
category. The application must compare catalog definitions semantically, apply
safe enrichment automatically, preserve local state, explain genuine conflicts,
and reconcile supported topology transitions without product-specific rules.

This design extends:

- `2026-08-14-automatic-registry-updates-design.md`
- `2026-08-14-registry-agent-payload-efficiency-design.md`

It corrects the implementation gaps exposed by repeated evaluations, false
identity changes, representation-only port differences, shallow object merges,
and topology updates that require a controlled local reconciliation.

## Observed Failure Classes

The production response contains 32 rendered groups backed by multiple update
runs. The actionable data demonstrates these systemic failures:

1. Historical evaluations are projected as current work, duplicating every
   pending linked item.
2. Latest-run counters count link evaluations while the toolbar is expected to
   count user-facing template groups.
3. A successful decision can change evaluation rows without changing the linked
   inventory records, yet still return an `applied` receipt.
4. A group displays the change set from its first link even when other linked
   items have different local values or dependency conflicts.
5. A group reports one source revision even when its links began at different
   revisions.
6. Any change to an identity field is treated as a product replacement, including
   completion of a previously missing model on an already linked item.
7. Raw JSON comparison reports equivalent values as changes, including `2500M`
   versus `2.5G`, omitted `origin` versus `fixed`, and formatting-only form-factor
   values.
8. Port slot numbers are treated as attachment identity even though cable
   relationships use numeric port IDs.
9. Catalog protocol validation accepts power-strip input slot zero while SQLite
   persistence requires every slot number to be positive.
10. Shallow replacement of `specs` and `compatibility` can discard local or
    unknown nested values omitted by the new template.
11. Generic `structural-validation-failed` reasons hide the exact conflict and
    provide no safe resolution path.
12. Full change payloads and unbounded applied history are transferred before a
    user opens a specific review.

## Design Principles

- Numeric relational IDs remain the only persisted relationship identity.
- Registry template keys and content hashes identify catalog definitions, not
  database rows.
- Comparison, classification, preview, merge, and execution use one canonical
  semantic model.
- Local instance data is never overwritten by catalog updates.
- Accurate catalog enrichment is not made risky merely because the previous
  local value was absent.
- Existing assignments, placements, cables, endpoint references, and route cache
  survive every update that does not genuinely alter their referenced topology.
- Current actionable state and immutable audit history are separate projections.
- A server response may report `applied` only after the inventory records and
  registry links prove that the target revision and content hash were committed.
- Blocked topology changes are never force-applied. A resolution must be explicit,
  deterministic, previewable, confirmed, and atomic.

## Architecture

Registry update handling is divided into six single-purpose services.

### Semantic normalizer

Converts current inventory values and incoming catalog values into a canonical
comparison representation without changing persisted data.

It normalizes:

- network speeds to integer bits per second;
- storage, memory, power, and capacity values to canonical v9/v10 units;
- known enum spelling and casing;
- empty strings, omitted values, and semantically empty collections;
- `2.5 inch` and `2.5-inch` form-factor spelling;
- omitted port `origin` to `fixed`;
- collection ordering by numeric ID and then stable semantic key.

Normalization is version-aware but not restricted to the fingerprint version
that originally created a link. Older linked records must still compare correctly
with newer canonical representations.

### Ownership-aware differ

Produces field-path changes after normalization. It excludes local-only paths and
distinguishes additions, removals, corrections, and topology operations.

The differ emits semantic descriptions such as:

> Port 1 speed: 2.5 Gbps -> 10 Gbps

It must not emit opaque whole-object replacements when only nested fields changed.

### Safety classifier

Classifies each linked item independently as `safe`, `review-required`, or
`blocked`. Group classification is derived from member classifications; it is not
copied from the first member.

### Merge planner

Creates the exact next inventory record using the ownership rules and records the
expected effects on assignments, ports, cables, and projects. The same planned
record is used for preview, validation, and commit.

### Topology resolver

Creates deterministic reconciliation operations for blocked but supported
topology transitions. It never mutates data while planning.

### Atomic executor

Validates the group concurrency token, project revisions, catalog hash, current
link membership, and resolution plan before committing all affected records in
one SQLite transaction.

## Field Ownership

Ownership is defined by semantic path rather than by replacing entire top-level
objects.

### Registry-owned product definition

Registry updates may authoritatively maintain:

- manufacturer, secondary manufacturer, family, model, number, and aliases;
- product specifications and dimensions;
- compatibility requirements and host capabilities;
- fixed component definitions;
- canonical ports and resource topology;
- manufacturer-supported and independently verified limits.

Unknown fields received from a supported Registry contract are retained as opaque
Registry-owned paths and round-trip unchanged. They are never silently discarded
merely because the current UI does not render them.

An already linked item remains the same logical product unless a non-empty local
identity value conflicts with the linked template's normalized identity.

### Local instance state

Registry updates always preserve:

- local display name;
- serial number and other per-device identifiers;
- management IP address, MAC address, hostname, and telemetry;
- notes, custom labels, smart-device configuration, and outlet names;
- project ownership, global/project scope, and archive state;
- assignments and slot positions;
- canvas placements and workspace configuration;
- cable connections, manual bends, and route cache;
- agent enrollment and observed hardware values;
- unknown extension fields that are not explicitly Registry-owned.

Local instance paths are excluded from Registry change summaries.

### Missing and conflicting identity

Identity changes use these rules:

- Missing local value plus matching linked-template value is safe enrichment.
- Normalized-equivalent values produce no change.
- A known identity alias normalized to the canonical value is safe.
- A non-empty contradictory value requires review.
- A type change, ambiguous identity, or attempted template reassignment is blocked.

For example, adding `model: i7-13700T` to an already linked
`cpu-intel-i7-13700t` record is safe enrichment, not an identity change.

## Port Identity And Compatibility

### Relationship identity

The numeric port ID is the persisted cable relationship identity. A semantic key
corroborates identity and enables deterministic migration when IDs change.

The following are not relationship identities:

- slot number;
- display label;
- array position;
- speed text formatting;
- omitted default origin;
- local port notes or custom names.

### Port change classes

Port changes are classified as:

1. **Representation-only**: equivalent speed units, default origin, ordering,
   display slot number, label, or compatible kind normalization. Safe.
2. **Capability change**: speed, role, PoE, or other capability changes while the
   numeric endpoint remains compatible. Re-run compatibility; preserve cables.
3. **Attachment change**: connector replacement, port removal, endpoint ownership
   change, or another change that can invalidate a cable. Review or block according
   to actual dependencies.
4. **Remappable identity change**: numeric ID changed but one unique semantic key
   proves the replacement. Offer a topology resolution plan.
5. **Ambiguous identity change**: no unique mapping exists. Block and require
   manual correction.

Changing `server-port` to `network` while preserving numeric ID and RJ45 connector
is semantic enrichment. Changing `2500M` to `2.5G` is no change. Removing an
omitted `origin: fixed` is no change.

### Slot zero

`slotNumber` is ordering and display metadata, not a relational ID. It accepts
non-negative safe integers. Database IDs and foreign keys remain positive safe
integers.

Power-strip AC input may persist canonical slot zero while outlets use slots one
through N. The canvas continues to display the single header input as `AC 01`, so
canonical storage does not regress the established user-facing label.

The SQLite schema check, import validation, lifecycle validation, canonical power
validation, and round-trip projections must agree on this rule.

## Safety Classification

### Safe

An update is safe when it:

- adds missing linked identity information;
- adds or corrects product specifications;
- normalizes equivalent units or enums;
- enriches compatibility without invalidating assignments;
- preserves occupied resources and connected endpoint identities;
- introduces no confirmed incompatibility;
- requires no assignment, cable, or ownership operation.

Configured automatic safe updates apply these changes without manual review.

### Review required

Review is required when:

- a non-empty identity value changes but still plausibly represents the linked
  product;
- a capability correction reveals a confirmed incompatibility;
- a material supported limit decreases without invalidating current topology;
- evidence is insufficient to prove that a meaningful change is safe.

Missing host evidence alone is not a confirmed incompatibility and must not create
a blocking alert.

### Blocked

An update is blocked when it would leave persisted relationships invalid, remove
an occupied resource, orphan an assignment, invalidate a connected endpoint, or
cannot be represented by the current application contract.

Blocked updates expose the exact error code, message, affected numeric IDs, and
whether an automatic resolution plan is available.

## Resolve And Apply

The Registry updates dialog offers **Resolve and apply** for supported blocked
transitions.

The preview lists every operation, including:

- components converted to fixed or soldered definitions;
- assignments removed or remapped;
- standalone components returned to inventory;
- cables moved to replacement fixed endpoints;
- affected projects and inventory items;
- relationships that remain unchanged.

The operation requires explicit confirmation and is never part of automatic safe
updates.

Supported generic operations include:

- replaceable component to fixed or soldered component;
- replaceable external power adapter to fixed external adapter;
- separate power endpoint to host-owned fixed endpoint;
- numeric port remapping proven by one unique semantic key;
- compatible resource-key renaming while preserving numeric resource ID.

The executor returns replaced standalone components to inventory instead of
deleting them. It preserves unrelated assignments, placements, cables, manual
bends, and cached routes. If any mapping is ambiguous, validation changed after
preview, or a project revision is stale, the transaction aborts.

The DS620slim transition is one example: preserve drive assignments and network
cables, add the fixed CPU, move the power cable to the NAS-owned endpoint, return
the separate adapter to inventory, and then apply the Registry definition.

## Current State And Audit History

### Immutable history

Every evaluation run and decision remains persisted for audit and recovery.
Historical rows are never used directly as the current work queue.

### Authoritative current projection

For each registry link, the backend derives at most one current actionable
evaluation matching:

- the link's current state;
- its current available revision and content hash;
- the latest completed evaluation for that exact target;
- a pending or declined decision that has not been superseded.

Older pending evaluations are marked `superseded` when a newer authoritative
evaluation for the link is committed. Re-running the same catalog revision is
idempotent and does not duplicate the work queue.

### Group projection

Current groups are built from authoritative link evaluations by template key,
target revision, target content hash, decision status, and actionability.

The group contains:

- distinct linked items only;
- member-level source revisions and classifications;
- minimum and maximum source revision for compact display;
- common semantic change summary;
- counts of member-specific variations;
- affected project names;
- a server-generated concurrency token.

If members have different safety classes, safe members may have already applied
automatically while only unresolved members remain in Review or Blocked. A group
action never silently includes links that were not represented by its concurrency
token.

Applied and Declined are paginated audit projections. A link may correctly appear
in Applied for an older revision and in Review for a newer revision without being
duplicated inside either logical update.

## Counts

The toolbar badge counts unresolved user-facing groups:

```text
review groups + blocked groups
```

It does not count linked copies, historical evaluations, applied history, or run
rows. Group and linked-item counts are exposed separately.

The latest run retains operational link-level metrics for diagnostics, but these
are labeled as run metrics and do not drive the toolbar badge.

After a successful decision, authoritative counts are returned in the same
response and update the toolbar immediately.

## API Contract

### Summary

`GET /api/registry/updates?view=summary`

Returns only:

- unresolved review group count;
- unresolved blocked group count;
- optional linked-item counts;
- latest run state and error summary.

No change definitions, inventory records, or project snapshots are included.

### Group list

`GET /api/registry/update-groups`

Supports status, search, category, project, reason, cursor, and bounded page size.
Each row contains compact group metadata, affected item names/types, project names,
change count, and concurrency token. It excludes current/proposed JSON values.

### Group detail

`GET /api/registry/update-groups/:groupId`

Returns the common semantic changes, per-item variations, exact validation
details, affected relationships, and any topology resolution plan. TanStack Query
caches details by immutable group target and concurrency token.

### Decision

`POST /api/registry/update-groups/decision`

The request contains explicitly selected group IDs and concurrency tokens. The
server verifies target hashes and exact member link IDs before acting.

The compact response contains:

- accepted group identities and resulting statuses;
- updated group counts;
- affected numeric link and project IDs;
- committed project revisions;
- a stable idempotency receipt.

An `applied` status is legal only when every selected eligible member is now linked
at the requested revision and content hash. Already-applied members are successful
idempotent results. Zero changed rows without proof of that state is an error.

### Resolution

`POST /api/registry/update-groups/:groupId/resolve-and-apply`

Requires the concurrency token and explicit confirmation of the displayed plan.
The response uses the same authoritative decision receipt.

### Stale state

Catalog, link membership, project revision, or resolution-plan changes return
`409` with a refresh-required code. The UI retains the group, refreshes its detail,
and explains that the preview changed.

## Dialog Behavior

The dialog provides Review, Blocked, Applied, and Declined views.

- Review and Blocked load current groups.
- Applied and Declined load paginated history.
- Opening the dialog fetches one compact group page.
- Expanding a card fetches only that group's detail.
- One action marks only its selected group pending.
- Bulk actions mark only the explicitly selected groups pending.
- A successful approval moves a group from Review to Applied immediately.
- A decline moves it to Declined.
- Resolve and apply is shown only when a deterministic plan exists.
- Inline errors remain attached to the affected group.
- Adoption groups display **Adopt Registry definition** rather than misleading
  same-revision text such as `revision 1 to 1`.
- Mixed source revisions display a range or member-specific revisions.

Change presentation uses field paths and human units. Local-only differences such
as custom names are not shown as catalog changes.

## Transaction And Performance Guarantees

- Evaluation is batched by affected project and template, not performed through
  one HTTP request per link.
- Group application uses one SQLite transaction across all affected projects.
- Inventory and registry link updates commit together.
- A no-topology update does not rebuild canvas nodes or reroute cables.
- A topology update invalidates only affected project/workspace projections and
  route entries.
- Detailed group payloads are loaded on demand.
- Applied and Declined history is paginated.
- The summary response remains count-only and suitable for background polling.
- One group decision performs one mutation and one targeted reconciliation.

## Migration And Reconciliation

The implementation includes an ordered automatic startup migration.

1. Create and verify the standard pre-migration backup.
2. Rebuild the SQLite port-details constraint so slot number accepts values greater
   than or equal to zero.
3. Validate all primary and foreign keys remain positive numeric IDs.
4. Preserve all inventory items, registry links, assignments, placements, cables,
   manual bends, and route-cache rows.
5. Mark obsolete duplicate pending evaluations as superseded while retaining them
   in audit history.
6. Rebuild the current evaluation projection from link state and target hashes.
7. Reevaluate every current available update once with the semantic engine.
8. Apply newly safe updates according to the existing trusted-source policy.
9. Leave topology resolutions pending for explicit confirmation.

The migration is idempotent, rollback-capable, and validated before commit.
Restarting cannot duplicate decisions or reapply an already imported revision.

## Expected Production Reclassification

Using the captured catalog revision 18 response:

- Eleven CPU groups become safe identity and specification enrichment.
- The Omada ES210X-M2 group becomes safe semantic port normalization.
- The TP-Link HS300 group becomes safe port ordering normalization.
- The DS620slim revision 2 group remains blocked with a deterministic
  resolve-and-apply plan.

With automatic safe official updates enabled, thirteen groups apply automatically
and DS620slim remains the only group requiring user interaction.

## Test Matrix

### Projection and history

- repeated evaluations of the same link and target produce one current member;
- historical rows remain queryable after superseding;
- one link applied at revision 1 and pending at revision 2 appears correctly in
  separate history/current projections;
- one target revision with mixed applied and pending links remains consistent;
- toolbar counts groups rather than links or evaluations;
- applied and declined pagination is stable and deterministic.

### Identity and semantic comparison

- missing CPU model completed by its existing linked template is safe;
- equivalent normalized identity values produce no change;
- known aliases normalize safely;
- contradictory non-empty model requires review;
- type or ambiguous identity replacement is blocked;
- nested specifications render as field-level additions and corrections;
- local names and private instance fields are excluded and preserved.

### Ports

- `2500M` and `2.5G` compare equal;
- omitted fixed origin compares equal to explicit fixed origin;
- compatible kind enrichment preserves connected cables;
- slot-number-only changes preserve numeric port relationships;
- power-strip input slot zero round-trips through SQLite and renders as `AC 01`;
- connector replacement is classified using actual cable compatibility;
- unique semantic-key remapping produces a resolution plan;
- ambiguous remapping remains blocked.

### Merge and topology

- nested local and unknown fields survive Registry updates;
- Registry-owned fields update without replacing local instance state;
- DS620slim drive assignments and network cables survive revision 2;
- DS620slim power cable remaps to the fixed endpoint and its separate adapter
  returns to inventory;
- unrelated assignments, placements, cables, bends, and route cache are unchanged;
- a failed resolution leaves every database row unchanged.

### Decisions and concurrency

- one click triggers one request and one group pending indicator;
- a successful application persists inventory and link revisions before returning;
- closing, reopening, and hard-refreshing retains Applied status;
- already-applied retry is idempotent;
- false zero-row applied receipts are rejected;
- changed group membership, target hash, or project revision returns `409`;
- bulk decisions are atomic and include only selected groups;
- different local member conflicts are represented independently.

### Payload and performance

- summary excludes group and change payloads;
- list excludes current/proposed definitions;
- expanding one card fetches one detail payload;
- a representative large group decision response remains below 4 KiB;
- no catalog update without topology changes triggers canvas or cable recomputation;
- 1,000 linked items are evaluated in bounded project batches.

### Migration and recovery

- existing positive slot numbers remain unchanged;
- canonical slot zero imports and round-trips;
- duplicate pending evaluations become superseded without history loss;
- restart during migration rolls back safely;
- restart after migration is idempotent;
- backup/export/restore preserve runs, evaluations, decisions, and links;
- demo mode retains its existing Registry restrictions.

## Acceptance Criteria

- Current Registry work contains no duplicated linked items.
- Toolbar and dialog counts update immediately and survive reload.
- Safe enrichment applies automatically under the configured trusted-source policy.
- Representation-only differences never block connected equipment.
- Local instance data and every unrelated relationship remain intact.
- Supported topology transitions provide an exact Resolve and apply workflow.
- Ambiguous or destructive changes remain blocked.
- Decision receipts cannot claim success without committed linked state.
- Summary and list payloads remain compact as history and inventory scale.
- No implementation contains rules keyed to the specific affected product models.
- Lint, unit, integration, migration, build, backup, and container-security checks
  pass before deployment.
