# Canonical Compatibility Audit Design

**Date:** 2026-08-18

**Status:** Approved design

**Scope:** Server-side compatibility projection, M.2 A/E semantics, memory ECC defaults, exact-slot evaluation, expansion power, and CPU generation aliases

## Objective

Make compatibility findings consistent across Systems, Inspector, Canvas, and the global Audit drawer by creating one persisted server-side compatibility projection. Correct the compatibility rules that currently produce false or misleading findings for M.2 A/E modules, ordinary non-ECC memory, assigned resource slots, single-slot expansion power, and CPU generation aliases.

The server projection is authoritative after a change is persisted. Client-side compatibility evaluation remains available only for previews before an assignment is saved.

## Problems

The current application has three incompatible behaviors:

- Inspector and Canvas calculate compatibility from the frontend project snapshot.
- Systems reads persisted `compatibility_audit_findings` through its Attention projection.
- No production service currently evaluates hosts and writes those compatibility audit rows.

Consequently, Systems can report no attention while Inspector and Canvas show multiple compatibility findings for the same host.

The evaluator also has several semantic defects:

- Optional-module matching treats `acceptedModuleKinds` as an exclusive gate, causing wired M.2 A+E Ethernet modules to miss a physically compatible socket labeled as WLAN.
- Missing ECC metadata generates noise for ordinary non-ECC memory.
- Project evaluation may select the most favorable resource group instead of evaluating the exact resource slot recorded by the assignment.
- A host-wide expansion power budget is not used when the host has one expansion slot and no separate per-slot value.
- CPU generation strings are compared literally even when one label is a marketing generation and another is an architecture or codename for the same supported processor family.
- Missing metadata and proven incompatibilities are presented as equivalent attention items.

## Scope

Included:

- A dedicated server-side compatibility audit service and dirty-host queue.
- Persisted actionable and informational compatibility findings.
- Incremental recomputation after inventory, assignment, Registry, compatibility-policy, and relevant topology changes.
- Compact SSE invalidations with no compatibility polling loop.
- Exact assigned-resource evaluation.
- Deterministic repair of unambiguous legacy assignments without a resource slot.
- Canonical M.2 A/E host-resource semantics and legacy `wlan-m2` aliases.
- Missing-ECC defaults for ordinary memory while retaining strict registered-memory behavior.
- Single-slot global expansion-budget fallback.
- Canonical CPU-generation aliases.
- Shared read models for Systems, Inspector, Canvas, and Audit.
- Ordered automatic migration and regression coverage.

Excluded:

- A dedicated inventory type for M.2 adapters.
- Modeling A/E-to-M-key adapters in this change.
- Changing Registry catalog records directly from the application.
- Treating descriptive intended use as proof of electrical capability.
- Polling compatibility endpoints.
- Replacing local pre-assignment compatibility previews.

Physical adapters may later use the existing `other` inventory category with an input interface and output resources. That future work must not be approximated by assigning a downstream NVMe drive directly to an A/E socket.

## Chosen Architecture

Create a `CompatibilityAuditService` as an independent server domain. The shared compatibility evaluator remains pure domain logic. The service owns host snapshot assembly, evaluation, persistence, invalidation, and projection events.

The existing `SystemAttentionProjector` remains an aggregation layer. It consumes persisted actionable compatibility findings together with Registry and notification findings; it does not calculate hardware compatibility.

The authoritative flow is:

```text
Inventory, assignment, Registry, policy, or topology change
  -> identify affected host IDs
  -> upsert compatibility dirty-host rows
  -> evaluate each affected host once
  -> atomically reconcile persisted findings
  -> mark Systems attention projection dirty
  -> emit compact compatibility.updated SSE event
  -> invalidate only affected frontend queries
```

Small mutations enqueue only directly affected hosts. Registry refreshes and bulk canonical changes enqueue every host linked directly or through an assigned component and process them in bounded batches. Dirty rows survive restart and are idempotent.

## Service Boundaries

### Compatibility evaluator

Responsibilities:

- Normalize host capabilities and component requirements.
- Evaluate one component against one host and an explicit assigned resource when supplied.
- Return structured findings with stable rule keys, classification, severity, field, and resource context.
- Evaluate pre-assignment candidates without persistence.

Dependencies:

- Canonical host and component projections.
- Assignment allocation data.
- Versioned canonical alias vocabularies.

The evaluator does not read SQLite, write findings, emit SSE, or choose UI presentation.

### Compatibility audit service

