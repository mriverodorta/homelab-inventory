import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runSqlitePersistenceBenchmark } from '../../../scripts/benchmark-sqlite-persistence.mjs'
import { hashLegacyData } from '../migration/crash-fixtures.ts'

const temporaryDirectories: string[] = []
const source = resolve(import.meta.dir, '../../../data')

async function hasCurrentLegacyData() {
  try {
    await Promise.all([
      stat(join(source, 'meta.json')),
      stat(join(source, 'stores', 'inventory.json')),
      stat(join(source, 'stores', 'project.json')),
    ])
    return true
  } catch {
    return false
  }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

const currentDataTest = await hasCurrentLegacyData() ? test : test.skip

currentDataTest('copies and verifies the current local data without modifying its source', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'hli-current-data-parity-'))
  temporaryDirectories.push(temporaryRoot)
  const output = join(temporaryRoot, 'migrated')
  const before = await hashLegacyData(source)

  const report = await runSqlitePersistenceBenchmark({ source, output })

  expect(report.ok).toBe(true)
  expect(report.performance.routeRecomputationsOnHydration).toBe(0)
  expect(await hashLegacyData(source)).toEqual(before)
  expect(JSON.parse(await readFile(join(output, 'sqlite-parity-report.json'), 'utf8'))).toMatchObject({ ok: true })
})
