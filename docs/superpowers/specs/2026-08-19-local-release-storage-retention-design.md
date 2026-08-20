# Local Release Storage Retention Design

## Goal

Keep local Homelab Inventory releases fast while preventing Docker BuildKit
state, OCI candidate archives, and exported build caches from growing without
bound.

## Docker-managed storage

The `homelab-release` builder remains the dedicated multi-platform release
builder. `dclaim` prunes it with a 6 GB maximum and 4 GB reserve so recent
layers remain warm. The obsolete `trigger` builder is removed when present.
The selected Docker builder is still fully pruned because it is used for
disposable validation builds.

Builder removal and pruning happen before Docker's normal image cleanup and
filesystem trim. Named application data volumes are never pruned.

## Release artifacts outside Docker

Local release cleanup retains the current release revision and the newest
additional revision. Older candidate archive directories are deleted.
Standard `current`, `previous`, and `incoming` data directories remain
untouched. Nonstandard validation directories are handled only when they are
not mounted by a container and are explicitly selected during the one-time
cleanup.

## External BuildKit caches

Each architecture continues to use a persistent external `mode=max` cache.
A build exports into a new sibling directory, validates success, then swaps
that directory into place. The previous cache is deleted only after the new
cache is complete. This retains cross-cleanup build acceleration without
leaving unreferenced blobs in a reused OCI cache directory.

## Safety and verification

Cleanup reports every removed candidate revision and reclaimed builder. Tests
cover current-revision preservation, newest-previous retention, deterministic
selection, failed-build cache preservation, and successful atomic cache
replacement. Final verification compares Docker accounting, Docker.raw
allocation, release support storage, and external cache storage before and
after cleanup.
