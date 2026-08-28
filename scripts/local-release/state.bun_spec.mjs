import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { releasePaths } from './config.mjs'
import { emptyReleaseState, readReleaseState, withReleaseLock, writeReleaseState } from './state.mjs'

async function context() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hli-release-state-'))
  return { root, paths: releasePaths({ HOME: root }) }
}

describe('local release state', () => {
  test('keeps state and cache outside Docker Desktop and the repository', async () => {
    const { root, paths } = await context()
    expect(paths.supportRoot).toBe(path.join(root, 'Library', 'Application Support', 'Homelab Inventory Release'))
    expect(paths.cacheRoot).toBe(path.join(root, 'Library', 'Caches', 'homelab-inventory-release'))
  })

  test('round trips state atomically with private permissions', async () => {
    const { paths } = await context()
    expect(await readReleaseState(paths)).toEqual(emptyReleaseState())
    const written = await writeReleaseState(paths, { ...emptyReleaseState(), phase: 'prepared' })
    expect((await readReleaseState(paths)).phase).toBe('prepared')
    expect(written.updatedAt).toBeString()
    expect((await fs.stat(paths.stateFile)).mode & 0o777).toBe(0o600)
  })

  test('migrates version one state with empty phase timings', async () => {
    const { paths } = await context()
    await fs.mkdir(paths.supportRoot, { recursive: true })
    await fs.writeFile(paths.stateFile, `${JSON.stringify({ version: 1, phase: 'approved' })}\n`)
    const state = await readReleaseState(paths)
    expect(state.version).toBe(2)
    expect(state.phase).toBe('approved')
    expect(state.timings).toEqual([])
  })

  test('prevents concurrent release operations and removes the lock afterward', async () => {
    const { paths } = await context()
    await withReleaseLock(paths, async () => {
      await expect(withReleaseLock(paths, async () => {})).rejects.toThrow('Another local release operation')
    })
    await expect(fs.stat(paths.lockFile)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
