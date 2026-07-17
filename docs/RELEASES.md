# Release Process

GitHub is the source of truth for CI/CD. Docker Hub receives images from GitHub Actions.

## Channels

| Source | Docker tag | Purpose |
| --- | --- | --- |
| `main` branch | `latest` | Fast-moving development image. Can be unstable. |
| `stable` branch | `stable`, `X.Y.Z`, `X.Y` | Recommended channel plus immutable and minor-series release images. |
| Manual backfill | `X.Y.Z`, `X.Y` | Guarded restoration of a historical release from its original commit. |

## Normal Flow

1. Open pull requests into `main`.
2. CI runs lint, tests, and production build.
3. Merge into `main` when ready.
4. GitHub Actions publishes `mriverodorta/homelab-inventory:latest`.
5. When `main` is considered safe, merge or fast-forward it into `stable`.
6. GitHub Actions publishes `mriverodorta/homelab-inventory:stable`.
7. When the package version has not been released before, the same verified build also publishes immutable `X.Y.Z` and moving `X.Y` tags.
8. After both Docker architectures and metadata are verified, automation creates `vX.Y.Z` and the matching GitHub Release.

## Immutability Guards

- An existing `vX.Y.Z` tag must already point to the commit being promoted, otherwise publication fails.
- An existing `X.Y.Z` Docker image is never overwritten.
- Re-running a stable build for an already released commit refreshes only `stable`.
- The `X.Y` alias intentionally moves to the newest verified stable patch in that minor series.

## Historical Backfill

The manual `Docker Backfill` workflow accepts a strict `X.Y.Z` version and the full original Git revision. The pair must match the repository's bounded historical release map. It validates the structured release note, builds that historical source with current OCI metadata, publishes only `X.Y.Z` and `X.Y`, verifies amd64 and arm64, and then creates the Git tag and GitHub Release. It never changes `latest` or `stable`.

## Required GitHub Secret

The Docker publishing workflow requires this repository secret:

```txt
DOCKERHUB_TOKEN
```

Create a Docker Hub access token for `mriverodorta`, then add it:

```bash
gh secret set DOCKERHUB_TOKEN --repo mriverodorta/homelab-inventory
```

Paste the token when prompted.

## Recommended Deployment Tag

Use `stable` in production Compose files:

```yaml
image: mriverodorta/homelab-inventory:stable
```

Use `latest` only when you intentionally want the newest development image from `main`.
