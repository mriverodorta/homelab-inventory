# Local Staged Release Pipeline Design

## Goal

Move Homelab Inventory Docker release construction and publication from GitHub Actions to the maintainer's Apple Silicon Mac. Every release must first run locally against a sanitized copy of current production data, pass the existing zero-vulnerability policy, and receive explicit manual approval. Docker Hub must receive the exact OCI image manifests that passed local validation; publication must never rebuild them.

This document designs the workflow only. It does not change release automation, bump the application version, publish an image, modify production, or replace the existing mandatory security policy.

## Principles

- Production is always read-only to the staging workflow.
- Ordinary local development data is never used or replaced.
- Staging uses a current, consistent production snapshot on every preparation.
- Authentication and every external side effect are disabled in staging.
- ARM64 is built and tested first because it runs natively on the Mac.
- AMD64 is deferred until the ARM64 candidate receives manual approval.
- Each architecture is built once. The tested OCI manifests are the published manifests.
- A source or image-input change invalidates approval and both architecture candidates.
- Release state is local, resumable, auditable, and excluded from Git.
- GitHub continues independent source validation but no longer builds or publishes releases.

## Release Sequence

### Prepare And Stage ARM64

1. Verify the local prerequisites, Git state, release metadata, remote access, and credentials.
2. Create a consistent live-data snapshot on `bolt` without modifying or stopping production.
3. Incrementally transfer the snapshot with `rsync` into a temporary local incoming directory.
4. Sanitize and strictly validate the incoming data.
5. Atomically rotate `current` staging data to `previous` and activate the sanitized incoming snapshot as `current`.
6. Build an immutable `linux/arm64` OCI candidate from the exact Git revision.
7. Run the existing ARM64 security policy, image metadata checks, SQLite runtime proof, and container smoke test.
8. If validation fails because of source, dependencies, Dockerfile, base image, or release metadata, fix the issue and restart preparation from step 1.
9. Load the exact ARM64 OCI candidate into Docker Desktop and run it as `homelab-inventory-staging` on `127.0.0.1:8799`.
10. Run automated staging migration, health, integrity, API, and browser checks.
11. Leave the healthy staging container available for manual testing and stop before publication.

### Approve And Complete The Candidate

1. Record manual approval against the exact Git revision, ARM64 manifest digest, staging-data fingerprint, and completed validation receipt.
2. Lock the release revision. A worktree, commit, submodule, lockfile, Dockerfile, base-image, agent pin, release-note, or build-argument change invalidates approval.
3. Build the immutable `linux/amd64` OCI candidate from the approved revision.
4. Run the same zero-vulnerability, metadata, SQLite, and smoke-test requirements under AMD64 emulation.
5. Retry infrastructure-only failures without invalidating ARM64 approval. Any fix that changes an image input invalidates both candidates and restarts the complete preparation flow.
6. Assemble a multi-platform OCI index that references the exact tested ARM64 and AMD64 manifests.
7. Verify both platform descriptors, OCI labels, version, revision, source, SBOM, provenance, and digest ownership.
8. Upload the exact OCI index and manifests to Docker Hub without invoking a build.
9. Apply channel and version tags according to the requested release operation.
10. Push the approved Git state and create the Git tag and GitHub release where applicable.
11. Persist a final release receipt containing the source revision, architecture and index digests, scan results, staging approval, publication tags, and timestamps.

## Command Surface

One repository-owned Bun entry point owns the state machine. Package scripts expose these commands:

```bash
bun run release:local prepare
bun run release:local status
bun run release:local approve
bun run release:local publish --channel latest
bun run release:local publish --channel stable
bun run release:local logs
bun run release:local stop
bun run release:local reset
bun run release:local warm-cache
```

`prepare` performs preflight, production snapshot creation, incremental transfer, sanitization, ARM64 construction and validation, staging deployment, and automated staging checks. It is safe to rerun and always starts with a fresh consistent production snapshot.

