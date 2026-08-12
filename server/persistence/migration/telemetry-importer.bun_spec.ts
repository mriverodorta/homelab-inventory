import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TELEMETRY_MIGRATIONS, TELEMETRY_SCHEMA_VERSION } from '../../telemetry/schema.mjs'
import type { CanonicalIdentityPlan } from '../legacy/identity-plan.ts'
import { migrateTelemetryReferences } from './telemetry-importer.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function identityPlan(): CanonicalIdentityPlan {
  return {
    items: new Map([['server:7', 41]]),
    agents: new Map([['9', 13]]),
    ports: new Map(),
    endpointFaces: new Map(),
    resourceGroups: new Map(),
    resourceSlots: new Map(),
    registrySources: new Map(),
    registryLinks: new Map(),
    assignments: new Map(),
    connections: new Map(),
  }
}

async function legacyTelemetry() {
  const root = await mkdtemp(join(tmpdir(), 'hli-telemetry-import-'))
  roots.push(root)
  const sourcePath = join(root, 'active', 'telemetry.sqlite')
  await mkdir(join(root, 'active'), { recursive: true })
  const database = new Database(sourcePath, { create: true, strict: true })
  database.exec(TELEMETRY_MIGRATIONS[0].sql)
  database.exec('PRAGMA user_version = 1')
  const payload = JSON.stringify({
    sequence: 4,
    collectedAt: '2026-08-11T12:00:00.000Z',
    agentVersion: '0.1.6',
    metrics: {
      uptimeSeconds: 300,
      loadAverage: [0.1, 0.2, 0.3],
      cpu: { percent: 12.5 },
      memory: { usedBytes: 1024, totalBytes: 4096 },
      network: [{ name: 'eno1', rxBytes: 20 }, { name: 'eno1', rxBytes: 40 }],
      diskIo: [{ device: 'nvme0n1', readBytes: 30 }, { device: 'nvme0n1', readBytes: 60 }],
      filesystems: [
        { mountPoint: '/', device: '/dev/nvme0n1p2', type: 'ext4', totalBytes: 1000, usedBytes: 400, availableBytes: 600 },
        { mountPoint: '/', device: '/dev/nvme0n1p2', type: 'ext4', totalBytes: 1000, usedBytes: 450, availableBytes: 550 },
      ],
    },
    services: [], containers: [], storageHealth: [],
  })
  database.query(`INSERT INTO telemetry_samples (id, device_id, host_type, host_id, sequence, received_at_ms, collected_at_ms, agent_version, payload_json) VALUES (1, 9, 'server', 7, 4, 1001, 1000, '0.1.6', ?)`).run(payload)
  database.query(`INSERT INTO latest_host_state (host_type, host_id, device_id, sequence, received_at_ms, collected_at_ms, agent_version, payload_json) VALUES ('server', 7, 9, 4, 1001, 1000, '0.1.6', ?)`).run(payload)
  database.query(`INSERT INTO latest_component_state (host_type, host_id, family, entity_key, state_hash, observed_at_ms, state_json) VALUES ('server', 7, 'service', 'docker', 'hash', 1001, '{"active":true}')`).run()
  database.query(`INSERT INTO component_events (id, host_type, host_id, family, entity_key, event_kind, observed_at_ms, state_hash, state_json) VALUES (1, 'server', 7, 'service', 'docker', 'observed', 1001, 'hash', '{"active":true}')`).run()
  database.close(false)
  return { root, sourcePath, targetPath: join(root, 'staging', 'telemetry.sqlite') }
}

