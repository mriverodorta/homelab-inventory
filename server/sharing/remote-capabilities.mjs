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
  return Object.freeze({
    accountClaiming: supported(capabilities.accountClaiming),
    installationEvents: supported(capabilities.installationEvents),
    ownerAnalytics: supported(capabilities.ownerAnalytics),
    protectedShares: supported(capabilities.protectedPasswordHandoff),
    remoteLifecycle: supported(capabilities.lifecycleOperations),
  })
}

function supported(value) {
  if (!isRecord(value) || typeof value.supported !== 'boolean') throw new Error('lab.gd capability support flag is invalid.')
  return value.supported
}

function integerList(value) {
  if (!Array.isArray(value) || value.some((item) => !Number.isSafeInteger(item) || item <= 0)) throw new Error('lab.gd contract version list is invalid.')
  return value
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
