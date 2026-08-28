# Release Process

GitHub is the source of truth for source history and pull-request review. Deployment validation, production-shaped staging, image construction, security scanning, and Docker publication run on the maintainer's Mac. GitHub Actions does not build or publish release images; it retains pull-request CI plus scheduled CodeQL and published-image monitoring.

## Channels

| Source | Docker tag | Purpose |
| --- | --- | --- |
| `main` branch | `latest` | Fast-moving development image. Can be unstable. |
| `stable` branch | `stable`, `X.Y.Z`, `X.Y` | Recommended channel plus immutable and minor-series release images. |
| Local guarded backfill | `X.Y.Z`, `X.Y` | Guarded restoration from an exact locally validated historical candidate. |

## Normal Flow

1. Finalize the version, changelog, and structured release notes on `main`.
2. Run `bun run release:local prepare`. Before contacting the live server, it validates a versioned local CI receipt bound to the exact clean commit, submodule, CI phase contract, pinned toolchains, host platform, and relevant environment. An exact receipt restores and verifies canonical WASM and Agent artifacts in under a second; any missing, malformed, stale, dirty, or mismatched input runs the complete pinned `bun run ci:verify` contract. Independent Vitest and Bun test families run concurrently under one fail-fast supervisor. Verified Rust checks plus portable WASM and Agent artifacts are reused only when their complete source, lockfile, toolchain, packaging, command, and contract fingerprints are unchanged. It then obtains a fresh consistent live snapshot, sanitizes it, builds only ARM64, performs zero-vulnerability scans and smoke tests, and starts staging at `127.0.0.1:8799`.
3. Test the production-shaped staging app and run `bun run release:local approve`.
4. Run `bun run release:local publish --channel latest --dry-run` to build and validate AMD64 and verify the exact two-platform OCI archives directly without uploading them.
5. Run `bun run release:local publish --channel latest` to upload those same OCI candidates, move `latest`, remove the temporary candidate tags, and push the approved `main` revision.
6. When that commit is ready for stable promotion, check out `stable`, fast-forward it to the approved revision, and reuse the retained candidate state.
7. Run `bun run release:local publish --channel stable`; it moves `stable`, publishes immutable `X.Y.Z`, updates `X.Y`, and creates the verified Git tag and GitHub Release.

The final runtime is pinned to a reviewed Bun distroless multi-architecture digest. Build stages may use larger toolchain images, but their operating-system packages are not copied into the published runtime. Rust/WASM and multi-OS Agent bundles are built separately from pinned toolchains, verified by SHA-256 plus their native manifests, and copied byte-for-byte into both architecture image builds.

## Protected Push Gate

Every push to `main` or `stable` must carry two local proofs for the exact commit:

1. `bun run ci:verify` passed the shared GitHub/local validation contract with Bun 1.3.14 and Rust 1.94.1.
2. The retained ARM64 and AMD64 release candidates passed runtime and zero-vulnerability validation.

The pre-push hook rejects missing or stale receipts. It does not substitute a container scan for an incomplete CI run. Ordinary feature branches remain unaffected, and GitHub pull requests rerun the repository-owned CI command as an independent confirmation. Direct pushes to `main` or `stable` do not start a second hosted CI or CodeQL run; CodeQL and published-image monitoring run on their independent schedules.

`bun run release:local status` prints the retained critical-path receipts for local CI, snapshot transfer, sanitization, architecture builds, validation, staging, OCI publication, and Git/GitHub finalization. A trusted CI reuse is reported as `passed-reused`; a complete execution is `passed`. Failed phases record duration and input fingerprint without storing command output or secrets.

## Immutability Guards

- An existing `vX.Y.Z` tag must already point to the commit being promoted, otherwise publication fails.
- An existing `X.Y.Z` Docker image is never overwritten.
- Re-running a stable build for an already released commit refreshes only `stable`.
- The `X.Y` alias intentionally moves to the newest verified stable patch in that minor series.

## Historical Backfill

The previous GitHub Docker Backfill writer is disabled. A historical release must be checked out locally, validated against the bounded historical release map, and run through the same ARM64-first exact-artifact pipeline. It must never move `latest` or `stable` unless that is a separately approved channel operation.

Docker Hub authentication comes from Docker Desktop's credential store. GitHub tag and release operations use the authenticated `gh` CLI. Tokens are not accepted as release-command arguments or stored in receipts.

Architecture-specific candidate tags exist only while Docker Hub assembles and verifies the final multi-platform index. Successful publication deletes those temporary tag records while retaining the local OCI archives and validation receipts. Runtime validation converts the selected OCI manifest into a temporary Docker-load archive, verifies every compressed layer and diff ID, and proves the loaded image config and rootfs before deleting the conversion. A temporary Registry is reserved for unsupported OCI layer compression and uses tmpfs storage. The Trivy database and cache-free BuildKit runtime may remain only between ARM64 approval and AMD64 validation; every BuildKit record is pruned before approval, and final cleanup removes the database, builder, loaded candidates, fallback Registry, and scanner images. `bun run release:local cleanup-candidates` removes any candidate aliases left by an interrupted or older release.

## Recommended Deployment Tag

Use `stable` in production Compose files:

```yaml
image: mriverodorta/homelab-inventory:stable
```

Use `latest` only when you intentionally want the newest development image from `main`.