Responsibilities:

- Resolve the canonical host assembly from SQLite.
- Evaluate every current assignment against its recorded resource slot.
- Reconcile active, ignored, and resolved findings transactionally.
- Repair only deterministic missing resource-slot relationships through the normal relational assignment path.
- Manage dirty-host work and audit-run status.
- Notify downstream projections after a successful reconciliation.

Dependencies:

- Core SQLite store.
- Shared evaluator.
- Systems attention invalidation interface.
- Application SSE hub.

### Systems attention projector

Responsibilities:

- Aggregate actionable compatibility findings, pending Registry updates, and active notification incidents.
- Maintain compact per-host counts for the Systems workspace.

It must not duplicate compatibility rules or include informational metadata gaps in the Attention count.

### Frontend consumers

Responsibilities:

- Read server projections with TanStack Query.
- Invalidate only relevant queries from SSE events.
- Present persisted findings consistently.
- Use the local evaluator only for unsaved assignment previews.

## Persistence Model

Extend the existing compatibility audit schema rather than replacing it.

### `compatibility_audit_dirty_hosts`

Fields:

- Positive numeric primary key.
- `project_id` foreign key.
- `host_item_id` foreign key.
- Reason.
- Input project revision.
- Created and updated timestamps.

Enforce one row per project and host. A newer invalidation updates the existing row instead of creating duplicate work.

### `compatibility_audits`

Retain audit-run history and record:

- Project.
- Input revision.
- Engine version.
- Running, completed, or failed state.
- Start and completion timestamps.

An audit run is operational history. It is not the source of active UI findings.

### `compatibility_audit_findings`

Add relational and classification context:

- `project_id`.
- `host_item_id`.
- Nullable `component_item_id`.
- Nullable `assignment_id`.
- Nullable `resource_slot_id`.
- Stable `finding_key`.
- Stable `rule_key`.
- `classification`: `actionable` or `informational`.
- `severity`: `info`, `warning`, or `error`.
- Human-readable message.
- Structured details JSON for presentation and navigation.
- First-seen, last-seen, and resolved timestamps.

Relationships use positive numeric IDs. Names, labels, array positions, and semantic keys are never persisted as foreign keys.

Finding identity is derived from stable relational context:

```text
project + host + assignment + resource slot + rule
```

Host-level rules omit assignment and resource-slot components. Message text and display names are excluded so wording changes do not create new findings or lose ignore state.

### Ignore behavior

`compatibility_audit_ignores` continues to reference a numeric finding ID. When the same finding remains active after reevaluation, its row and ignore relationship remain stable. When the condition disappears, the finding is resolved. If it later reappears with the same stable identity, the existing finding is reopened and its explicit ignore state remains attached.

## Reconciliation Transaction

For each dirty host:

1. Read the host, assignments, assigned components, resource groups, resource slots, compatibility policy, and current project revision.
2. Repair an assignment without a resource slot only when exactly one valid slot exists.
3. Re-read the assembly if a repair was committed.
4. Evaluate every assignment against its exact resource slot.
5. Derive stable finding identities.
6. Upsert findings still present and update `last_seen_at_ms`.
7. Reopen previously resolved findings that have returned.
8. Mark absent active findings resolved.
9. Mark the audit run completed.
10. Delete the dirty-host row only if it still represents the evaluated input revision.
11. Mark the host's Systems attention projection dirty.
12. Emit `compatibility.updated` after the transaction commits.

If a newer invalidation arrives during evaluation, the dirty row remains for another pass. If evaluation fails, the previous valid projection remains available and is marked stale; the failure does not become a hardware finding.

## Finding Classification

### Actionable

Actionable findings represent a proven conflict or a relationship that requires a decision:

- Unsupported interface, connector key, module type, CPU generation, or form factor.
- Exceeded capacity, TDP, power, slot count, or electrical limit.
- Component incompatible with its recorded resource slot.
- Ambiguous legacy assignment that cannot be repaired deterministically.
- Missing required physical relationship where the application cannot identify the installed slot safely.

### Informational

Informational findings represent incomplete evidence without a proven incompatibility:

- Missing speed, ECC, TDP, generation, lane, slot-power, or similar metadata.
- Partial compatibility topology.
- Unrecorded optional capability where the assignment is not contradicted by known data.

Informational findings appear under **Unverified details** in Inspector and under an **Informational** filter in the Audit drawer. They do not contribute to Systems Attention or the Canvas bottom alert count.

## Exact Assigned-Resource Evaluation

