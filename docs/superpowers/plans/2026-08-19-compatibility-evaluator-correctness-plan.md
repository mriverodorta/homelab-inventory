# Compatibility Evaluator Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct mixed CPU-generation matching, audit the complete compatibility path for evidence-backed defects, and automatically rebuild persisted compatibility findings after upgrade.

**Architecture:** Keep the existing shared compatibility evaluator and add a generic ordinal-generation canonicalizer plus an exact normalized match guard. Validate the full path with table-driven rule and allocation invariants, then use one ordered SQLite migration to enqueue every active host for reconciliation under the incremented evaluator version.

**Tech Stack:** Bun, TypeScript, JavaScript ES modules, Vitest, `bun:test`, Drizzle-managed SQLite migrations, `bun:sqlite`.

## Global Constraints

- Treat compatibility as `compatible`, `incompatible`, or `unknown`; missing evidence is informational.
- Preserve assignments, numeric resource-slot IDs, placements, connections, route cache, private fields, Registry links, inventory identity, agent state, telemetry, and notifications.
- Do not change Registry catalog data or request a Registry publication.
- Do not bump the application version, create tags, push, or deploy.
- Update the structured unreleased release notes and `CHANGELOG.md`.
- Leave the untracked `.superpowers/` directory untouched.
- Run `bun run lint`, `bun run test`, `bun run build`, and `bun run security:container` before completion.

---

### Task 1: Correct CPU generation canonicalization and matching

**Files:**
- Modify: `shared/compatibility/cpu-generation-aliases.mjs`
- Modify: `shared/compatibility/index.mjs`
- Modify: `src/test/compatibility-rules.test.ts`
- Create: `src/test/cpu-generation-aliases.test.ts`

**Interfaces:**
- Consumes: `canonicalCpuGenerationTokens(value)` and `inferCpuProductGenerationTokens(item)`.
- Produces: `CPU_GENERATION_ALIAS_VERSION = 2`; generic Intel ordinal product tokens; exact normalized generation equality before semantic matching.

- [ ] **Step 1: Add failing canonicalization tests**

Create `src/test/cpu-generation-aliases.test.ts` with direct assertions:

```ts
import { describe, expect, it } from 'vitest'
import {
  CPU_GENERATION_ALIAS_VERSION,
  canonicalCpuGenerationTokens,
} from '../../shared/compatibility/cpu-generation-aliases.mjs'

describe('CPU generation aliases', () => {
  it('canonicalizes arbitrary Intel ordinal product generations', () => {
    expect(CPU_GENERATION_ALIAS_VERSION).toBe(2)
    expect(canonicalCpuGenerationTokens('12th Gen')).toContain('product:intel:12th-gen')
    expect(canonicalCpuGenerationTokens('12th Generation')).toContain('product:intel:12th-gen')
    expect(canonicalCpuGenerationTokens('14th Gen')).toContain('product:intel:14th-gen')
    expect(canonicalCpuGenerationTokens('21st Generation')).toContain('product:intel:21st-gen')
  })

  it('keeps architecture and product-generation tokens distinct', () => {
    expect(canonicalCpuGenerationTokens('Zen 2')).toContain('architecture:amd:zen-2')
    expect(canonicalCpuGenerationTokens('Ryzen PRO 4000')).toContain('product:amd:ryzen-pro-4000')
    expect(canonicalCpuGenerationTokens('Zen 2'))
      .not.toEqual(expect.arrayContaining(canonicalCpuGenerationTokens('Ryzen PRO 4000')))
  })
})
```

- [ ] **Step 2: Add the failing production regression**

Extend `src/test/compatibility-rules.test.ts` with the exact live contract:

```ts
it('accepts an i7-12700T when a Dell 7010 supports 12th and 13th Gen CPUs', () => {
  const result = evaluate(
    host({ host: { cpu: {
      sockets: ['LGA1700'],
      generations: ['12th Gen', '13th Gen'],
      maxTdpWatts: 35,
    } } }),
    component('cpu', {
      requirements: { cpu: {
        socket: 'LGA1700',
        generation: '12th Gen',
        tdpWatts: 35,
      } },
    }),
  )

  expect(result.status).toBe('compatible')
  expect(result.findings).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'cpu.generation.unsupported' }),
  ]))
})
```

