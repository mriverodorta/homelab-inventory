import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { releasePaths } from './config.mjs'
import { activateIncomingData, verifySnapshotManifest } from './snapshot.mjs'

const roots = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))))

test('remote helper serializes committed WAL state without copying WAL files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hli-release-snapshot-'))
  roots.push(root)
  const source = path.join(root, 'source')
  const output = path.join(root, 'output')
  await fs.mkdir(path.join(source, 'databases'), { recursive: true })
  const database = new Database(path.join(source, 'databases', 'homelab-inventory.sqlite'))
  database.exec('PRAGMA journal_mode=WAL; CREATE TABLE proof(value TEXT); INSERT INTO proof VALUES (\'current\');')
  await Bun.$`bun ${path.resolve(import.meta.dir, 'remote-snapshot.mjs')} ${source} ${output}`.quiet()
  database.close(false)
  expect(await fs.readdir(path.join(output, 'databases'))).toEqual(['homelab-inventory.sqlite'])
  const snapshot = new Database(path.join(output, 'databases', 'homelab-inventory.sqlite'))
  expect(snapshot.query('SELECT value FROM proof').get()).toEqual({ value: 'current' })
  expect(snapshot.query('PRAGMA quick_check').get()).toEqual({ quick_check: 'ok' })
  snapshot.close(false)
  expect((await verifySnapshotManifest(output)).files.length).toBe(1)
})

describe('snapshot activation', () => {
  test('rotates current to previous and incoming to current', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hli-release-rotation-'))
    roots.push(root)
    const paths = releasePaths({ HOME: root })
    for (const [directory, value] of [[paths.currentDataDir, 'current'], [paths.previousDataDir, 'old'], [paths.incomingDataDir, 'incoming']]) {
      await fs.mkdir(directory, { recursive: true })
      await fs.writeFile(path.join(directory, 'value'), value)
    }
    await activateIncomingData(paths)
    expect(await fs.readFile(path.join(paths.currentDataDir, 'value'), 'utf8')).toBe('incoming')
    expect(await fs.readFile(path.join(paths.previousDataDir, 'value'), 'utf8')).toBe('current')
  })
})
