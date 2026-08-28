export const ISOLATED_APP_MODES = Object.freeze(['demo', 'staging', 'test'])

export const ISOLATED_RUNTIME_ENVIRONMENT = Object.freeze({
  APP_MODE: 'staging',
  LABGD_ENABLED: 'false',
  UPDATE_CHECK_ENABLED: 'false',
  REGISTRY_REFRESH_INTERVAL_MS: '0',
  REGISTRY_IDENTITY_ENABLED: 'false',
  REGISTRY_CONTRIBUTION_ENABLED: 'false',
})

export const EXTERNAL_IDENTITY_PATHS = Object.freeze([
  '/data/sharing/installation-instance.json',
  '/data/sharing/installation-ed25519.pem',
  '/data/sharing/installation-credentials.json',
  '/data/registry/installation-instance.json',
  '/data/registry/installation-ed25519.pem',
  '/data/registry/installation-credentials.json',
])

export function isIsolatedAppMode(appMode) {
  return ISOLATED_APP_MODES.includes(appMode)
}

export function createExternalAccessPolicy(appMode) {
  const isolated = isIsolatedAppMode(appMode)
  return Object.freeze({
    isolated,
    labGdAllowed: !isolated,
    registryIdentityAllowed: !isolated,
    registryContributionsAllowed: !isolated,
    registryNetworkRefreshAllowed: !isolated,
    updateChecksAllowed: !isolated,
  })
}

