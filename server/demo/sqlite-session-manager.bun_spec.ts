import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteHomelabInventoryStore } from '../persistence/sqlite-store.ts'
import { schema29ProductionShapeFixture } from '../persistence/fixtures/schema-29-production-shape.ts'
import { DemoSessionManager } from './session-manager.mjs'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function writeJson(filePath: string, value: unknown) {
  await writeFile(filePath, `${JSON.stringify(value)}\n`, { mode: 0o600 })
}

async function createSource() {
  const sourceDir = await mkdtemp(join(tmpdir(), 'hli-demo-sqlite-source-'))
  roots.push(sourceDir)
  const snapshot = schema29ProductionShapeFixture()
  await mkdir(join(sourceDir, 'stores'), { recursive: true })
  await writeJson(join(sourceDir, 'meta.json'), snapshot.meta)
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
    await writeJson(join(sourceDir, 'stores', file), snapshot[key as keyof typeof snapshot])
  }
  return sourceDir
}

describe('SQLite demo sessions', () => {
  test('uses isolated ephemeral SQLite stores and removes active JSON stores', async () => {
    const sourceDir = await createSource()
    const dataDir = await mkdtemp(join(tmpdir(), 'hli-demo-sqlite-runtime-'))
    roots.push(dataDir)
    const manager = new DemoSessionManager({
      appVersion: '0.10.0',
      dataDir,
      sourceDir,
      sessionMinutes: 30,
    })
    await manager.init()

    const first = await manager.getOrCreateSessionStore(null, { clientKey: 'first' })
    const second = await manager.getOrCreateSessionStore(null, { clientKey: 'second' })

    expect(first.store).toBeInstanceOf(SqliteHomelabInventoryStore)
    expect(second.store).toBeInstanceOf(SqliteHomelabInventoryStore)
    expect(first.session.dataDir).not.toBe(second.session.dataDir)
    expect(first.store.getRegistryState().settings).toMatchObject({
      mode: 'connected',
      automaticContributions: false,
    })
    await expect(stat(join(first.session.dataDir, 'stores', 'project.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await stat(join(first.session.dataDir, 'databases', 'homelab-inventory.sqlite'))).mode & 0o777).toBe(0o600)

    const secondName = second.store.getProject().metadata.name
    first.store.setProject({
      ...first.store.getProject(),
      metadata: { ...first.store.getProject().metadata, name: 'First isolated demo' },
    })
    expect(second.store.getProject().metadata.name).toBe(secondName)

    await manager.closeAll()
    expect(await readFile(join(sourceDir, 'stores', 'project.json'), 'utf8')).toContain('Default Project')
  })
})
