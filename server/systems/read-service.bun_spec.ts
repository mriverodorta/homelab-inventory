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
import { SystemsReadService } from './read-service.mjs'

const roots: string[] = []
const stores: SqliteHomelabInventoryStore[] = []

afterEach(async () => {
  for (const store of stores.splice(0)) store.close()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixtureStore() {
  const root = await mkdtemp(join(tmpdir(), 'homelab-inventory-systems-'))
  roots.push(root)
  const handle = await openManagedDatabase({ filePath: join(root, 'core.sqlite'), schemaName: 'core' })
  await applyCommittedMigrations(handle, await Promise.all(CORE_MIGRATIONS.map(async (migration) => ({
    id: migration.id,
    sha256: migration.sha256,
    sql: await readFile(resolve(import.meta.dir, '../persistence/core/migrations/generated', migration.file), 'utf8'),
  }))))
  const snapshot = schema29ProductionShapeFixture()
  importLegacyCore({ database: handle.database, snapshot, identityPlan: buildCanonicalIdentityPlan(snapshot) })
  const store = new SqliteHomelabInventoryStore({ core: handle, appVersion: '0.13.0' })
  stores.push(store)
  return store
}

describe('Systems read service', () => {
  test('builds compact host summaries and mutable live projections', async () => {
    const store = await fixtureStore()
    const telemetry = new Map([[1, {
      hostItemId: 1,
      receivedAt: '2026-08-17T16:40:00.000Z',
      agentVersion: '0.1.8',
      cpuPercent: 25,
      memoryPercent: 50,
      memory: {
        totalBytes: 32_000,
        availableBytes: 16_000,
        cachedBytes: 8_000,
        buffersBytes: 1_000,
        sharedBytes: null,
      },
      uptimeSeconds: 3_600,
      system: { operatingSystem: 'Ubuntu', osVersion: '24.04', lanIp: '192.0.2.10' },
      rootFilesystem: { totalBytes: 100_000_000_000, usedBytes: 90_000_000_000 },
    }]])
    const releaseService = {
      current: () => ({ version: '0.2.0' }),
      updateAvailable: () => true,
      upgradeCommands: () => ({
        linux: 'sudo homelab-inventory-agent update',
        alpine: 'homelab-inventory-agent update',
        freebsd: 'sudo homelab-inventory-agent update',
      }),
    }
    const service = new SystemsReadService({
      telemetryRepository: { getSystemsSnapshot: () => telemetry },
      releaseService,
      now: () => Date.parse('2026-08-17T16:40:30.000Z'),
    })

    const initial = service.initial(store, 1, 'https://inventory.example')
    expect(initial.currentAgentVersion).toBe('0.2.0')
    expect(initial.systems).toHaveLength(1)
    expect(initial.systems[0]).toMatchObject({
      itemKey: 'server:7',
      name: 'Example Micro Host',
      cpuLabel: 'Example CPU',
      memoryLabel: '16GB DDR4 3200MHz',
      storageLabel: '1TB NVMe',
      operatingSystem: 'Ubuntu 24.04',
      lanIp: '192.0.2.10',
      agentRegistered: true,
      agentState: 'online',
      agentUpdateAvailable: true,
      agentUpdateCommand: 'sudo homelab-inventory-agent update',
      cpuPercent: 25,
      memoryPercent: 50,
      storagePercent: 90,
      uptimeSeconds: 3_600,
      attentionCount: 0,
      attentionState: 'refreshing',
      attentionRevision: 0,
    })

    telemetry.get(1)!.system = { operatingSystem: 'Alpine Linux', osVersion: '3.22' }
    expect(service.initial(store, 1, 'https://inventory.example').systems[0]).toMatchObject({
      operatingSystem: 'Alpine Linux 3.22',
      agentUpdateCommand: 'homelab-inventory-agent update',
    })

    expect(service.live(store, 1, 'https://inventory.example').systems).toEqual([{
      itemId: initial.systems[0].itemId,
      itemKey: 'server:7',
      agentRegistered: true,
      agentState: 'online',
      agentVersion: '0.1.8',
      agentUpdateAvailable: true,
      cpuPercent: 25,
      memoryPercent: 50,
      storagePercent: 90,
      uptimeSeconds: 3_600,
      attentionCount: 0,
      attentionState: 'refreshing',
      attentionRevision: 0,
    }])
  })

  test('keeps hosts without agents in initial and minimal live projections', async () => {
    const store = await fixtureStore()
    store.core.database.query("UPDATE agent_host_bindings SET state = 'unlinked', unbound_at_ms = ?").run(Date.now())
    const service = new SystemsReadService({
      telemetryRepository: { getSystemsSnapshot: () => new Map([[1, {
        hostItemId: 1,
        receivedAt: '2026-08-17T16:40:00.000Z',
        cpuPercent: 75,
        memoryPercent: 80,
        rootFilesystem: { totalBytes: 100, usedBytes: 90 },
      }]]) },
      now: () => Date.parse('2026-08-17T16:40:30.000Z'),
    })

    expect(service.initial(store, 1, 'https://inventory.example').systems[0]).toMatchObject({
      agentRegistered: false,
      agentState: 'unregistered',
      cpuPercent: null,
      memoryPercent: null,
      storagePercent: null,
      uptimeSeconds: null,
      attentionCount: 0,
      attentionState: 'refreshing',
      attentionRevision: 0,
    })
    expect(service.live(store, 1, 'https://inventory.example').systems).toEqual([])
  })

  test('omits stale metrics and falls back to the first assigned storage device', async () => {
    const store = await fixtureStore()
    const service = new SystemsReadService({
      telemetryRepository: { getSystemsSnapshot: () => new Map([[1, {
        hostItemId: 1,
        receivedAt: '2026-08-17T16:30:00.000Z',
        cpuPercent: 75,
        memoryPercent: 80,
        rootFilesystem: { totalBytes: 100, usedBytes: 90 },
      }]]) },
      now: () => Date.parse('2026-08-17T16:40:30.000Z'),
    })

    expect(service.initial(store, 1, 'https://inventory.example').systems[0]).toMatchObject({
      agentState: 'offline',
      storageLabel: '1TB NVMe',
      cpuPercent: null,
      memoryPercent: null,
      storagePercent: null,
    })
  })

  test('derives pressure from available memory without exposing composition in Systems payloads', async () => {
    const store = await fixtureStore()
    const service = new SystemsReadService({
      telemetryRepository: { getSystemsSnapshot: () => new Map([[1, {
        hostItemId: 1,
        receivedAt: '2026-08-17T16:40:00.000Z',
        memoryPercent: 40,
        memory: {
          totalBytes: 16_000,
          availableBytes: 9_600,
        },
      }]]) },
      now: () => Date.parse('2026-08-17T16:40:30.000Z'),
    })

    const system = service.initial(store, 1, 'https://inventory.example').systems[0]
    expect(system.memoryPercent).toBe(40)
    expect(system).not.toHaveProperty('memoryBreakdown')
  })
})
