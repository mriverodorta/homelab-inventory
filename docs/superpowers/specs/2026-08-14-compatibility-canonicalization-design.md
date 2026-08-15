# Compatibility Canonicalization Design

## Objective

Remove false compatibility alerts caused by equivalent hardware vocabulary while preserving actionable findings for genuinely unsupported configurations.

The immediate cases are:

- Synology DS620slim accepting 2.5-inch SATA storage.
- Synology DS1621+ accepting 3.5-inch SATA storage.
- Intel X520-DA2 operating in the DS1621+ PCIe slot when the slot's x4 electrical link satisfies the card's declared x4 minimum.

## Storage Form-Factor Identity

Persisted canonical keys and user-facing labels may represent the same form factor differently. For example, `2.5-inch`, `2.5 inch`, and `2.5"` all describe the same physical form factor.

The compatibility evaluator will canonicalize storage form factors through a domain-specific function before comparing component requirements with host slot capabilities. It will support the application's known storage form factors and common legacy aliases without changing persisted values or display labels.

This behavior belongs in the evaluator rather than the SQLite read model. Read models may continue returning human-readable labels, while compatibility remains stable across legacy JSON, SQLite projections, registry templates, and user-entered records.

Unknown values will be normalized conservatively and compared without broadly discarding punctuation that could carry hardware meaning.

## PCIe Electrical Lanes

PCIe compatibility will use the component's declared minimum electrical lane requirement as the actionable threshold.

- If the slot provides fewer lanes than `minimumElectricalLanes`, emit an incompatibility error.
- If the slot meets or exceeds `minimumElectricalLanes`, do not emit an alert merely because it provides fewer lanes than the card's connector width.
- If no minimum is declared, existing missing-data behavior remains in place; the evaluator must not invent a safe minimum.
- Mechanical fit, PCIe generation, height, occupied width, power, and CPU dependency checks remain independent and unchanged.

The Inspector continues to show the host slot topology, including x8 mechanical and x4 electrical details. The audit surface remains reserved for unsupported, unsafe, or unverifiable configurations.

## Data And Migration

No schema or data migration is required. The existing NAS records, storage assignments, relational IDs, storage form-factor vocabulary, and expansion topology are correct.

The fix changes compatibility interpretation only. Existing assignments, placements, cables, registry links, and project revisions must remain unchanged.

## Regression Coverage

Tests will prove that:

1. A 2.5-inch SATA drive is accepted by a host slot projected as `2.5 inch`.
2. A 3.5-inch SATA drive is accepted by a host slot projected as `3.5 inch`.
3. Common aliases such as `2.5"` resolve to the same storage form factor.
4. An x8 Intel X520-DA2 with an x4 minimum produces no lane alert in an x4 electrical slot.
5. A card requiring x8 still produces an error in an x4 electrical slot.
6. Unrelated storage form factors remain incompatible.
7. Existing mechanical, generation, height, width, power, and CPU-dependency checks continue to run.

## Release Notes

The fix is user-visible and will be recorded in the unreleased structured release notes and the `Unreleased` changelog section. It does not trigger a version bump, tag, push, or deployment until explicitly requested.
