import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ensureCiVerification, runCiVerification } from './run.mjs'

const cleanState = {
  receiptVersion: 2,
  revision: 'a'.repeat(40),
  trackedStatus: '',
  untrackedStatus: '',
  submodules: '',
  bunVersion: '1.3.14',
  rustVersion: '1.94.1',
  contractVersion: 4,
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

  test('reuses exact proof only after restoring artifacts and revalidating state', async () => {
    const calls = []
    const receipt = { ...cleanState, passed: true }
    let collection = 0
    const result = await ensureCiVerification({
      root: '/repo',
      receiptFile: '/proof/ci.json',
      phases: [{ id: 'release-artifacts', command: ['restore-artifacts'] }],
      collectState: async () => ({ ...cleanState, collection: collection += 1 }),
      readReceipt: async () => receipt,
      validateReceipt: (saved, current) => {
        calls.push(['validate', current.collection])
        return saved
      },
      runCommand: async (command) => { calls.push(command) },
      runFullVerification: async () => { throw new Error('full CI should not run') },
    })

    expect(result).toEqual({ receipt, reused: true, timingOutcome: 'passed-reused' })
    expect(calls).toEqual([
      ['validate', 1],
      ['restore-artifacts'],
      ['validate', 2],
    ])
  })

  test.each([
    ['missing', async () => null],
    ['malformed', async () => { throw new SyntaxError('bad JSON') }],
  ])('falls back to complete CI for a %s receipt', async (_name, readReceipt) => {
    const fullReceipt = { ...cleanState, passed: true, completedAt: 'now' }
    let fullRuns = 0
    const result = await ensureCiVerification({
      root: '/repo',
      receiptFile: '/proof/ci.json',
      collectState: async () => cleanState,
      readReceipt,
      validateReceipt: (saved) => {
        if (!saved) throw new Error('missing')
        return saved
      },
      runFullVerification: async () => { fullRuns += 1; return fullReceipt },
      log: () => {},
    })

    expect(result).toEqual({ receipt: fullReceipt, reused: false, timingOutcome: 'passed' })
    expect(fullRuns).toBe(1)
  })

  test('falls back when artifact restoration fails', async () => {
    let fullRuns = 0
    const result = await ensureCiVerification({
      root: '/repo',
      receiptFile: '/proof/ci.json',
      phases: [{ id: 'release-artifacts', command: ['restore-artifacts'] }],
      collectState: async () => cleanState,
      readReceipt: async () => ({ ...cleanState, passed: true }),
      validateReceipt: (saved) => saved,
      runCommand: async () => { throw new Error('artifact missing') },
      runFullVerification: async () => { fullRuns += 1; return { passed: true } },
      log: () => {},
    })

    expect(result.reused).toBe(false)
    expect(fullRuns).toBe(1)
  })

  test('falls back when inputs drift while artifacts are restored', async () => {
    let collection = 0
    let fullRuns = 0
    const result = await ensureCiVerification({
      root: '/repo',
      receiptFile: '/proof/ci.json',
      phases: [{ id: 'release-artifacts', command: ['restore-artifacts'] }],
      collectState: async () => ({ ...cleanState, revision: collection++ === 0 ? cleanState.revision : 'b'.repeat(40) }),
      readReceipt: async () => ({ ...cleanState, passed: true }),
      validateReceipt: (saved, current) => {
        if (saved.revision !== current.revision) throw new Error('drift')
        return saved
      },
      runCommand: async () => {},
      runFullVerification: async () => { fullRuns += 1; return { passed: true } },
      log: () => {},
    })

    expect(result.reused).toBe(false)
    expect(fullRuns).toBe(1)
  })
})
