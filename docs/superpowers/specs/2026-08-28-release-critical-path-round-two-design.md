# Release Critical Path Round Two Design

## Context

The optimized local `latest` dry run at commit `d911ccb` completed its measured
critical path in 154.515 seconds. The remaining dominant phases were:

| Area | Duration | Share |
| --- | ---: | ---: |
| Local CI | 50.998 seconds | 33.0% |
| ARM64 and AMD64 builds | 42.281 seconds | 27.4% |
| ARM64 and AMD64 validation | 44.073 seconds | 28.5% |
| Live snapshot and other preparation | 17.163 seconds | 11.1% |

Rust verification and the canonical WASM and Agent builds were already reused.
The next optimization must preserve the cold image-build policy, exact OCI
artifacts, dual-scanner zero-vulnerability gate, manual ARM64 approval, and
post-release disk cleanup.

## Goals

1. Run independent application test families concurrently without weakening
   failure reporting or source-bound CI receipts.
2. Eliminate the temporary local Registry from the normal candidate-loading
   path while proving the loaded runtime image is the image represented by the
   immutable OCI candidate.
3. Keep the BuildKit builder temporarily between ARM64 staging and AMD64
   publication, while deleting its build cache and removing all retained state
   after publication, reset, cancellation, or failure.
4. Re-run the complete `latest --dry-run` release and compare every measured
   phase with the 154.515-second baseline.

## Non-goals

- Do not introduce reusable Docker layer caches.
- Do not skip tests, security scanners, SBOMs, provenance, smoke tests, or live
  staging probes.
- Do not publish to Docker Hub, push Git branches, create GitHub releases, or
  change production during implementation verification.
- Do not retain compiler output, candidate archives, scanner data, anonymous
  Registry volumes, or BuildKit cache after verification.

## Design

### 1. Supervised parallel test families

The existing `test` command runs three independent families sequentially:
Vitest, Bun authentication tests, and Bun SQLite/release tests. Introduce a
small CI test supervisor and explicit package scripts:

- `test:vitest`: the existing Node-options-scoped Vitest run.
- `test:bun`: authentication followed by SQLite/release tests.
- `test`: the supervisor starts `test:vitest` and `test:bun` concurrently.

Each child receives the same repository root and inherited environment. Output
is written to private task-scoped log files so concurrent output is readable.
On success, the supervisor prints each family duration and a concise result. On
the first failure, it terminates the sibling, waits for bounded shutdown, prints
both logs, exits nonzero, and writes no CI receipt. The temporary log directory
is removed in a `finally` block on success, failure, or interruption.

The supervisor must work under Bun on macOS and Linux. Tests cover successful
parallel execution, failure propagation, sibling termination, environment
forwarding, duration reporting, and cleanup. Existing direct `test:auth` and
`test:sqlite` commands remain available for focused development.

### 2. One BuildKit solve, two verified outputs

The preferred candidate build uses one cold BuildKit solve with two exporters:

1. The canonical OCI archive with provenance and SBOM attestations.
2. A Docker exporter that loads the runnable platform image directly into the
   local Docker daemon under the candidate tag.

The immutable OCI archive remains the only publishable artifact. The Docker
export exists only for smoke tests and scanners. The implementation must parse
the OCI archive and prove the loaded image corresponds to the selected runtime
descriptor:

- Verify the top-level candidate digest and every traversed blob digest.
- Select exactly one descriptor matching the requested OS and architecture,
  excluding attestation descriptors.
- Verify the loaded Docker image ID equals the selected OCI config digest.
- Compare OCI config `rootfs.diff_ids` with Docker `RootFS.Layers` exactly.
- Compare OS, architecture, version, revision, and release-channel labels.

If the installed Buildx/Docker combination cannot produce both outputs in one
solve, the implementation may attempt native OCI archive loading and apply the
same proof. If neither direct path can satisfy every identity check, it must
fail closed to the existing local-Registry path.

