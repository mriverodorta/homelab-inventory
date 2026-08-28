import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createExternalAccessPolicy,
  EXTERNAL_IDENTITY_PATHS,
  ISOLATED_RUNTIME_ENVIRONMENT,
} from './external-access-policy.mjs'

describe('non-production external access policy', () => {
  it.each(['demo', 'staging', 'test'])('fails closed for %s mode', (mode) => {
    expect(createExternalAccessPolicy(mode)).toEqual({
      isolated: true,
      labGdAllowed: false,
      registryIdentityAllowed: false,
      registryContributionsAllowed: false,
      registryNetworkRefreshAllowed: false,
      updateChecksAllowed: false,
    })
  })

  it('defines independent mode, service, refresh, contribution, and identity controls', () => {
    expect(ISOLATED_RUNTIME_ENVIRONMENT).toEqual({
      APP_MODE: 'staging',
      LABGD_ENABLED: 'false',
      UPDATE_CHECK_ENABLED: 'false',
      REGISTRY_REFRESH_INTERVAL_MS: '0',
      REGISTRY_IDENTITY_ENABLED: 'false',
      REGISTRY_CONTRIBUTION_ENABLED: 'false',
    })
    expect(EXTERNAL_IDENTITY_PATHS).toHaveLength(6)
  })

  it('contains no automated test request to a production external service', async () => {
    const productionHosts = '(?:lab\\.gd|app\\.lab\\.gd|registry\\.homelabinventory\\.com|api\\.github\\.com)'
    const networkCall = new RegExp(`(?:(?:fetch|request|connect)\\s*\\(\\s*['"]https?://(?:${productionHosts})|curl\\s+[^\\n]*https?://(?:${productionHosts}))`, 'iu')
    const violations = []
    const root = process.cwd()
    for (const directory of ['server', 'scripts', 'src']) {
      for (const relativePath of await readdir(join(root, directory), { recursive: true })) {
        if (!/\.(?:test|spec)\.(?:js|mjs|ts|tsx)$/u.test(relativePath)) continue
        const source = await readFile(join(root, directory, relativePath), 'utf8')
        if (networkCall.test(source)) violations.push(join(directory, relativePath))
      }
    }
    expect(violations).toEqual([])
  })
})
