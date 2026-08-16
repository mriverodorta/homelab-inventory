import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { closeTelemetryDatabase, openTelemetryDatabase } from './database.mjs'
import { TelemetryRepository } from './repository.mjs'
import {
  maintainTelemetry,
  pruneTelemetry,
  readTelemetryRetentionDays,
  startTelemetryRetentionSchedule,
} from './retention.mjs'

const resources = []

afterEach(async () => {
  for (const resource of resources.splice(0)) {
    try { closeTelemetryDatabase(resource.database) } catch {}
    await fs.rm(resource.dataDir, { recursive: true, force: true })
  }
})

describe('telemetry retention', () => {
  test('prunes bounded historical batches without deleting latest projections', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hli-telemetry-retention-'))
    const database = await openTelemetryDatabase({ dataDir })
    resources.push({ dataDir, database })
    const repository = new TelemetryRepository(database)
    for (let sequence = 1; sequence <= 3; sequence += 1) {
      const time = new Date(Date.UTC(2026, 7, 5, 12, sequence)).toISOString()
      repository.recordHeartbeat({
        deviceId: 1,
        hostType: 'server',
        hostId: 1,
        receivedAt: time,
        payload: {
          protocolMajor: 1,
          sequence,
          agentVersion: 'test',
          collectedAt: time,
          host: { type: 'server', id: 1 },
          capabilities: {}, metrics: {}, services: [], containers: [], storageHealth: [],
        },
      })
    }

    const first = pruneTelemetry(database, { samplesBefore: '2026-08-05T12:03:00.000Z', limit: 1 })
    expect(first.samples).toBe(1)
    expect(database.query('SELECT COUNT(*) AS count FROM heartbeat_receipts').get().count).toBe(2)
    expect(repository.getHostSummary('server', 1).sequence).toBe(3)

    const second = pruneTelemetry(database, { samplesBefore: '2026-08-05T12:03:00.000Z', limit: 10 })
    expect(second.samples).toBe(1)
    expect(repository.getHostSummary('server', 1).sequence).toBe(3)
    expect(() => maintainTelemetry(database)).not.toThrow()
  })

  test('validates retention configuration and supports stoppable automatic maintenance', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hli-telemetry-retention-'))
    const database = await openTelemetryDatabase({ dataDir })
    resources.push({ dataDir, database })
    expect(readTelemetryRetentionDays()).toBe(7)
    expect(readTelemetryRetentionDays('30')).toBe(30)
    expect(() => readTelemetryRetentionDays('0')).toThrow()

    let callback
    let cleared = false
    const schedule = startTelemetryRetentionSchedule(database, {
      retentionDays: 7,
      now: () => Date.UTC(2026, 7, 5),
      setIntervalFn: (next) => { callback = next; return 42 },
      clearIntervalFn: (timer) => { cleared = timer === 42 },
    })
    expect(() => callback()).not.toThrow()
    schedule.stop()
    expect(cleared).toBe(true)
  })
})