Add cases for exact future/vendor strings in a mixed token list, `12th Generation`, `14th Gen`, genuine mismatches, Comet Lake, Rocket Lake, Ryzen family aliases, and Ryzen product-versus-Zen architecture separation.

- [ ] **Step 3: Run the focused tests and confirm failure**

Run:

```bash
bunx vitest run src/test/cpu-generation-aliases.test.ts src/test/compatibility-rules.test.ts
```

Expected: the alias version and Dell 7010 regressions fail on the current implementation.

- [ ] **Step 4: Implement generic ordinal canonicalization**

In `cpu-generation-aliases.mjs`:

```js
export const CPU_GENERATION_ALIAS_VERSION = 2

function intelOrdinalProductToken(key) {
  const match = key.match(/^(\d{1,3})(st|nd|rd|th) (?:gen|generation)$/)
  return match ? `product:intel:${match[1]}${match[2]}-gen` : undefined
}

export function canonicalCpuGenerationTokens(value) {
  const key = normalized(value)
  if (!key) return Object.freeze([])
  const ordinal = intelOrdinalProductToken(key)
  return Object.freeze([
    ...(ordinal ? [ordinal] : DIRECT_ALIASES.get(key) ?? [`literal:${key}`]),
  ])
}
```

Retain the explicit codename and AMD aliases.

- [ ] **Step 5: Make exact normalized equality authoritative**

In `evaluateCpu`, calculate exact equality before semantic token matching:

```js
const exactMatch = requirements.generation
  ? includesNormalized(acceptedGenerations, requirements.generation)
  : false
const semanticMatch = componentProductTokens.some((token) => acceptedTokens.has(token))
const literalFallback = acceptedProductTokens.length === 0
  && componentGenerationTokens.some((token) => acceptedTokens.has(token))
const matches = exactMatch || semanticMatch || literalFallback
```

Do not allow architecture tokens to satisfy product-generation requirements.

- [ ] **Step 6: Run focused tests**

Run the same Vitest command. Expected: all CPU generation tests pass.

- [ ] **Step 7: Commit Task 1**

```bash
git add shared/compatibility/cpu-generation-aliases.mjs shared/compatibility/index.mjs src/test/compatibility-rules.test.ts src/test/cpu-generation-aliases.test.ts
git commit -m "fix: correct canonical CPU generation matching"
```

### Task 2: Audit full-path compatibility invariants

**Files:**
- Create: `src/test/compatibility-evaluator-invariants.test.ts`
- Modify only when a failing invariant proves a defect: `shared/compatibility/index.mjs`
- Modify only when a failing normalization invariant proves a defect: `shared/compatibility/cpu-generation-aliases.mjs`

**Interfaces:**
- Consumes: `normalizeHostCapabilities`, `normalizeComponentRequirements`, `evaluateAssignmentCompatibility`, `evaluateProjectCompatibility`, and `planHostAllocations`.
- Produces: a table-driven regression matrix covering all rule families and resource-selection behavior.

- [ ] **Step 1: Add a tri-state rule matrix**

Create `src/test/compatibility-evaluator-invariants.test.ts` with one table per rule family. Each table must assert a known-compatible case, a proven-incompatible case, and a missing-evidence case:

```ts
const ruleCases = [
  { label: 'memory generation', compatible: memoryPair('DDR4', ['DDR4']), incompatible: memoryPair('DDR5', ['DDR4']), unknown: memoryPair(undefined, ['DDR4']) },
  { label: 'storage interface', compatible: storagePair('NVMe', ['NVMe']), incompatible: storagePair('SAS', ['NVMe']), unknown: storagePair(undefined, ['NVMe']) },
  { label: 'expansion family', compatible: expansionPair('pcie', 'pcie'), incompatible: expansionPair('ocp', 'pcie'), unknown: expansionPair(undefined, 'pcie') },
]

it.each(ruleCases)('$label preserves compatible/incompatible/unknown', ({ compatible, incompatible, unknown }) => {
  expect(run(compatible).status).toBe('compatible')
  expect(run(incompatible).status).toBe('incompatible')
  expect(run(unknown).status).toBe('unknown')
  expect(run(unknown).findings.every((finding) => finding.classification === 'informational')).toBe(true)
})
```

