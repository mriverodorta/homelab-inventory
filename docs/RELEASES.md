# Release Process

GitHub is the source of truth for CI/CD. Docker Hub receives images from GitHub Actions.

## Channels

| Source | Docker tag | Purpose |
| --- | --- | --- |
| `main` branch | `latest` | Fast-moving development image. Can be unstable. |
| `stable` branch | `stable` | Recommended image for normal deployments and Watchtower. |
| `vX.Y.Z` tag | `X.Y.Z`, `X.Y` | Immutable release images for pinned deployments. |

## Normal Flow

1. Open pull requests into `main`.
2. CI runs lint, tests, and production build.
3. Merge into `main` when ready.
4. GitHub Actions publishes `mriverodorta/homelab-inventory:latest`.
5. When `main` is considered safe, merge or fast-forward it into `stable`.
6. GitHub Actions publishes `mriverodorta/homelab-inventory:stable`.
7. For a named release, create a tag such as `v0.2.0`.
8. GitHub Actions publishes semver Docker tags and creates a GitHub Release.

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
