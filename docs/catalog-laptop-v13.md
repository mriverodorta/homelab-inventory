# Laptop Catalog v13

Laptop is a physical class, not a workload. Local computers keep the existing
`server` inventory category and numeric IDs; `hardwareClass: laptop` and the
independent usage role describe their hardware and use. No existing computer is
reclassified by its name, chassis or assigned components.

## Compatibility and Persistence

- Canonical Registry laptops use fingerprint and runtime canonical version 13.
  Older categories retain their existing canonicalization and hashes.
- Fixed components remain embedded hardware, with no removable inventory
  assignments. Memory slots count replaceable modules only; total capacity counts
  both fixed memory and assigned sticks once.
- Missing, explicitly empty and populated capabilities remain distinct. Physical
  M.2 sockets use the v12 bus/key rules, not a WLAN-only restriction.
- Only declared power topology supplies an AC endpoint. Internal and fixed-adapter
  power belongs to the host; replaceable adapters own their own endpoint.
- Locally derived power connectors carry persisted provenance and are excluded
  from catalog projection. Explicitly declared fixed ports remain catalog data.
  Local evidence-presence flags are not public catalog content or identity.
- Resource keys are scoped by collection. Numeric resource and slot IDs remain
  stable through updates; controller and constraint references are numeric and
  type-scoped, never inferred from labels or array positions.

## Migration

`0038_laptop_hardware_class.sql` extends the class constraint without changing
existing host identities or relationships. `0039_scoped_laptop_resources.sql`
scopes laptop resource adapter aliases, records constraint catalog IDs and tracks
derived power-port provenance. Existing resource and slot IDs are not renumbered.
Both run through the existing backed-up transactional migration workflow.

Migration 0039 opts into execution at committed statement breakpoints within one
transaction. An intermediate constraint failure rolls back all changes and does
not produce a verified migration receipt. Historical migration SQL is unchanged.

## Coordinated Release

The frozen contract checksum is
`6387d9490f2077c44244a679eaf6a93c5d34e3604089d56ceec2c557658fdd82`.
The ten synthetic shared vectors have SHA-256
`3b10d33a76e5d370044cbdb72c6b2d4f2d269b37923fe76ede372b98b441eda7`.

Catalog Protocol 0.2.0 must be published and its exact integrity verified by the
Registry and LabGD. Deploy Registry support with its publication gate still at
12, then compatible app and LabGD consumers. Advance the gate only after shared
hash and preservation verification. Source support is not deployment evidence.
Do not publish synthetic fixtures, mutate historical signed artifacts or use
production services for automated tests.
