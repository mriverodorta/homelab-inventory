# Catalog protocol compatibility

The catalog protocol is a wire contract shared by Homelab Inventory and the
official registry. A fingerprint version defines the complete normalization,
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
- Registry publication must use a fingerprint implementation already shipped
  by the supported Homelab Inventory release channel.
- Both repositories must pass the same conformance vector before an application
  release or catalog publication.

These rules make protocol incompatibility a CI or publication failure instead
of allowing an incompatible signed catalog to replace a client's last-known-good
snapshot.
