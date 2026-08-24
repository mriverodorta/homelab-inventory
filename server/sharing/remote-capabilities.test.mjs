import { describe, expect, it } from 'vitest'
import { normalizeLabGdCapabilities } from './remote-capabilities.mjs'

function document(overrides = {}) {
  return {
    protocolVersion: 1,
    shareContractVersions: [1],
    viewContractVersions: { systems: [1], canvas: [1] },
    capabilities: {
      installationEvents: { supported: true, resumable: true },
      protectedPasswordHandoff: { supported: true },
      lifecycleOperations: { supported: true, operations: ['update', 'unpublish', 'delete', 'republish', 'replace-password'] },
      accountClaiming: {
        supported: true,
        statusSupported: true,
        statusVersions: [1, 2],
        unlinkSupported: true,
        unlinkDispositions: ['keep', 'unpublish', 'delete'],
      },
      ownerAnalytics: { supported: true, buckets: ['day'], retentionDays: 90 },
      comments: { configurationSupported: true, interactionSupported: false },
      reactions: { configurationSupported: true, interactionSupported: false },
    },
    ...overrides,
  }
}

describe('lab.gd remote capability contract', () => {
  it('maps the exact service document into client feature gates', () => {
    expect(normalizeLabGdCapabilities(document())).toEqual({
      accountClaiming: true,
      accountUnlink: true,
      installationAccountStatus: true,
      installationEvents: true,
      ownerAnalytics: true,
      protectedShares: true,
      remoteLifecycle: true,
    })
  })

  it('keeps account claiming usable while older services leave unlink disabled', () => {
    const value = document()
    value.capabilities.accountClaiming = { supported: true, statusSupported: true }
    expect(normalizeLabGdCapabilities(value)).toMatchObject({
      accountClaiming: true,
      accountUnlink: false,
      installationAccountStatus: true,
    })

    value.capabilities.accountClaiming = {
      supported: true,
      statusSupported: true,
      statusVersions: [1, 2],
      unlinkSupported: false,
    }
    expect(normalizeLabGdCapabilities(value).accountUnlink).toBe(false)
  })

  it('rejects malformed present unlink declarations', () => {
    for (const accountClaiming of [
      { supported: true, statusSupported: true, unlinkSupported: true, statusVersions: [1], unlinkDispositions: ['keep', 'unpublish', 'delete'] },
      { supported: true, statusSupported: true, unlinkSupported: true, statusVersions: [1, 2], unlinkDispositions: ['keep', 'keep', 'delete'] },
      { supported: true, statusSupported: true, unlinkSupported: true, statusVersions: [1, 2], unlinkDispositions: ['keep', 'unpublish'] },
      { supported: true, statusSupported: true, unlinkSupported: true, statusVersions: [1, 2], unlinkDispositions: ['keep', 'unpublish', 'archive'] },
    ]) {
      const value = document()
      value.capabilities.accountClaiming = accountClaiming
      expect(() => normalizeLabGdCapabilities(value)).toThrow(/unlink/iu)
    }
  })

  it('rejects unsupported protocol, share, and view versions', () => {
    expect(() => normalizeLabGdCapabilities(document({ protocolVersion: 2 }))).toThrow(/protocol/iu)
    expect(() => normalizeLabGdCapabilities(document({ shareContractVersions: [2] }))).toThrow(/share contract/iu)
    expect(() => normalizeLabGdCapabilities(document({ viewContractVersions: { systems: [1], canvas: [2] } }))).toThrow(/canvas/iu)
  })

  it('requires explicit booleans instead of treating missing declarations as support', () => {
    const value = document()
    delete value.capabilities.ownerAnalytics.supported
    expect(() => normalizeLabGdCapabilities(value)).toThrow(/support flag/iu)
  })

  it('rejects unsupported and incomplete required features', () => {
    const unsupported = document()
    unsupported.capabilities.installationEvents.supported = false
    expect(() => normalizeLabGdCapabilities(unsupported)).toThrow(/installation events/iu)

    const notResumable = document()
    notResumable.capabilities.installationEvents.resumable = false
    expect(() => normalizeLabGdCapabilities(notResumable)).toThrow(/resumable/iu)

    const missingLifecycle = document()
    missingLifecycle.capabilities.lifecycleOperations.operations = ['update', 'unpublish']
    expect(() => normalizeLabGdCapabilities(missingLifecycle)).toThrow(/lifecycle/iu)

    const wrongAnalytics = document()
    wrongAnalytics.capabilities.ownerAnalytics.retentionDays = 30
    expect(() => normalizeLabGdCapabilities(wrongAnalytics)).toThrow(/analytics/iu)
  })
})
