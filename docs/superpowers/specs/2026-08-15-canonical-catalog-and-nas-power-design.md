# Canonical Catalog And NAS Power Design

## Goal

Complete the application-side canonical-unit migration so every published catalog revision is searchable through the current canonical facet contract, remove user-visible legacy labeling, and render fixed NAS power topology without a duplicate body slot or misleading AC number.

## Scope

This change covers three related boundaries:

1. Canonical projection of signed catalog templates into the local SQLite catalog index.
2. Canonical handling of known inventory values while preserving backward-compatible imports.
3. NAS power presentation for internal PSUs, fixed external adapters, and replaceable external adapters.

It does not rewrite signed registry artifacts, change catalog hashes, add a new registry protocol, or change cable endpoint identities.

## Canonical Catalog Projection

Signed snapshots remain byte-for-byte immutable and continue to be verified against their original fingerprint version. After verification, the application creates a separate runtime projection for indexing and item materialization:

- Fingerprint v9 records are validated and canonicalized with the v9 canonical-unit contract.
- Fingerprint v10 records are validated with the v10 NAS contract and retain all fixed-component and power-ownership topology.
- Fingerprint v1-v8 records are translated exactly to v9 canonical measurement fields before they enter the local runtime index.
- A translation conflict or unsafe numeric conversion fails catalog activation instead of silently dropping a facet value. Historical fields whose units are genuinely ambiguous, such as old `cacheMb` values without binary-unit evidence, remain unchanged while exact canonical measurements are still projected.

The local index stores the projected item JSON and builds numeric facets from that projection. The signed template key, revision, fingerprint version, identity hash, and content hash remain those of the verified source record. This separation fixes range filtering without invalidating registry signatures.

The catalog index schema version increases so every existing installation rebuilds its index automatically on startup. The existing SQLite upgrade flow creates and verifies a pre-migration backup before replacing the index, and activation remains rollback-capable.

## Inventory Canonicalization Boundary

The relational SQLite inventory already stores measurements in canonical integer columns such as `capacity_mib`, `capacity_bytes`, `base_clock_mhz`, and `rated_power_mw`. Those columns remain authoritative.

Legacy measurement names remain accepted only at compatibility boundaries:

- old JSON/LowDB migrations;
- older selective backup imports;
- signed registry templates with fingerprint versions before v9;
- older agent payload contracts where required.

New registry contributions and catalog matching continue to use canonical measurement names. Friendly units such as GiB, TB, GHz, W, V, and Gbps are formatting choices in the UI, not persisted registry field names.

Known select-option synonyms are normalized through explicit alias tables. An unknown persisted value remains selectable and editable, but the interface displays the value verbatim. The application no longer appends `(Legacy)` to a valid current value. This avoids changing user-authored names merely because a curated option list is incomplete.

## NAS Power Ownership

NAS power rendering follows the explicit v10 topology:

| Configuration | Adapter disposition | Canvas behavior |
| --- | --- | --- |
| Internal PSU | Not applicable | One host-owned AC input chip in the header |
| External adapter | Fixed | One host-owned AC input chip in the header; no body assignment slot or fixed-adapter card |
| External adapter | Replaceable | One body assignment slot; the assigned adapter owns the AC cable endpoint |

Fixed component metadata remains persisted and available to the inspector. It is not rendered as a removable or assignable canvas row.

The numeric `slot_number` in SQLite is a relational port position and must stay unique across every port on an item. A NAS with two network ports can therefore have an AC port whose persisted slot is 3. That value must not be used as the human AC ordinal. The header chip derives its display ordinal from the ordered list of AC input ports, so a single-input NAS always displays `AC 01` while retaining the original numeric port identity used by existing cables.

No cable endpoint, assignment, canvas placement, or route-cache key changes as part of this presentation repair.

## Migration And Recovery

The upgrade uses the established SQLite migration process:

1. Verify and back up the active core, telemetry, and catalog databases.
2. Apply any core normalization migration transactionally.
3. Rebuild the catalog index into a temporary file using canonical projections.
4. Validate SQLite integrity, foreign keys, template counts, facet metadata, and representative canonical ranges.
5. Atomically replace the active index and update the activation marker.
6. Preserve the previous databases and write the existing failure receipt if validation fails.

The migration is ordered and idempotent. Restarting the same version performs no second rewrite.

## Registry Responsibilities

No registry change is required for historical v1-v8 templates. Their signed bodies are intentionally immutable and the app owns exact boundary translation.

A registry change is required only if a current v9/v10 publication:

- contains legacy measurement field names;
- emits a fixed external adapter as an assignable resource slot;
- omits the explicit `compatibility.host.power.configuration` or `adapterDisposition` field needed to determine endpoint ownership.

The application rejects those current-contract violations rather than guessing.

## Testing

Automated coverage must prove:

- mixed fingerprint v1-v10 snapshots produce canonical numeric facets;
- RAM capacity filtering is inclusive at both bounds and exact when both bounds match;
- CPU, GPU, storage, network, switch, UPS, and power ranges work for historical templates;
- conflicting or inexact legacy measurements block activation;
- catalog rebuilding is deterministic and idempotent;
- unknown select values display without `(Legacy)` and remain editable;
- recognized aliases normalize without losing meaning;
- internal and fixed NAS power render one header chip and no body power slot;
- replaceable NAS adapters retain the assignment row and adapter-owned endpoint;
- a single host-owned NAS input displays `AC 01` even when its persisted port slot is 3 or 5;
- existing cable endpoints remain unchanged;
- lint, unit tests, SQLite tests, build, and release-note validation pass.

## Documentation And Release Notes

Add one consolidated Unreleased changelog and structured release-note entry describing canonical catalog filters, current terminology, and corrected NAS power rendering. Do not bump the application version or create a tag until a deployment is explicitly requested.