When `component_assignments.resource_slot_id` is present, the evaluator must use that exact `host_resource_slots` record and its parent `host_resource_groups` subtype. It must not select another compatible group or the candidate with the fewest findings.

Candidate ranking remains valid only for:

- Drag-and-drop preview.
- Add-to-host planning.
- Deterministic repair of an assignment that lacks a slot.

For a missing slot relationship:

- Exactly one valid available destination: persist that numeric slot relationship automatically.
- No valid destination: keep the assignment unchanged and create an actionable finding.
- More than one valid destination: keep the assignment unchanged and create an actionable ambiguity finding.

Automatic repair must use the existing assignment mutation and validation path so occupancy constraints and foreign keys remain enforced.

## M.2 A/E Physical Semantics

An M.2 A/E socket is a physical and electrical interface, not a wireless-only resource.

Canonical host resources remain under `optionalModuleSlots`, but use generic physical semantics:

- Canonical semantic key based on `m2-ae-slot`, with deterministic suffixes when multiple groups exist.
- User-facing label `M.2 A/E slot`.
- Legacy aliases including `wlan-m2` where applicable.
- Interface family `m2-ae`.
- Mechanically accepted keys based on evidence.
- Supported module sizes such as `2230`.
- Available PCIe and USB buses recorded independently when evidenced.
- Optional intended-use metadata that is descriptive and non-restrictive.

Component requirements continue to use the Registry v11 host-interface contract, including `family`, `key`, and `moduleSize`. Matching uses:

1. Interface family.
2. Connector key.
3. Module size.
4. Required bus.
5. PCIe generation and lanes only when evidenced.

`acceptedModuleKinds` must not reject a physically and electrically compatible module. Wi-Fi modules and wired A+E Ethernet adapters can therefore use the same compatible socket. Unknown bus data yields an informational result unless known data proves a mismatch.

## M.2 A/E Migration

The ordered startup migration identifies unambiguous legacy resources represented as:

- `optionalModuleSlots` key `wlan-m2`.
- Label `M.2 WLAN slot`.
- Equivalent normalized A/E WLAN keys.
- Legacy `expansionSlots` key `m2-ae-slot` that represents the same physical socket.

For each unambiguous socket, the migration:

- Preserves the existing numeric inventory resource, resource-group, and resource-slot IDs.
- Changes the canonical semantic meaning and visible label to M.2 A/E.
- Stores `wlan-m2` as a legacy resource identity alias.
- Preserves count, location, CPU dependencies, constraints, and assignments.
- Removes duplicate cross-collection representations only through the existing validated reclassification path.
- Leaves exactly one physical socket.

Ambiguous or conflicting resources are not rewritten. They remain intact and are surfaced as actionable migration findings.

The migration never infers that every A/E socket has PCIe and USB. It persists only supported values already present in canonical data or supplied by a compatible Registry contract.

## Memory ECC Defaults

For compatibility evaluation only:

- Missing ECC metadata on UDIMM, SO-DIMM, or an otherwise ordinary unregistered memory module means non-ECC.
- Missing ECC metadata does not write fabricated `ecc: false` into the inventory record.
- RDIMM and LRDIMM require explicit ECC support.
- An explicit ECC module remains incompatible with a host that declares ECC unsupported.
- A host with unknown ECC capability produces informational evidence only when it affects evaluation.

This removes noise for normal consumer and OEM memory without weakening registered-memory validation.

## Expansion Power

When a host exposes exactly one expansion resource group and that group has no `maxPowerMw`, the evaluator may use `host_compatibility_profiles.max_expansion_power_mw` as the effective limit for that slot.

When a host has multiple expansion slots, the host value remains a shared aggregate budget. It must not be copied or treated as the per-slot limit for each resource. Aggregate known expansion draw continues to be checked against the host-wide budget.

## CPU Generation Aliases

CPU product generation, architecture, and codename are separate concepts. Compatibility must not compare their display strings literally.

Introduce a versioned canonical CPU taxonomy at the compatibility boundary:

- Normalize known legacy labels into canonical tokens.
- Preserve separate tokens for product generation, architecture, and codename.
- Allow a CPU to expose multiple compatibility aliases.
- Match when the host's supported product-generation tokens intersect the CPU's applicable product-generation aliases.
- Do not treat architecture equivalence alone as proof that a host supports every CPU using that architecture.

