import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-.][0-9A-Za-z.-]+)?$/
const REVISION_PATTERN = /^(?:[0-9a-f]{40}|unknown)$/
const DIGEST_PATTERN = /^[0-9a-f]{64}$/
const ASSET_PATH_PATTERN = /^(?:[A-Za-z0-9._-]+|schemas\/[A-Za-z0-9._-]+\.schema\.json)$/
const CONTAINER_MODES = new Set(['disabled', 'proxy', 'socket'])
const CONTAINER_RUNTIMES = new Set(['docker', 'podman'])

function releaseError(message) {
  const error = new Error(message)
  error.code = 'invalid-agent-release'
  return error
}

function shellArgument(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`
}

function contentType(assetPath) {
  if (assetPath.endsWith('.json')) return 'application/json; charset=utf-8'
  if (assetPath.endsWith('.sh') || assetPath === 'homelab_inventory_agent') return 'text/x-shellscript; charset=utf-8'
  if (assetPath.endsWith('.service') || assetPath.endsWith('.txt')) return 'text/plain; charset=utf-8'
  return 'application/octet-stream'
}

function validateContainerOptions(input = {}) {
  const mode = input.mode ?? 'disabled'
  const runtime = input.runtime ?? 'docker'
  const endpoint = input.endpoint?.trim() ?? ''
  if (!CONTAINER_MODES.has(mode)) throw releaseError('Container collection mode is invalid.')
  if (!CONTAINER_RUNTIMES.has(runtime)) throw releaseError('Container runtime is invalid.')
  if (mode === 'disabled') return { mode, runtime, endpoint: '' }
  if (!endpoint || endpoint.length > 2048 || /[\s'"`$;|&<>(){}]/.test(endpoint)) {
    throw releaseError('Container endpoint is invalid.')
  }
  return { mode, runtime, endpoint }
}

export class AgentReleaseService {
  constructor({
    directory = process.env.AGENT_RELEASE_DIR ?? path.resolve('server/agent-release'),
    expectedVersion = null,
    expectedSourceRevision = null,
  } = {}) {
    this.directory = path.resolve(directory)
    this.expectedVersion = expectedVersion
    this.expectedSourceRevision = expectedSourceRevision
    this.manifest = null
    this.assets = new Map()
  }

  async initialize() {
    const manifestPath = path.join(this.directory, 'manifest.json')
    const body = await fs.readFile(manifestPath, 'utf8').catch((error) => {
      throw releaseError(`Embedded agent manifest could not be read: ${error.message}`)
    })
    let manifest
    try {
      manifest = JSON.parse(body)
    } catch {
      throw releaseError('Embedded agent manifest contains invalid JSON.')
    }
    if (!VERSION_PATTERN.test(manifest.version) || !REVISION_PATTERN.test(manifest.sourceRevision) || manifest.protocolMajor !== 1 || !Array.isArray(manifest.assets)) {
      throw releaseError('Embedded agent manifest metadata is invalid.')
    }
    if (this.expectedVersion && manifest.version !== this.expectedVersion) throw releaseError('Embedded agent version does not match the application pin.')
    if (this.expectedSourceRevision && manifest.sourceRevision !== this.expectedSourceRevision) throw releaseError('Embedded agent source revision does not match the application pin.')
    if (manifest.assets.length < 19 || manifest.assets.length > 64) throw releaseError('Embedded agent manifest asset count is invalid.')
    const assets = new Map()
    for (const asset of manifest.assets) {
      if (!asset || !ASSET_PATH_PATTERN.test(asset.path) || !DIGEST_PATTERN.test(asset.sha256) || !Number.isSafeInteger(asset.bytes) || asset.bytes < 1) {
        throw releaseError('Embedded agent manifest contains an invalid asset.')
      }
      if (assets.has(asset.path)) throw releaseError(`Embedded agent manifest repeats ${asset.path}.`)
      const filePath = path.resolve(this.directory, asset.path)
      if (!filePath.startsWith(`${this.directory}${path.sep}`)) throw releaseError('Embedded agent asset escapes its release directory.')
      const file = await fs.readFile(filePath)
      const digest = createHash('sha256').update(file).digest('hex')
      if (file.byteLength !== asset.bytes || digest !== asset.sha256) throw releaseError(`Embedded agent asset ${asset.path} failed verification.`)
      assets.set(asset.path, Object.freeze({ ...asset, filePath, contentType: contentType(asset.path) }))
    }
    for (const required of [
      'homelab-inventory-agent-linux-amd64', 'homelab-inventory-agent-linux-arm64',
      'homelab-inventory-agent-freebsd-amd64', 'install.sh', 'install-freebsd.sh',
      'version.txt',
    ]) {
      if (!assets.has(required)) throw releaseError(`Embedded agent release is missing ${required}.`)
    }
    const checksumsPath = path.join(this.directory, 'checksums.txt')
    const checksums = await fs.readFile(checksumsPath).catch(() => null)
    const expectedChecksums = `${manifest.assets.map((asset) => `${asset.sha256}  ${asset.path}`).join('\n')}\n`
    if (!checksums || checksums.toString('utf8') !== expectedChecksums) {
      throw releaseError('Embedded agent checksums do not match the release manifest.')
    }
    assets.set('checksums.txt', Object.freeze({
      path: 'checksums.txt',
      sha256: createHash('sha256').update(checksums).digest('hex'),
      bytes: checksums.byteLength,
      filePath: checksumsPath,
      contentType: contentType('checksums.txt'),
    }))
    const manifestFile = Buffer.from(body)
    assets.set('manifest.json', Object.freeze({
      path: 'manifest.json',
      sha256: createHash('sha256').update(manifestFile).digest('hex'),
      bytes: manifestFile.byteLength,
      filePath: manifestPath,
      contentType: contentType('manifest.json'),
    }))
    this.manifest = Object.freeze(manifest)
    this.assets = assets
    return this.current()
  }

