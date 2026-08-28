import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { computeCiPhaseFingerprint, runCachedCiPhase } from './phase-cache.mjs'

const phase = {
  id: 'rust-test',
  command: ['cargo', 'test'],
  cacheInputs: ['rust', 'rust-toolchain.toml'],
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'homelab-ci-cache-'))
  await fs.mkdir(path.join(root, 'rust'))
  await fs.writeFile(path.join(root, 'rust', 'Cargo.toml'), '[workspace]\n')
  await fs.writeFile(path.join(root, 'rust-toolchain.toml'), '[toolchain]\nchannel = "1.94.1"\n')
  return root
}

describe('local CI phase cache', () => {
  test('reuses a successful phase only while all declared inputs and its command match', async () => {
    const root = await fixture()
    const cacheDir = path.join(root, 'receipts')
    let runs = 0
    try {
      const runCommand = async () => { runs += 1 }
      expect((await runCachedCiPhase({ root, cacheDir, phase, contractVersion: 3, runCommand })).reused).toBe(false)
      expect((await runCachedCiPhase({ root, cacheDir, phase, contractVersion: 3, runCommand })).reused).toBe(true)
      expect(runs).toBe(1)

      await fs.writeFile(path.join(root, 'rust', 'Cargo.toml'), '[workspace]\nmembers = []\n')
      expect((await runCachedCiPhase({ root, cacheDir, phase, contractVersion: 3, runCommand })).reused).toBe(false)
      expect(runs).toBe(2)

      const changedCommand = { ...phase, command: ['cargo', 'test', '--locked'] }
      expect(await computeCiPhaseFingerprint({ root, phase: changedCommand, contractVersion: 3 })).not.toBe(
        await computeCiPhaseFingerprint({ root, phase, contractVersion: 3 }),
      )
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test('writes no reusable receipt when the phase fails', async () => {
    const root = await fixture()
    const cacheDir = path.join(root, 'receipts')
    try {
      await expect(runCachedCiPhase({
        root,
        cacheDir,
        phase,
        contractVersion: 3,
        runCommand: async () => { throw new Error('failed') },
      })).rejects.toThrow('failed')
      await expect(fs.stat(path.join(cacheDir, 'rust-test.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
