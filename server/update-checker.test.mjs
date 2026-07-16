import { describe, expect, it, vi } from 'vitest'
import {
  determineImageRelationship,
  DockerHubUpdateChecker,
  UPDATE_CACHE_MS,
  UpdateCheckError,
} from './update-checker.mjs'

const SOURCE = 'https://github.com/mriverodorta/homelab-inventory'
const DIGESTS = {
  amd64: `sha256:${'a'.repeat(64)}`,
  arm64: `sha256:${'b'.repeat(64)}`,
  arm64Only: `sha256:${'c'.repeat(64)}`,
  config: `sha256:${'d'.repeat(64)}`,
  windows: `sha256:${'e'.repeat(64)}`,
}

function requiredLabels({
  version = '0.1.16',
  revision = 'abc123def456',
  channel = 'stable',
  source = SOURCE,
} = {}) {
  return {
    'org.opencontainers.image.version': version,
    'org.opencontainers.image.revision': revision,
    'org.opencontainers.image.source': source,
    'io.homelab-inventory.channel': channel,
  }
}

function jsonResponse(payload, {
  contentType = 'application/json',
  headers = {},
  status = 200,
} = {}) {
  const body = JSON.stringify(payload)

  return new Response(body, {
    status,
    headers: {
      'content-length': String(new TextEncoder().encode(body).byteLength),
      'content-type': contentType,
      ...headers,
    },
  })
}

function createRegistryFetch({
  labels = requiredLabels(),
  platforms = [
    { architecture: 'arm64', os: 'linux', digest: DIGESTS.arm64 },
    { architecture: 'amd64', os: 'linux', digest: DIGESTS.amd64 },
  ],
  rootIsManifest = false,
} = {}) {
  const urls = []
  let tokenCalls = 0
  let manifestCalls = 0
  let configCalls = 0

  const fetch = vi.fn(async (url, options = {}) => {
    const requestUrl = String(url)
    urls.push(requestUrl)

    if (requestUrl.startsWith('https://auth.docker.io/token?')) {
      tokenCalls += 1
      return jsonResponse({ token: 'registry-token' })
    }

    expect(options.headers?.Authorization).toBe('Bearer registry-token')

    if (/\/manifests\/(?:stable|latest|\d+\.\d+\.\d+)$/.test(requestUrl)) {
      manifestCalls += 1

      if (rootIsManifest) {
        return jsonResponse({
          schemaVersion: 2,
          mediaType: 'application/vnd.oci.image.manifest.v1+json',
          config: { digest: DIGESTS.config },
        }, { contentType: 'application/vnd.oci.image.manifest.v1+json' })
      }

      return jsonResponse({
        schemaVersion: 2,
        mediaType: 'application/vnd.oci.image.index.v1+json',
        manifests: platforms.map(({ architecture, os, digest }) => ({
          digest,
          mediaType: 'application/vnd.oci.image.manifest.v1+json',
          platform: { architecture, os },
        })),
      }, { contentType: 'application/vnd.oci.image.index.v1+json' })
    }

    if (requestUrl.includes('/manifests/sha256:')) {
      manifestCalls += 1
      return jsonResponse({
        schemaVersion: 2,
        mediaType: 'application/vnd.oci.image.manifest.v1+json',
        config: { digest: DIGESTS.config },
      }, { contentType: 'application/vnd.oci.image.manifest.v1+json' })
    }

    if (requestUrl.endsWith(`/blobs/${DIGESTS.config}`)) {
      configCalls += 1
      return jsonResponse({ config: { Labels: labels } }, {
        contentType: 'application/vnd.oci.image.config.v1+json',
      })
    }

    throw new Error(`Unexpected registry URL: ${requestUrl}`)
  })

  Object.defineProperties(fetch, {
    configCalls: { get: () => configCalls },
    manifestCalls: { get: () => manifestCalls },
    tokenCalls: { get: () => tokenCalls },
    urls: { get: () => urls },
  })

  return fetch
}

function createChecker({
  channel = 'stable',
  enabled = true,
  fetch = createRegistryFetch(),
  now = () => Date.parse('2026-07-12T12:00:00Z'),
  runningVersion = '0.1.15',
  ...options
} = {}) {
  return new DockerHubUpdateChecker({
    channel,
    enabled,
    fetch,
    now,
    runningRevision: 'running-sha',
    runningVersion,
    ...options,
  })
}

