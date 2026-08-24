import { SHARE_CONTRACT_VERSION } from '../../packages/share-contract/src/index.ts'

const VIEW_CONTRACT_VERSION = 1

export function normalizeLabGdCapabilities(value) {
  if (!isRecord(value) || value.protocolVersion !== 1) throw new Error('lab.gd capability protocol is unsupported.')
  if (!integerList(value.shareContractVersions).includes(SHARE_CONTRACT_VERSION)) throw new Error('lab.gd does not support this share contract.')
  if (!isRecord(value.viewContractVersions)) throw new Error('lab.gd view capabilities are invalid.')
  for (const view of ['systems', 'canvas']) {
    if (!integerList(value.viewContractVersions[view]).includes(VIEW_CONTRACT_VERSION)) throw new Error(`lab.gd does not support ${view} view contract ${VIEW_CONTRACT_VERSION}.`)
  }
  const capabilities = value.capabilities
  if (!isRecord(capabilities)) throw new Error('lab.gd capability declarations are invalid.')
  requireSupported(capabilities.installationEvents, 'installation events')
  if (capabilities.installationEvents.resumable !== true) throw new Error('lab.gd installation events are not resumable.')
  requireSupported(capabilities.protectedPasswordHandoff, 'protected password handoff')
  requireSupported(capabilities.lifecycleOperations, 'lifecycle operations')
  requireExactStrings(capabilities.lifecycleOperations.operations, ['update', 'unpublish', 'delete', 'republish', 'replace-password'], 'lifecycle operations')
  requireSupported(capabilities.accountClaiming, 'account claiming')
  if (typeof capabilities.accountClaiming.statusSupported !== 'boolean') throw new Error('lab.gd account status support flag is invalid.')
  requireSupported(capabilities.ownerAnalytics, 'owner analytics')
  requireExactStrings(capabilities.ownerAnalytics.buckets, ['day'], 'owner analytics buckets')
  if (capabilities.ownerAnalytics.retentionDays !== 90) throw new Error('lab.gd owner analytics retention is unsupported.')
  requireConfigurationOnly(capabilities.comments, 'comments')
  requireConfigurationOnly(capabilities.reactions, 'reactions')
  return Object.freeze({
    accountClaiming: true,
    installationAccountStatus: capabilities.accountClaiming.statusSupported,
    installationEvents: true,
    ownerAnalytics: true,
    protectedShares: true,
    remoteLifecycle: true,
  })
}

function requireSupported(value, name) {
  if (!isRecord(value) || typeof value.supported !== 'boolean') throw new Error('lab.gd capability support flag is invalid.')
  if (value.supported !== true) throw new Error(`lab.gd ${name} are unsupported.`)
}

function requireExactStrings(value, expected, name) {
  if (!Array.isArray(value) || value.length !== expected.length || value.some((item) => typeof item !== 'string') || new Set(value).size !== value.length || expected.some((item) => !value.includes(item))) {
    throw new Error(`lab.gd ${name} are unsupported.`)
  }
}

function requireConfigurationOnly(value, name) {
  if (!isRecord(value) || value.configurationSupported !== true || value.interactionSupported !== false) throw new Error(`lab.gd ${name} capabilities are unsupported.`)
}

function integerList(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 16 || new Set(value).size !== value.length || value.some((item) => !Number.isSafeInteger(item) || item <= 0)) throw new Error('lab.gd contract version list is invalid.')
  return value
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
