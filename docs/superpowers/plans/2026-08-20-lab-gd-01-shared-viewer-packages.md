# lab.gd Shared Viewer Packages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish deterministic share contracts and reusable read-only Systems, Canvas, workbook, and inspector packages from Homelab Inventory without exposing editor or persistence code.

**Architecture:** Add three public packages under `packages/`. `share-contract` owns closed Zod schemas, canonical serialization, privacy classification, and hashes. `viewer-model` converts validated share data into immutable read models. `viewer-react` renders those models and emits selection/navigation intents without importing application APIs.

**Tech Stack:** Bun, TypeScript, Zod 4, React 19, React DOM 19, XYFlow, Lucide, Vitest, npm organization `@homelab-inventory`.

## Global Constraints

- Design authority: `docs/superpowers/specs/2026-08-20-lab-gd-sharing-platform-design.md` at commit `05a5244`.
- Initial `shareContractVersion` is `1`; initial view schemas are `systems@1` and `canvas@1`.
- Registry references always include exact `templateKey`, `templateRevision`, and `contentHash`; never resolve `latest`.
- Unknown contract fields fail closed; absent optional fields remain absent.
- Shared packages contain no API clients, persistence, editing, authentication, telemetry transport, or Registry credentials.
- Public packages use explicit `files` allowlists and must contain no private runtime data.
- Do not publish npm packages until the coordinated rollout plan authorizes publication.
- Update the unreleased structured release notes and `CHANGELOG.md` for user-visible behavior.

---

### Task 1: Scaffold The Public Packages And Contract Version

**Files:**
- Modify: `package.json`
- Create: `packages/share-contract/package.json`
- Create: `packages/share-contract/tsconfig.json`
- Create: `packages/share-contract/src/index.ts`
- Create: `packages/share-contract/src/version.ts`
- Create: `packages/share-contract/test/version.test.ts`
- Create: `packages/share-contract/LICENSE`

**Interfaces:**
- Produces: `SHARE_CONTRACT_VERSION`, `SUPPORTED_VIEW_SCHEMAS`, `ShareViewType`.
- Consumes: root TypeScript and Vitest configuration.

- [ ] **Step 1: Write the failing package-version test**

```ts
import { describe, expect, it } from 'vitest'
import { SHARE_CONTRACT_VERSION, SUPPORTED_VIEW_SCHEMAS } from '../src'

describe('share contract version', () => {
  it('advertises only the frozen initial views', () => {
    expect(SHARE_CONTRACT_VERSION).toBe(1)
    expect(SUPPORTED_VIEW_SCHEMAS).toEqual({ systems: 1, canvas: 1 })
  })
})
```

- [ ] **Step 2: Run the package test and verify the missing-module failure**

Run: `bunx vitest run packages/share-contract/test/version.test.ts`

Expected: FAIL because `packages/share-contract/src/index.ts` does not exist.

- [ ] **Step 3: Add the package manifests and version exports**

```ts
export const SHARE_CONTRACT_VERSION = 1 as const
export const SUPPORTED_VIEW_SCHEMAS = Object.freeze({ systems: 1, canvas: 1 } as const)
export type ShareViewType = keyof typeof SUPPORTED_VIEW_SCHEMAS
```

The package manifest must use `name: "@homelab-inventory/share-contract"`, `private: false`, ESM exports, and `files: ["src", "README.md", "LICENSE"]`. Add root Bun workspaces for `packages/*` and a `test:share-packages` script that runs all three package test directories. Copy the repository MIT license byte-for-byte into every public package before packing.

- [ ] **Step 4: Run the focused test and typecheck**