`status` reports the Git revision, app version, snapshot and sanitization state, ARM64 digest and validation, staging URL and health, approval identity, AMD64 state, OCI index digest, and publication state.

`approve` succeeds only for a healthy staging container whose running image, Git revision, sanitized-data fingerprint, and ARM64 receipt all match current state.

`publish` requires valid approval, builds and validates AMD64, assembles and verifies the multi-platform candidate, publishes exact bytes, applies the selected release policy, and writes the final receipt. It never invokes Docker build for ARM64 and never rebuilds a validated AMD64 manifest during upload or tag promotion.

`reset` removes incomplete candidate state but requires explicit confirmation before removing a valid approved or published receipt. `warm-cache` restores pinned build inputs, registry-backed BuildKit cache, and scanner databases after intentional cache removal.

## Local State Layout

Release data lives outside both the repository and Docker Desktop:

```text
~/Library/Application Support/Homelab Inventory Release/
  state.json
  lock
  receipts/
  candidates/<git-revision>/
    arm64/
    amd64/
    index/
  data/
    incoming/
    current/
    previous/
  logs/

~/Library/Caches/homelab-inventory-release/
  buildkit/
  registry-cache-metadata/
```

State files are written atomically. The release lock prevents two prepare or publish operations from changing candidate state concurrently. Candidate directories are immutable after their digest receipt is written. No production data, identity, credential, scan artifact, or release state is committed.

## Production Snapshot And Incremental Transfer

The workflow must not `rsync` active SQLite database, WAL, or shared-memory files directly. On `bolt`, it creates a temporary internally consistent snapshot with SQLite's online backup mechanism or the application's verified backup service. Immutable catalog artifacts and other required runtime files are copied into the same temporary snapshot boundary.

The temporary remote snapshot contains no changes to the live stack. Before transfer, the workflow creates an APFS clone of local `current` as the new `incoming` baseline when `current` exists; otherwise it creates an empty incoming directory. `rsync --delete` then transfers only changed content from the stable remote snapshot over that private baseline. This preserves atomic activation while avoiding a complete download on every preparation. The remote temporary directory is removed after transfer whether the local workflow succeeds or fails.

Every preparation requests a new snapshot. Incremental transfer is an optimization, not permission to reuse a stale live snapshot. The snapshot manifest records source host alias, creation time, database integrity results, schema and contract versions, file sizes, and content hashes without storing private values.

## Staging Data Boundary

The staging copy retains realistic state required for migrations, startup performance, and user-flow verification:

- core inventory, projects, workspaces, assignments, placements, and connections;
- cable bends and disposable routing cache;
- catalog database, signed catalog artifacts, Registry links, and catalog-link state;
- Agent projections and telemetry history;
- notification policy and incident history without usable destination credentials;
- authentication structure only long enough to validate migration, after which authentication is disabled.

Sanitization removes or neutralizes all environment-owned or externally active state:

- Registry installation UUID, Ed25519 private key, and credentials;
- Agent enrollment secrets, credentials, and active registrations;
- notification encryption keys, webhook destinations, and contact credentials;
- backup passphrases and stored backup archives;
- authentication password credentials, sessions, OIDC secrets, and active login state;
- automatic Registry contributions and enrollment or recovery operations;
- notification and webhook delivery;
- Agent enrollment, heartbeat mutation, contribution, and release-download operations;
- update checks and other outbound integrations.

Staging environment overrides enforce these restrictions independently of database values. Authentication is disabled by default. Startup fails closed when private production identity material remains, authentication is active, a network listener is not loopback-bound, or an outbound capability can execute.

Sanitization changes only the incoming staging copy. It never writes to production or ordinary repository `./data`.

## Staging Runtime

The ARM64 candidate runs with:

```text
container: homelab-inventory-staging
address:   http://127.0.0.1:8799
data:      .../Homelab Inventory Release/data/current
restart:   no
network:   loopback publication only
```

Preparation replaces the previous staging container only after the ARM64 image and data pass pre-deployment validation. Data activation uses an atomic rotation:

