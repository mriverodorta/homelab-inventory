import os from 'node:os'
import path from 'node:path'

export const RELEASE_STATE_VERSION = 2
export const DEFAULT_REMOTE_HOST = 'bolt'
export const DEFAULT_REMOTE_STACK_DIR = '/data/stack/homelab-inventory'
export const DEFAULT_REMOTE_DATA_DIR = `${DEFAULT_REMOTE_STACK_DIR}/data`
export const STAGING_CONTAINER = 'homelab-inventory-staging'
export const STAGING_NETWORK = 'homelab-inventory-staging-isolated'
export const STAGING_INGRESS_CONTAINER = 'homelab-inventory-staging-ingress'
export const STAGING_INGRESS_NETWORK = 'homelab-inventory-staging-ingress'
export const STAGING_PORT = 8799

export function releasePaths(environment = process.env) {
  const home = environment.HOME || os.homedir()
  const supportRoot = environment.HOMELAB_RELEASE_HOME
    || path.join(home, 'Library', 'Application Support', 'Homelab Inventory Release')
  const cacheRoot = environment.HOMELAB_RELEASE_CACHE
    || path.join(home, 'Library', 'Caches', 'homelab-inventory-release')

  return {
    supportRoot,
    cacheRoot,
    stateFile: path.join(supportRoot, 'state.json'),
    lockFile: path.join(supportRoot, 'lock'),
    receiptsDir: path.join(supportRoot, 'receipts'),
    ciReceiptFile: path.join(supportRoot, 'receipts', 'ci.json'),
    ciPhaseCacheDir: path.join(supportRoot, 'receipts', 'ci-phases'),
    candidatesDir: path.join(supportRoot, 'candidates'),
    logsDir: path.join(supportRoot, 'logs'),
    toolsDir: path.join(supportRoot, 'tools'),
    artifactsRoot: path.join(supportRoot, 'artifacts'),
    portableArtifactsDir: path.join(supportRoot, 'artifacts', 'wasm', 'current'),
    agentArtifactsDir: path.join(supportRoot, 'artifacts', 'agent', 'current'),
    dataDir: path.join(supportRoot, 'data'),
    incomingDataDir: path.join(supportRoot, 'data', 'incoming'),
    currentDataDir: path.join(supportRoot, 'data', 'current'),
    previousDataDir: path.join(supportRoot, 'data', 'previous'),
  }
}

export function releaseRemoteConfig(environment = process.env) {
  const stackDir = environment.HOMELAB_RELEASE_REMOTE_STACK_DIR || DEFAULT_REMOTE_STACK_DIR
  return {
    host: environment.HOMELAB_RELEASE_REMOTE_HOST || DEFAULT_REMOTE_HOST,
    stackDir,
    dataDir: environment.HOMELAB_RELEASE_REMOTE_DATA_DIR || `${stackDir}/data`,
    service: environment.HOMELAB_RELEASE_REMOTE_SERVICE || 'homelab-inventory',
  }
}
