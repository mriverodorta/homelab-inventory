import { describe, expect, it } from 'vitest'
import { sharingClientCapabilities } from './capabilities.mjs'

describe('sharing client capabilities', () => {
  it('fails closed for disabled, demo, and staging runtimes', () => {
    expect(sharingClientCapabilities({ enabled: false, publication: true, remote: { protectedShares: true } })).toMatchObject({
      publication: false,
      protectedShares: false,
      visibility: [],
      views: [],
    })
  })

  it('advertises only implemented local and explicitly negotiated remote behavior', () => {
    expect(sharingClientCapabilities({
      enabled: true,
      publication: true,
      remote: { accountClaiming: true, installationEvents: true, protectedShares: true },
    })).toEqual({
      version: 1,
      publication: true,
      accountClaiming: true,
      installationAccountStatus: false,
      installationEvents: true,
      ownerAnalytics: false,
      protectedShares: true,
      remoteLifecycle: false,
      views: ['systems', 'canvas'],
      visibility: ['public', 'unlisted', 'protected'],
      mutability: ['immutable', 'replaceable'],
      synchronization: ['manual', 'synchronized'],
      embeds: true,
      resourceSnapshots: true,
      comments: 'coming-soon',
      reactions: 'coming-soon',
    })
  })
})
