import { compareVersions } from '../src/release-notes.ts'

const REPOSITORY = 'mriverodorta/homelab-inventory'
const SOURCE = 'https://github.com/mriverodorta/homelab-inventory'
const AUTH_URL = new URL('https://auth.docker.io/token')
AUTH_URL.searchParams.set('service', 'registry.docker.io')
AUTH_URL.searchParams.set('scope', `repository:${REPOSITORY}:pull`)

const REGISTRY_URL = `https://registry-1.docker.io/v2/${REPOSITORY}`
const INDEX_MEDIA_TYPES = new Set([
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.index.v1+json',
])
const MANIFEST_MEDIA_TYPES = new Set([
  'application/vnd.docker.distribution.manifest.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
])
const CONFIG_MEDIA_TYPES = new Set([
  'application/octet-stream',
  'application/vnd.docker.container.image.v1+json',
  'application/vnd.oci.image.config.v1+json',
])
const JSON_MEDIA_TYPES = new Set(['application/json'])
const MANIFEST_ACCEPT = [...INDEX_MEDIA_TYPES, ...MANIFEST_MEDIA_TYPES].join(', ')
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/

export const UPDATE_CACHE_MS = 6 * 60 * 60 * 1000

export class UpdateCheckError extends Error {
  constructor(code, options) {
    super(`Update check failed: ${code}`, options)
    this.name = 'UpdateCheckError'
    this.code = code
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function validateDigest(value) {
  if (!isNonEmptyString(value) || !DIGEST_PATTERN.test(value)) {
    throw new UpdateCheckError('registry-response-invalid')
  }

  return value
}

function validateManifest(payload) {
  if (!isRecord(payload) || payload.schemaVersion !== 2 || !isRecord(payload.config)) {
    throw new UpdateCheckError('registry-response-invalid')
  }

  return {
    ...payload,
    config: {
      ...payload.config,
      digest: validateDigest(payload.config.digest),
    },
  }
}

function isIndex(payload) {
  return isRecord(payload) && Array.isArray(payload.manifests)
}

function selectLinuxManifest(index, preferredArchitecture = null) {
  if (!isRecord(index) || index.schemaVersion !== 2 || !Array.isArray(index.manifests)) {
    throw new UpdateCheckError('registry-response-invalid')
  }

  const supported = index.manifests.filter((manifest) => (
    isRecord(manifest)
    && isRecord(manifest.platform)
    && manifest.platform.os === 'linux'
    && ['amd64', 'arm64'].includes(manifest.platform.architecture)
  ))
  const selected = preferredArchitecture
    ? supported.find((manifest) => manifest.platform.architecture === preferredArchitecture)
    : supported.find((manifest) => manifest.platform.architecture === 'amd64')
      ?? supported.find((manifest) => manifest.platform.architecture === 'arm64')

  if (!selected) {
    throw new UpdateCheckError('registry-response-invalid')
  }

  return validateDigest(selected.digest)
}

function validateLabels(labels, channel) {
  const version = labels?.['org.opencontainers.image.version']
  const revision = labels?.['org.opencontainers.image.revision']
  const source = labels?.['org.opencontainers.image.source']
  const publishedChannel = labels?.['io.homelab-inventory.channel']

  if (
    !isRecord(labels)
    || !isNonEmptyString(version)
    || !isNonEmptyString(revision)
    || source !== SOURCE
    || publishedChannel !== channel
  ) {
    throw new UpdateCheckError('image-metadata-invalid')
  }

  try {
    compareVersions(version, version)
  } catch {
    throw new UpdateCheckError('image-metadata-invalid')
  }

  return {
    revision: revision.trim(),
    version: version.trim().replace(/^v/, ''),
  }
}

function parseContentLength(response, maxResponseBytes) {
  const header = response.headers.get('content-length')

  if (header === null) {
    return
  }

  const length = Number(header)

  if (!Number.isSafeInteger(length) || length < 0 || length > maxResponseBytes) {
    throw new UpdateCheckError('registry-response-invalid')
  }
}

function validateContentType(response, acceptedContentTypes) {
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()

  if (!contentType || !acceptedContentTypes.has(contentType)) {
    throw new UpdateCheckError('registry-response-invalid')
  }
}

async function readBoundedBody(response, maxResponseBytes) {
  if (!response.body) {
    throw new UpdateCheckError('registry-response-invalid')
  }

  const reader = response.body.getReader()
  const chunks = []
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()

      if (done) break

      totalBytes += value.byteLength
      if (totalBytes > maxResponseBytes) {
        await reader.cancel()
        throw new UpdateCheckError('registry-response-invalid')
      }
      chunks.push(value)
    }
  } catch (error) {
    if (error instanceof UpdateCheckError) throw error
    throw new UpdateCheckError('registry-response-invalid', { cause: error })
  }

