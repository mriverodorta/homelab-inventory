import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { schema29ProductionShapeFixture } from './fixtures/schema-29-production-shape.ts'
import { NotificationStore } from '../notifications/store.mjs'
import { SqliteNotificationPersistence } from '../notifications/sqlite-persistence.ts'
import { activateSqliteRuntime } from './runtime.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function digest(body: Uint8Array) {
  return createHash('sha256').update(body).digest('hex')
}

async function createLegacyData() {
  const dataDir = await mkdtemp(join(tmpdir(), 'hli-production-sqlite-runtime-'))
  roots.push(dataDir)
  const snapshot = schema29ProductionShapeFixture()
  snapshot.backupManagement.backups = []
  await mkdir(join(dataDir, 'stores'), { recursive: true })
  await writeFile(join(dataDir, 'meta.json'), `${JSON.stringify(snapshot.meta)}\n`)
  const files = {
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
  }
  for (const [key, file] of Object.entries(files)) {
    await writeFile(join(dataDir, 'stores', file), `${JSON.stringify(snapshot[key as keyof typeof snapshot])}\n`)
  }
  return dataDir
}

function options(dataDir: string) {
  return {
    dataDir,
    appVersion: '0.10.0',
    backupServiceFactory: () => ({
      async create() {
        return { archive: Buffer.from('verified-production-migration-backup') }
      },
    }),
  }
}

describe('SQLite production runtime', () => {
  test('activates once, leaves legacy JSON untouched, and survives restart', async () => {
    const dataDir = await createLegacyData()
    const legacyProjectPath = join(dataDir, 'stores', 'project.json')
    const legacyBefore = digest(await readFile(legacyProjectPath))

    const first = await activateSqliteRuntime(options(dataDir))
    expect(first.persistence).toMatchObject({ ok: true, status: 'active', migrated: true })
    expect(first.store.getPersistenceHealth()).toMatchObject({ ok: true, engine: 'sqlite' })
    const notifications = await new NotificationStore({
      persistence: new SqliteNotificationPersistence({ database: first.store.core.database }),
    }).init()
    expect(notifications.readConfig()).toMatchObject({ enabled: true, revision: 2 })
    await notifications.mutateConfig((draft) => {
      draft.enabled = false
      draft.monitoredResources.push({
        id: 1,
        hostType: 'server',
        hostId: 7,
        family: 'service',
        key: 'docker.service',
        name: 'Docker',
        enabled: true,
      })
      draft.hostOverrides.push({
        id: 1,
        hostType: 'server',
        hostId: 7,
        mode: 'custom',
        mutedUntil: null,
        monitoredResourceIds: [1],
        rules: [],
      })
      draft.counters.monitoredResource = 2
      draft.counters.hostOverride = 2
    })
    expect(first.store.core.database.query(`
      SELECT s.enabled, r.resource_key, o.mode, orr.monitored_resource_id
      FROM notification_settings s
      JOIN notification_monitored_resources r ON r.id = 1
      JOIN notification_host_overrides o ON o.id = 1
      JOIN notification_host_override_resources orr ON orr.host_override_id = o.id
    `).get()).toEqual({
      enabled: 0,
      resource_key: 'docker.service',
      mode: 'custom',
      monitored_resource_id: 1,
    })
    expect(first.store.core.database.query('SELECT count(*) AS count FROM incidents').get()).toEqual({ count: 1 })
    expect(first.store.core.database.query('SELECT count(*) AS count FROM notification_deliveries').get()).toEqual({ count: 1 })
    first.store.setProject({
      ...first.store.getProject(),
      metadata: { ...first.store.getProject().metadata, name: 'SQLite project' },
    })
    await first.close()

    expect(digest(await readFile(legacyProjectPath))).toBe(legacyBefore)
    const second = await activateSqliteRuntime(options(dataDir))
    expect(second.persistence).toMatchObject({ ok: true, status: 'active', migrated: false })
    expect(second.store.getProject().metadata.name).toBe('SQLite project')
    const restartedNotifications = await new NotificationStore({
      persistence: new SqliteNotificationPersistence({ database: second.store.core.database }),
    }).init()
    expect(restartedNotifications.readConfig()).toMatchObject({
      enabled: false,
      revision: 3,
      monitoredResources: [{ id: 1, hostType: 'server', hostId: 7 }],
      hostOverrides: [{ id: 1, hostType: 'server', hostId: 7, monitoredResourceIds: [1] }],
    })
    expect((await stat(second.persistence.paths.core)).mode & 0o777).toBe(0o600)
    await second.close()
  })
})
