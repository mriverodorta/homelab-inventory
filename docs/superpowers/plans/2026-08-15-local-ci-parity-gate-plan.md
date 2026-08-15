# Local CI Parity Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent code-driven GitHub CI failures from being discovered after a `main` or `stable` push by requiring the exact commit to pass the same repository-owned CI command locally first.

**Architecture:** A focused CI contract module defines the ordered checks, executes them, and writes a commit-bound receipt outside the repository. GitHub invokes the same command, while release preparation and the pre-push hook verify the receipt before any remote snapshot, image publication, or protected-branch push.

**Tech Stack:** Bun 1.3.14, Rust 1.94.1, Bun test, Git hooks, GitHub Actions, existing local release support storage.

## Global Constraints

- Do not bump the application version or publish Docker images.
- Pin GitHub Bun to 1.3.14 and Rust to 1.94.1.
- Preserve the existing two-platform zero-vulnerability release receipt.
- Ignore untracked files when proving a committed revision; reject tracked or submodule changes.
- Store CI receipts outside the repository in the existing Homelab Inventory Release support directory.
- Mark commits with `[skip release-notes]` because this changes release tooling only.

---

### Task 1: Shared CI Contract And Runner

**Files:**
- Create: `scripts/ci/contract.mjs`
- Create: `scripts/ci/run.mjs`
- Create: `scripts/ci/contract.bun_spec.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `CI_CONTRACT_VERSION`, `CI_PHASES`, `runCiVerification(options)`, and `bun run ci:verify`.
- Consumes: existing package scripts and pinned repository toolchain files.

- [ ] Write contract tests asserting the exact fail-fast order: frozen install, agent pin, release notes, Rust format, all-target Clippy, Rust tests, WASM, lint, tests, build, benchmark.
- [ ] Run `bun test scripts/ci/contract.bun_spec.mjs` and confirm it fails because the module does not exist.
- [ ] Implement immutable phase definitions and sequential inherited-output execution with clear phase banners.
- [ ] Register `ci:verify` and include `scripts/ci/*.bun_spec.mjs` in the standard Bun suite.
- [ ] Run the focused test and confirm it passes.

### Task 2: Commit-Bound CI Receipts

**Files:**
- Create: `scripts/ci/receipt.mjs`
- Create: `scripts/ci/receipt.bun_spec.mjs`
- Modify: `scripts/ci/run.mjs`
- Modify: `scripts/local-release/config.mjs`

**Interfaces:**
- Produces: `createCiReceipt({ root, receiptFile })`, `verifyCiReceipt({ root, receiptFile, expectedRevision })`, and `paths.ciReceiptFile`.
- Consumes: `CI_CONTRACT_VERSION` and `CI_CONTRACT_FILES`.

- [ ] Write temporary-repository tests for matching, missing, stale, dirty-tracked, dirty-submodule, changed-contract, wrong-toolchain, and untracked-file cases.
- [ ] Run the receipt tests and confirm they fail before implementation.
- [ ] Implement SHA-256 contract hashing, Git identity checks, submodule checks, pinned toolchain checks, and atomic mode-0600 JSON writes.
- [ ] Delete stale proof before validation and write proof only after all phases pass.
- [ ] Run receipt and contract tests and confirm they pass.

### Task 3: Release And Push Enforcement

**Files:**
- Modify: `scripts/local-release.mjs`
- Modify: `.githooks/pre-push`
- Create: `scripts/ci/verify-receipt.mjs`
- Create: `scripts/ci/integration.bun_spec.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `runCiVerification` and `verifyCiReceipt`.
- Produces: release preparation validation before snapshotting and protected-branch enforcement of CI plus security receipts.

- [ ] Write integration tests proving CI precedes snapshots and the hook requires both receipts for `main` and `stable` without a security-only fallback.
- [ ] Run the integration test and confirm it fails against current wiring.
- [ ] Register `ci:verify-receipt` and implement its thin CLI.
- [ ] Gate `release:local prepare` before any release state or SkyBolt operation.
- [ ] Update the hook with actionable failure messages and fail-closed receipt checks.
- [ ] Run integration and local-release tests and confirm they pass.

### Task 4: GitHub Parity And Release-Note Regression

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `src/test/release-notes.test.ts`
- Create: `scripts/ci/workflow-parity.bun_spec.mjs`

**Interfaces:**
- Consumes: `bun run ci:verify`.
- Produces: one shared local/GitHub command and version-independent release-note assertions.

- [ ] Write workflow tests asserting Bun 1.3.14, Rust 1.94.1, one shared verification command, no duplicated validation commands, and benchmark upload after verification.
- [ ] Run the focused test and confirm it fails against the duplicated workflow.
- [ ] Replace workflow validation steps with `bun run ci:verify` while retaining setup and benchmark artifact upload.
- [ ] Derive current release-note expectations from `package.json`, semantic order, and lookup-based historical assertions.
- [ ] Run workflow and release-note tests and confirm they pass.

### Task 5: Full Verification And Documentation

**Files:**
- Modify: `docs/RELEASES.md`

**Interfaces:**
- Documents: mandatory local CI proof and protected-push behavior.

- [ ] Document that release preparation runs shared CI before snapshot/build and direct protected pushes require CI and security receipts.
- [ ] Run `bun test scripts/ci/*.bun_spec.mjs`, `bun run release-notes:check`, and `git diff --check`.
- [ ] Run `bun run ci:verify`; expect every phase to pass and a current receipt to be written.
- [ ] Run `bun run ci:verify-receipt` and `bun run release:local verify-push`; expect both proofs to match the same commit.
- [ ] Commit with `ci: require local parity before protected pushes [skip release-notes]`.
