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
      agentId: 70,
      hostType: 'server',
      hostId: 1,
      hostItemId: 101,
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
      agentId: 70,
      hostType: 'server',
      hostId: 1,
      hostItemId: 101,
      receivedAt: receivedAt(2),
      payload: heartbeat(2, {
        services: [{ name: 'docker', activeState: 'failed', enabled: true }],
      }),
    })
    expect(repository.getHostSummary('server', 1).services[0].state.activeState).toBe('failed')
    expect(database.query("SELECT COUNT(*) AS count FROM component_events WHERE event_kind = 'changed'").get().count).toBe(1)
    expect(database.query("SELECT COUNT(*) AS count FROM component_events WHERE event_kind = 'removed'").get().count).toBe(2)
  })

  test('treats a repeated device sequence as an idempotent delivery', async () => {
    const { database, repository } = await context()
    repository.recordHeartbeat({ deviceId: 7, hostType: 'server', hostId: 1, receivedAt: receivedAt(1), payload: heartbeat(1) })

    expect(repository.recordHeartbeat({
      deviceId: 7,
      hostType: 'server',
      hostId: 1,
      receivedAt: receivedAt(2),
      payload: heartbeat(1, { metrics: { cpu: { percent: 99 } } }),
    })).toMatchObject({ duplicate: true })

    expect(repository.getHostSummary('server', 1).payload.metrics.cpu.percent).toBe(10)
    expect(database.query('SELECT COUNT(*) AS count FROM heartbeat_receipts').get().count).toBe(1)
  })

  test('writes canonical metric projections when canonical identities are supplied', async () => {
    const { database, repository } = await context()
    repository.recordHeartbeat({
      deviceId: 7,
      agentId: 70,
      hostType: 'server',
      hostId: 1,
      hostItemId: 101,
      receivedAt: receivedAt(1),
      payload: heartbeat(1, { metrics: {
        uptimeSeconds: 90.875,
        loadAverage: [0.1, 0.2, 0.3],
        cpu: { percent: 25 },
        memory: { usedBytes: 2048, totalBytes: 8192 },
        network: [{ name: 'eno1', rxBytes: 10 }],
        diskIo: [{ device: 'nvme0n1', readBytes: 11 }],
        filesystems: [{ mountPoint: '/', type: 'ext4', totalBytes: 100, usedBytes: 40, availableBytes: 60 }],
      } }),
    })

    expect(repository.getHostSummary('server', 1)).toMatchObject({ agentId: 70, hostItemId: 101 })
    expect(database.query('SELECT host_item_id, cpu_percent FROM host_metric_samples').get())
      .toEqual({ host_item_id: 101, cpu_percent: 25 })
    expect(database.query('SELECT uptime_seconds FROM host_runtime_state').get()).toEqual({ uptime_seconds: 90 })
    expect(database.query("SELECT count(*) AS count FROM sqlite_master WHERE name IN ('network_interface_samples', 'storage_device_samples')").get()).toEqual({ count: 0 })
    expect(database.query('SELECT count(*) AS count FROM filesystem_mount_states').get()).toEqual({ count: 0 })
  })

  test('stores complete manual inventory reports and applies the five-report retention policy', async () => {
    const { database, repository } = await context()
    for (let sequence = 1; sequence <= 6; sequence += 1) {
      repository.recordManualInventoryReport({
        agentId: 70,
        hostItemId: 101,
        sequence,
        collectedAt: receivedAt(sequence),
        receivedAt: receivedAt(sequence),
        payload: { components: [{ kind: 'memory', locator: 'DIMM A1', values: { manufacturer: 'Micron' } }] },
      })
    }
    expect(database.query('SELECT sequence FROM manual_inventory_reports ORDER BY sequence').all())
      .toEqual([{ sequence: 2 }, { sequence: 3 }, { sequence: 4 }, { sequence: 5 }, { sequence: 6 }])
    expect(database.query('SELECT count(*) AS count FROM manual_inventory_components').get()).toEqual({ count: 5 })
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
    expect(samples.map((sample) => sample.payload.metrics.cpu.percent)).toEqual([30, 40])
    expect(createHash('sha256').update(await fs.readFile(projectPath)).digest('hex')).toBe(before)
  })

  test('keeps exactly 30 minute buckets and carries metrics across a missed slot', async () => {
    const { database, repository } = await context()
    for (let sequence = 1; sequence <= 35; sequence += 1) {
      repository.recordHeartbeat({
        deviceId: 7,
        agentId: 70,
        hostType: 'server',
        hostId: 1,
        hostItemId: 101,
        receivedAt: receivedAt(sequence),
        payload: heartbeat(sequence, { metrics: { cpu: { percent: sequence }, memory: { usedBytes: sequence, totalBytes: 100 } } }),
      })
    }
    expect(database.query('SELECT COUNT(*) AS count FROM heartbeat_receipts').get().count).toBe(30)
    expect(database.query('SELECT COUNT(*) AS count FROM host_metric_samples').get().count).toBe(30)
    database.query('DELETE FROM host_metric_samples WHERE minute_bucket_ms = ?').run(Date.parse('2026-08-05T12:33:00.000Z'))
    const view = repository.getTelemetryView('server', 1, { now: Date.parse('2026-08-05T12:35:30.000Z') })
    const missed = view.buckets.find((bucket) => bucket.at === '2026-08-05T12:33:00.000Z')
    expect(view.buckets).toHaveLength(30)
    expect(missed).toMatchObject({ received: false, metrics: { cpu: { percent: 32 } } })
  })

  test('keeps the latest successful heartbeat green until its cadence is genuinely overdue', async () => {
    const { repository } = await context()
    for (const [sequence, receivedAt, percent] of [
      [1, '2026-08-17T16:40:52.959Z', 40],
      [2, '2026-08-17T16:41:52.959Z', 41],
    ]) {
      repository.recordHeartbeat({
        deviceId: 7,
        agentId: 70,
        hostType: 'server',
        hostId: 1,
        hostItemId: 101,
        receivedAt,
        payload: heartbeat(sequence, {
          collectedAt: receivedAt,
          metrics: { cpu: { percent }, memory: { usedBytes: percent, totalBytes: 100 } },
        }),
      })
    }

    const online = repository.getTelemetryView('server', 1, {
      now: Date.parse('2026-08-17T16:42:30.252Z'),
      heartbeatIntervalMs: 60_000,
      onlineMaxAgeMs: 90_000,
    })
    expect(online.buckets).toHaveLength(30)
    expect(online.buckets.at(-1)).toMatchObject({
      at: '2026-08-17T16:41:00.000Z',
      received: true,
      metrics: { cpu: { percent: 41 } },
    })

    const atGraceBoundary = repository.getTelemetryView('server', 1, {
      now: Date.parse('2026-08-17T16:43:22.959Z'),
      heartbeatIntervalMs: 60_000,
      onlineMaxAgeMs: 90_000,
    })
    expect(atGraceBoundary.buckets.at(-1)).toMatchObject({
      at: '2026-08-17T16:41:00.000Z',
      received: true,
    })

    const overdue = repository.getTelemetryView('server', 1, {
      now: Date.parse('2026-08-17T16:43:23.000Z'),
      heartbeatIntervalMs: 60_000,
      onlineMaxAgeMs: 90_000,
    })
    expect(overdue.buckets.at(-1)).toMatchObject({
      at: '2026-08-17T16:42:00.000Z',
      received: false,
      metrics: { cpu: { percent: 41 } },
    })
  })

  test('stays compact under production-shaped metric-only updates', async () => {
    const { database, repository } = await context()
    const services = Array.from({ length: 200 }, (_, index) => ({
      manager: 'systemd',
      name: `service-${index}.service`,
      activeState: 'active',
      enabled: true,
      cpuPercent: 0,
      memoryCurrentBytes: 1024,
    }))
    const containers = Array.from({ length: 128 }, (_, index) => ({
      runtime: 'docker',
      runtimeId: `container-${index}`,
      name: `container-${index}`,
      image: 'example:latest',
      state: 'running',
      cpuPercent: 0,
      memoryBytes: 2048,
    }))

    for (let sequence = 1; sequence <= 120; sequence += 1) {
      repository.recordHeartbeat({
        deviceId: 7,
        agentId: 70,
        hostType: 'server',
        hostId: 1,
        hostItemId: 101,
        receivedAt: receivedAt(sequence),
        payload: heartbeat(sequence, {
          metrics: { cpu: { percent: sequence % 100 }, memory: { usedBytes: sequence * 1024, usedPercent: sequence % 100 } },
          services: services.map((service) => ({ ...service, cpuPercent: sequence % 100, memoryCurrentBytes: sequence * 1024 })),
          containers: containers.map((container) => ({ ...container, cpuPercent: sequence % 100, memoryBytes: sequence * 2048, uptime: `${sequence}m` })),
        }),
      })
    }

    expect(database.query('SELECT COUNT(*) AS count FROM heartbeat_receipts').get().count).toBe(30)
    expect(database.query('SELECT COUNT(*) AS count FROM host_metric_samples').get().count).toBe(30)
    expect(database.query('SELECT COUNT(*) AS count FROM service_states').get().count).toBe(200)
    expect(database.query('SELECT COUNT(*) AS count FROM container_states').get().count).toBe(128)
    expect(database.query('SELECT COUNT(*) AS count FROM component_events').get().count).toBe(328)
    const pageCount = Number(database.query('PRAGMA page_count').get().page_count)
    const pageSize = Number(database.query('PRAGMA page_size').get().page_size)
    expect(pageCount * pageSize).toBeLessThan(20 * 1024 * 1024)
  })

  test('deletes every telemetry projection for one host without touching another host', async () => {
    const { database, repository } = await context()
    repository.recordHeartbeat({
      deviceId: 7,
      agentId: 70,
      hostType: 'server',
      hostId: 1,
      hostItemId: 101,
      receivedAt: receivedAt(1),
      payload: heartbeat(1, { services: [{ name: 'docker', activeState: 'active' }] }),
    })
    repository.recordHeartbeat({
      deviceId: 8,
      agentId: 80,
      hostType: 'nas',
      hostId: 1,
      hostItemId: 102,
      receivedAt: receivedAt(2),
      payload: heartbeat(2, { host: { type: 'nas', id: 1 }, containers: [{ runtime: 'docker', runtimeId: 'nas', name: 'nas', image: 'nas:1', state: 'running' }] }),
    })

    const deleted = repository.deleteHost('server', 1)
    expect(deleted).toMatchObject({ heartbeat_receipts: 1, host_metric_samples: 1, service_states: 1 })
    expect(repository.getHostSummary('server', 1)).toBeNull()
    expect(repository.getHostSummary('nas', 1)?.sequence).toBe(2)
    expect(database.query("SELECT COUNT(*) AS count FROM heartbeat_receipts WHERE host_type = 'nas'").get().count).toBe(1)
  })

  test('keeps latest storage health without duplicating unchanged events', async () => {
    const { database, repository } = await context({ storageCheckpointMs: 60_000 })
    const disk = { deviceId: 'disk-a', kind: 'smart', state: 'healthy', collectedAt: receivedAt(1), metrics: { temperatureC: 30 } }
    repository.recordHeartbeat({ deviceId: 7, hostType: 'nas', hostId: 1, receivedAt: receivedAt(1), payload: heartbeat(1, { host: { type: 'nas', id: 1 }, storageHealth: [disk] }) })
    repository.recordHeartbeat({ deviceId: 7, hostType: 'nas', hostId: 1, receivedAt: receivedAt(2), payload: heartbeat(2, { host: { type: 'nas', id: 1 }, storageHealth: [disk] }) })
    repository.recordHeartbeat({ deviceId: 7, hostType: 'nas', hostId: 1, receivedAt: receivedAt(3), payload: heartbeat(3, { host: { type: 'nas', id: 1 }, storageHealth: [disk] }) })

    const kinds = database.query("SELECT event_kind FROM component_events WHERE family = 'storage-health' ORDER BY id").all().map((row) => row.event_kind)
    expect(kinds).toEqual(['observed'])
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
    invalid.tables.heartbeat_receipts.push(structuredClone(invalid.tables.heartbeat_receipts[0]))

    expect(() => repository.replaceBackup(invalid, currentStores())).toThrow()
    expect(database.query('SELECT COUNT(*) AS count FROM heartbeat_receipts').get().count).toBe(1)
    expect(repository.exportBackup()).toEqual(before)
  })
})
