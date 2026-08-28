import { createExternalAccessPolicy } from './external-access-policy.mjs'

export function createStagingPolicy(appMode) {
  const staging = appMode === 'staging'
  const externalAccess = createExternalAccessPolicy(appMode)
  return Object.freeze({
    staging,
    isolated: externalAccess.isolated,
    authenticationDisabled: externalAccess.isolated,
    agentsDisabled: externalAccess.isolated,
    notificationsDisabled: externalAccess.isolated,
    sharingDisabled: !externalAccess.labGdAllowed,
    registryIdentityDisabled: !externalAccess.registryIdentityAllowed,
    registryContributionsDisabled: !externalAccess.registryContributionsAllowed,
    registryNetworkRefreshDisabled: !externalAccess.registryNetworkRefreshAllowed,
    updateChecksDisabled: !externalAccess.updateChecksAllowed,
    scheduledBackupsDisabled: externalAccess.isolated,
  })
}

export function stagingRegistryPolicy(policy) {
  if (!policy.isolated) return undefined
  return Object.freeze({
    contributionsAllowed: false,
    networkRefreshAllowed: false,
  })
}
