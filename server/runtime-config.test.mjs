import { describe, expect, it } from 'vitest'
import {
  readBooleanSetting,
  readIntegerSetting,
  readRuntimeConfig,
} from './runtime-config.mjs'

describe('runtime configuration', () => {
  it('uses development defaults without environment variables', () => {
    expect(readRuntimeConfig({})).toEqual({
      appMode: 'production',
      port: 5173,
      demoSessionMinutes: 30,
      demoMaxSessions: 100,
      saveDebounceMs: 500,
      seedEmptyData: true,
      externalAccess: {
        isolated: false,
        labGdAllowed: true,
        registryIdentityAllowed: true,
        registryContributionsAllowed: true,
        registryNetworkRefreshAllowed: true,
        updateChecksAllowed: true,
      },
      labGdEnabled: true,
      registryIdentityEnabled: true,
      registryContributionEnabled: true,
      registryNetworkRefreshEnabled: true,
      updateCheckEnabled: true,
    })
  })

  it('uses production seed behavior and accepts explicit supported values', () => {
    expect(readRuntimeConfig({
      NODE_ENV: 'production',
      APP_MODE: 'demo',
      PORT: '8798',
      DEMO_SESSION_MINUTES: '45',
      DEMO_MAX_SESSIONS: '250',
      SAVE_DEBOUNCE_MS: '0',
      SEED_EMPTY_DATA: 'true',
      UPDATE_CHECK_ENABLED: '0',
    })).toEqual({
      appMode: 'demo',
      port: 8798,
      demoSessionMinutes: 45,
      demoMaxSessions: 250,
      saveDebounceMs: 0,
      seedEmptyData: true,
      externalAccess: expect.objectContaining({ isolated: true }),
      labGdEnabled: false,
      registryIdentityEnabled: false,
      registryContributionEnabled: false,
      registryNetworkRefreshEnabled: false,
      updateCheckEnabled: false,
    })
  })

  it('forces update checks off in staging mode', () => {
    expect(readRuntimeConfig({ APP_MODE: 'staging', UPDATE_CHECK_ENABLED: 'true' })).toMatchObject({
      appMode: 'staging',
      updateCheckEnabled: false,
    })
  })

  it.each(['demo', 'staging', 'test'])('prevents %s mode from enabling any external integration', (appMode) => {
    expect(readRuntimeConfig({
      APP_MODE: appMode,
      LABGD_ENABLED: 'true',
      REGISTRY_IDENTITY_ENABLED: 'true',
      REGISTRY_CONTRIBUTION_ENABLED: 'true',
      UPDATE_CHECK_ENABLED: 'true',
    })).toMatchObject({
      appMode,
      labGdEnabled: false,
      registryIdentityEnabled: false,
      registryContributionEnabled: false,
      registryNetworkRefreshEnabled: false,
      updateCheckEnabled: false,
    })
  })

  it('selects isolated test mode when NODE_ENV is test and APP_MODE is absent', () => {
    expect(readRuntimeConfig({ NODE_ENV: 'test' })).toMatchObject({ appMode: 'test', labGdEnabled: false })
  })

  it.each([
    [{ APP_MODE: 'preview' }, 'APP_MODE'],
    [{ PORT: '0' }, 'PORT'],
    [{ PORT: '65536' }, 'PORT'],
    [{ PORT: '5173.5' }, 'PORT'],
    [{ DEMO_SESSION_MINUTES: '-1' }, 'DEMO_SESSION_MINUTES'],
    [{ DEMO_MAX_SESSIONS: 'many' }, 'DEMO_MAX_SESSIONS'],
    [{ SAVE_DEBOUNCE_MS: '60001' }, 'SAVE_DEBOUNCE_MS'],
    [{ SEED_EMPTY_DATA: 'sometimes' }, 'SEED_EMPTY_DATA'],
    [{ UPDATE_CHECK_ENABLED: '' }, 'UPDATE_CHECK_ENABLED'],
  ])('rejects invalid configuration %o', (environment, setting) => {
    expect(() => readRuntimeConfig(environment)).toThrow(setting)
  })

  it('enforces caller-provided integer bounds', () => {
    expect(readIntegerSetting({ COUNT: '4' }, 'COUNT', 2, { minimum: 1, maximum: 5 })).toBe(4)
    expect(() => readIntegerSetting({ COUNT: '6' }, 'COUNT', 2, { minimum: 1, maximum: 5 }))
      .toThrow('COUNT')
  })

  it('accepts case-insensitive boolean strings', () => {
    expect(readBooleanSetting({ ENABLED: ' TRUE ' }, 'ENABLED', false)).toBe(true)
    expect(readBooleanSetting({ ENABLED: 'False' }, 'ENABLED', true)).toBe(false)
  })
})