For example, a Ryzen PRO 4000 processor may retain `Zen 2` as its architecture while also exposing the correct Ryzen PRO 4000 product-generation alias. A host supporting Ryzen PRO 4000 matches the product-generation token without comparing `Ryzen PRO 4000` directly to `Zen 2`.

The alias vocabulary is deterministic, versioned, shared by client previews and server audits, and covered by fixtures. Registry-provided canonical aliases should be preserved when the Registry contract supplies them.

## APIs

Expose compact server projections:

```text
GET /api/projects/:projectId/compatibility/summary
GET /api/projects/:projectId/hosts/:hostType/:hostId/compatibility
GET /api/projects/:projectId/compatibility/findings
```

### Project summary

Returns per-host actionable count, informational count, projection state, revision, and evaluation timestamp. It excludes full finding details.

### Host compatibility

Returns one host's active actionable and informational findings with stable IDs, relational destinations, and projection state.

### Project findings

Powers the Audit drawer with server-side classification, severity, host, and visibility filters. It returns only requested pages or bounded result sets rather than every finding by default.

All reads support ETags. Unchanged requests return `304` without retransmitting payloads.

## SSE Contract

After a successful host reconciliation, emit:

```json
{
  "type": "compatibility.updated",
  "projectId": 1,
  "hostType": "server",
  "hostId": 7,
  "revision": 12,
  "actionableCount": 2,
  "informationalCount": 3
}
```

The event contains no full finding set. The frontend invalidates only:

- The affected host compatibility query.
- The project compatibility summary.
- An open Audit drawer query whose filter can include the host.
- The affected Systems attention entry.

No interval polling is added. Existing application SSE reconnection behavior handles temporary disconnects. After reconnection, normal query revalidation closes any missed-event gap.

Views retain the previous valid projection while a host is refreshing. They show a subtle stale or refreshing state rather than clearing findings or flashing counts.

## UI Behavior

### Systems

- The Attention column includes actionable compatibility findings only.
- Informational findings do not increase the count.
- SSE updates the affected row without reloading the complete Systems dataset.

### Inspector

- The Compatibility tab reads the persisted host projection.
- It separates **Compatibility issues** from **Unverified details**.
- Exact assignment and resource-slot context is shown where available.
- The previous projection remains visible during recomputation.

### Canvas

- Canvas audit badges and the bottom alert count use the same actionable projection.
- Informational metadata gaps do not produce alert badges.
- Canvas rendering does not reevaluate the complete project.

### Audit drawer

- Reads persisted project findings.
- Supports actionable, informational, severity, host, and ignored/open filters.
- Uses the same finding IDs and messages shown in Inspector.

### Assignment previews

- Unsaved drag-and-drop and add-to-host interactions may evaluate locally for immediate feedback.
- After the mutation succeeds, the persisted server projection becomes authoritative.
- A preview result never writes an audit finding directly.

## Invalidation Sources

Mark affected hosts dirty after:

- Host compatibility fields change.
- Assigned component compatibility fields change.
- Assignment is added, removed, moved, or repaired.
- Registry update is applied to a host or assigned component.
- Registry resource reclassification changes an assignment relationship.
- Compatibility policy changes.
- A topology change affects a compatibility or audit rule.
- Migration or restore changes canonical inventory relationships.

Do not mark unrelated hosts dirty. Bulk operations may enqueue a bounded set of affected hosts in one transaction.

## Startup And Migration Safety

The migration must:

- Create a verified pre-migration backup through the established migration workflow.
- Run automatically when the updated image starts.
- Be ordered, transactional, idempotent, rollback-capable, and strictly validated.
- Add the dirty-host queue and finding relationship/classification fields.
- Canonicalize only unambiguous M.2 A/E resources.
- Enqueue every existing compute host once after schema activation.
- Resume incomplete dirty work after restart.
- Preserve all existing inventory, assignments, placements, connections, manual bends, route cache, private fields, Registry links, and ignore relationships.

The initial projection does not increment project revisions because audit materialization is derived state. A deterministic assignment repair is a real relational mutation and follows the normal project revision and history behavior.

## Error Handling

- Evaluation failure retains the previous valid projection and marks it stale.
- A failed host remains in or returns to the dirty queue with bounded retry and backoff.
- Repeated failures do not create duplicate findings or an unbounded retry loop.
- Ambiguous assignment repair creates one actionable finding and performs no mutation.
- Unknown metadata remains informational and never becomes a fabricated incompatibility.
- SSE publication occurs only after the database transaction commits.
- Failure to emit SSE does not roll back a valid projection; reconnect revalidation repairs client state.

