# Cold Local Release Cleanup Design

## Goal

Run every Homelab Inventory architecture build without reusable Docker or
external BuildKit cache, then remove release-owned Docker state so Docker.raw
returns to the smallest practical size after each phase.

## Cold build boundary

Each architecture build recreates the dedicated `homelab-release` Buildx
builder and passes `--no-cache --pull`. The build does not read or export an
external BuildKit cache. Any cache directory left by an older workflow is
deleted before the build starts.

## Automatic cleanup

Cleanup runs after ARM64 preparation and after AMD64 publication, including
failed builds. It removes the dedicated builder, the external release cache
directory, Trivy's named cache volume, Docker Scout cached SBOMs, temporary
release registry containers, and locally loaded candidate image tags. The
running ARM64 staging container may retain its referenced filesystem layers
until publication or an explicit stop; successful publication stops staging
before final cleanup.

## Preserved state

Immutable OCI candidate archives, receipts, release state, and the sanitized
staging snapshot remain outside Docker Desktop. They are required to bind user
approval to the exact artifact and to promote the same release to `stable`
without rebuilding it. Unrelated containers, images, networks, and named data
volumes are never selected by release cleanup.

## Manual cleanup

`dclaim` invokes the same project-owned cleanup command, removes unused Docker
objects without pruning volumes, and returns free Docker.raw blocks to macOS.
It must not delete unrelated application database volumes or stop unrelated
running containers.