describe('DockerHubUpdateChecker', () => {
  it.each([
    ['newer semantic version', '0.1.16', 'published-sha', '0.1.15', 'running-sha', 'available'],
    ['exact image match', '0.1.15', 'same-sha', '0.1.15', 'same-sha', 'current'],
    ['same version rebuilt', '0.1.15', 'published-sha', '0.1.15', 'running-sha', 'available'],
    ['running image ahead', '0.1.14', 'published-sha', '0.1.15', 'running-sha', 'ahead'],
    ['unknown running revision', '0.1.15', 'published-sha', '0.1.15', 'unknown', 'current'],
    ['missing running revision', '0.1.15', 'published-sha', '0.1.15', null, 'current'],
  ])('determines the image relationship for %s', (
    _name,
    availableVersion,
    availableRevision,
    runningVersion,
    runningRevision,
    expected,
  ) => {
    expect(determineImageRelationship({
      availableRevision,
      availableVersion,
      runningRevision,
      runningVersion,
    })).toBe(expected)
  })

  it('resolves a newer stable image from the fixed Docker Hub repository', async () => {
    const fetch = createRegistryFetch()
    const checker = createChecker({ fetch })

    await expect(checker.check()).resolves.toMatchObject({
      availableRevision: 'abc123def456',
      availableVersion: '0.1.16',
      channel: 'stable',
      checkedAt: '2026-07-12T12:00:00.000Z',
      errorCode: null,
      runningRevision: 'running-sha',
      runningVersion: '0.1.15',
      state: 'available',
      updateAvailable: true,
    })
    expect(fetch.urls).toEqual([
      'https://auth.docker.io/token?service=registry.docker.io&scope=repository%3Amriverodorta%2Fhomelab-inventory%3Apull',
      'https://registry-1.docker.io/v2/mriverodorta/homelab-inventory/manifests/stable',
      `https://registry-1.docker.io/v2/mriverodorta/homelab-inventory/manifests/${DIGESTS.amd64}`,
      `https://registry-1.docker.io/v2/mriverodorta/homelab-inventory/blobs/${DIGESTS.config}`,
    ])
  })

  it('checks the configured latest channel and validates its channel label', async () => {
    const fetch = createRegistryFetch({ labels: requiredLabels({ channel: 'latest' }) })
    const checker = createChecker({ channel: 'latest', fetch })

    await expect(checker.check()).resolves.toMatchObject({
      channel: 'latest',
      state: 'available',
    })
    expect(fetch.urls[1]).toContain('/manifests/latest')
  })

  it('checks an immutable release tag and an explicit arm64 config', async () => {
    const fetch = createRegistryFetch({ labels: requiredLabels({ channel: 'release' }) })
    const checker = createChecker({
      channel: 'release',
      tag: '0.1.16',
      platformArchitecture: 'arm64',
      fetch,
    })

    await expect(checker.check()).resolves.toMatchObject({ channel: 'release', state: 'available' })
    expect(fetch.urls[1]).toContain('/manifests/0.1.16')
    expect(fetch.urls[2]).toContain(DIGESTS.arm64)
  })

  it('prefers linux amd64 and falls back to linux arm64', async () => {
    const amd64Fetch = createRegistryFetch()
    const arm64Fetch = createRegistryFetch({
      platforms: [
        { architecture: 'amd64', os: 'windows', digest: DIGESTS.windows },
        { architecture: 'arm64', os: 'linux', digest: DIGESTS.arm64Only },
      ],
    })

    await createChecker({ fetch: amd64Fetch }).check()
    await createChecker({ fetch: arm64Fetch }).check()

    expect(amd64Fetch.urls[2]).toContain(DIGESTS.amd64)
    expect(arm64Fetch.urls[2]).toContain(DIGESTS.arm64Only)
  })

  it('also accepts a single-platform OCI manifest', async () => {
    const fetch = createRegistryFetch({ rootIsManifest: true })

    await expect(createChecker({ fetch }).check()).resolves.toMatchObject({
      state: 'available',
    })
    expect(fetch.manifestCalls).toBe(1)
    expect(fetch.configCalls).toBe(1)
  })

  it.each([
    ['0.1.16', 'published-sha', '0.1.15', 'running-sha', 'available', true],
    ['0.1.15', 'same-sha', '0.1.15', 'same-sha', 'current', false],
    ['0.1.15', 'published-sha', '0.1.15', 'running-sha', 'available', true],
    ['0.1.14', 'published-sha', '0.1.15', 'running-sha', 'ahead', false],
    ['0.1.15', 'published-sha', '0.1.15', 'unknown', 'current', false],
  ])('compares published image %s@%s with running %s@%s', async (
    availableVersion,
    availableRevision,
    runningVersion,
    runningRevision,
    state,
    updateAvailable,
  ) => {
    const fetch = createRegistryFetch({
      labels: requiredLabels({ revision: availableRevision, version: availableVersion }),
    })

    await expect(createChecker({ fetch, runningRevision, runningVersion }).check()).resolves.toMatchObject({
      availableVersion,
      state,
      updateAvailable,
    })
  })

  it.each([
    ['malformed version', requiredLabels({ version: 'next' })],
    ['wrong channel', requiredLabels({ channel: 'latest' })],
    ['wrong source', requiredLabels({ source: 'https://example.com/repository' })],
    ['missing revision', (() => {
      const labels = requiredLabels()
      delete labels['org.opencontainers.image.revision']
      return labels
    })()],
  ])('returns a non-sensitive metadata error for %s', async (_name, labels) => {
    const checker = createChecker({ fetch: createRegistryFetch({ labels }) })

    await expect(checker.check()).resolves.toMatchObject({
      availableRevision: null,
      availableVersion: null,
      errorCode: 'image-metadata-invalid',
      state: 'unknown',
      updateAvailable: false,
    })
  })

  it('returns an invalid-response error when no supported Linux manifest exists', async () => {
    const fetch = createRegistryFetch({
      platforms: [{ architecture: 'amd64', os: 'windows', digest: DIGESTS.windows }],
    })

    await expect(createChecker({ fetch }).check()).resolves.toMatchObject({
      errorCode: 'registry-response-invalid',
      state: 'unknown',
    })
  })

  it('maps registry throttling without exposing response details', async () => {
    const fetch = vi.fn(async () => jsonResponse({ detail: 'private registry response' }, {
      status: 429,
    }))

    const result = await createChecker({ fetch }).check()

    expect(result).toMatchObject({
      errorCode: 'registry-rate-limited',
      state: 'unknown',
    })
    expect(JSON.stringify(result)).not.toContain('private registry response')
  })

  it('maps timeout aborts to a stable error code', async () => {
    const fetch = vi.fn(async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }))

    await expect(createChecker({ fetch, timeoutMs: 5 }).check()).resolves.toMatchObject({
      errorCode: 'registry-timeout',
      state: 'unknown',
    })
  })

  it('rejects responses that exceed the configured byte limit', async () => {
    const fetch = vi.fn(async () => jsonResponse({ token: 'registry-token' }, {
      headers: { 'content-length': '1000' },
    }))

    await expect(createChecker({ fetch, maxResponseBytes: 50 }).check()).resolves.toMatchObject({
      errorCode: 'registry-response-invalid',
      state: 'unknown',
    })
  })

  it('rejects a streamed response that exceeds its declared bounded size', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ token: 'x'.repeat(200) }))
    const fetch = vi.fn(async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.slice(0, 20))
        controller.enqueue(bytes.slice(20))
        controller.close()
      },
    }), {
      headers: {
        'content-length': '20',
        'content-type': 'application/json',
      },
    }))

    await expect(createChecker({ fetch, maxResponseBytes: 100 }).check()).resolves.toMatchObject({
      errorCode: 'registry-response-invalid',
      state: 'unknown',
    })
  })

  it('rejects unexpected response content types', async () => {
    const fetch = vi.fn(async () => new Response('<html>not json</html>', {
      headers: { 'content-type': 'text/html' },
    }))

    await expect(createChecker({ fetch }).check()).resolves.toMatchObject({
      errorCode: 'registry-response-invalid',
      state: 'unknown',
    })
  })

  it('deduplicates concurrent checks and honors the six-hour cache', async () => {
    let currentTime = Date.parse('2026-07-12T12:00:00Z')
    const fetch = createRegistryFetch()
    const checker = createChecker({ fetch, now: () => currentTime })

    const [first, second] = await Promise.all([checker.check(), checker.check()])
    const cached = await checker.check()

    expect(second).toEqual(first)
    expect(cached).toEqual(first)
    expect(fetch.tokenCalls).toBe(1)

    currentTime += UPDATE_CACHE_MS
    await checker.check()
    expect(fetch.tokenCalls).toBe(2)
  })

  it('bypasses a fresh cache when forced but joins an existing request', async () => {
    const fetch = createRegistryFetch()
    const checker = createChecker({ fetch })

    await checker.check()
    await Promise.all([
      checker.check({ force: true }),
      checker.check({ force: true }),
    ])

    expect(fetch.tokenCalls).toBe(2)
  })

  it('uses a fresh persisted result without requesting Docker Hub', async () => {
    const fetch = createRegistryFetch()
    const checker = createChecker({ fetch })
    const persistedResult = {
      availableRevision: 'persisted-sha',
      availableVersion: '0.1.16',
      channel: 'stable',
      checkedAt: '2026-07-12T11:00:00.000Z',
      errorCode: null,
      runningRevision: 'old-running-sha',
      runningVersion: '0.1.15',
      state: 'available',
      updateAvailable: true,
    }

    await expect(checker.check({ persistedResult })).resolves.toEqual({
      ...persistedResult,
      runningRevision: 'running-sha',
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('recomputes a persisted relationship against the current running image', async () => {
    const fetch = createRegistryFetch()
    const checker = createChecker({
      fetch,
      runningRevision: 'new-running-sha',
      runningVersion: '0.1.17',
    })
    const persistedResult = {
      availableRevision: 'persisted-sha',
      availableVersion: '0.1.16',
      channel: 'stable',
      checkedAt: '2026-07-12T11:00:00.000Z',
      errorCode: null,
      runningRevision: 'old-running-sha',
      runningVersion: '0.1.15',
      state: 'available',
      updateAvailable: true,
    }

    await expect(checker.check({ persistedResult })).resolves.toMatchObject({
      availableRevision: 'persisted-sha',
      availableVersion: '0.1.16',
      runningRevision: 'new-running-sha',
      runningVersion: '0.1.17',
      state: 'ahead',
      updateAvailable: false,
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['invalid available version', { availableVersion: 'next' }],
    ['empty available revision', { availableRevision: '   ' }],
    ['invalid check timestamp', { checkedAt: 'not-a-date' }],
    ['wrong channel', { channel: 'latest' }],
    ['unknown state', { state: 'unknown' }],
  ])('does not reuse persisted metadata with %s', async (_name, override) => {
    const fetch = createRegistryFetch()
    const checker = createChecker({ fetch })
    const persistedResult = {
      availableRevision: 'persisted-sha',
      availableVersion: '0.1.16',
      channel: 'stable',
      checkedAt: '2026-07-12T11:00:00.000Z',
      errorCode: null,
      runningRevision: 'old-running-sha',
      runningVersion: '0.1.15',
      state: 'available',
      updateAvailable: true,
      ...override,
    }

    await expect(checker.check({ persistedResult })).resolves.toMatchObject({
      availableVersion: '0.1.16',
      state: 'available',
    })
    expect(fetch.tokenCalls).toBe(1)
  })

  it('does not replace a successful cache with a failed forced result', async () => {
    const successfulFetch = createRegistryFetch()
    const checker = createChecker({ fetch: successfulFetch })
    const successful = await checker.check()
    checker.fetch = vi.fn(async () => {
      throw new TypeError('offline')
    })

    await expect(checker.check({ force: true })).resolves.toMatchObject({
      errorCode: 'registry-unavailable',
      state: 'unknown',
    })
    await expect(checker.check()).resolves.toEqual(successful)
  })

  it('returns a disabled result without making a registry request', async () => {
    const fetch = createRegistryFetch()

    await expect(createChecker({ enabled: false, fetch }).check()).resolves.toMatchObject({
      availableRevision: null,
      availableVersion: null,
      errorCode: null,
      state: 'disabled',
      updateAvailable: false,
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects unsupported channels and invalid running versions', () => {
    expect(() => createChecker({ channel: 'edge' })).toThrow('Unsupported update channel')
    expect(() => createChecker({ channel: 'release', tag: 'latest' })).toThrow('Unsupported update tag')
    expect(() => createChecker({ platformArchitecture: 'riscv64' })).toThrow('Unsupported platform architecture')
    expect(() => createChecker({ runningVersion: 'development' })).toThrow('Invalid running version')
  })

  it('exposes typed errors with stable codes and no remote details', () => {
    const error = new UpdateCheckError('registry-response-invalid')

    expect(error).toBeInstanceOf(Error)
    expect(error.code).toBe('registry-response-invalid')
    expect(error.message).toBe('Update check failed: registry-response-invalid')
  })
})