  current() {
    if (!this.manifest) throw releaseError('Embedded agent release is not initialized.')
    return this.manifest
  }

  asset(assetPath) {
    return this.assets.get(assetPath) ?? null
  }

  installCommands({ endpoint, hostType, hostId, activationToken, containers }) {
    const config = validateContainerOptions(containers)
    const common = [
      '--endpoint', endpoint,
      '--version', this.current().version,
      '--host-type', hostType,
      '--host-id', hostId,
      '--enrollment-code', activationToken,
      '--containers-mode', config.mode,
      '--containers-runtime', config.runtime,
      ...(config.endpoint ? ['--containers-endpoint', config.endpoint] : []),
    ].map(shellArgument).join(' ')
    const base = `${endpoint}/api/agent/releases/${this.current().version}`
    return {
      linux: `curl -fsSL ${shellArgument(`${base}/install.sh`)} | sudo sh -s -- ${common}`,
      freebsd: `fetch -q -o - ${shellArgument(`${base}/install-freebsd.sh`)} | sudo sh -s -- ${common}`,
    }
  }

  upgradeCommands(endpoint) {
    const version = this.current().version
    const base = `${endpoint}/api/agent/releases/${version}`
    const common = `--endpoint ${shellArgument(endpoint)} --version ${shellArgument(version)} --upgrade`
    return {
      linux: `curl -fsSL ${shellArgument(`${base}/install.sh`)} | sudo sh -s -- ${common}`,
      freebsd: `fetch -q -o - ${shellArgument(`${base}/install-freebsd.sh`)} | sudo sh -s -- ${common}`,
    }
  }
}

export function registerAgentReleaseRoutes(app, service, { disabled = false } = {}) {
  const denied = (_request, response) => response.status(403).json({ message: 'Agent features are disabled in public demo mode.', code: 'agent-disabled' })
  const sendAsset = async (request, response, next) => {
    try {
      if (disabled) return denied(request, response)
      const version = request.params.version ?? service.current().version
      const assetPath = request.params[0] ?? 'install.sh'
      if (version !== service.current().version) return response.status(404).json({ message: 'Agent release not found.' })
      const asset = service.asset(assetPath)
      if (!asset) return response.status(404).json({ message: 'Agent release asset not found.' })
      response
        .set('Cache-Control', 'public, max-age=31536000, immutable')
        .set('ETag', `"sha256-${asset.sha256}"`)
        .set('X-Content-Type-Options', 'nosniff')
        .type(asset.contentType)
        .sendFile(asset.filePath)
    } catch (error) {
      next(error)
    }
  }
  app.get('/api/agent/install.sh', (request, response, next) => {
    request.params.version = service.current().version
    request.params[0] = 'install.sh'
    return sendAsset(request, response, next)
  })
  app.get(/^\/api\/agent\/releases\/([^/]+)\/(.+)$/, (request, response, next) => {
    request.params.version = request.params[0]
    request.params[0] = request.params[1]
    return sendAsset(request, response, next)
  })
}