```text
current  -> previous
incoming -> current
```

Only one previous data snapshot is retained. A failed transfer or sanitization leaves `current` and `previous` untouched. A startup or migration failure leaves the failed `current` available for diagnosis and preserves `previous` as the rollback reference; rollback is explicit and never mutates production.

## OCI Construction And Exact Promotion

The dedicated `homelab-release` Buildx builder produces architecture-specific OCI layouts rather than relying on mutable images in Docker Desktop. The ARM64 layout is loaded for local staging only after its immutable digest is recorded. Loading does not become the publication source; the OCI layout remains authoritative.

After AMD64 validation, an OCI index is created from the two manifest descriptors. A pinned OCI-capable registry client uploads blobs and manifests by digest. Docker Hub tags are assigned to the verified index after all referenced blobs exist. No publication step has access to a Docker build action.

The release must include verifiable SBOM and provenance attestations tied to each platform manifest. The final receipt includes every digest necessary to compare the local candidate with Docker Hub after upload.

## Release And Channel Policy

The existing channel model remains authoritative:

- a deployment from `main` moves `latest`;
- a promotion to `stable` moves `stable`;
- stable promotion creates the immutable application version tag, minor alias, Git `v<version>` tag, and GitHub release;
- promotion of the same commit from `latest` to `stable` reuses the previously validated OCI candidates and does not rebuild them;
- an existing immutable Docker or Git tag may be reused only when its revision and trusted metadata match exactly; conflicting ownership fails before mutation.

Channel metadata embedded in an image must not force a rebuild during promotion. The implementation must make release identity channel-neutral or otherwise represent mutable channel state outside immutable platform bytes. Application update checks must retain the same observable latest, stable, and immutable-version behavior.

## Security And Credentials

The existing policy remains mandatory for both architectures:

- final pinned distroless runtime image;
- container boot and health proof;
- SQLite runtime capability proof;
- Docker Scout zero known vulnerabilities at every severity;
- Trivy zero known vulnerabilities at every severity;
- no ignored unfixed findings;
- pinned scanner and build dependencies.

Docker Hub authentication uses Docker Desktop's macOS credential store. GitHub operations use the existing authenticated `gh` CLI and Git transport. Tokens are never accepted as command-line values, persisted in release state, copied into OCI layouts, or printed in logs. Preflight verifies required scopes without exposing secrets.

Sanitized production data remains private local state with restrictive permissions. Logs and receipts record hashes, IDs, revisions, counts, and sanitized errors, never credentials, serials, inventory definitions, or telemetry payloads.

## Cache Strategy And `dclaim`

The existing `~/bin/dclaim` intentionally runs:

```bash
docker buildx prune --all --force
docker system prune --all --force
docker run --rm --privileged --pid=host docker/desktop-reclaim-space
```

The release pipeline therefore cannot rely on Docker Desktop's image store or default BuildKit cache. Its primary reusable BuildKit cache is stored outside Docker Desktop under `~/Library/Caches/homelab-inventory-release`. A registry-backed cache provides recovery when that local cache is intentionally deleted or unavailable. Both caches are content-addressed and bounded by age and storage budget.

OCI candidates, receipts, staging data, and release logs live outside Docker Desktop and survive `dclaim`. The existing named Trivy cache volume also survives because `dclaim` does not prune volumes. `warm-cache` restores pinned base layers, BuildKit cache, agent build inputs, Trivy data, and other required release dependencies after a deliberate deep cleanup.

`dclaim` itself does not need to become less effective. Its final Docker Desktop block reclamation remains useful because release-critical state is outside its deletion boundary.

## Failure And Invalidation Rules

Infrastructure-only failures include transient network interruption, temporary registry unavailability before mutation, remote snapshot transport interruption, or an emulator process failure with unchanged inputs. These may resume from the last verified immutable state.

The following invalidate manual approval and all image candidates:

