# Catalog Protocol Single-Source Reconciliation Design

## Status

Approved for specification on 2026-08-21. Implementation and publication have
not started.

## Problem

`@homelab-inventory/catalog-protocol@0.1.0` is public, but the Registry still
resolves `@homelab-inventory/catalog-protocol` from its own `workspace:*`
package. The two source trees differ in protocol-significant behavior,
including canonical units, contract vectors, sanitization, topology
projection, hashing, physical M.2 handling, and exported names.

The Registry copy currently produces the signed public catalog. Replacing it
with `0.1.0` without reconciliation could change deterministic hashes or reject
catalog data that the Registry already published. Keeping two copies would
allow the same divergence to recur.

## Decision

The package in the public Homelab Inventory repository becomes the only source
tree for the catalog protocol.

- Homelab Inventory continues authoring the workspace package at
  `packages/catalog-protocol`.
- The Registry becomes an exact npm consumer of
  `@homelab-inventory/catalog-protocol@0.1.1`.
- The Registry's `packages/catalog-protocol` directory is removed after the
  exact npm package passes all Registry checks.
- LabGD and other external consumers use exact versions and npm integrity
  evidence. They receive no private signing material.
- Protocol changes after `0.1.1` are authored once in Homelab Inventory and
  released before consumers adopt them.

No application, Registry, or LabGD deployment is part of this reconciliation.

## Reconciliation Authority

The merged package must satisfy two authorities simultaneously:

1. Registry frozen vectors and signed historical catalog behavior define
   deterministic hashing, identity, content, signature, and publication
   compatibility.
2. Homelab Inventory fixtures and tests define accepted runtime parsing,
   canonical field preservation, evaluator-facing types, and application
   compatibility behavior.

Neither source tree is copied wholesale over the other. For each differing
module, behavior is merged deliberately. If a signed Registry vector conflicts
with an application requirement and both cannot pass unchanged, publication is
blocked until the conflict is explicitly resolved. Existing signed artifacts
are never regenerated or modified to accommodate the package.

## Public API Compatibility

`0.1.1` is a patch release and must preserve every root export available in
`0.1.0`.

- The physical M.2 implementation uses one canonical internal module.
- Registry-facing `M2_PHYSICAL_*` names become canonical.
- Existing `M2_AE_*` exports remain compatibility aliases with identical
  values and behavior.
- Application-only physical M.2 compatibility helpers remain available when
  they are protocol-level and do not depend on application state.
- No private Registry importer, database, signing-key, or publication-worker
  behavior enters the public package.
- The package remains source-distributed TypeScript, ESM, side-effect free,
  MIT licensed, and restricted to the current file allowlist.

## Module Reconciliation

The reconciliation covers every differing protocol module:

- `canonical-units.ts`: preserve v9-v11 canonical unit and optional-field
  semantics required by both repositories.
- `contract.ts`: freeze the union of historical v2-v12 vectors, including the
  Registry's authoritative v7, v10, v11, and v12 expected hashes.
- `hash.ts`: retain Registry-compatible identity/content projection while
  preserving `0.1.0` exports.
- `m2-physical.ts`: become the single physical M.2 canonicalizer and hash
  projector.
- `m2-ae-compatibility.ts`: remain a focused public compatibility evaluator
  when its behavior is independent of Homelab Inventory persistence.
- `projector.ts`: preserve Registry signed-catalog identities across every
  fingerprint version and the application's supported hardware classes.
- `sanitize.ts`: preserve unknown public fields and all version-specific
  optional/empty/absent distinctions.
- `types.ts`: expose the union required by Registry, Homelab Inventory, and
  LabGD without loosening validation.
- `index.ts`: export the canonical API plus patch-compatible aliases.

The Registry's package tests and canonical item vectors are copied into the
public package where they become permanent regression coverage. Duplicate tests
may be consolidated only when their assertions remain explicit and equivalent.

## Determinism Evidence

Before changing the Registry dependency, the current Registry workspace package
is treated as the reference implementation for published catalog behavior.
The reconciled local `0.1.1` candidate must prove:

- every Registry canonical vector produces the same canonical item, identity
  hash, and content hash;
