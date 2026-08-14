# Release Process

GitHub is the source of truth for source history and CI. Docker Hub receives exact locally staged OCI candidates from the maintainer's Mac; GitHub Actions does not build or publish release images.

## Channels

| Source | Docker tag | Purpose |
| --- | --- | --- |
| `main` branch | `latest` | Fast-moving development image. Can be unstable. |
| `stable` branch | `stable`, `X.Y.Z`, `X.Y` | Recommended channel plus immutable and minor-series release images. |
| Local guarded backfill | `X.Y.Z`, `X.Y` | Guarded restoration from an exact locally validated historical candidate. |

## Normal Flow

1. Finalize the version, changelog, and structured release notes on `main`.
2. Run `bun run release:local prepare`. This obtains a fresh consistent live snapshot, sanitizes it, builds only ARM64, performs zero-vulnerability scans and smoke tests, and starts staging at `127.0.0.1:8799`.
3. Test the production-shaped staging app and run `bun run release:local approve`.
4. Run `bun run release:local publish --channel latest --dry-run` to build and validate AMD64 and assemble the exact two-platform index in a disposable local registry.
5. Run `bun run release:local publish --channel latest` to upload those same OCI candidates, move `latest`, remove the temporary candidate tags, and push the approved `main` revision.
6. When that commit is ready for stable promotion, check out `stable`, fast-forward it to the approved revision, and reuse the retained candidate state.
7. Run `bun run release:local publish --channel stable`; it moves `stable`, publishes immutable `X.Y.Z`, updates `X.Y`, and creates the verified Git tag and GitHub Release.

The final runtime is pinned to a reviewed Bun distroless multi-architecture digest. Build stages may use larger toolchain images, but their operating-system packages are not copied into the published runtime.

## Immutability Guards

- An existing `vX.Y.Z` tag must already point to the commit being promoted, otherwise publication fails.
- An existing `X.Y.Z` Docker image is never overwritten.
- Re-running a stable build for an already released commit refreshes only `stable`.
- The `X.Y` alias intentionally moves to the newest verified stable patch in that minor series.

## Historical Backfill

The previous GitHub Docker Backfill writer is disabled. A historical release must be checked out locally, validated against the bounded historical release map, and run through the same ARM64-first exact-artifact pipeline. It must never move `latest` or `stable` unless that is a separately approved channel operation.

Docker Hub authentication comes from Docker Desktop's credential store. GitHub tag and release operations use the authenticated `gh` CLI. Tokens are not accepted as release-command arguments or stored in receipts.

Architecture-specific candidate tags exist only while Docker Hub assembles and verifies the final multi-platform index. Successful publication deletes those temporary tag records while retaining the local OCI archives and validation receipts. `bun run release:local cleanup-candidates` removes any candidate aliases left by an interrupted or older release.

## Recommended Deployment Tag

Use `stable` in production Compose files:

```yaml
image: mriverodorta/homelab-inventory:stable
```

Use `latest` only when you intentionally want the newest development image from `main`.