describe('telemetry reference migration', () => {
  test('rekeys a staged clone and preserves source samples exactly', async () => {
    const { sourcePath, targetPath } = await legacyTelemetry()
    const before = createHash('sha256').update(await readFile(sourcePath)).digest('hex')

    const result = await migrateTelemetryReferences({ sourcePath, targetPath, identityPlan: identityPlan() })

    expect(result).toMatchObject({ telemetry_samples: 1, latest_host_state: 1, latest_component_state: 1, component_events: 1 })
    expect(createHash('sha256').update(await readFile(sourcePath)).digest('hex')).toBe(before)
    expect((await stat(targetPath)).mode & 0o777).toBe(0o600)

    const migrated = new Database(targetPath, { readonly: true, strict: true })
    try {
      expect(migrated.query('PRAGMA user_version').get()).toEqual({ user_version: TELEMETRY_SCHEMA_VERSION })
      expect(migrated.query('SELECT agent_id, host_item_id, sequence, received_at_ms, collected_at_ms FROM telemetry_samples').get())
        .toEqual({ agent_id: 13, host_item_id: 41, sequence: 4, received_at_ms: 1001, collected_at_ms: 1000 })
      expect(migrated.query('SELECT host_item_id FROM latest_component_state').get()).toEqual({ host_item_id: 41 })
      expect(migrated.query('SELECT host_item_id FROM component_events').get()).toEqual({ host_item_id: 41 })
      expect(migrated.query('SELECT host_item_id, uptime_seconds, cpu_percent, memory_total_bytes FROM host_metric_samples').get())
        .toEqual({ host_item_id: 41, uptime_seconds: 300, cpu_percent: 12.5, memory_total_bytes: 4096 })
      expect(migrated.query('SELECT interface_key FROM network_interface_samples').get()).toEqual({ interface_key: 'eno1' })
      expect(migrated.query('SELECT device_key FROM storage_device_samples').get()).toEqual({ device_key: 'nvme0n1' })
      expect(migrated.query('SELECT mount_key, filesystem_type FROM filesystem_samples').get()).toEqual({ mount_key: '/', filesystem_type: 'ext4' })
      expect(migrated.query('SELECT count(*) AS count FROM network_interface_samples').get()).toEqual({ count: 1 })
      expect(migrated.query('SELECT count(*) AS count FROM storage_device_samples').get()).toEqual({ count: 1 })
      expect(migrated.query('SELECT count(*) AS count FROM filesystem_samples').get()).toEqual({ count: 1 })
    } finally {
      migrated.close(false)
    }
  })

  test('removes staging and leaves the source untouched when a reference is unresolved', async () => {
    const { sourcePath, targetPath } = await legacyTelemetry()
    const before = createHash('sha256').update(await readFile(sourcePath)).digest('hex')
    const invalid = { ...identityPlan(), items: new Map() }

    await expect(migrateTelemetryReferences({ sourcePath, targetPath, identityPlan: invalid })).rejects.toThrow('unknown legacy host')
    expect(createHash('sha256').update(await readFile(sourcePath)).digest('hex')).toBe(before)
    expect(await Bun.file(targetPath).exists()).toBe(false)
  })

  test('migrates telemetry histories larger than one processing batch', async () => {
    const { sourcePath, targetPath } = await legacyTelemetry()
    const source = new Database(sourcePath, { strict: true })
    const insert = source.query(`INSERT INTO telemetry_samples (id, device_id, host_type, host_id, sequence, received_at_ms, collected_at_ms, agent_version, payload_json) VALUES (?, 9, 'server', 7, ?, ?, ?, '0.1.6', ?)`)
    source.transaction(() => {
      for (let id = 2; id <= 80; id += 1) {
        insert.run(id, id + 3, id + 1000, id + 999, JSON.stringify({
          sequence: id + 3,
          metrics: { cpu: { percent: id / 10 }, memory: { usedBytes: id, totalBytes: 4096 } },
        }))
      }
      const insertEvent = source.query(`INSERT INTO component_events (id, host_type, host_id, family, entity_key, event_kind, observed_at_ms, state_hash, state_json) VALUES (?, 'server', 7, 'service', ?, 'observed', ?, ?, '{"active":true}')`)
      for (let id = 2; id <= 600; id += 1) {
        insertEvent.run(id, `service-${id}`, id + 1000, String(id).padStart(64, '0'))
      }
    }).immediate()
    source.close(false)

    await expect(migrateTelemetryReferences({ sourcePath, targetPath, identityPlan: identityPlan() }))
      .resolves.toMatchObject({ telemetry_samples: 80 })

    const migrated = new Database(targetPath, { readonly: true, strict: true })
    expect(migrated.query('SELECT count(*) AS count FROM telemetry_samples WHERE agent_id = 13 AND host_item_id = 41').get())
      .toEqual({ count: 80 })
    expect(migrated.query('SELECT count(*) AS count FROM host_metric_samples').get()).toEqual({ count: 80 })
    expect(migrated.query('SELECT count(*) AS count FROM component_events WHERE host_item_id = 41').get()).toEqual({ count: 600 })
    migrated.close(false)
  })

  test('retains only the latest five complete manual inventory reports per host', async () => {
    const { sourcePath, targetPath } = await legacyTelemetry()
    await migrateTelemetryReferences({ sourcePath, targetPath, identityPlan: identityPlan() })
    const database = new Database(targetPath, { strict: true })
    try {
      for (let sequence = 1; sequence <= 7; sequence += 1) {
        database.query(`INSERT INTO manual_inventory_reports (agent_id, host_item_id, sequence, collected_at_ms, received_at_ms, payload_hash, payload_json, complete) VALUES (13, 41, ?, ?, ?, ?, '{}', 1)`)
          .run(sequence, sequence, sequence, String(sequence).padStart(64, '0'))
      }
      expect(database.query('SELECT sequence FROM manual_inventory_reports ORDER BY sequence').all())
        .toEqual([{ sequence: 3 }, { sequence: 4 }, { sequence: 5 }, { sequence: 6 }, { sequence: 7 }])
    } finally {
      database.close(false)
    }
  })
})
