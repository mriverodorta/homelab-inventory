import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { schema29ProductionShapeFixture } from '../server/persistence/fixtures/schema-29-production-shape.ts'
import { runSqlitePersistenceBenchmark } from './benchmark-sqlite-persistence.mjs'

const roots = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixtureData() {
  const root = await mkdtemp(join(tmpdir(), 'hli-sqlite-benchmark-'))
  roots.push(root)
  const source = join(root, 'source')
  const stores = join(source, 'stores')
  const registry = join(source, 'registry')
  await mkdir(stores, { recursive: true })
  await mkdir(registry, { recursive: true })
  const snapshot = schema29ProductionShapeFixture()
  snapshot.backupManagement.backups = []
  await writeFile(join(source, 'meta.json'), `${JSON.stringify(snapshot.meta)}\n`)
  const storeFiles = {
    inventory: 'inventory.json', project: 'project.json', agents: 'agents.json',
    agentStatus: 'agent-status.json', registry: 'registry.json', routingCache: 'routing-cache.json',
    backupManagement: 'backup-management.json', authentication: 'authentication.json',
    notifications: 'notifications.json', notificationState: 'notification-state.json',
    notificationSecrets: 'notification-secrets.json',
  }
  for (const [key, file] of Object.entries(storeFiles)) {
    await writeFile(join(stores, file), `${JSON.stringify(snapshot[key])}\n`)
  }
  for (const [file, body] of Object.entries({
    'installation-instance.json': '{"clientInstanceId":"11111111-1111-4111-8111-111111111111"}\n',
    'installation-ed25519.pem': 'fixture-private-key\n',
    'installation-credentials.json': '{"installationId":"fixture"}\n',
  })) {
    await writeFile(join(registry, file), body, { mode: 0o600 })
  }
  return { root, source, output: join(root, 'output') }
}

async function digest(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex')
}

describe('SQLite persistence benchmark', () => {
  test('proves migration parity, startup budget, cache bounds, and source immutability', async () => {
    const paths = await fixtureData()
    const sourceProject = join(paths.source, 'stores', 'project.json')
    const identity = join(paths.source, 'registry', 'installation-instance.json')
    const before = { project: await digest(sourceProject), identity: await digest(identity) }

    const report = await runSqlitePersistenceBenchmark(paths)

    expect(report.ok).toBe(true)
    expect(report.semantic.topology).toEqual({ assignments: 4, placements: 4, connections: 2 })
    expect(report.performance.initialApiBootstrapRequests).toBe(3)
    expect(report.performance.initialApiBootstrapRequestBudget).toBe(3)
    expect(report.performance.routeRecomputationsOnHydration).toBe(0)
    expect(report.performance.cache.bytes).toBeLessThanOrEqual(64 * 1024 * 1024)
    expect(await digest(sourceProject)).toBe(before.project)
    expect(await digest(identity)).toBe(before.identity)
    expect((await stat(join(paths.output, 'sqlite-parity-report.json'))).mode & 0o777).toBe(0o600)
  })

  test('refuses unsafe or reused output locations', async () => {
    const paths = await fixtureData()
    await expect(runSqlitePersistenceBenchmark({ source: paths.source, output: paths.source }))
      .rejects.toThrow('must be separate')
    await mkdir(paths.output)
    await expect(runSqlitePersistenceBenchmark(paths)).rejects.toThrow('must not already exist')
  })
})