The Registry fallback uses a tmpfs mount for `/var/lib/registry`, preventing
anonymous data volumes. The normal supported Docker Desktop path must create no
Registry container and no Registry volume. Tests use synthetic OCI layouts to
cover valid identity, wrong architecture, altered config, altered layers,
attestation exclusion, and ambiguous platform descriptors.

### 3. Temporarily warm BuildKit runtime

ARM64 preparation recreates the release builder once to guarantee a cold build.
After the ARM64 candidate is exported, the release process prunes all BuildKit
records with `docker buildx prune --builder homelab-release --all --force` but
keeps the builder container and its approximately 241 MB runtime image while
the candidate awaits approval. AMD64 uses that existing builder with
`--no-cache`; it does not recreate or bootstrap a second builder.

Retention is represented explicitly through cleanup options rather than by
silently omitting cleanup. While awaiting approval:

- Preserve the builder runtime and Trivy database.
- Remove BuildKit build records, Scout cache, temporary smoke resources, and
  any local Registry resources.
- Keep the approved ARM64 candidate and current sanitized snapshot.

On publication success, publication failure, reset, cancellation, or explicit
local cleanup:

- Remove the builder and its volume.
- Remove candidate images, candidate archives when the run is reset, scanner
  images and database, generated output, and all release-owned cache.
- Preserve only the current sanitized rsync base, canonical WASM/Agent artifact
  store, tools, and immutable receipts.

### 4. Timing and diagnostics

Add subphase timing for the two test families and distinguish candidate export,
runtime identity proof, smoke test, vulnerability database update, and scanner
execution inside architecture validation. Existing top-level timing receipts
remain backward compatible and continue to avoid command output, paths with
secrets, and error text.

The final report compares:

- Local CI against 50.998 seconds.
- Combined candidate builds against 42.281 seconds.
- Combined candidate validation against 44.073 seconds.
- Complete measured critical path against 154.515 seconds.
- Retained disk while awaiting approval and disk after cleanup.

## Failure Handling

- Any test-family failure cancels its sibling and prevents a CI receipt.
- Any OCI identity mismatch prevents smoke testing and scanning.
- An unsupported direct exporter uses the verified fallback; a failed identity
  proof never falls back after loading an untrusted image under the release tag.
- Builder pruning failure blocks approval because retained cache would violate
  the cold-build and disk-boundary policy.
- Every exit path stops task containers and removes release-owned temporary
  files. Cleanup errors are reported without replacing the original failure.

## Verification

1. Run focused unit tests for the test supervisor, OCI projector/verifier,
   builder lifecycle, Registry tmpfs fallback, timing receipts, and cleanup.
2. Run `bun run lint`, `bun run test`, and `bun run build`.
3. Run `bun run security:container` for AMD64 and ARM64 with zero findings.
4. Run a complete live-snapshot `latest --dry-run` release without publication.
5. Confirm both candidate digests, runtime identity proofs, smoke tests, SSE
   staging probe, Scout, Trivy, and dry-run OCI index validation pass.
6. Confirm no local Registry resource exists on the normal path.
7. Confirm the builder exists with zero reclaimable build records while ARM64
   awaits approval, then is absent after final cleanup.
8. Confirm only the pre-existing Docker volumes, including
   `sehmadocker_mysql`, remain after cleanup.

## Acceptance Criteria

- All existing verification remains mandatory and passes.
- The publishable OCI archives are byte-verified before and after validation.
- The loaded runtime image has exact config and rootfs identity with the OCI
  platform descriptor.
- Test families run concurrently and leave no logs or child processes.
- AMD64 reuses the waiting builder without reusable build layers.
- No normal-path local Registry container or volume is created.
- The final critical path is faster than 154.515 seconds; the target is at most
  140 seconds under comparable network conditions.
- Final cleanup leaves zero task-created volumes, containers, candidate images,
  candidate archives, generated trees, or reclaimable release build cache.
