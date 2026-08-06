import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { BackupService } from '../backup/backup-service.mjs'
import { HomelabInventoryStore } from '../db/store.mjs'
import { closeTelemetryDatabase, openTelemetryDatabase } from './database.mjs'
import { TelemetryRepository } from './repository.mjs'

const resources = []

function heartbeat(sequence, overrides = {}) {
  return {
    protocolMajor: 1,
    sequence,
    agentVersion: '0.1.0',
    collectedAt: new Date(Date.UTC(2026, 7, 5, 12, sequence)).toISOString(),
    host: { type: 'server', id: 1 },
    droppedSamples: 0,
    capabilities: { 'host.cpu': { state: 'available' } },
    metrics: { cpu: { percent: sequence * 10 }, memory: { usedBytes: sequence * 1024 } },
    services: [],
    containers: [],
    storageHealth: [],
    ...overrides,
  }
}

function receivedAt(sequence) {
  return new Date(Date.UTC(2026, 7, 5, 12, sequence, 30)).toISOString()
}

async function context() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hli-telemetry-backup-service-'))
  const store = new HomelabInventoryStore({
    appVersion: '1.0.0',
    dataDir,
    legacyProjectPath: path.join(dataDir, 'legacy.json'),
    saveDebounceMs: 1,
    seedEmptyData: false,
    seedDir: path.join(dataDir, 'missing-seed'),
  })
  await store.init()
  store.createInventoryItems({ type: 'server', name: 'Telemetry host' })
  const hostId = store.databases.inventory.data.servers[0].id
  store.databases.agents.data.devices['1'] = {
    id: 1,
    hostType: 'server',
    hostId,
    protocolMajor: 1,
    publicKey: 'test-public-key',
    agentVersion: '0.1.0',
    capabilities: {},
    createdAt: receivedAt(1),
    lastSeenAt: receivedAt(1),
    lastSequence: 1,
  }
  store.scheduleFlush('agents')
  await store.flush()

  const database = await openTelemetryDatabase({ dataDir })
  const repository = new TelemetryRepository(database)
  const service = new BackupService({
    store,
    appVersion: '1.0.0',
    telemetryRepository: repository,
  })
  await service.init()
  const resource = { dataDir, database, repository, service, store }
  resources.push(resource)
  return resource
}

afterEach(async () => {
  for (const resource of resources.splice(0)) {
    await resource.store.flush().catch(() => {})
    try { closeTelemetryDatabase(resource.database) } catch {}
    await fs.rm(resource.dataDir, { recursive: true, force: true })
  }
})

describe('portable telemetry backup integration', () => {
  test('round-trips SQLite history and derived projections through BackupService', async () => {
    const { repository, service } = await context()
    repository.recordHeartbeat({
      deviceId: 1,
      hostType: 'server',
      hostId: 1,
      receivedAt: receivedAt(1),
      payload: heartbeat(1, {
        services: [{ name: 'docker', activeState: 'active', enabled: true }],
        containers: [{ runtime: 'docker', runtimeId: 'abc', name: 'web', image: 'web:1', state: 'running' }],
      }),
    })

    const created = await service.create({ sections: ['agentTelemetry'], label: 'Telemetry baseline' })
    repository.recordHeartbeat({
      deviceId: 1,
      hostType: 'server',
      hostId: 1,
      receivedAt: receivedAt(2),
      payload: heartbeat(2),
    })
    expect(repository.getHostSummary('server', 1).sequence).toBe(2)
    expect(repository.listSamples('server', 1)).toHaveLength(2)

    const inspection = await service.inspect(created.archive)
    await expect(service.preflight(inspection.token, ['agentTelemetry']))
      .resolves.toMatchObject({ ok: true, sections: ['agentTelemetry'], blockers: [] })
    await expect(service.restore(inspection.token, ['agentTelemetry']))
      .resolves.toMatchObject({ ok: true, reloadRequired: true })

    const restored = repository.getHostSummary('server', 1)
    expect(restored.sequence).toBe(1)
    expect(restored.services.map((entry) => entry.state.name)).toEqual(['docker'])
    expect(restored.containers.map((entry) => entry.state.name)).toEqual(['web'])
    expect(repository.listSamples('server', 1).map((sample) => sample.sequence)).toEqual([1])
  })
})
