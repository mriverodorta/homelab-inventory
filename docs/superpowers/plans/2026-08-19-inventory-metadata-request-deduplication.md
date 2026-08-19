# Inventory Metadata Request Deduplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce a normal inventory metadata autosave from one write plus two redundant item reads to one authoritative write with idempotent data-bearing SSE synchronization.

**Architecture:** Publish sanitized item metadata in `inventory-metadata.item-changed` events, then use a project/item revision marker in TanStack Query to make mutation responses and SSE events converge regardless of delivery order. Normal events update cached item data and refresh affected aggregate projections once; only SSE resynchronization invalidates item queries for an HTTP recovery read.

**Tech Stack:** Bun, Express 5, Zod, React 19, TanStack Query, application SSE events, Vitest, Testing Library, Playwright browser verification.

## Global Constraints

- A tag selection or deselection issues one metadata `PUT` and zero follow-up item metadata `GET` requests.
- Successful mutation responses update item cache before any aggregate projection refresh.
- Normal SSE item events carry sanitized authoritative metadata and never invalidate item queries.
- Duplicate or stale event revisions cannot overwrite newer metadata or refresh projections twice.
- SSE resynchronization remains the authoritative HTTP recovery path for missed events.
- Cross-browser metadata changes remain visible without manual refresh.
- Existing `.superpowers/` runtime files remain untouched.
- Update the structured unreleased release notes and `CHANGELOG.md`; do not bump the app version or deploy.
- Complete verification includes `bun run lint`, `bun run test`, `bun run build`, `bun run security:container`, and browser testing against `http://127.0.0.1:7899/`.

---

### Task 1: Publish Sanitized Item Metadata In SSE Events

**Files:**
- Modify: `server/live-events/inventory-metadata-payloads.mjs`
- Modify: `server/live-events/inventory-metadata-payloads.test.mjs`
- Modify: `server/inventory-metadata/routes.mjs`
- Modify: `server/inventory-metadata/routes.test.mjs`

**Interfaces:**
- Produces: `inventoryMetadataItemPayload({ itemId, projectIds, metadata })` with a public `metadata` projection whose `itemId` matches the event item.
- Preserves: existing `inventory-metadata.item-changed` topic and kind names.

- [ ] **Step 1: Add failing payload tests for authoritative metadata and strict identifiers**

```js
const metadata = {
  itemId: 9,
  revision: 2,
  definitions: [],
  values: [],
  tags: [],
}
expect(inventoryMetadataItemPayload({ itemId: 9, projectIds: [3, 1, 3], metadata })).toEqual({
  itemId: 9,
  projectIds: [1, 3],
  metadata,
})
expect(() => inventoryMetadataItemPayload({
  itemId: 9,
  projectIds: [1],
  metadata: { ...metadata, itemId: 10 },
})).toThrow(/match/iu)
```

- [ ] **Step 2: Run the focused payload tests and verify the new assertions fail**

```bash
bunx vitest run server/live-events/inventory-metadata-payloads.test.mjs
```

- [ ] **Step 3: Extend the bounded payload constructor without exposing repository-only fields**

```js
export function inventoryMetadataItemPayload({ itemId, projectIds, metadata }) {
  const normalizedItemId = positiveId(itemId, 'Inventory item ID')
  if (metadata?.itemId !== normalizedItemId) {
    throw new Error('Inventory metadata item ID must match the event item ID.')
  }
  if (!Number.isSafeInteger(metadata.revision) || metadata.revision <= 0) {
    throw new Error('Inventory metadata revision must be a positive safe integer.')
  }
  return Object.freeze({
    itemId: normalizedItemId,
    projectIds: boundedPositiveIds(projectIds, 'Project ID'),
    metadata: Object.freeze(metadata),
  })
}
```

- [ ] **Step 4: Publish the same public projection used by the mutation response**

```js
const metadata = publicItemMetadata(result.metadata)
const payload = inventoryMetadataItemPayload({
  itemId: result.itemId,
  projectIds: result.affectedProjectIds,
  metadata,
})
```

- [ ] **Step 5: Prove repository-only normalized fields are absent from the response and event**

```js
expect(published.payload.metadata.tags[0]).not.toHaveProperty('normalizedName')
expect(published.payload.metadata.definitions[0]).not.toHaveProperty('normalizedName')
```

- [ ] **Step 6: Run focused server tests and commit the event contract**

```bash
bunx vitest run server/live-events/inventory-metadata-payloads.test.mjs server/inventory-metadata/routes.test.mjs
git add server/live-events/inventory-metadata-payloads.mjs server/live-events/inventory-metadata-payloads.test.mjs server/inventory-metadata/routes.mjs server/inventory-metadata/routes.test.mjs
git commit -m "fix: publish authoritative metadata events"
```

### Task 2: Make Mutation And SSE Cache Updates Idempotent

**Files:**
- Create: `src/lib/inventory-metadata-live.ts`
- Create: `src/lib/inventory-metadata-live.test.ts`
- Modify: `src/lib/inventory-metadata-query.ts`
- Modify: `src/lib/inventory-metadata-query.test.ts`

**Interfaces:**
- Produces: `inventoryMetadataItemChangedPayloadSchema`.
- Produces: `applyInventoryMetadataItemChange(queryClient, payload): readonly number[]`, returning project IDs whose aggregate projections need refresh.
- Produces: `commitInventoryMetadataMutation(queryClient, ref, result): readonly number[]` using the same revision marker.
- Marker key: `inventoryMetadataKeys.itemRevision(projectId, itemId)`.

