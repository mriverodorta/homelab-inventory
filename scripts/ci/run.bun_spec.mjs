import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { runCiVerification } from './run.mjs'

const cleanState = {
  revision: 'a'.repeat(40),
  trackedStatus: '',
  submodules: '',
  bunVersion: '1.3.14',
  rustVersion: '1.94.1',
  contractVersion: 3,
  contractHashes: {},
}

describe('local CI runner', () => {
  test('removes stale proof and writes no receipt when a phase fails', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'homelab-ci-'))
    const receiptFile = path.join(directory, 'ci.json')
    await fs.writeFile(receiptFile, '{"stale":true}\n')

    try {
      await expect(runCiVerification({
        root: directory,
        receiptFile,
        phases: [{ id: 'fails', command: ['false'] }],
        collectState: async () => cleanState,
        runCommand: async () => {
          throw new Error('phase failed')
        },
      })).rejects.toThrow('phase failed')
      await expect(fs.stat(receiptFile)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })
})