Use explicit fixture builders in this file for CPU, memory, storage, expansion, optional modules, power, cooler, and case inputs. Do not rely on names to infer missing compatibility data.

- [ ] **Step 2: Add normalization immutability and malformed-input cases**

For each normalized numeric family, freeze the source object, call normalization and evaluation, and assert the source remains byte-identical. Assert malformed strings remain absent and produce informational findings rather than fabricated zero values or incompatibilities.

- [ ] **Step 3: Add assigned-resource authority cases**

Create hosts with two storage, expansion, and optional-module groups where one sibling is compatible and the persisted assigned slot is incompatible. Assert evaluation reports the assigned-slot conflict. Add unassigned cases proving selection order is compatible, then unknown, then incompatible.

- [ ] **Step 4: Add aggregation and determinism cases**

Assert repeated `evaluateProjectCompatibility` and `planHostAllocations` calls return deep-equal results and do not mutate input. Assert rejected candidate findings do not leak into the selected result and host aggregate power findings are emitted once.

- [ ] **Step 5: Run the invariant suite**

Run:

```bash
bunx vitest run src/test/compatibility-evaluator-invariants.test.ts src/test/compatibility-rules.test.ts src/test/compatibility-allocation.test.ts src/test/compatibility-normalization.test.ts
```

If a new invariant fails, reduce it to the smallest fixture, document the incorrect current result in the test name, implement the minimum correction in `shared/compatibility/index.mjs`, and rerun the focused suite. If all new invariants pass after Task 1, make no unrelated evaluator changes.

- [ ] **Step 6: Commit Task 2**

```bash
git add src/test/compatibility-evaluator-invariants.test.ts shared/compatibility/index.mjs shared/compatibility/cpu-generation-aliases.mjs
git commit -m "test: audit compatibility evaluator invariants"
```

### Task 3: Rebuild persisted compatibility findings on upgrade

**Files:**
- Create: `server/persistence/core/migrations/generated/0024_compatibility_evaluator_v2.sql`
- Modify: `server/persistence/core/migrations/manifest.ts`
- Modify: `server/compatibility/audit-service.bun_spec.ts`
- Modify: `server/persistence/core/schema/schema.bun_spec.ts`

**Interfaces:**
- Consumes: `CPU_GENERATION_ALIAS_VERSION = 2`, `compatibility_audit_dirty_hosts`, project inventory membership, and the existing reconciliation scheduler.
- Produces: migration ID `0025_compatibility_evaluator_v2`; one dirty-host row per active project/host; automatic replacement of stale evaluator-v1 findings.

- [ ] **Step 1: Add a failing migration/reconciliation test**

Build a database through migration `0024_m2_ae_projection_repair`, import a fixture containing the Dell 7010 and i7-12700T assignment, insert the stale `cpu.generation.unsupported` finding, then apply the new migration. Assert:

```ts
expect(database.query(`
  SELECT project_id, host_item_id, reason
  FROM compatibility_audit_dirty_hosts
`).all()).toEqual([
  { project_id: 1, host_item_id: dellItemId, reason: 'compatibility-evaluator-v2' },
])

expect(service.reconcile(store)).toEqual({ claimed: 1, evaluated: 1, failed: 0 })
expect(service.findings(store, { projectId: 1 }))
  .not.toEqual(expect.arrayContaining([
    expect.objectContaining({ ruleKey: 'cpu.generation.unsupported' }),
  ]))
```

Capture and compare assignments, component-assignment slots, placements, connections, route cache, inventory private columns, and Registry links before and after migration/reconciliation.

- [ ] **Step 2: Create the idempotent migration**

Add `0024_compatibility_evaluator_v2.sql`:

