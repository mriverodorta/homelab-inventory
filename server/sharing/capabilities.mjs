export const SHARING_CAPABILITY_VERSION = 1

const OPTIONAL_CAPABILITIES = Object.freeze([
  'accountClaiming',
  'installationEvents',
  'ownerAnalytics',
  'protectedShares',
  'remoteLifecycle',
])

export function sharingClientCapabilities({ enabled = false, publication = false, remote = {} } = {}) {
  const active = enabled === true
  const capabilities = {
    version: SHARING_CAPABILITY_VERSION,
    publication: active && publication === true,
    accountClaiming: false,
    installationEvents: false,
    ownerAnalytics: false,
    protectedShares: false,
    remoteLifecycle: false,
    views: active ? ['systems', 'canvas'] : [],
    visibility: active ? ['public', 'unlisted'] : [],
    mutability: active ? ['immutable', 'replaceable'] : [],
    synchronization: active ? ['manual', 'synchronized'] : [],
    embeds: active,
    resourceSnapshots: active,
    comments: 'coming-soon',
    reactions: 'coming-soon',
  }
  for (const name of OPTIONAL_CAPABILITIES) capabilities[name] = active && remote[name] === true
  if (capabilities.protectedShares) capabilities.visibility.push('protected')
  return Object.freeze(capabilities)
}
