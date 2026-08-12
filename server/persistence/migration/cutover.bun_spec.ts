import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TELEMETRY_MIGRATIONS } from '../../telemetry/schema.mjs'
import { CORE_MIGRATIONS } from '../core/migrations/manifest.ts'
import { schema29ProductionShapeFixture } from '../fixtures/schema-29-production-shape.ts'
import { readActivationMarker } from './activation-marker.ts'
import { CUTOVER_STAGES, ensureSqlitePersistence } from './cutover.ts'
import { hashLegacyData } from './crash-fixtures.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const STORE_FILES = Object.freeze({
  inventory: 'inventory.json',
  project: 'project.json',
  agents: 'agents.json',
  agentStatus: 'agent-status.json',
  registry: 'registry.json',
  routingCache: 'routing-cache.json',
  backupManagement: 'backup-management.json',
  authentication: 'authentication.json',
  notifications: 'notifications.json',
  notificationState: 'notification-state.json',
  notificationSecrets: 'notification-secrets.json',
})

async function context() {
  const dataDir = await mkdtemp(join(tmpdir(), 'hli-cutover-'))
  roots.push(dataDir)
  const snapshot = schema29ProductionShapeFixture()
  snapshot.backupManagement.backups = []
  const stores = join(dataDir, 'stores')
  await mkdir(stores, { recursive: true })
  await writeFile(join(dataDir, 'meta.json'), `${JSON.stringify(snapshot.meta)}\n`)
  for (const [key, file] of Object.entries(STORE_FILES)) {
    await writeFile(join(stores, file), `${JSON.stringify(snapshot[key])}\n`)
  }

  const telemetryDir = join(dataDir, 'telemetry')
  await mkdir(telemetryDir, { recursive: true })
  const telemetryPath = join(telemetryDir, 'telemetry.sqlite')
  const telemetry = new Database(telemetryPath, { create: true, strict: true })
  telemetry.exec(TELEMETRY_MIGRATIONS[0].sql)
  telemetry.exec('PRAGMA user_version = 1')
  const payload = JSON.stringify({
    sequence: 4,
    collectedAt: '2026-08-11T12:00:00.000Z',
    agentVersion: '0.1.8',
    metrics: { cpu: { percent: 10 }, memory: { usedBytes: 1024 } },
    services: [], containers: [], storageHealth: [],
  })
  telemetry.query(`INSERT INTO telemetry_samples (device_id, host_type, host_id, sequence, received_at_ms, collected_at_ms, agent_version, payload_json) VALUES (4, 'server', 7, 4, 2, 1, '0.1.8', ?)`).run(payload)
  telemetry.query(`INSERT INTO latest_host_state (device_id, host_type, host_id, sequence, received_at_ms, collected_at_ms, agent_version, payload_json) VALUES (4, 'server', 7, 4, 2, 1, '0.1.8', ?)`).run(payload)
  telemetry.close(false)

  let backupCalls = 0
  const backupServiceFactory = (factoryOptions?: { includeTelemetry: boolean }) => ({
    async create(options: Record<string, unknown>) {
      backupCalls += 1
      expect(factoryOptions).toEqual({ includeTelemetry: false })
      expect(options).toMatchObject({ persist: false, kind: 'migration' })
      expect(options.sections).not.toContain('agentTelemetry')
      return { archive: Buffer.from('HLIBAK01-verified-fixture') }
    },
  })
  return {
    dataDir,
    backupServiceFactory,
    backupCalls: () => backupCalls,
    options: { dataDir, appVersion: '0.10.0', backupServiceFactory },
  }
}