- Git revision or tracked worktree change;
- submodule or agent-source pin change;
- lockfile, source, generated WASM, Dockerfile, build argument, or base-image digest change;
- application version, changelog, release-note, channel-label strategy, or OCI metadata change;
- ARM64 candidate digest change;
- staging data is refreshed after approval;
- a security policy or scanner database update finds a vulnerability in either candidate.

An AMD64 validation failure caused by the application or image requires a fix and a restart from fresh production snapshot and ARM64 preparation. The release tool cannot publish a partial platform set, a candidate with stale approval, or a tag without a final receipt.

Publication is ordered so immutable manifests are uploaded before mutable tags. If a tag update fails, rerunning publication verifies existing digests and continues idempotently. It never overwrites a conflicting immutable version.

## GitHub Actions Boundary

Automatic Docker construction and publication on `main` and `stable` are removed. GitHub retains:

- source CI, lint, tests, builds, and release-note validation;
- CodeQL and dependency/security checks;
- scheduled vulnerability monitoring of already-published images;
- the existing scheduled published-image security monitor, updated only as necessary to understand locally published release metadata.

Local tooling owns candidate construction, scans, staging, Docker Hub publication, Git tag creation, and GitHub release creation. The Docker Hub publishing credential is no longer needed by the branch-push workflow. Historical/backfill publication must use the same local exact-artifact policy or remain explicitly disabled until migrated.

## Automated Verification

### State Machine Tests

- commands reject missing prerequisites and invalid phase ordering;
- preparation is resumable and idempotent;
- approval binds revision, ARM64 digest, data fingerprint, and health receipt;
- every image-input change invalidates approval;
- infrastructure retries preserve valid immutable work;
- publication cannot invoke a build or publish one architecture;
- conflicting immutable tags fail before mutation;
- interrupted tag promotion resumes without rebuilding.

### Snapshot And Sanitization Tests

- active SQLite and WAL files are never transferred directly;
- online backup produces valid core, telemetry, and catalog databases;
- `rsync` reuses unchanged content while every run obtains a new snapshot manifest;
- production identity, credentials, sessions, and secrets are absent;
- authentication and all outbound effects remain disabled despite copied settings;
- startup refuses unsanitized or externally active data;
- incoming/current/previous rotation is atomic and retains only one rollback copy;
- production and repository development data hashes never change.

### Image And Publication Tests

- ARM64 OCI candidate loads and runs at `127.0.0.1:8799`;
- AMD64 executes under emulation and passes the same runtime proof;
- both Scout and Trivy enforce zero vulnerabilities;
- platform manifests contain identical release identity except platform-specific data;
- SBOM and provenance descriptors are present and digest-bound;
- assembled index references only the two validated manifests;
- Docker Hub digest after upload equals the local index digest;
- latest and stable promotion reuse exact candidate bytes.

### End-To-End Local Proof

Before replacing GitHub publication, run a dry release that does not push Docker tags:

1. prepare from a fresh live snapshot;
2. verify sanitization and production hash preservation;
3. validate and run ARM64 staging;
4. exercise migrations, catalog, projects, canvas, cables, Agents, telemetry, backups, authentication-disabled policy, and settings;
5. record manual approval;
6. build and validate AMD64;
7. assemble the multi-platform OCI index locally;
8. verify receipts and digests;
9. simulate tag and GitHub release planning without remote mutation;
10. run `dclaim`, restore cache with `warm-cache`, and prove candidates, receipts, and staging data survived.

The first real local publication runs with existing GitHub Docker publication disabled to prevent competing release writers.

## Documentation And Release Discipline

Implementation must update development and release documentation with prerequisites, commands, staging safety, cache storage, failure recovery, and credential handling. Docker Hub-facing channel documentation remains aligned.

The workflow change is maintainer-facing and security-relevant. Record it in the Unreleased changelog and structured release-note draft when implemented. Do not bump semver or publish until the user explicitly requests a release. This design-only commit uses `[skip release-notes]`.