Run: `bunx vitest run packages/share-contract/test/version.test.ts && bunx tsc -p packages/share-contract/tsconfig.json --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit the package foundation**

```bash
git add package.json packages/share-contract
git commit -m "feat: add sharing contract package foundation"
```

### Task 2: Define Closed Share Schemas And Canonical Hashing

**Files:**
- Create: `packages/share-contract/src/schema.ts`
- Create: `packages/share-contract/src/canonicalize.ts`
- Create: `packages/share-contract/src/hash.ts`
- Create: `packages/share-contract/src/privacy.ts`
- Modify: `packages/share-contract/src/index.ts`
- Create: `packages/share-contract/test/schema.test.ts`
- Create: `packages/share-contract/test/hash.test.ts`
- Create: `packages/share-contract/test/privacy.test.ts`

**Interfaces:**
- Produces: `ShareManifestSchema`, `ShareViewBlobSchema`, `parseShareManifest`, `canonicalShareJson`, `shareContentHash`, `classifyShareField`.
- Consumes: `SHARE_CONTRACT_VERSION`, `SUPPORTED_VIEW_SCHEMAS`.

- [ ] **Step 1: Write failing closed-schema and privacy tests**

```ts
expect(() => parseShareManifest({ ...validManifest, unknown: true })).toThrow()
expect(classifyShareField('serialNumber')).toBe('forbidden')
expect(classifyShareField('tags')).toBe('explicit-opt-in')
expect(classifyShareField('name')).toBe('safe-default')
```

The valid fixture must contain generated public IDs, a project label, ordered view descriptors, content hashes, visibility, mutability, update mode, and renderer feature flags. It must not contain relational database IDs.

- [ ] **Step 2: Run the tests and verify schema helpers are absent**

Run: `bunx vitest run packages/share-contract/test/schema.test.ts packages/share-contract/test/privacy.test.ts`

Expected: FAIL with missing exports.

- [ ] **Step 3: Implement strict schemas and privacy classification**

Use `z.strictObject` at signed boundaries. Define:

```ts
export const RegistryReferenceSchema = z.strictObject({
  templateKey: z.string().min(1).max(240),
  templateRevision: z.number().int().positive().safe(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
})

export const ShareViewDescriptorSchema = z.strictObject({
  publicViewId: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
  type: z.enum(['systems', 'canvas']),
  schemaVersion: z.number().int().positive().safe(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  sortOrder: z.number().int().nonnegative().safe(),
  name: z.string().trim().min(1).max(120),
})
```

Represent visibility, expiration, comments/reactions, embed policy, and resource-snapshot options as discriminated unions so invalid combinations cannot parse.

- [ ] **Step 4: Write failing canonicalization vectors**

```ts
expect(canonicalShareJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}')
expect(await shareContentHash({ b: 2, a: 1 })).toBe(await shareContentHash({ a: 1, b: 2 }))
expect(canonicalShareJson({ value: undefined })).toBe('{}')
```

- [ ] **Step 5: Implement canonical JSON and SHA-256**

Canonicalization must sort object keys recursively, preserve array order, reject non-finite numbers, reject unsupported values, and omit undefined object properties. Hash UTF-8 canonical bytes with Web Crypto so Bun and browsers produce identical output.

- [ ] **Step 6: Run package tests and commit**

Run: `bunx vitest run packages/share-contract && bunx tsc -p packages/share-contract/tsconfig.json --noEmit`

Expected: PASS.

```bash
git add packages/share-contract
git commit -m "feat: define deterministic share contract"
```

### Task 3: Add Contract Fixtures And Compatibility Negotiation

**Files:**
- Create: `packages/share-contract/src/negotiation.ts`
- Create: `packages/share-contract/test/fixtures/systems-v1.json`
- Create: `packages/share-contract/test/fixtures/canvas-v1.json`
- Create: `packages/share-contract/test/fixtures/manifest-v1.json`
- Create: `packages/share-contract/test/negotiation.test.ts`
- Modify: `packages/share-contract/src/index.ts`

**Interfaces:**
- Produces: `negotiateShareCapabilities(client, server): ShareNegotiationResult`.
- Consumes: contract and per-view versions.

- [ ] **Step 1: Write failing negotiation tests**

```ts
expect(negotiateShareCapabilities(clientV1, serverV1)).toEqual({ ok: true })
expect(negotiateShareCapabilities(
  { ...clientV1, views: { ...clientV1.views, rack: 1 } },
  serverV1,
)).toEqual({ ok: false, code: 'unsupported-view', viewType: 'rack' })
expect(negotiateShareCapabilities({ ...clientV1, contractVersion: 2 }, serverV1).ok).toBe(false)
```

- [ ] **Step 2: Run the test and verify failure**

Run: `bunx vitest run packages/share-contract/test/negotiation.test.ts`

Expected: FAIL with missing negotiation export.

- [ ] **Step 3: Implement exact negotiation and frozen fixtures**

Return stable error codes: `unsupported-contract`, `unsupported-view`, `unsupported-view-version`, and `unsupported-feature`. Never silently drop a selected view or feature.

- [ ] **Step 4: Verify every fixture parses and hashes deterministically**

Run: `bunx vitest run packages/share-contract`

Expected: PASS and snapshot hashes remain stable on a second run.

- [ ] **Step 5: Commit fixtures and negotiation**

```bash
git add packages/share-contract
git commit -m "test: freeze sharing contract fixtures"
```

### Task 4: Build The Framework-Neutral Viewer Model

**Files:**
- Create: `packages/viewer-model/package.json`
- Create: `packages/viewer-model/tsconfig.json`
- Create: `packages/viewer-model/src/index.ts`
- Create: `packages/viewer-model/src/workbook.ts`
- Create: `packages/viewer-model/src/systems.ts`
- Create: `packages/viewer-model/src/canvas.ts`
- Create: `packages/viewer-model/src/deep-links.ts`
- Create: `packages/viewer-model/test/systems.test.ts`
- Create: `packages/viewer-model/test/canvas.test.ts`
- Create: `packages/viewer-model/test/deep-links.test.ts`
- Create: `packages/viewer-model/LICENSE`

**Interfaces:**
- Produces: `createSharedWorkbookModel`, `createSharedSystemsModel`, `createSharedCanvasModel`, `parseShareDeepLink`, and immutable public view-model types.
- Consumes: parsed `@homelab-inventory/share-contract` fixtures.

- [ ] **Step 1: Write failing Systems and workbook projection tests**

```ts
const model = createSharedSystemsModel(systemsFixture)
expect(model.rows.map((row) => row.publicItemId)).toEqual(['item_server_a'])
expect(model.rows[0]).not.toHaveProperty('serialNumber')
expect(createSharedWorkbookModel(manifestFixture).views[0].type).toBe('systems')
```

- [ ] **Step 2: Write failing Canvas and deep-link tests**

```ts
const canvas = createSharedCanvasModel(canvasFixture)
expect(canvas.nodes).toHaveLength(2)
expect(canvas.connections[0].source.publicItemId).toBe('item_server_a')
expect(parseShareDeepLink('?view=view_canvas&item=item_server_a')).toEqual({
  viewId: 'view_canvas', itemId: 'item_server_a', connectionId: null,
})
```

- [ ] **Step 3: Implement immutable projections**

Every projection must return frozen data, preserve manifest order, validate references, and use generated public IDs. Systems filtering and sorting should adapt the pure behavior currently in `src/components/workbook/systems/systems-table-model.ts` without importing React. Canvas projection may reuse pure formatting/index concepts, but must not import routing workers or mutation callbacks.

- [ ] **Step 4: Run package tests and typecheck**

Run: `bunx vitest run packages/viewer-model && bunx tsc -p packages/viewer-model/tsconfig.json --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit the viewer model**

```bash
git add packages/viewer-model
git commit -m "feat: add read-only sharing viewer model"
```

### Task 5: Build The Read-Only React Viewer Package

**Files:**
- Create: `packages/viewer-react/package.json`
- Create: `packages/viewer-react/tsconfig.json`
- Create: `packages/viewer-react/src/index.ts`
- Create: `packages/viewer-react/src/workbook-viewer.tsx`
- Create: `packages/viewer-react/src/systems-viewer.tsx`
- Create: `packages/viewer-react/src/canvas-viewer.tsx`
- Create: `packages/viewer-react/src/share-inspector.tsx`
- Create: `packages/viewer-react/src/viewer.css`
- Create: `packages/viewer-react/test/workbook-viewer.test.tsx`
- Create: `packages/viewer-react/test/canvas-viewer.test.tsx`
- Create: `packages/viewer-react/LICENSE`

**Interfaces:**
- Produces: `SharedWorkbookViewer`, `SharedSystemsViewer`, `SharedCanvasViewer`, `SharedInspector`, `ShareViewerIntent`.
- Consumes: immutable models from `viewer-model`.

- [ ] **Step 1: Write failing navigation and read-only tests**

```tsx
render(<SharedWorkbookViewer model={model} onIntent={onIntent} />)
await user.click(screen.getByRole('tab', { name: 'Canvas' }))
expect(onIntent).toHaveBeenCalledWith({ type: 'select-view', publicViewId: 'view_canvas' })
expect(screen.queryByRole('button', { name: /delete|edit|save/i })).not.toBeInTheDocument()
```

- [ ] **Step 2: Run the focused test and verify missing components**

Run: `bunx vitest run packages/viewer-react/test/workbook-viewer.test.tsx`

Expected: FAIL with missing exports.

- [ ] **Step 3: Implement the viewer shell and intents**

Define intents as a closed union:

```ts
export type ShareViewerIntent =
  | { type: 'select-view'; publicViewId: string }
  | { type: 'select-item'; publicViewId: string; publicItemId: string }
  | { type: 'select-connection'; publicViewId: string; publicConnectionId: string }
  | { type: 'clear-selection' }
  | { type: 'fit-view' }
```

Render Canvas with XYFlow in non-editable mode. Do not mount DnD, route calculation,
engine workers, keyboard editing, or persistence hooks. Preserve pan, zoom, fit,
selection, centering, and inspector rendering. Namespace package CSS under one
viewer root, export it explicitly, and do not depend on Homelab Inventory's
global Tailwind output or private shadcn component files.

- [ ] **Step 4: Verify responsive and accessibility behavior**

Add tests for keyboard tab selection, Escape closing the inspector, mobile tab
overflow, no page-level horizontal overflow, and reduced-motion behavior.

Run: `bunx vitest run packages/viewer-react && bunx tsc -p packages/viewer-react/tsconfig.json --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit the viewer components**

```bash
git add packages/viewer-react
git commit -m "feat: add reusable read-only React viewer"
```

### Task 6: Make Homelab Inventory Consume Its Own Packages

**Files:**
- Modify: `src/components/workbook/systems/systems-table-model.ts`
- Modify: `src/components/canvas/use-canvas-project-model.ts`
- Modify: `src/components/workbook/workbook-tab-strip.tsx`
- Create: `src/components/share-viewer-package-parity.test.tsx`
- Modify: `tsconfig.app.json`
- Modify: `vite.config.ts`

**Interfaces:**
- Produces: one implementation of shared read-only projections used by both the private app and `lab.gd`.
- Consumes: all three new packages through workspace imports.

- [ ] **Step 1: Add failing package-parity tests**

For representative production-shaped Systems and Canvas fixtures, assert that
the package projection matches the current application labels, ordering,
placement, ports, connection endpoints, and inspector-safe fields.

- [ ] **Step 2: Run parity tests and record the expected differences**

Run: `bunx vitest run src/components/share-viewer-package-parity.test.tsx`

Expected: FAIL until the local pure helpers delegate to package exports.

- [ ] **Step 3: Replace duplicate pure logic with package imports**

Keep editor-only wrappers and callbacks in `src/`. Move or delegate only pure
read-only behavior. Do not move Canvas routing, drag/drop, mutation, persistence,
agent queries, or permissions into the packages.

- [ ] **Step 4: Run the application and package suites**

Run: `bun run lint && bun run test && bun run build`

Expected: PASS with no viewer behavior regressions.

- [ ] **Step 5: Commit package adoption**

```bash
git add src tsconfig.app.json vite.config.ts
git commit -m "refactor: consume shared viewer packages"
```

### Task 7: Add Package Audit And Dry-Run Publication

**Files:**
- Create: `scripts/check-share-packages.mjs`
- Create: `scripts/check-share-packages.test.mjs`
- Modify: `package.json`
- Create: `packages/share-contract/README.md`
- Create: `packages/viewer-model/README.md`
- Create: `packages/viewer-react/README.md`
- Modify: `CHANGELOG.md`
- Modify: `src/release-notes.ts`

**Interfaces:**
- Produces: `bun run packages:share:check` and reproducible npm tarballs.
- Consumes: npm pack manifests and Git status.

- [ ] **Step 1: Write the failing package-content audit**

The test must reject tarballs containing `.env`, `data/`, screenshots, source
maps, credentials, app server code, editor modules, or files outside each
package's explicit allowlist.

- [ ] **Step 2: Implement the dry-run auditor**

Run `npm pack --dry-run --json` for each package, verify package names and public
access metadata, assert dependency direction
`share-contract -> viewer-model -> viewer-react`, and fail on uncommitted package
changes.

- [ ] **Step 3: Document public APIs and version policy**

Document that package versions are independent SemVer, breaking contract changes
require a new share contract version, and private service consumers pin exact
versions.

- [ ] **Step 4: Run all checks**

Run: `bun run packages:share:check && bun run lint && bun run test && bun run build && bun run security:container`

Expected: all checks pass; no package is published.

- [ ] **Step 5: Commit the completed package track**

```bash
git add package.json scripts packages CHANGELOG.md src/release-notes.ts
git commit -m "chore: prepare shared viewer packages for publication"
```
