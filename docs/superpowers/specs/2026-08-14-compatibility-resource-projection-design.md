# Compatibility Resource Projection Design

## Problem

Canonical SQLite stores the Dell Precision Compact 3240 expansion slot as PCIe Gen 3 and the AMD Radeon RX 640 requirement as PCIe Gen 3. The legacy workspace projection selects `storage_resource_groups.pcie_generation` into a shared column and then reuses it for expansion slots. Consequently, expansion slots lose their stored generation, allocation remains unknown, and assigning the compatible GPU reports that the slot generation is not recorded.

## Scope

- Preserve every typed compatibility-resource field while projecting canonical SQLite records into the workspace model.
- Audit storage, expansion, optional-module, controller, boot-device, cooling, power, CPU, and memory projections for the same class of omission or ambiguous column collision.
- Prove that assigning the RX 640 to the Precision 3240 selects and persists the numeric expansion-slot relationship.
- Keep existing inventory, assignments, placements, connections, registry links, and project revisions unchanged.

## Design

The compatibility projection will use explicit aliases for subtype fields that share names. Storage PCIe generation and expansion PCIe generation will be projected independently, and each resource mapper will consume only its subtype alias. The audit will compare every field persisted by each compatibility subtype schema/import path with the corresponding projected field; omitted fields found in this path will be added without broad refactoring.

No data migration is required. The canonical database and registry catalog already contain the correct values, and this defect does not change a primary key or foreign key. The corrected projection is used automatically on application startup. New component assignments will therefore be planned against complete host capabilities and persist their existing numeric resource-group and slot relationships through the normal engine patch.

Existing assignments created while the defect was present may have no persisted slot allocation. They remain attached to the correct host and component. After the projection fix, compatibility planning resolves them without the false warning; the implementation will not guess or rewrite historical slot selections during startup.

## Error Handling

Missing canonical fields remain unknown rather than being inferred from model names, free-form specifications, or registry identity. Ambiguous or genuinely incomplete slots continue to produce the existing unknown compatibility result. The fix only restores values that are already stored in typed canonical columns.

## Verification

- A projection regression test stores different PCIe generations for storage and expansion resources and verifies both survive independently.
- A workflow regression test assigns a GPU to an OEM host, verifies a compatible result, and verifies `component_assignments.resource_slot_id` plus `component_assignment_slots` reference the expected numeric expansion slot.
- Existing conventional-server topology projection tests continue to cover controller, boot-device, cooling, power, CPU, and memory fields.
- Run focused tests, then `bun run lint`, `bun run test`, and `bun run build`.
- Update the unreleased structured release notes and `CHANGELOG.md` because this is a user-visible compatibility fix.

## Non-Goals

- No registry catalog mutation.
- No compatibility inference from hardware names.
- No automatic reassignment of existing components to guessed physical slots.
- No version bump, tag, push, or deployment until explicitly requested.
