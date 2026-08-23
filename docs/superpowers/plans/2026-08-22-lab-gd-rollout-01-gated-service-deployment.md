# LabGD Gated Production Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy LabGD to SkyBolt in package-backed production mode with all services healthy, migrations and recovery verified, public routing working, and publication still disabled.

**Architecture:** Build the private repository directly on SkyBolt, render file-only secrets through the scoped Infisical machine identity, and use PostgreSQL plus immutable object/preview storage behind a fail-closed API gate. Validate recovery from a matched backup before allowing the Application release to proceed.

**Tech Stack:** Bun, Hono, PostgreSQL, Docker Compose, isolated Chromium renderer, Infisical, Cloudflare Tunnel, SSH alias `bolt`.

## Global Constraints

- Execute in `/Users/maikeldorta/Code/home-datacenter/HomelabInventoryShare` locally and `/data/stack/labgd` on SkyBolt.
- Deploy commit `5f1f7520de90ccb90aff1842e7c8cfd967e395c6` or a reviewed descendant with a clean tree.
- Use the `hkloud-infisical` skill with identity `skybolt-provisioner`, project `183a13bc-d756-43a8-a61a-655e99d5b19b`, environment `prod`, and folder `/labgd`.
- Keep tracked and deployed `PUBLICATION_ENABLED=false` for this entire plan.
- Never print or persist secret values outside the ignored mode-`0700` `secrets/` directory and its mode-`0600` files.
- Publish only API host port `0.0.0.0:8787`; PostgreSQL, migrations, storage initialization, Registry mirror, renderer, analytics, and lifecycle services remain unexposed.
- Do not connect directly to SkyArk.
- Remove task-created local Docker images, containers, networks, build cache, and temporary files after verification; do not remove Docker volumes without explicit approval.

---

### Task 1: Freeze And Verify The Release Input

**Files:**
- Verify: `package.json`
- Verify: `bun.lock`
- Verify: `compose.yaml`
- Verify: `deploy/secret-files.md`
- Verify: `packages/database/migrations/0011_installation_control.sql`
- Verify: `packages/database/migrations/0012_operational_analytics.sql`

**Interfaces:**
- Consumes: audited source commit and exact npm lockfile.
- Produces: a clean local verification receipt.

- [ ] **Step 1: Verify source and dependency state**

```bash
git status --short
git rev-parse HEAD
bun install --frozen-lockfile
bun run verify:catalog-protocol
```

Expected: clean tracked tree, expected commit, frozen install success, and exact Catalog Protocol integrity success.

- [ ] **Step 2: Run application and migration gates**

```bash
bun run verify
bun run db:migrations:check
docker compose config --quiet
```

Expected: lint, 217-or-newer tests, typecheck/build, all 12-or-newer ordered migrations, and Compose validation pass.

- [ ] **Step 3: Run four-image security verification**

```bash
bun run security:container
```

Expected: API and renderer boot on `linux/amd64` and `linux/arm64`; Docker Scout and Trivy report zero findings at every severity without exclusions.

### Task 2: Render And Validate Production Secrets

**Files:**
- Create ignored: `secrets/*`
- Verify: `deploy/secret-files.md`

**Interfaces:**
- Consumes: Infisical `/labgd` secret set.
- Produces: correctly owned secret files without logging values.

- [ ] **Step 1: Use the scoped Infisical workflow**

Invoke the `hkloud-infisical` skill and verify all required keys listed in `deploy/secret-files.md` exist. Do not retrieve or display values in chat output.

- [ ] **Step 2: Render secrets atomically on SkyBolt**

Render into a temporary mode-`0700` directory, verify the complete filename set, then atomically replace `/data/stack/labgd/secrets`.

- [ ] **Step 3: Verify modes and ownership by filename only**

PostgreSQL files must be `999:999`; application files must be `65532:65532`; every file must be mode `0600`; the directory must be mode `0700`.

### Task 3: Create The Matched Predeployment Backup

**Files:**
- Use: `ops/backup.sh`
- Use: `ops/verify-backup.sh`
- Output on SkyBolt: timestamped directory printed by `ops/backup.sh` under `/data/stack/_shared/backups/labgd`

**Interfaces:**
- Consumes: existing LabGD database/object state, including an empty first-install state.
- Produces: one verified rollback checkpoint.

- [ ] **Step 1: Run the standard backup**

