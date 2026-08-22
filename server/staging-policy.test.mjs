import { describe, expect, it } from 'vitest'
import { createStagingPolicy, stagingRegistryPolicy } from './staging-policy.mjs'

describe('staging runtime policy', () => {
  it('disables every external integration without enabling demo sessions', () => {
    expect(createStagingPolicy('staging')).toEqual({
      staging: true,
      authenticationDisabled: true,
      agentsDisabled: true,
      notificationsDisabled: true,
      sharingDisabled: true,
      registryIdentityDisabled: true,
      registryContributionsDisabled: true,
      registryNetworkRefreshDisabled: true,
      updateChecksDisabled: true,
      scheduledBackupsDisabled: true,
    })
  })

  it('leaves production behavior unchanged', () => {
    expect(createStagingPolicy('production').staging).toBe(false)
    expect(stagingRegistryPolicy(createStagingPolicy('production'))).toBeUndefined()
  })

  it('blocks contribution and network refresh while retaining local catalog access', () => {
    expect(stagingRegistryPolicy(createStagingPolicy('staging'))).toEqual({
      contributionsAllowed: false,
      networkRefreshAllowed: false,
    })
  })
})