  const body = new Uint8Array(totalBytes)
  let offset = 0

  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }

  return new TextDecoder('utf-8', { fatal: true }).decode(body)
}

function isTimeoutError(error) {
  return error?.name === 'TimeoutError'
    || (error?.name === 'AbortError' && /timeout/i.test(error?.message ?? ''))
}

export function normalizePersistedUpdateResult(result, { channel, runningVersion }) {
  if (!isRecord(result) || result.errorCode !== null || result.channel !== channel) return null
  if (result.state !== 'available' && result.state !== 'current') return null
  if (!isNonEmptyString(result.runningVersion) || !isNonEmptyString(result.availableVersion)) return null
  if (!isNonEmptyString(result.runningRevision) || !isNonEmptyString(result.availableRevision)) return null
  if (typeof result.checkedAt !== 'string') return null

  const normalizedRunningVersion = runningVersion.trim().replace(/^v/, '')
  const persistedRunningVersion = result.runningVersion.trim().replace(/^v/, '')
  const availableVersion = result.availableVersion.trim().replace(/^v/, '')
  const checkedAtMs = Date.parse(result.checkedAt)

  if (persistedRunningVersion !== normalizedRunningVersion || !Number.isFinite(checkedAtMs)) return null

  let comparison
  try {
    compareVersions(normalizedRunningVersion, normalizedRunningVersion)
    comparison = compareVersions(availableVersion, normalizedRunningVersion)
  } catch {
    return null
  }

  const normalized = {
    availableRevision: result.availableRevision.trim(),
    availableVersion,
    channel,
    checkedAt: new Date(checkedAtMs).toISOString(),
    errorCode: null,
    runningRevision: result.runningRevision.trim(),
    runningVersion: normalizedRunningVersion,
    state: comparison > 0 ? 'available' : 'current',
    updateAvailable: comparison > 0,
  }

  return Object.entries(normalized).every(([key, value]) => result[key] === value)
    ? result
    : normalized
}

export class DockerHubUpdateChecker {
  constructor({
    enabled = true,
    channel = 'stable',
    tag = channel,
    platformArchitecture = null,
    runningVersion,
    runningRevision = 'unknown',
    fetch = globalThis.fetch,
    now = Date.now,
    timeoutMs = 8_000,
    maxResponseBytes = 1_000_000,
  }) {
    if (!['stable', 'latest', 'release'].includes(channel)) {
      throw new Error(`Unsupported update channel: ${channel}`)
    }
    if (
      (channel === 'release' && !/^\d+\.\d+\.\d+$/.test(tag))
      || (channel !== 'release' && tag !== channel)
    ) {
      throw new Error(`Unsupported update tag: ${tag}`)
    }
    if (platformArchitecture !== null && !['amd64', 'arm64'].includes(platformArchitecture)) {
      throw new Error(`Unsupported platform architecture: ${platformArchitecture}`)
    }
    try {
      compareVersions(runningVersion, runningVersion)
    } catch {
      throw new Error(`Invalid running version: ${runningVersion}`)
    }
    if (typeof fetch !== 'function') throw new TypeError('fetch must be a function')
    if (typeof now !== 'function') throw new TypeError('now must be a function')
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs must be positive')
    if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0) {
      throw new TypeError('maxResponseBytes must be a positive integer')
    }

