import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Database } from 'bun:sqlite'
import { closeTelemetryDatabase, openTelemetryDatabase } from './database.mjs'
import { TELEMETRY_MIGRATIONS } from './schema.mjs'

const resources = []

afterEach(async () => {
  for (const resource of resources.splice(0)) {
    try { closeTelemetryDatabase(resource.database) } catch {}
    await fs.rm(resource.dataDir, { recursive: true, force: true })
  }
})

describe('automatic compact telemetry migration', () => {
  test('replaces v2 snapshots while preserving manual inventory evidence', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hli-telemetry-compact-'))
    const filePath = path.join(dataDir, 'telemetry', 'telemetry.sqlite')
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    const legacy = new Database(filePath, { create: true, strict: true })
    for (const migration of TELEMETRY_MIGRATIONS.filter((entry) => entry.version <= 2)) {
      legacy.exec(migration.sql)
      legacy.exec(`PRAGMA user_version = ${migration.version}`)
    }
    const payload = JSON.stringify({ metrics: { services: Array.from({ length: 100 }, (_, id) => ({ id, value: 'x'.repeat(100) })) } })
    for (let sequence = 1; sequence <= 50; sequence += 1) {
      legacy.query(`
        INSERT INTO telemetry_samples (
          device_id, host_type, host_id, sequence, received_at_ms, collected_at_ms,
          agent_version, payload_json, agent_id, host_item_id
        ) VALUES (1, 'server', 1, ?, ?, ?, 'legacy', ?, 1, 1)
      `).run(sequence, sequence * 60_000, sequence * 60_000, payload)
    }
    legacy.query(`
      INSERT INTO manual_inventory_reports (
        agent_id, host_item_id, sequence, collected_at_ms, received_at_ms,
        payload_hash, payload_json, complete
      ) VALUES (1, 1, 100, 1, 1, ?, '{"components":[]}', 1)
    `).run('a'.repeat(64))
    legacy.close(false)

    const database = await openTelemetryDatabase({ dataDir, filePath })
    resources.push({ dataDir, database })
    const tables = database.query("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name)
    expect(database.query('PRAGMA user_version').get().user_version).toBe(3)
    expect(tables).not.toContain('telemetry_samples')
    expect(database.query('SELECT COUNT(*) AS count FROM heartbeat_receipts').get().count).toBe(0)
    expect(database.query('SELECT COUNT(*) AS count FROM manual_inventory_reports').get().count).toBe(1)
    expect(await fs.stat(`${filePath}.schema-v2.rollback`).catch(() => null)).toBeNull()
  })
})