## Registry Coordination

The Registry must stop modeling M.2 A/E sockets as WLAN-only compatibility resources. Its coordinated change must:

- Represent A/E sockets by interface family, connector keying, module dimensions, and evidenced buses.
- Keep intended WLAN use descriptive and non-restrictive.
- Preserve legacy `wlan-m2` keys as aliases.
- Preserve template identity while changing content and template revision.
- Correct every published and staged OEM template consistently.
- Avoid duplicate expansion and optional-module representations.
- Stage ambiguous records instead of guessing.
- Keep previous signed revisions byte-for-byte unchanged.
- Provide frozen fixtures before publication.
- Hold publication behind the application contract gate until this application supports the final Registry contract.

The complete operational Registry handoff is maintained separately for the Registry task. The application implementation must follow the final frozen field names supplied by that handoff rather than publishing a competing schema.

## Verification

### Evaluator tests

- Exact assigned-slot evaluation wins over best-candidate selection.
- Wi-Fi and wired M.2 A+E Ethernet modules match a compatible A/E socket.
- Key, size, and evidenced bus mismatches remain actionable.
- Missing A/E bus evidence is informational rather than a proven mismatch.
- Ordinary missing ECC evaluates as non-ECC.
- Explicit ECC against unsupported hosts remains incompatible.
- RDIMM and LRDIMM require ECC.
- A single expansion slot inherits the global expansion budget.
- Multiple expansion slots do not receive duplicated per-slot budgets.
- CPU generation aliases match supported product generations.
- Architecture aliases do not create broad false compatibility.

### Projection tests

- Dirty rows deduplicate by project and host.
- One host mutation evaluates only affected hosts.
- Bulk Registry changes evaluate all and only affected hosts.
- Stable findings retain IDs and ignore state.
- Disappeared findings resolve in all consumers.
- Reappearing findings reopen deterministically.
- Informational findings never increase actionable counts.
- Failed evaluation preserves the prior projection.
- Restart resumes dirty work without duplicate runs or findings.

### Migration tests

- A legacy `wlan-m2` resource becomes one canonical M.2 A/E resource.
- Numeric inventory-resource, resource-group, and resource-slot IDs remain unchanged.
- `wlan-m2` remains a resolvable alias.
- Existing assignments remain attached to the same physical slot.
- An assignment without a slot is repaired only when one valid destination exists.
- Ambiguous assignments remain unchanged and receive one actionable finding.
- Physical WLAN/A/E resource count remains one.
- Duplicate cross-collection resources are not created.
- A second startup makes no further changes.

### API and UI tests

- Systems, Inspector, Canvas, and Audit show the same actionable findings.
- Inspector and Audit expose the same informational findings.
- ETags avoid retransmitting unchanged data.
- SSE invalidates only affected query keys.
- No compatibility polling timer exists.
- A stale projection remains visible while refreshing.
- Local assignment preview is replaced by the persisted projection after save.

### Preservation assertions

For migration, Registry refresh, and audit recomputation:

- Assignments lost: 0.
- Placements changed: 0.
- Connections changed: 0.
- Manual bends changed: 0.
- Route-cache entries changed: 0.
- Private fields changed: 0.
- Registry links lost: 0.
- Duplicate M.2 A/E resources: 0.
- Ambiguous migrations applied: 0.

## Release Requirements

This is a user-visible compatibility correction and automatic schema migration.

- Update the structured unreleased release-note draft.
- Update `CHANGELOG.md` under Unreleased.
- Do not bump the version until deployment is explicitly requested.
- Run focused migration, evaluator, projection, API, and UI tests.
- Run `bun run lint`.
- Run `bun run test`.
- Run `bun run build`.
- Run `bun run security:container` before any push to `main` or `stable`.

## Acceptance Criteria

- Systems, Inspector, Canvas, and Audit consume one persisted server compatibility projection.
- Missing metadata is separated from actionable incompatibility.
- Components are evaluated against their assigned numeric resource slot.
- Ordinary missing ECC metadata no longer creates an actionable warning.
- Wired M.2 A+E Ethernet adapters work in compatible A/E sockets regardless of WLAN labeling.
- Single-slot hosts use the global expansion power budget when no per-slot budget exists.
- Canonical CPU-generation aliases prevent marketing-generation versus architecture false mismatches.
- Compatibility changes reach open views through SSE without polling.
- Existing inventory and topology survive migration unchanged except deterministic, validated assignment repairs.
