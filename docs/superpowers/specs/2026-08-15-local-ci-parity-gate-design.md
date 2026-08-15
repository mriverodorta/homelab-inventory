# Local CI Parity Gate

## Problem

The local release pipeline validates the final container and its security posture, but it does not prove that the exact release commit passes every command in GitHub CI. The pre-push hook currently accepts a valid two-platform security receipt without requiring Rust formatting, all-target Clippy, Rust tests, the complete application test suite, or the engine benchmark.

This split has produced preventable failed GitHub runs after publication. The five most recent failed `main` CI runs consisted of two Rust Clippy failures and three release-note test failures. GitHub also selects the latest Bun release while the application image pins Bun 1.3.14, allowing toolchain drift.

## Goal

No code-driven CI failure should first be discovered after a push to `main` or `stable`. The local machine and GitHub must execute the same repository-owned validation command with pinned toolchains. A push to either protected release branch must be rejected unless the exact committed revision has a successful local CI receipt and, for Docker publication, the existing security receipt.

External GitHub service, runner, network, or action failures remain outside this guarantee.

## Shared Validation Command

Add a repository-owned `bun run ci:verify` command. It runs these checks in fail-fast order:

1. Frozen dependency installation.
2. Pinned agent source verification.
3. Structured release-note validation.
4. Rust formatting check.
5. Rust Clippy for the workspace and all targets with warnings denied.
6. Rust workspace tests.
7. WASM build.
8. Frontend and server lint.
9. Complete application, authentication, and SQLite test suites.
10. Production build.
11. Engine benchmark.

The command owns command ordering and failure reporting. GitHub Actions invokes this command rather than maintaining a second manually synchronized command list.

## Toolchain Parity

- Pin GitHub Actions to Bun 1.3.14, matching the runtime and release builds.
- Keep Rust pinned to 1.94.1 with `rustfmt`, `clippy`, and `wasm32-unknown-unknown`.
- Continue using the frozen Bun lockfile and committed Cargo lockfile.
- Keep GitHub setup actions responsible only for installing the pinned toolchains and checking out submodules.

The local gate checks the installed Bun and Rust versions before validation and fails with an actionable message when they do not match.

## Revision-Bound Receipt

After `ci:verify` succeeds, write a private receipt outside the repository under the existing Homelab Inventory Release support directory. The receipt records:

- Git commit SHA.
- Validation contract version.
- Bun and Rust versions.
- Agent submodule revision.
- Hashes of the validation script, package manifest, Bun lockfile, Cargo manifests/lockfile, Rust toolchain file, and GitHub CI workflow.
- Completion timestamp.

Receipt verification requires:

- The receipt revision equals the pushed commit.
- No tracked file differs from that commit.
- The submodule state is clean and matches the commit.
- Every recorded contract hash still matches.
- The receipt was produced by the current validation contract.

Untracked local tooling directories do not invalidate a receipt and are never committed.

## Push And Release Integration

The release `prepare` command runs `ci:verify` before taking a live snapshot or building an OCI candidate. Any failure stops before data synchronization, image construction, Docker Hub publication, or GitHub push.

The pre-push hook handles `main` and `stable` as follows:

1. Verify the revision-bound CI receipt.
2. Verify the existing release security receipt.
3. Reject the push if either receipt is missing, stale, or for another revision.

The hook must not silently replace a missing CI receipt with only the container security scan. A direct protected-branch push tells the operator to run `bun run ci:verify`; the release workflow performs it automatically.

Other branches retain normal push behavior. Pull requests still run GitHub CI using the same shared command.

## Release-Note Regression

Replace brittle tests that hardcode the previous release as the first structured note. Tests should derive the package version dynamically, require exactly one current release entry, verify descending semantic-version order, and assert known historical entries by lookup rather than array position.

## Failure Handling

- Every shared validation phase prints its name and exact command before execution.
- The first failed phase exits nonzero and no receipt is written.
- An existing receipt for that revision is removed before validation starts, preventing an old pass from surviving a failed rerun.
- Receipt verification explains whether revision, tracked files, submodule state, toolchain, or contract files became stale.
- GitHub retains the benchmark artifact upload after the shared validation command succeeds.

## Tests

Add focused tests proving:

- The shared command contains every required CI phase in order.
- GitHub invokes the shared command and pins Bun 1.3.14.
- A matching clean revision accepts its receipt.
- Missing, stale-revision, changed-contract, dirty-tracked-file, and dirty-submodule receipts are rejected.
- Failed validation does not leave a usable receipt.
- Untracked files do not invalidate an otherwise current receipt.
- Release preparation invokes CI verification before snapshot or image work.
- The pre-push hook requires both CI and security receipts for `main` and `stable`.
- Structured release-note tests remain valid across future version bumps.

## Release Discipline

This is release tooling and test hardening. It does not change application runtime behavior, does not bump the app version, and uses `[skip release-notes]` when committed.
