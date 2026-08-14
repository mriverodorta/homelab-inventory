# Compatibility Resource Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve typed storage and expansion compatibility fields independently so compatible OEM components receive deterministic numeric slot allocations without false unknown warnings.

**Architecture:** Keep canonical SQLite as the source of truth and correct only the legacy workspace projection. Explicit SQL aliases prevent subtype columns with the same name from colliding; normal compatibility planning and engine persistence then write the existing numeric resource-group and slot relationships.

**Tech Stack:** Bun, TypeScript, bun:sqlite, Drizzle-managed SQLite schema, Bun test, React compatibility planner.

## Global Constraints

- Do not infer missing compatibility from product names or free-form fields.
- Do not rewrite existing inventory, registry links, assignments, placements, connections, or project revisions.
- Persist assignment relationships through positive numeric IDs only.
- Do not bump the version, tag, push, or deploy during implementation.

---

### Task 1: Reproduce subtype projection isolation

**Files:**
- Modify: `server/persistence/core/repositories/repositories.bun_spec.ts`

**Interfaces:**
- Consumes: `buildLegacyProjectProjection({ database, projectId })` and the schema-29 migration fixture.
- Produces: Regression coverage proving `storageSlots[].pcieGeneration` and `expansionSlots[].pcieGeneration` are independent.

- [ ] **Step 1: Add distinct storage and expansion resources to the fixture**

Extend the host compatibility fixture with one Gen 3 storage slot and one Gen 4 expansion slot:

```ts
snapshot.inventory.servers[0].compatibility.host.expansionSlots = [{
  id: 2,
  key: 'pcie-x8',
  label: 'PCIe x8',
  count: 1,
  interfaceFamily: 'pcie',
  pcieGeneration: 4,
  mechanicalLanes: 8,
  electricalLanes: 8,
  acceptedHeights: ['low-profile'],
  maxSlotWidth: 1,
  maxPowerWatts: 75,
}]
```

- [ ] **Step 2: Assert both projected generations**

```ts
expect(host.storageSlots?.[0]).toMatchObject({ pcieGeneration: 3 })
expect(host.expansionSlots?.[0]).toMatchObject({
  pcieGeneration: 4,
  mechanicalLanes: 8,
  electricalLanes: 8,
})
```

- [ ] **Step 3: Run the focused test and verify the expansion assertion fails**

Run: `bun test server/persistence/core/repositories/repositories.bun_spec.ts`

Expected: the storage assertion passes and the expansion slot omits `pcieGeneration`.

---

### Task 2: Isolate typed compatibility projection columns

**Files:**
- Modify: `server/persistence/core/projections/legacy-project.ts`
- Test: `server/persistence/core/repositories/repositories.bun_spec.ts`

**Interfaces:**
- Consumes: canonical `storage_resource_groups.pcie_generation` and `expansion_resource_groups.pcie_generation`.
- Produces: legacy host compatibility objects with independently preserved `pcieGeneration` values.

- [ ] **Step 1: Alias colliding SQL columns explicitly**

Replace the shared selection with subtype-specific names:

```sql
s.pcie_generation AS storage_pcie_generation,
s.hot_swap,
s.backplane,
s.direct_connect,
e.pcie_generation AS expansion_pcie_generation,
e.interface_family,
e.mechanical_lanes,
e.electrical_lanes
```

- [ ] **Step 2: Read only the matching subtype alias**

Use `group.storage_pcie_generation` for storage entries and `group.expansion_pcie_generation` for expansion entries.

- [ ] **Step 3: Audit every resource subtype mapping**

Compare fields stored by `storageResourceGroups`, `expansionResourceGroups`, `controllerResourceGroups`, `bootDeviceResourceGroups`, `coolingResourceGroups`, `hostPowerProfiles`, `hostCpuProfiles`, and `hostMemoryProfiles` against `hostCompatibility()`. Add only omitted canonical fields discovered by this comparison.

- [ ] **Step 4: Run the projection tests**

Run: `bun test server/persistence/core/repositories/repositories.bun_spec.ts`

Expected: all repository and v6 topology projection tests pass.

---

### Task 3: Prove OEM GPU allocation persistence

**Files:**
- Modify: `server/persistence/sqlite-store.bun_spec.ts`
- Test: `server/persistence/sqlite-store.bun_spec.ts`

**Interfaces:**
- Consumes: `SqliteHomelabInventoryStore.applyEnginePatch()` and the normal compatibility allocation result.
- Produces: Regression coverage for numeric expansion-slot persistence after assigning a compatible GPU.

- [ ] **Step 1: Build a Precision-like host and RX-640-like GPU fixture**

Add one server expansion slot with Gen 3, x8 electrical/mechanical lanes, low-profile height, one-slot width, and 75 W capacity. Add one GPU requiring Gen 3, x8, low-profile, one slot, and 50 W.

- [ ] **Step 2: Plan the assignment and assert compatibility**

Create the candidate assignment, run `planHostAllocations`, and assert:

```ts
expect(result.status).toBe('compatible')
expect(planned.allocation).toEqual({
  resourceType: 'expansion',
  groupId: 1,
  positions: [0],
})
```

- [ ] **Step 3: Persist the engine assignment patch**

Apply `patch-assignments` with the planned allocation, then assert `component_assignments.resource_slot_id` is a positive integer and the matching `component_assignment_slots` row references the same host and slot.

- [ ] **Step 4: Remove and re-add the GPU in the test**

Apply a removal patch followed by a new assignment patch and verify the re-added assignment retains a compatible result and the numeric slot relationship. This covers the user-reported workflow rather than only initial import.

- [ ] **Step 5: Run the focused store tests**

Run: `bun test server/persistence/sqlite-store.bun_spec.ts`

Expected: all SQLite store tests pass.

---

### Task 4: Record and verify the user-visible fix

**Files:**
- Modify: `src/release-notes.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: the verified projection and assignment behavior.
- Produces: one consolidated unreleased fix entry.

- [ ] **Step 1: Update structured unreleased release notes**

Add a fix stating that typed PCIe storage and expansion generations remain distinct through SQLite projection so compatible GPUs and expansion cards no longer report missing slot generation.

- [ ] **Step 2: Update `CHANGELOG.md` Unreleased**

Add the same user-facing correction under `### Fixed`.

- [ ] **Step 3: Run complete verification**

Run: `bun run lint`, `bun run test`, and `bun run build`.

Expected: all commands exit zero. Container security preflight is deferred until a deployment is explicitly requested.

- [ ] **Step 4: Review the final diff**

Run: `git diff --check`, `git status --short`, and `git diff --stat`.

Confirm no runtime data, credentials, screenshots, version bump, tag, or deployment changes are included.