```bash
backup_dir="$(ssh bolt 'cd /data/stack/labgd && LABGD_BACKUP_ROOT=/data/stack/_shared/backups/labgd ./ops/backup.sh' | tail -n 1)"
test -n "$backup_dir"
printf '%s\n' "$backup_dir"
```

- [ ] **Step 2: Verify the exact returned directory**

```bash
ssh bolt "cd /data/stack/labgd && ./ops/verify-backup.sh '$backup_dir'"
```

Expected: PostgreSQL custom dump, object tree, preview tree, metadata, and checksums pass.

### Task 4: Deploy The Disabled Stack

**Files:**
- Deploy: repository contents to `/data/stack/labgd`
- Use: `compose.yaml`
- Use: `deploy/storage-init.sh`

**Interfaces:**
- Consumes: verified source, secrets, and backup.
- Produces: healthy package-mode LabGD with publication disabled.

- [ ] **Step 1: Synchronize the clean private repository**

Transfer the exact clean commit to `/data/stack/labgd` without copying `.git`, local dependencies, build output, tests' temporary data, or secrets from the Mac.

- [ ] **Step 2: Initialize storage and apply ordered migrations**

Run the Compose PostgreSQL, migration, Registry mirror, and storage initialization dependencies in their documented order. Expected: all 12 migrations apply once and a second migration run is a no-op.

- [ ] **Step 3: Start the runtime services**

Start `renderer`, `analytics`, `api`, and `lifecycle` with `PUBLICATION_ENABLED=false`. Confirm no worker is in an unbounded retry loop.

- [ ] **Step 4: Verify listeners and Watchtower policy**

Confirm only `0.0.0.0:8787` is published, PostgreSQL has no host port, no LabGD-managed Cloudflare container exists, and every LabGD service is excluded from Watchtower.

### Task 5: Verify Health, Readiness, Routing, And Privacy

**Files:**
- Verify: `src/app.ts`
- Verify: `test/e2e/production-stack.spec.ts`

**Interfaces:**
- Consumes: running disabled stack and operator-managed ingress.
- Produces: LabGD production-readiness receipt for Plan 02.

- [ ] **Step 1: Verify local and public health**

Check `http://127.0.0.1:8787/healthz`, `http://127.0.0.1:8787/readyz`, `https://lab.gd/healthz`, and `https://lab.gd/readyz`. Expected: HTTP 200 and package-mode readiness.

- [ ] **Step 2: Verify host separation**

Confirm `lab.gd` serves public pages and `app.lab.gd` serves owner authentication and management. Wrong-host requests fail closed, and the GitHub callback is exactly `https://app.lab.gd/api/auth/callback/github`.

- [ ] **Step 3: Verify publication is disabled**

Read `/v1/capabilities` and the deployment environment without secrets. A signed publication attempt using a task-scoped fixture must return the documented disabled response and create no share, revision, blob, preview, analytics, or lifecycle record.

- [ ] **Step 4: Verify generic public states**

Unknown, protected, expired, deleted, and unsupported public states must reveal no title, description, owner, Registry reference, content hash, or preview metadata before authorization.

### Task 6: Prove Restore And Restart Safety

**Files:**
- Use: `ops/restore.sh`
- Use: `ops/verify-restart.sh`
- Use: `test/e2e/production-stack.spec.ts`

**Interfaces:**
- Consumes: verified matched backup and running disabled stack.
- Produces: rollback and idempotency evidence.

- [ ] **Step 1: Restore into an isolated destination**

Run `ops/restore.sh` against the matched backup using a new task-scoped restore root. Verify migration state, database checks, archive traversal rejection, symlink rejection, and object/preview checksums. Do not switch live pointers.

- [ ] **Step 2: Run the production restart proof**

```bash
LABGD_PRODUCTION_E2E_SSH=bolt bun run test:e2e:production
```

Expected: `production restart persistence verification passed` and `synthetic cleanup verification passed`.

- [ ] **Step 3: Record the LabGD receipt**

Record commit, migrations, package integrities, backup path, container IDs/start times, health/readiness, publication-disabled proof, restore result, restart result, and zero-vulnerability result in the shared rollout ledger.

- [ ] **Step 4: Clean local task artifacts**

Remove only task-created images, containers, networks, temporary databases, temporary restore roots, scanner cache, and build cache. Report retained Docker volumes and their size without deleting them.