describe('atomic SQLite persistence cutover', () => {
  test('keeps legacy sources authoritative and marker-free across every injected interruption', async () => {
    for (const stage of CUTOVER_STAGES) {
      const current = await context()
      const before = await hashLegacyData(current.dataDir)
      await expect(ensureSqlitePersistence({ ...current.options, failAtStage: stage })).rejects.toThrow(stage)
      expect(await hashLegacyData(current.dataDir)).toEqual(before)
      expect(await readActivationMarker(current.dataDir)).toBeNull()
      await expect(stat(join(current.dataDir, '.sqlite-migration.lock'))).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })

  test('retries from clean staging, activates once, and then reopens idempotently', async () => {
    const current = await context()
    const before = await hashLegacyData(current.dataDir)
    await expect(ensureSqlitePersistence({ ...current.options, failAtStage: 'marker' })).rejects.toThrow('marker')

    const activated = await ensureSqlitePersistence(current.options)
    expect(activated).toMatchObject({
      ok: true,
      status: 'active',
      migrated: true,
      versions: { core: CORE_MIGRATIONS.length, telemetry: 2, catalog: 2 },
    })
    expect(await hashLegacyData(current.dataDir)).toEqual(before)
    expect(await readActivationMarker(current.dataDir)).not.toBeNull()
    expect((await stat(activated.paths.core)).mode & 0o777).toBe(0o600)
    expect((await readdir(join(current.dataDir, 'backups', 'migrations')))
      .filter((name) => name.startsWith('pre-sqlite-'))).toHaveLength(4)

    const reopened = await ensureSqlitePersistence(current.options)
    expect(reopened).toMatchObject({ ok: true, status: 'active', migrated: false })
    expect(current.backupCalls()).toBe(2)
  })

  test('reconciles an interrupted marker update after all database migrations committed', async () => {
    const current = await context()
    const activated = await ensureSqlitePersistence(current.options)
    const markerPath = join(current.dataDir, 'databases', 'persistence-engine.json')
    const staleMarker = structuredClone(activated.marker)
    staleMarker.databases.core.schemaVersion -= 1
    await writeFile(markerPath, `${JSON.stringify(staleMarker)}\n`, { mode: 0o600 })

    const restarted = await ensureSqlitePersistence(current.options)

    expect(restarted).toMatchObject({
      ok: true,
      status: 'active',
      migrated: false,
      markerReconciled: true,
      versions: { core: CORE_MIGRATIONS.length },
    })
    expect((await readActivationMarker(current.dataDir))?.databases.core.schemaVersion)
      .toBe(CORE_MIGRATIONS.length)
    expect(current.backupCalls()).toBe(1)
  })

  test('reclaims stale locks but rejects a live migration lock', async () => {
    const stale = await context()
    await writeFile(join(stale.dataDir, '.sqlite-migration.lock'), JSON.stringify({
      version: 1, token: 'stale', pid: 999_999_999, startedAt: '2020-01-01T00:00:00.000Z',
    }))
    await expect(ensureSqlitePersistence(stale.options)).resolves.toMatchObject({ migrated: true })

    const active = await context()
    await writeFile(join(active.dataDir, '.sqlite-migration.lock'), JSON.stringify({
      version: 1, token: 'active', pid: process.pid, startedAt: new Date().toISOString(),
    }))
    await expect(ensureSqlitePersistence(active.options)).rejects.toThrow('already running')
  })

  test('does not upgrade legacy telemetry while producing the rollback set', async () => {
    const current = await context()
    await expect(ensureSqlitePersistence({ ...current.options, failAtStage: 'backup' })).rejects.toThrow('backup')
    const telemetry = new Database(join(current.dataDir, 'telemetry', 'telemetry.sqlite'), { readonly: true, strict: true })
    expect(telemetry.query('PRAGMA user_version').get()).toEqual({ user_version: 1 })
    telemetry.close(false)
  })

  test('refuses a database schema newer than the application supports', async () => {
    const current = await context()
    const activated = await ensureSqlitePersistence(current.options)
    const core = new Database(activated.paths.core, { strict: true })
    core.exec('PRAGMA user_version = 999')
    core.close(false)

    await expect(ensureSqlitePersistence(current.options)).rejects.toThrow('newer than supported')
    expect(current.backupCalls()).toBe(1)
  })

  test('retains a private verified backup path in the activation marker', async () => {
    const current = await context()
    const activated = await ensureSqlitePersistence(current.options)
    const backupPath = join(current.dataDir, activated.marker.backupPath)
    expect(activated.marker.backupPath.endsWith('.hlibackup')).toBe(true)
    expect((await stat(backupPath)).mode & 0o777).toBe(0o600)
    expect(await readFile(backupPath, 'utf8')).toBe('HLIBAK01-verified-fixture')
    expect(activated.marker.backupSetManifestPath).toBe(`${activated.marker.backupPath}.manifest.json`)
    expect(activated.marker.backupTelemetryPath).toBe(`${activated.marker.backupPath}.telemetry.sqlite`)
    if (!activated.marker.backupTelemetryPath || !activated.marker.backupSetManifestPath) {
      throw new Error('Migration backup set paths were not recorded.')
    }
    const telemetryBackupPath = join(current.dataDir, activated.marker.backupTelemetryPath)
    expect((await stat(telemetryBackupPath)).mode & 0o777).toBe(0o600)
    const telemetry = new Database(telemetryBackupPath, { readonly: true, strict: true })
    expect(telemetry.query('PRAGMA quick_check').get()).toEqual({ quick_check: 'ok' })
    telemetry.close(false)
    const manifest = JSON.parse(await readFile(join(current.dataDir, activated.marker.backupSetManifestPath), 'utf8'))
    expect(manifest).toMatchObject({
      version: 1,
      kind: 'pre-sqlite-migration-set',
      telemetry: { schemaVersion: 1 },
    })
    expect(manifest.telemetry.file.endsWith('.telemetry.sqlite')).toBe(true)
  })
})
