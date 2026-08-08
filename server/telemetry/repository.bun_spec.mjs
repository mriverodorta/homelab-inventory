import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { closeTelemetryDatabase, openTelemetryDatabase } from './database.mjs'
import { TelemetryRepository } from './repository.mjs'

const resources = []

async function context(options) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hli-telemetry-repository-'))
  const database = await openTelemetryDatabase({ dataDir })
  const resource = { dataDir, database }
  resources.push(resource)
  return { ...resource, repository: new TelemetryRepository(database, options) }
}

function heartbeat(sequence, overrides = {}) {
  return {
    protocolMajor: 1,
    sequence,
    agentVersion: '0.1.0-dev',
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

function currentStores() {
  return {
    inventory: { servers: [{ id: 1 }], nas: [], pcBuilds: [] },
    agents: { devices: { 7: { id: 7, hostType: 'server', hostId: 1 } } },
  }
}

afterEach(async () => {
  for (const resource of resources.splice(0)) {
    try { closeTelemetryDatabase(resource.database) } catch {}
    await fs.rm(resource.dataDir, { recursive: true, force: true })
  }
})

describe('telemetry repository', () => {
  test('atomically stores samples, latest host state, and component transitions', async () => {
    const { database, repository } = await context()
    repository.recordHeartbeat({
      deviceId: 7,
      hostType: 'server',
      hostId: 1,
      receivedAt: receivedAt(1),
      payload: heartbeat(1, {
        services: [{ name: 'docker', activeState: 'active', enabled: true }],
        containers: [{ runtime: 'docker', runtimeId: 'abc', name: 'web', image: 'web:1', state: 'running' }],
        storageHealth: [{ deviceId: 'disk-a', kind: 'smart', state: 'healthy', collectedAt: receivedAt(1), metrics: {} }],
      }),
    })

    const summary = repository.getHostSummary('server', 1)
    expect(summary.sequence).toBe(1)
    expect(summary.payload.metrics.cpu.percent).toBe(10)
    expect(summary.services.map((entry) => entry.state.name)).toEqual(['docker'])
    expect(summary.containers.map((entry) => entry.state.name)).toEqual(['web'])
    expect(summary.storageHealth.map((entry) => entry.state.deviceId)).toEqual(['disk-a'])
    expect(database.query('SELECT COUNT(*) AS count FROM component_events').get().count).toBe(3)

    repository.recordHeartbeat({
      deviceId: 7,
      hostType: 'server',
      hostId: 1,
      receivedAt: receivedAt(2),
      payload: heartbeat(2, {
        services: [{ name: 'docker', activeState: 'failed', enabled: true }],
      }),
    })
    expect(repository.getHostSummary('server', 1).services[0].state.activeState).toBe('failed')
    expect(database.query("SELECT COUNT(*) AS count FROM component_events WHERE event_kind = 'changed'").get().count).toBe(1)
    expect(database.query("SELECT COUNT(*) AS count FROM component_events WHERE event_kind = 'removed'").get().count).toBe(2)
  })

  test('rolls back every projection when a duplicate device sequence fails', async () => {
    const { database, repository } = await context()
    repository.recordHeartbeat({ deviceId: 7, hostType: 'server', hostId: 1, receivedAt: receivedAt(1), payload: heartbeat(1) })

    expect(() => repository.recordHeartbeat({
      deviceId: 7,
      hostType: 'server',
      hostId: 1,
      receivedAt: receivedAt(2),
      payload: heartbeat(1, { metrics: { cpu: { percent: 99 } } }),
    })).toThrow()

    expect(repository.getHostSummary('server', 1).payload.metrics.cpu.percent).toBe(10)
    expect(database.query('SELECT COUNT(*) AS count FROM telemetry_samples').get().count).toBe(1)
  })

  test('returns bounded chronological ranges and never touches the project store', async () => {
    const { dataDir, repository } = await context()
    const projectPath = path.join(dataDir, 'stores', 'project.json')
    await fs.mkdir(path.dirname(projectPath), { recursive: true })
    await fs.writeFile(projectPath, '{"revision":42}\n')
    const before = createHash('sha256').update(await fs.readFile(projectPath)).digest('hex')

    for (let sequence = 1; sequence <= 4; sequence += 1) {
      repository.recordHeartbeat({ deviceId: 7, hostType: 'server', hostId: 1, receivedAt: receivedAt(sequence), payload: heartbeat(sequence) })
    }
    const samples = repository.listSamples('server', 1, {
      from: receivedAt(1),
      to: receivedAt(4),
      limit: 2,
    })
    expect(samples.map((sample) => sample.sequence)).toEqual([3, 4])
    expect(createHash('sha256').update(await fs.readFile(projectPath)).digest('hex')).toBe(before)
  })

  test('deletes every telemetry projection for one host without touching another host', async () => {
    const { database, repository } = await context()
    repository.recordHeartbeat({
      deviceId: 7,
      hostType: 'server',
      hostId: 1,
      receivedAt: receivedAt(1),
      payload: heartbeat(1, { services: [{ name: 'docker', activeState: 'active' }] }),
    })
    repository.recordHeartbeat({
      deviceId: 8,
      hostType: 'nas',
      hostId: 1,
      receivedAt: receivedAt(2),
      payload: heartbeat(2, { host: { type: 'nas', id: 1 }, containers: [{ runtime: 'docker', runtimeId: 'nas', name: 'nas', image: 'nas:1', state: 'running' }] }),
    })

    const deleted = repository.deleteHost('server', 1)
    expect(deleted).toMatchObject({ telemetry_samples: 1, latest_host_state: 1, latest_component_state: 1 })
    expect(repository.getHostSummary('server', 1)).toBeNull()
    expect(repository.getHostSummary('nas', 1)?.sequence).toBe(2)
    expect(database.query("SELECT COUNT(*) AS count FROM telemetry_samples WHERE host_type = 'nas'").get().count).toBe(1)
  })

  test('checkpoints unchanged storage health without duplicating every heartbeat', async () => {
    const { database, repository } = await context({ storageCheckpointMs: 60_000 })
    const disk = { deviceId: 'disk-a', kind: 'smart', state: 'healthy', collectedAt: receivedAt(1), metrics: { temperatureC: 30 } }
    repository.recordHeartbeat({ deviceId: 7, hostType: 'nas', hostId: 1, receivedAt: receivedAt(1), payload: heartbeat(1, { host: { type: 'nas', id: 1 }, storageHealth: [disk] }) })
    repository.recordHeartbeat({ deviceId: 7, hostType: 'nas', hostId: 1, receivedAt: receivedAt(2), payload: heartbeat(2, { host: { type: 'nas', id: 1 }, storageHealth: [disk] }) })
    repository.recordHeartbeat({ deviceId: 7, hostType: 'nas', hostId: 1, receivedAt: receivedAt(3), payload: heartbeat(3, { host: { type: 'nas', id: 1 }, storageHealth: [disk] }) })

    const kinds = database.query("SELECT event_kind FROM component_events WHERE family = 'storage-health' ORDER BY id").all().map((row) => row.event_kind)
    expect(kinds).toEqual(['observed', 'checkpoint', 'checkpoint'])
  })

  test('exports and restores complete telemetry history and projections', async () => {
    const { repository } = await context()
    repository.recordHeartbeat({
      deviceId: 7,
      hostType: 'server',
      hostId: 1,
      receivedAt: receivedAt(1),
      payload: heartbeat(1, {
        services: [{ name: 'docker', activeState: 'active', enabled: true }],
        containers: [{ runtime: 'docker', runtimeId: 'abc', name: 'web', image: 'web:1', state: 'running' }],
      }),
    })
    const exported = repository.exportBackup()

    repository.replaceBackup({
      ...exported,
      tables: Object.fromEntries(Object.keys(exported.tables).map((table) => [table, []])),
    }, currentStores())
    expect(repository.getHostSummary('server', 1)).toBeNull()

    repository.replaceBackup(exported, currentStores())
    const restored = repository.getHostSummary('server', 1)
    expect(restored.sequence).toBe(1)
    expect(restored.services[0].state.name).toBe('docker')
    expect(restored.containers[0].state.name).toBe('web')
    expect(repository.exportBackup()).toEqual(exported)
  })

  test('rolls back the SQLite replacement when imported telemetry violates constraints', async () => {
    const { database, repository } = await context()
    repository.recordHeartbeat({ deviceId: 7, hostType: 'server', hostId: 1, receivedAt: receivedAt(1), payload: heartbeat(1) })
    const before = repository.exportBackup()
    const invalid = structuredClone(before)
    invalid.tables.telemetry_samples.push(structuredClone(invalid.tables.telemetry_samples[0]))

    expect(() => repository.replaceBackup(invalid, currentStores())).toThrow()
    expect(database.query('SELECT COUNT(*) AS count FROM telemetry_samples').get().count).toBe(1)
    expect(repository.exportBackup()).toEqual(before)
  })
})
