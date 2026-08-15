# Compatibility Canonicalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove false NAS storage and PCIe lane alerts while preserving errors for genuinely unsupported hardware.

**Architecture:** Add domain-specific storage form-factor canonicalization at the shared compatibility boundary so persisted keys, projected labels, registry values, and legacy inputs compare by physical meaning. Change electrical-lane evaluation so the explicit minimum is the only alert threshold; connector width remains topology metadata when that minimum is satisfied.

**Tech Stack:** JavaScript compatibility engine, TypeScript/Vitest regression tests, Bun, React application release notes.

## Global Constraints

- Do not change persisted inventory, assignments, placements, cables, registry links, or project revisions.
- Do not add a schema migration; existing relational data is correct.
- Keep display labels unchanged.
- Alerts represent unsupported, unsafe, or unverifiable configurations, not supported negotiation.
- Preserve mechanical fit, PCIe generation, height, occupied width, power, and CPU-dependency checks.
- Do not bump the application version, create tags, push, or deploy.

---

### Task 1: Canonical Storage Form-Factor Matching

**Files:**
- Modify: `shared/compatibility/index.mjs`
- Test: `src/test/compatibility-rules.test.ts`

**Interfaces:**
- Consumes: storage form-factor strings from `normalizeComponentRequirements()` and `normalizeHostCapabilities()`.
- Produces: internal `normalizeStorageFormFactor(value)` and form-factor-aware comparison in `evaluateStorage()`.

- [ ] **Step 1: Add failing storage alias tests**

Extend the storage compatibility test with host form factors using projected display labels and components using canonical or legacy aliases:

```ts
for (const [hostFormFactor, componentFormFactor] of [
  ['2.5 inch', '2.5-inch'],
  ['2.5-inch', '2.5"'],
  ['3.5 inch', '3.5-inch'],
] as const) {
  expect(evaluate(
    host({ host: { storageSlots: [{
      id: 1,
      key: 'bay',
      label: 'SATA bay',
      count: 1,
      interfaces: ['SATA'],
      formFactors: [hostFormFactor],
    }] } }),
    component('storage', undefined, {
      interface: 'SATA',
      formFactor: componentFormFactor,
    }),
  )).toEqual({ status: 'compatible', findings: [] })
}
```

Keep an explicit `3.5-inch` host versus `2.5-inch` component mismatch assertion.

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
bunx vitest run src/test/compatibility-rules.test.ts
```

Expected: alias cases fail with `storage.form-factor.mismatch`.

- [ ] **Step 3: Implement domain canonicalization**

Add a conservative helper near `normalizeStorageInterface()`:

```js
function normalizeStorageFormFactor(value) {
  const normalized = optionalString(value)?.toLowerCase()
  if (!normalized) return undefined

  const compact = normalized
    .replace(/["']/g, '')
    .replace(/\binches?\b/g, 'inch')
    .replace(/[\s_-]+/g, '-')

  const aliases = new Map([
    ['2.5', '2.5-inch'],
    ['2.5-inch', '2.5-inch'],
    ['3.5', '3.5-inch'],
    ['3.5-inch', '3.5-inch'],
    ['m.2-2230', '2230'],
    ['m2-2230', '2230'],
    ['m.2-2242', '2242'],
    ['m2-2242', '2242'],
    ['m.2-2260', '2260'],
    ['m2-2260', '2260'],
    ['m.2-2280', '2280'],
    ['m2-2280', '2280'],
    ['m.2-22110', '22110'],
    ['m2-22110', '22110'],
  ])

  return aliases.get(compact) ?? compact
}
```

Use it only for the form-factor comparison in `evaluateStorage()`:

```js
const expectedFormFactor = normalizeStorageFormFactor(requirements.formFactor)
const group = interfaceGroups.find((candidate) =>
  Array.isArray(candidate.formFactors)
  && candidate.formFactors.some((value) =>
    normalizeStorageFormFactor(value) === expectedFormFactor,
  )
)
```

- [ ] **Step 4: Run focused compatibility tests**

Run:

```bash
bunx vitest run src/test/compatibility-rules.test.ts
```

Expected: all storage alias and mismatch tests pass.

### Task 2: Actionable PCIe Electrical-Lane Findings

**Files:**
- Modify: `shared/compatibility/index.mjs`
- Test: `src/test/compatibility-rules.test.ts`

**Interfaces:**
- Consumes: `requirements.minimumElectricalLanes`, `requirements.connectorLanes`, and `group.electricalLanes`.
- Produces: no lane finding when the declared minimum is met; `expansion.minimum-lanes.insufficient` when it is not.

- [ ] **Step 1: Change the reduced-lane regression expectation**

Update the existing lane test so an x8 card declaring an x4 minimum in an x4 electrical slot has no `expansion.electrical-lanes.reduced` finding. Retain the separate component with `minimumElectricalLanes: 8` and assert it emits `expansion.minimum-lanes.insufficient` with severity `error`.

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
bunx vitest run src/test/compatibility-rules.test.ts
```

Expected: the supported x4 case still contains `expansion.electrical-lanes.reduced`.

- [ ] **Step 3: Remove the connector-width warning branch**

In `evaluateExpansionGroup()`, retain missing slot-lane data and minimum-lane errors, then remove the branch that compares `electricalLanes` with `connectorLanes` after the minimum has passed:

```js
if (group.electricalLanes === undefined) {
  addMissing(/* existing arguments */)
} else if (
  requirements.minimumElectricalLanes !== undefined
  && group.electricalLanes < requirements.minimumElectricalLanes
) {
  addFinding(findings, {
    code: 'expansion.minimum-lanes.insufficient',
    severity: 'error',
    message: `The slot provides x${group.electricalLanes}, below the card's required x${requirements.minimumElectricalLanes}.`,
    field: 'component.expansion.minimumElectricalLanes',
    resourceId: group.id,
  })
}
```

- [ ] **Step 4: Run focused compatibility tests**

Run:

```bash
bunx vitest run src/test/compatibility-rules.test.ts
```

Expected: supported x4 operation has no lane alert; the x8 minimum remains incompatible.

### Task 3: Release Notes And Full Verification

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `src/release-notes.ts`

**Interfaces:**
- Consumes: completed evaluator behavior from Tasks 1 and 2.
- Produces: consolidated unreleased user-facing fix description.

- [ ] **Step 1: Record the user-visible fix**

Add one consolidated `Fixed` entry to both release-note surfaces:

```text
Compatibility checks now recognize equivalent storage form-factor labels and only alert on PCIe electrical lanes when a card's declared minimum is not met.
```

- [ ] **Step 2: Run focused and full checks**

Run:

```bash
bunx vitest run src/test/compatibility-rules.test.ts
bun run lint
bun run test
bun run build
```

Expected: all commands pass; existing nonblocking lint warnings may remain.

- [ ] **Step 3: Verify the production-shaped data copy**

Run the compatibility evaluator against a copied and migrated local database. Confirm:

```text
Synology DS620slim + 2.5-inch SATA: no storage.form-factor.mismatch
Synology DS1621+ + 3.5-inch SATA: no storage.form-factor.mismatch
Synology DS1621+ + Intel X520-DA2 with x4 minimum: no electrical-lane finding
```

The active `data/` directory must remain unchanged.

- [ ] **Step 4: Commit the implementation**

```bash
git add shared/compatibility/index.mjs src/test/compatibility-rules.test.ts CHANGELOG.md src/release-notes.ts
git commit -m "fix: remove false compatibility alerts"
```
