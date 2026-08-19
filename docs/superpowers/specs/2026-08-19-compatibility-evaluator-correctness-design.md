# Compatibility Evaluator Correctness Design

## Purpose

Eliminate the false CPU-generation incompatibility reported for a Registry-linked Dell OptiPlex Micro 7010 with a Registry-linked Intel Core i7-12700T, then audit the complete compatibility path for the same classes of false-positive, false-negative, and stale-projection defects.

This is a patch-scoped correctness change. It does not redesign the compatibility data model or add new compatibility policy.

## Confirmed Production Defect

Catalog revision 24 and the linked inventory records agree on every relevant fact:

- The Dell OptiPlex Micro 7010 supports `LGA1700`, `12th Gen`, `13th Gen`, and CPUs up to 35 W.
- The Intel Core i7-12700T requires `LGA1700`, `12th Gen`, and 35 W.

The current CPU alias map canonicalizes `13th Gen` to a product token but leaves `12th Gen` as a literal token. The evaluator disables literal matching whenever any accepted host generation has a product token. A host list containing both `12th Gen` and `13th Gen` therefore rejects an exact `12th Gen` component value.

This is an Application evaluator defect. No Registry template correction or publication is required.

## Scope

The review covers the complete compatibility path:

1. Canonical host and component normalization.
2. Individual CPU, memory, storage, expansion, optional-module, power, cooler, and case rules.
3. Assigned-resource evaluation.
4. Automatic resource candidate selection and allocation.
5. Project-level aggregation and finding deduplication.
6. Persisted audit reconciliation and startup invalidation.

Changes outside this path are excluded. A suspected issue only becomes part of the patch when a minimal failing regression test demonstrates incorrect behavior.

## Generation Matching

CPU generation compatibility follows this order:

1. If the normalized host generation and normalized component generation are exactly equal, they match.
2. Otherwise, compare semantic product-generation aliases.
3. Product-generation aliases may connect equivalent marketing labels and codenames.
4. Product generation and architecture remain separate concepts. For example, `Ryzen PRO 4000` must not become equivalent to `Zen 2` merely because products in that family use that architecture.
5. A proven non-match is incompatible. Missing host or component generation evidence remains informational.

Intel ordinal generations are parsed generically. Values such as `12th Gen`, `12th Generation`, `14th Gen`, and future ordinal generations produce a stable Intel product-generation token without requiring an enumerated alias for each release.

The canonicalizer continues to support explicit aliases for marketing families and codenames that cannot be derived safely.

## Evaluator Invariants

Every compatibility rule must preserve a three-state result:

- `compatible`: all required known facts match.
- `incompatible`: at least one known fact proves the assignment invalid.
- `unknown`: no known conflict exists, but required evidence is missing.

Missing metadata must never be converted into an actionable incompatibility. Known lower-bound violations remain actionable even when unrelated metadata is missing.

Normalization must:

- Preserve absence as absence.
- Reject malformed numeric data rather than coercing it.
- Avoid deriving compatibility facts from names or throughput unless an existing, explicit boundary adapter owns that inference.
- Return cloned data and never mutate inventory or Registry projections.

## Resource Selection

When an assignment has a persisted physical resource slot, evaluation uses that slot. A more permissive sibling slot must not mask an incompatibility in the assigned slot.

When no resource is assigned, candidate selection is deterministic:

1. Fully compatible candidates.
2. Candidates with incomplete evidence but no proven conflict.
3. Proven incompatible candidates.

Candidates within the same class retain their established deterministic ordering. Ambiguous equivalent candidates remain unresolved instead of receiving a fabricated allocation.

Project-level evaluation must not leak rejected-candidate findings into the selected candidate result. Aggregate findings are emitted once per host while assignment-specific findings retain their assignment identity.

## Persisted Audit Reconciliation

The CPU alias contract version and compatibility audit engine version advance together.

An ordered, idempotent SQLite migration enqueues every active compatibility host in every applicable project in `compatibility_audit_dirty_hosts`. This ensures an updated image automatically recomputes persisted findings without requiring the user to edit inventory, refresh the Registry, or reassign components.

Reconciliation must:

- Resolve the stale Dell CPU-generation finding.
- Preserve finding history and existing ignore records according to the current audit lifecycle.
- Emit the existing compatibility and Systems SSE invalidation events after recomputation.
- Produce no duplicate active findings after restart or repeated reconciliation.
- Be safe when the dirty-host row already exists.

## Data Preservation

The migration and audit rebuild may only alter compatibility audit queue, audit-run, finding, and derived Systems-attention state.

The following must remain unchanged:

- Inventory items and identities.
- Component assignments and numeric resource-slot IDs.
- Project memberships and revisions, except a revision change already required by established migration infrastructure.
- Canvas workspaces and placements.
- Cable connections and endpoints.
- Cable route cache.
- Private fields and serial numbers.
- Registry links, revisions, identity aliases, and contribution state.
- Agent identity, telemetry, and notification state.

## Test Strategy

### CPU generation regressions

- Reproduce the exact Dell OptiPlex Micro 7010 and i7-12700T production records.
- Match `12th Gen` when the host supports both `12th Gen` and `13th Gen`.
- Match `12th Gen` with `12th Generation` and equivalent ordinal formatting.
- Match `14th Gen` without adding a dedicated manual alias.
- Match exact normalized future or vendor-specific generation labels even when another accepted host generation has a semantic product token.
- Retain Comet Lake and Rocket Lake product aliases.
- Retain AMD Ryzen product-family aliases.
- Prove that AMD architecture labels do not match product-generation labels without explicit evidence.
- Continue reporting genuine generation mismatches.

### Full-path evaluator audit

Use table-driven tests for each rule family covering compatible, incompatible, and unknown inputs. Retain existing regression cases for malformed values, assigned sibling slots, PCIe mechanical versus electrical requirements, M.2 required buses, storage interface and form factor, memory ECC defaults, power aggregation, and deterministic allocation.

Add a regression whenever the audit identifies a concrete defect. Do not change behavior solely to make implementation structure more uniform.

### Persistence and restart

- Apply the new migration over a pre-patch database containing the false Dell finding.
- Verify all active hosts are queued exactly once.
- Reconcile and confirm the false finding is resolved and no replacement incompatibility is created.
- Restart and rerun migration/reconciliation to prove idempotency.
- Compare relational invariants before and after for assignments, resource slots, placements, connections, route cache, private fields, Registry links, inventory identity, and project state.

## Release Documentation

The implementation updates the structured unreleased release-note draft and the `Unreleased` changelog section. Version numbers and release tags remain unchanged until the user explicitly requests deployment.

## Acceptance Criteria

1. The live Dell 7010/i7-12700T data evaluates as compatible.
2. Exact normalized CPU generation values always match.
3. Generic Intel ordinal aliases cover current and future ordinal generations.
4. Product and architecture semantics remain distinct.
5. No reviewed evaluator branch converts missing evidence into a false incompatibility.
6. Assigned resource slots remain authoritative.
7. Candidate selection remains deterministic and does not leak rejected findings.
8. Existing false persisted findings are removed automatically after image startup.
9. Repeated migration, reconciliation, refresh, and restart are idempotent.
10. All protected inventory, project, topology, routing, private, Registry, agent, and notification state remains unchanged.
11. Lint, tests, build, and the two-platform container security preflight pass.