- every Homelab Inventory package fixture remains accepted and round-trips
  without field loss;
- v12 absent, explicit-empty, and populated `availableBuses` states remain
  distinct;
- all historical identity aliases remain unchanged;
- signed snapshot, manifest, digest-index, and offline-bundle round trips
  remain deterministic;
- publicly available signed historical catalog revisions validate without
  rewriting their bytes;
- a second projection or validation pass is idempotent.

The candidate tarball, not a workspace symlink, is installed into a clean
Registry verification checkout before publication. This proves the packaged
artifact behaves like the source tree.

## Publication Sequence

1. Add cross-repository failing vectors to the public package.
2. Reconcile the source modules until both repositories' protocol suites pass.
3. Bump only the package version from `0.1.0` to `0.1.1`.
4. Update the Homelab Inventory unreleased release notes, changelog, package
   README, and publication receipt.
5. Produce one audited npm tarball and record its file allowlist, sizes, SHA-1,
   SHA-256, and SHA-512 integrity.
6. Install that tarball into the Registry without using its workspace package.
7. Run package, Homelab Inventory, Registry, build, migration, and container
   security gates.
8. Publish the exact audited tarball as public `0.1.1`.
9. Download it from npm and prove byte-for-byte identity with the audited
   tarball.
10. Verify a clean external install and real Ed25519 artifact verification.
11. Change the Registry dependency to exact `0.1.1`, regenerate its frozen
   lockfile, remove its duplicate package and Docker workspace-copy steps, and
   rerun all Registry gates.
12. Commit the Registry consumer migration only after all checks pass.

If any check fails after npm publication, the Registry remains on its existing
workspace implementation until a subsequent corrected package version passes;
the failed immutable npm version is never silently substituted.

## Registry Build Changes

The Registry root manifest changes from `workspace:*` to exactly `0.1.1`.
The lockfile must contain the npm SHA-512 integrity. Dockerfiles and build
contexts stop copying `packages/catalog-protocol`. Tests and source imports use
only the package name; direct imports from `../packages/catalog-protocol/src`
must be removed. Frozen installs must work from a clean checkout with no local
protocol package directory.

## Validation Gates

Homelab Inventory must pass:

- standalone catalog package typecheck;
- catalog protocol tests and public-package audit;
- `bun run lint`;
- `bun run test`;
- `bun run build`;
- `bun run security:container`.

The Registry must pass, first against the candidate tarball and then against
the published exact npm version:

- frozen dependency installation;
- protocol contract assertion;
- all Registry tests, including importer, publisher, signature, and historical
  vector coverage;
- lint;
- server and admin builds;
- migration and startup verification;
- final container build and vulnerability checks required by the Registry.

The final package evidence must include:

- exact version and npm URL;
- source commit;
- file allowlist and archive sizes;
- SHA-1, SHA-256, and SHA-512 integrity;
- downloaded-tarball byte comparison;
- clean external consumer verification;
- Registry exact-lock integrity;
- signed historical artifact verification results.

## Failure Handling

- A vector mismatch blocks package publication.
- A packaged-tarball mismatch blocks package publication.
- A Registry test or build failure blocks removal of the workspace package.
- A vulnerability at any severity blocks publication or consumer migration.
- npm authentication or 2FA failure leaves the audited tarball unpublished and
  does not alter Registry dependencies.
- No signing key is copied into the package or test fixtures.
- Existing signed Registry revisions remain immutable throughout the work.

## Cleanup

All candidate tarballs, clean-consumer directories, temporary Registry
checkouts, generated build output, scanner images, and Docker build cache are
removed after verification. Persistent Docker volumes are preserved. The
existing untracked `.superpowers/` directory in Homelab Inventory remains
untouched.

## Completion Criteria

The reconciliation is complete when:

- npm serves `@homelab-inventory/catalog-protocol@0.1.1` with recorded immutable
  integrity;
- the public package satisfies the complete Homelab Inventory and Registry
  protocol contract;
- the Registry has no local catalog protocol source tree;
- the Registry pins exact `0.1.1` and its lockfile records npm integrity;
- clean Registry builds and all deterministic historical checks pass;
- no application or Registry production state was modified;
- temporary and build artifacts have been cleaned.
