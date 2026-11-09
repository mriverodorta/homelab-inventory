# Registry Follow-up: Laptop Hardware Class

## Coordinated v13 Update

The initial protocol-gap assessment below is superseded by the frozen Laptop v13 agreement (CONTRACT SHA-256 `6387d9490f2077c44244a679eaf6a93c5d34e3604089d56ceec2c557658fdd82`). Catalog Protocol 0.2.0 implements the shared canonicalizer and ten frozen vectors. Registry publication must remain gated until the actual npm artifact and both consumers are verified; a local candidate is not publication evidence.

The app maps canonical `laptop` records to numeric `server` inventory identities with `hardwareClass: laptop`. Migrations 0038 and 0039 preserve existing data and make laptop resource semantic keys collection-scoped. No existing desktop or server is automatically reclassified. Fixed components remain embedded and nonassignable. Power endpoints require explicit topology. Historical fingerprints remain unchanged.

## Original Assessment

The application adds local `hardwareClass: "laptop"` to compute hosts stored under the existing numeric `server` inventory category. `usageRole` remains independent; Mini/Micro/Tiny are chassis form factors, and DIMM/SO-DIMM/Onboard are memory form factors. Do not infer RAM packaging or component replaceability from the physical class.

The current Catalog Protocol does not support a `laptop` template type. Application contribution projection therefore produces an unsupported laptop candidate instead of silently converting it to desktop. No published protocol, fingerprint, signed artifact or Registry repository was modified for this local feature.

Before enabling laptop catalog publication, agree on the canonical laptop template type and version gate, validation and identity semantics, digest/snapshot/offline representations, applicable compatibility resources (including fixed components), and shared Catalog Protocol fixtures. Then publish the compatible protocol package and update both consumers together. Preserve all existing template hashes and aliases. Do not automatically reclassify existing desktop templates by name, form factor or memory type.

Existing Mini/Micro desktop templates and DIMM/SO-DIMM RAM templates require no change for this application feature.
