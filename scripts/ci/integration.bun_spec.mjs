import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'

const root = new URL('../../', import.meta.url)

describe('protected push integration', () => {
  test('release preparation verifies CI before contacting the live server', async () => {
    const source = await fs.readFile(new URL('scripts/local-release.mjs', root), 'utf8')
    const prepare = source.slice(source.indexOf('async function prepare()'))
    const ciVerification = prepare.indexOf('runCiVerification')
    const remoteSnapshot = prepare.indexOf('createRemoteSnapshot')

    expect(ciVerification).toBeGreaterThan(-1)
    expect(remoteSnapshot).toBeGreaterThan(-1)
    expect(ciVerification).toBeLessThan(remoteSnapshot)
  })

  test('release preparation retains the awaiting-approval state while recording cleanup timing', async () => {
    const source = await fs.readFile(new URL('scripts/local-release.mjs', root), 'utf8')
    const prepare = source.slice(source.indexOf('async function prepare()'), source.indexOf('async function approve()'))

    expect(prepare).toContain("state = await writeReleaseState(paths, { ...state, phase: 'awaiting-approval', staging })")
    expect(prepare.indexOf("phase: 'awaiting-approval'"))
      .toBeLessThan(prepare.indexOf("timed('prepare-cleanup'"))
  })

  test('main and stable require CI and release security receipts without fallback scanning', async () => {
    const hook = await fs.readFile(new URL('.githooks/pre-push', root), 'utf8')
    expect(hook).toContain('refs/heads/main|refs/heads/stable')
    expect(hook).toContain('for protected_sha in $protected_shas')
    expect(hook).toContain('ci:verify-receipt')
    expect(hook).toContain('release:local verify-push')
    expect(hook).not.toContain('security:container')
  })
})
