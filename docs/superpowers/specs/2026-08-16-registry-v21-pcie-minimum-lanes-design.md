# Registry Revision 21 PCIe Minimum Lanes Design

## Goal

Adopt catalog revision 21 by treating `minimumElectricalLanes` as an optional,
independently sourced PCIe functional requirement while preserving physical
connector fit, catalog identity, linked inventory, and project topology.

## Contract

- `connectorLanes` is the physical PCIe connector width and remains required
  for PCIe network adapters.
- `minimumElectricalLanes` is optional. When present, it is a positive safe
  integer no greater than `connectorLanes`.
- The compatibility copy at
  `compatibility.requirements.expansion.minimumElectricalLanes` is absent when
  the host-interface value is absent and must match it when present.
- A compatibility-only minimum is invalid rather than being adopted as source
  data.
- Import, canonicalization, persistence, snapshot verification, digesting, and
  offline bundles preserve absence instead of manufacturing a value.

## Compatibility Behavior

Mechanical fit continues to compare `connectorLanes` with the slot's
mechanical width. Electrical compatibility produces a finding only when the
card declares `minimumElectricalLanes` and the slot provides fewer lanes.
Connector width alone does not imply a functional electrical minimum.

The Intel X520-DA2 remains physically x8, declares a functional x4 minimum,
and is compatible with the Synology DS1621+ Gen3 x8-mechanical/x4-electrical
slot.

## Identity And Updates

PCIe minimum-lane changes remain outside catalog identity. Lowering or omitting
the minimum changes content but preserves identity. The registry update planner
must classify a minimum-lane relaxation as safe when it introduces no new
compatibility finding, allowing configured trusted-update policy to apply it
without topology changes.

## Persistence And Safety

The existing nullable SQLite column requires no migration. Catalog refresh may
replace only catalog artifacts and update evaluation state. It must not modify
inventory records, assignments, placements, cable connections, or project
revisions until an update is actually applied. Restart and repeated refresh
remain deterministic and idempotent.

## Verification

Regression coverage spans optional-field validation, synchronization,
fingerprints, signed snapshots and digests, offline bundles, update planning,
compatibility evaluation, persistence round trips, refresh idempotency, and the
published revision 21 X520-DA2 vector. Full lint, test, build, and dual-platform
container security preflight are required before a patch release to
`main/latest`.
