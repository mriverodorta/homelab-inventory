# `@homelab-inventory/catalog-protocol`

Canonical catalog contracts, normalization, hashing, signed-artifact
verification, snapshots, and compatibility projections shared by Homelab
Inventory and the official Registry.

```bash
bun add --exact @homelab-inventory/catalog-protocol@0.2.1
```

The npm package is intended for applications that must consume an exact public
Registry revision. Consumers should pin an exact version because fingerprint
implementations are historical wire contracts rather than ordinary display
helpers.

Version `0.1.1` is the first release reconciled against both Homelab
Inventory's runtime fixtures and the Registry's frozen publication vectors.
Version `0.2.0` adds laptop fingerprint 13 without changing any fingerprint 2-12
output. Consumers must pin the exact tested version, not a range or distribution
tag. The historical default `FINGERPRINT_VERSION` remains 3.

Version `0.2.1` hardens input normalization against excessive regex processing.
Historical canonical projections, identity/content hashes and catalog contract
13 remain unchanged. Existing signed catalogs do not need republishing.

## Laptop v13

Use `canonicalizeCatalogItemV13`, `assertCanonicalCatalogItemV13` and
`digestCatalogTemplate(item, { fingerprintVersion: LAPTOP_FINGERPRINT_VERSION })`.
Laptops require explicit manufacturer/model and material host evidence. Fixed
CPU/RAM and replaceable resources are independent; memory slot counts exclude
soldered banks. Physical M.2 A/E follows v12 bus/key rules without WLAN-only use
restrictions. Missing power remains unknown, never a default internal PSU.

The dedicated topology projector resolves numeric resource relationships to
semantic keys for identity while preserving numeric IDs in canonical content.
Explicit empty arrays/objects remain distinct from absent evidence. Hash-only
markers are reserved and never persisted in items. Cosmetic labels and capacity
ceilings are content-only; fixed hardware identity remains material.

Run `await assertCatalogProtocolContract()` without arguments at the consumer
boundary. It checks all historical vectors plus the ten synthetic v13 cases in
`src/laptop-v13-vectors.json`. The fixture SHA-256 is
`3b10d33a76e5d370044cbdb72c6b2d4f2d269b37923fe76ede372b98b441eda7`.
Contract support does not itself authorize publishing new Registry templates.

## Public verification

```ts
import {
  validateCatalogManifest,
  validateCatalogSnapshot,
  verifySignedCatalogArtifact,
} from '@homelab-inventory/catalog-protocol'
```

Use the package to select a configured public key by key ID, verify Ed25519
signatures, validate artifact hashes and size limits, reject unsupported
contract versions, and preserve exact historical template revisions.

## Trust boundary

Configure only Registry public verification keys in consuming applications.
Registry private signing keys must remain mounted only in the Registry
publication worker. Installing this package confers no signing authority and
must not be used as a reason to copy signing keys into Homelab Inventory,
LabGD, or another viewer.

The module exports the protocol's signing-compatible canonicalization
primitives because publishers and verifiers must produce the same bytes. Key
custody, authorization, and publication remain separate operational concerns.

## Compatibility

The catalog protocol is a wire contract shared by Homelab Inventory and the
official Registry. A fingerprint version defines the complete normalization,
sanitization, identity, and content-hash behavior for that version.

## Compatibility rules

- Never change hash-affecting behavior while retaining the same
  `FINGERPRINT_VERSION`.
- The fingerprint-v2 conformance test contains immutable canonical output and
  hashes from official catalog revision 3. Do not update those expectations to
  accommodate a behavior change.
- A future normalization change must add a new fingerprint implementation and
  preserve the old implementation for clients or stored records that still use
  it.
- Fingerprint v3 separates product-family identity from motherboard or complete
  topology evidence. Fingerprint-v2 hashes remain valid aliases and must never
  be recomputed with v3 rules.
- Fingerprint v8 identifies one physical RAM stick by canonical manufacturer
  and exact manufacturer part number. Capacity, speed, rank, voltage, physical
  form factor, electrical module type, and ECC state remain revisioned content.
- RAM contract v8 keeps `formFactor` (`DIMM` or `SO-DIMM`) independent from
  `moduleType` (`UDIMM`, `RDIMM`, or `LRDIMM`) and requires structured memory
  requirements to remain consistent with known specifications.
- Variant identity must not include installed components, local device names,
  assignments, topology relationships, or the role a user gives the machine.
- Registry publication must use a fingerprint implementation already shipped
  by the supported Homelab Inventory release channel.
- Both repositories must pass the same conformance vector before an application
  release or catalog publication.

These rules make protocol incompatibility a CI or publication failure instead
of allowing an incompatible signed catalog to replace a client's last-known-good
snapshot.