    this.enabled = enabled
    this.channel = channel
    this.tag = tag
    this.platformArchitecture = platformArchitecture
    this.runningVersion = runningVersion.trim().replace(/^v/, '')
    this.runningRevision = runningRevision
    this.fetch = fetch
    this.now = now
    this.timeoutMs = timeoutMs
    this.maxResponseBytes = maxResponseBytes
    this.cachedResult = null
    this.inFlight = null
  }

  async check({ force = false, persistedResult = null } = {}) {
    if (!this.enabled) return this.disabledResult()

    const cached = this.freshestResult(this.cachedResult, persistedResult)
    if (!force && cached && this.isFresh(cached)) return cached
    if (this.inFlight) return this.inFlight

    this.inFlight = this.resolvePublishedImage()
      .then((result) => {
        this.cachedResult = result
        return result
      })
      .catch((error) => this.unknownResult(this.toErrorCode(error)))
      .finally(() => {
        this.inFlight = null
      })

    return this.inFlight
  }

  async resolvePublishedImage() {
    const tokenPayload = await this.fetchJson(AUTH_URL.href, JSON_MEDIA_TYPES)

    if (!isNonEmptyString(tokenPayload?.token)) {
      throw new UpdateCheckError('registry-response-invalid')
    }

    const headers = {
      Accept: MANIFEST_ACCEPT,
      Authorization: `Bearer ${tokenPayload.token}`,
    }
    const rootManifest = await this.fetchJson(
      `${REGISTRY_URL}/manifests/${this.tag}`,
      new Set([...INDEX_MEDIA_TYPES, ...MANIFEST_MEDIA_TYPES]),
      { headers },
    )
    const imageManifest = isIndex(rootManifest)
      ? await this.fetchJson(
        `${REGISTRY_URL}/manifests/${selectLinuxManifest(rootManifest, this.platformArchitecture)}`,
        MANIFEST_MEDIA_TYPES,
        { headers },
      )
      : rootManifest
    const manifest = validateManifest(imageManifest)
    const config = await this.fetchJson(
      `${REGISTRY_URL}/blobs/${manifest.config.digest}`,
      CONFIG_MEDIA_TYPES,
      {
        headers: {
          Accept: [...CONFIG_MEDIA_TYPES].join(', '),
          Authorization: headers.Authorization,
        },
      },
    )
    const metadata = validateLabels(config?.config?.Labels, this.channel)
    const comparison = compareVersions(metadata.version, this.runningVersion)

    return {
      availableRevision: metadata.revision,
      availableVersion: metadata.version,
      channel: this.channel,
      checkedAt: new Date(this.now()).toISOString(),
      errorCode: null,
      runningRevision: this.runningRevision,
      runningVersion: this.runningVersion,
      state: comparison > 0 ? 'available' : 'current',
      updateAvailable: comparison > 0,
    }
  }

  async fetchJson(url, acceptedContentTypes, options = {}) {
    let response

    try {
      response = await this.fetch(url, {
        ...options,
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      if (isTimeoutError(error)) {
        throw new UpdateCheckError('registry-timeout', { cause: error })
      }
      throw new UpdateCheckError('registry-unavailable', { cause: error })
    }

    if (response.status === 429) {
      throw new UpdateCheckError('registry-rate-limited')
    }
    if (!response.ok) {
      throw new UpdateCheckError('registry-unavailable')
    }

    parseContentLength(response, this.maxResponseBytes)
    validateContentType(response, acceptedContentTypes)

    let text
    try {
      text = await readBoundedBody(response, this.maxResponseBytes)
      return JSON.parse(text)
    } catch (error) {
      if (error instanceof UpdateCheckError) throw error
      throw new UpdateCheckError('registry-response-invalid', { cause: error })
    }
  }

  disabledResult() {
    return {
      availableRevision: null,
      availableVersion: null,
      channel: this.channel,
      checkedAt: null,
      errorCode: null,
      runningRevision: this.runningRevision,
      runningVersion: this.runningVersion,
      state: 'disabled',
      updateAvailable: false,
    }
  }

  unknownResult(errorCode) {
    return {
      availableRevision: null,
      availableVersion: null,
      channel: this.channel,
      checkedAt: null,
      errorCode,
      runningRevision: this.runningRevision,
      runningVersion: this.runningVersion,
      state: 'unknown',
      updateAvailable: false,
    }
  }

  freshestResult(...results) {
    return results
      .map((result) => normalizePersistedUpdateResult(result, {
        channel: this.channel,
        runningVersion: this.runningVersion,
      }))
      .filter(Boolean)
      .sort((left, right) => Date.parse(right.checkedAt) - Date.parse(left.checkedAt))[0] ?? null
  }

  isFresh(result) {
    const checkedAt = Date.parse(result.checkedAt)
    return Number.isFinite(checkedAt)
      && this.now() - checkedAt < UPDATE_CACHE_MS
      && this.now() >= checkedAt
  }

  toErrorCode(error) {
    return error instanceof UpdateCheckError ? error.code : 'registry-unavailable'
  }
}