- [ ] **Step 1: Write failing cache tests for mutation/event ordering and stale revisions**

```ts
commitInventoryMetadataMutation(queryClient, ref, mutationResult)
expect(queryClient.getQueryData(inventoryMetadataKeys.item(1, ref))).toEqual(mutationResult.metadata)
expect(applyInventoryMetadataItemChange(queryClient, sameRevisionEvent)).toEqual([])
expect(applyInventoryMetadataItemChange(queryClient, newerRevisionEvent)).toEqual([1])
expect(queryClient.getQueryData(inventoryMetadataKeys.item(1, ref))).toEqual(newerRevisionEvent.metadata)
expect(applyInventoryMetadataItemChange(queryClient, olderRevisionEvent)).toEqual([])
```

- [ ] **Step 2: Run focused client tests and verify the helpers are missing**

```bash
bunx vitest run src/lib/inventory-metadata-live.test.ts src/lib/inventory-metadata-query.test.ts
```

- [ ] **Step 3: Implement strict event parsing and revision-aware cache application**

```ts
export const inventoryMetadataItemChangedPayloadSchema = z.strictObject({
  itemId: positiveId,
  projectIds: z.array(positiveId),
  metadata: inventoryItemMetadataSchema,
}).superRefine((value, context) => {
  if (value.itemId !== value.metadata.itemId) {
    context.addIssue({ code: 'custom', message: 'Event and metadata item IDs must match.' })
  }
})
```

For each project, compare the incoming metadata revision with the marker. When it is newer, update all cached item queries under that project's item prefix whose current `itemId` matches, then advance the marker and return the project ID once.

- [ ] **Step 4: Commit mutation results before refreshing projections**

```ts
onSuccess: async (result, variables) => {
  const projectIds = commitInventoryMetadataMutation(queryClient, variables.ref, result)
  await refreshProjectProjections(projectIds)
}
```

Remove the existing `refreshProjects` item-prefix invalidation from normal mutation success.

- [ ] **Step 5: Route all normal project metadata SSE events through the shared helper**

```ts
onEvent: (event) => {
  if (event.kind !== 'inventory-metadata.item-changed') return
  const payload = inventoryMetadataItemChangedPayloadSchema.safeParse(event.payload)
  if (!payload.success) return
  for (const id of applyInventoryMetadataItemChange(queryClient, payload.data)) {
    void queryClient.invalidateQueries({ queryKey: inventoryMetadataKeys.projectProjections(id) })
  }
}
```

Both item and projection hooks may receive the same topic event; the revision marker ensures only the first subscriber updates data and refreshes projections.

- [ ] **Step 6: Keep HTTP recovery only in `onResync`**

```ts
onResync: () => {
  void queryClient.invalidateQueries({ queryKey: inventoryMetadataKeys.projectItems(projectId) })
  void queryClient.invalidateQueries({ queryKey: inventoryMetadataKeys.projectProjections(projectId) })
}
```

- [ ] **Step 7: Run focused tests and commit the client cache behavior**

```bash
bunx vitest run src/lib/inventory-metadata-live.test.ts src/lib/inventory-metadata-query.test.ts src/components/inventory-metadata/use-inventory-metadata-autosave.test.tsx
git add src/lib/inventory-metadata-live.ts src/lib/inventory-metadata-live.test.ts src/lib/inventory-metadata-query.ts src/lib/inventory-metadata-query.test.ts
git commit -m "fix: deduplicate metadata cache refreshes"
```

### Task 3: Release Notes And End-To-End Verification

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `src/release-notes.ts`
- Test: local candidate at `http://127.0.0.1:7899/`

**Interfaces:**
- Documents: metadata autosave uses its authoritative response and data-bearing SSE events without duplicate item reads.
- Verifies: one `PUT`, zero item metadata `GET` requests per tag toggle.

- [ ] **Step 1: Add the user-visible fix to both unreleased release-note surfaces**

```md
- Inventory metadata autosave now reuses its authoritative response and data-bearing SSE event instead of issuing duplicate item reads after every tag or custom-field change.
```

- [ ] **Step 2: Run complete static and automated verification**

```bash
bun run lint
bun run test
bun run build
bun run db:migrations:check
bun run security:container
```

- [ ] **Step 3: Rebuild and start the isolated local candidate on port 7899**

Use the existing local candidate Compose/runtime workflow and verify `/api/health` reports healthy schema 28 before browser interaction.

- [ ] **Step 4: Capture tag selection and deselection network behavior**

For each toggle, assert:

```text
PUT /api/inventory/items/<type>/<id>/metadata: 1
GET /api/inventory/items/<type>/<id>/metadata: 0
```

Also verify the editor reaches `Saved`, no workspace-engine synchronization or cable-routing activity occurs, and the item metadata revision advances once.

- [ ] **Step 5: Verify cross-browser SSE synchronization**

Open a second browser context on the same item, toggle the tag in the first, and assert the second reflects the new tag without reload or metadata `GET`.

- [ ] **Step 6: Verify reconnect recovery and restore copied data**

Interrupt and reconnect the SSE stream, make an out-of-band metadata change, and assert resynchronization performs one authoritative item read. Restore the local candidate's copied data and confirm inventory, project, assignment, placement, connection, and route-cache invariants remain unchanged.

- [ ] **Step 7: Commit release notes and final verification adjustments**

```bash
git add CHANGELOG.md src/release-notes.ts
git commit -m "docs: note metadata request deduplication"
git status --short
```

