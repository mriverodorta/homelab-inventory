import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { closeTelemetryDatabase, openTelemetryDatabase, telemetryDatabaseStatus } from './database.mjs'

const resources = []

afterEach(async () => {
  for (const resource of resources.splice(0)) {
    closeTelemetryDatabase(resource.database)
    await fs.rm(resource.dataDir, { recursive: true, force: true })
  }
})

describe('telemetry schema v3', () => {
  test('creates compact bounded telemetry tables', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hli-telemetry-schema-v3-'))
    const database = await openTelemetryDatabase({ dataDir })
    resources.push({ dataDir, database })
    const tables = database.query("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name)
    expect(telemetryDatabaseStatus(database).schemaVersion).toBe(3)
    expect(tables).toEqual(expect.arrayContaining([
      'heartbeat_receipts', 'host_metric_samples', 'agent_capabilities', 'host_system_facts',
      'host_runtime_state', 'service_states', 'container_states', 'filesystem_mount_states',
      'gpu_states', 'sensor_states', 'storage_health_states', 'component_events',
    ]))
    expect(tables).not.toContain('telemetry_samples')
    expect(tables).not.toContain('network_interface_samples')
  })
})
