export function createStagingPolicy(appMode) {
  const staging = appMode === 'staging'
  return Object.freeze({
    staging,
    authenticationDisabled: staging,
    agentsDisabled: staging,
    notificationsDisabled: staging,
    registryIdentityDisabled: staging,
    registryContributionsDisabled: staging,
    registryNetworkRefreshDisabled: staging,
    updateChecksDisabled: staging,
    scheduledBackupsDisabled: staging,
  })
}

export function stagingRegistryPolicy(policy) {
  if (!policy.staging) return undefined
  return Object.freeze({
    contributionsAllowed: false,
    networkRefreshAllowed: false,
  })
}
