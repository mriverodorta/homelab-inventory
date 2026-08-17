import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { CORE_MIGRATIONS } from '../persistence/core/migrations/manifest.ts'
import { schema29ProductionShapeFixture } from '../persistence/fixtures/schema-29-production-shape.ts'
import { buildCanonicalIdentityPlan } from '../persistence/legacy/identity-plan.ts'
import { importLegacyCore } from '../persistence/migration/core-importer.ts'
import { openManagedDatabase } from '../persistence/sqlite/database.ts'
import { applyCommittedMigrations } from '../persistence/sqlite/migrator.ts'
import { SqliteHomelabInventoryStore } from '../persistence/sqlite-store.ts'
import { SYSTEMS_COLUMN_KEYS, SystemsSavedViewService, normalizeSystemsViewInput } from './saved-view-service.mjs'

const roots: string[] = []
const stores: SqliteHomelabInventoryStore[] = []

afterEach(async () => {
  for (const store of stores.splice(0)) store.close()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixtureStore() {
  const root = await mkdtemp(join(tmpdir(), 'homelab-inventory-systems-views-'))
  roots.push(root)
  const handle = await openManagedDatabase({ filePath: join(root, 'core.sqlite'), schemaName: 'core' })
  await applyCommittedMigrations(handle, await Promise.all(CORE_MIGRATIONS.map(async (migration) => ({
    id: migration.id,
    sha256: migration.sha256,
    sql: await readFile(resolve(import.meta.dir, '../persistence/core/migrations/generated', migration.file), 'utf8'),
  }))))
  const snapshot = schema29ProductionShapeFixture()
  importLegacyCore({ database: handle.database, snapshot, identityPlan: buildCanonicalIdentityPlan(snapshot) })
  const store = new SqliteHomelabInventoryStore({ core: handle })
  stores.push(store)
  return store
}

function input(name = 'My servers') {
  return {
    name,
    types: ['server'],
    registrations: ['registered'],
    registryStates: ['linked'],
    sortKey: 'name',
    sortDirection: 'ascending',
    density: 'dense',
    columns: SYSTEMS_COLUMN_KEYS.map((key, order) => ({
      key,
      order,
      visible: !['operatingSystem', 'uptime', 'lanIp'].includes(key),
    })),
    query: 'must not persist',
    widths: { name: 400 },
  }
}

describe('Systems saved view service', () => {
  test('normalizes synchronized configuration without search or widths', () => {
    expect(normalizeSystemsViewInput(input())).toEqual({
      name: 'My servers',
      types: ['server'],
      registrations: ['registered'],
      registryStates: ['linked'],
      sortKey: 'name',
      sortDirection: 'ascending',
      density: 'dense',
      columns: input().columns,
    })
    expect(() => normalizeSystemsViewInput({
      ...input(),
      columns: input().columns.map((column) => column.key === 'type' ? { ...column, visible: false } : column),
    })).toThrow('Type and Name must remain visible and first.')
  })

  test('isolates account and open-mode views and transfers open views to an administrator', async () => {
    const store = await fixtureStore()
    const service = new SystemsSavedViewService({ now: () => 1_800_000_000_000 })
    const open = service.create(store, { projectId: 1, input: input('Fleet') })
    expect(service.list(store, { projectId: 1 })).toHaveLength(1)
    expect(service.list(store, { projectId: 1, accountId: 1 })).toHaveLength(0)

    expect(service.transferOpenViewsToAccount(store, 1)).toEqual({ transferred: 1 })
    expect(service.list(store, { projectId: 1 })).toHaveLength(0)
    expect(service.list(store, { projectId: 1, accountId: 1 })[0]).toMatchObject({ id: open.id, name: 'Fleet', revision: 2 })
  })

  test('enforces optimistic revisions, unique names, and one default', async () => {
    const store = await fixtureStore()
    const service = new SystemsSavedViewService({ now: () => 1_800_000_000_000 })
    const first = service.create(store, { projectId: 1, input: input('Fleet') })
    const second = service.create(store, { projectId: 1, input: input('Online') })
    expect(() => service.create(store, { projectId: 1, input: input('fleet') })).toThrow('already exists')
    const defaultView = service.setDefault(store, { projectId: 1, viewId: first.id, expectedRevision: first.revision })
    expect(defaultView).toMatchObject({ isDefault: true, revision: 2 })
    const replacement = service.setDefault(store, { projectId: 1, viewId: second.id, expectedRevision: second.revision })
    expect(replacement.isDefault).toBe(true)
    expect(service.list(store, { projectId: 1 }).filter((view) => view.isDefault)).toHaveLength(1)
    expect(() => service.replace(store, {
      projectId: 1,
      viewId: first.id,
      expectedRevision: 1,
      input: input('Changed'),
    })).toThrow('changed in another session')
  })
})