```sql
INSERT INTO `compatibility_audit_dirty_hosts`
  (`project_id`, `host_item_id`, `reason`, `enqueued_at_ms`)
SELECT project.id, item.id, 'compatibility-evaluator-v2', unixepoch('subsec') * 1000
FROM `projects` project
JOIN `inventory_items` item ON item.archived_at_ms IS NULL
JOIN `inventory_item_types` item_type ON item_type.id = item.type_id
LEFT JOIN `project_inventory_memberships` membership
  ON membership.project_id = project.id AND membership.item_id = item.id
WHERE project.archived_at_ms IS NULL
  AND item_type.key IN ('server', 'nas', 'pcBuild')
  AND (
    item.owner_project_id = project.id
    OR membership.id IS NOT NULL
    OR (item.scope = 'global' AND project.includes_global_inventory = 1)
  )
ON CONFLICT (`project_id`, `host_item_id`) DO UPDATE SET
  `reason` = excluded.`reason`,
  `enqueued_at_ms` = excluded.`enqueued_at_ms`;
```

- [ ] **Step 3: Register the immutable migration checksum**

Run:

```bash
shasum -a 256 server/persistence/core/migrations/generated/0024_compatibility_evaluator_v2.sql
```

Append migration ID `0025_compatibility_evaluator_v2`, its filename, and the exact checksum to `CORE_MIGRATIONS`.

- [ ] **Step 4: Verify migration order, rollback readiness, and idempotency**

Extend `schema.bun_spec.ts` to verify the migration follows `0024_m2_ae_projection_repair`, cannot run out of order, and remains represented by an immutable checksum. Apply the complete migration list twice through the managed migrator and verify no duplicate dirty rows.

- [ ] **Step 5: Run persistence tests**

```bash
bun test server/compatibility/audit-service.bun_spec.ts server/persistence/core/schema/schema.bun_spec.ts server/persistence/sqlite-store.bun_spec.ts
```

Expected: migration, reconciliation, restart, and preservation assertions pass.

- [ ] **Step 6: Commit Task 3**

```bash
git add server/persistence/core/migrations/generated/0024_compatibility_evaluator_v2.sql server/persistence/core/migrations/manifest.ts server/compatibility/audit-service.bun_spec.ts server/persistence/core/schema/schema.bun_spec.ts
git commit -m "fix: rebuild compatibility audits after evaluator updates"
```

### Task 4: Document the user-visible correction

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `src/release-notes.ts`

**Interfaces:**
- Produces: one human-facing unreleased fix entry; no version bump.

- [ ] **Step 1: Update the changelog**

Under `## Unreleased`, add:

```markdown
### Fixed

- Compatibility audits now recognize exact and canonical CPU generations across mixed host support lists, and upgrades automatically rebuild persisted findings so valid CPU assignments no longer retain stale incompatibility alerts.
```

- [ ] **Step 2: Update structured unreleased notes**

Add the same behavior to `UNRELEASED_RELEASE_NOTES.fixes` using concise in-app wording.

- [ ] **Step 3: Validate release notes**

```bash
bun run release-notes:check
```

- [ ] **Step 4: Commit Task 4**

```bash
git add CHANGELOG.md src/release-notes.ts
git commit -m "docs: note compatibility evaluator correction"
```

### Task 5: Complete validation and review

**Files:**
- Review only: all files changed by Tasks 1-4.

**Interfaces:**
- Produces: a clean, deployable, unversioned patch implementation.

- [ ] **Step 1: Run formatting and diff checks**

```bash
git diff --check origin/main...HEAD
git status --short
```

- [ ] **Step 2: Run lint**

```bash
bun run lint
```

- [ ] **Step 3: Run the full test suite**

```bash
bun run test
```

- [ ] **Step 4: Build production assets**

```bash
bun run build
```

- [ ] **Step 5: Run two-platform container security verification**

```bash
bun run security:container
```

Expected: final distroless images boot for `linux/amd64` and `linux/arm64`; Docker Scout and Trivy report zero known vulnerabilities at every severity.

- [ ] **Step 6: Review the final commit range**

```bash
git log --oneline origin/main..HEAD
git diff --stat origin/main...HEAD
git status --short --branch
```

Confirm that only `.superpowers/` remains untracked and that no version, tag, deployment, or private data change occurred.
