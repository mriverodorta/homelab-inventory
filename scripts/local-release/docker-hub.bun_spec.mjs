import { describe, expect, test } from 'bun:test'
import {
  candidateTagNames,
  cleanupDockerHubCandidateTags,
  dockerCredentialHelper,
  dockerHubTagUrl,
} from './docker-hub.mjs'

describe('Docker Hub candidate tag cleanup', () => {
  test('selects only temporary candidate tags', () => {
    expect(candidateTagNames(['latest', 'candidate-abc-arm64', '0.12.6', 'candidate-abc-amd64'])).toEqual([
      'candidate-abc-arm64',
      'candidate-abc-amd64',
    ])
  })

  test('resolves the configured Docker credential helper', () => {
    expect(dockerCredentialHelper({ credsStore: 'desktop' })).toBe('docker-credential-desktop')
    expect(dockerCredentialHelper({
      credsStore: 'desktop',
      credHelpers: { 'https://index.docker.io/v1/': 'osxkeychain' },
    })).toBe('docker-credential-osxkeychain')
    expect(() => dockerCredentialHelper({})).toThrow('credential helper')
  })

  test('encodes tag names in the documented Docker Hub API path', () => {
    expect(dockerHubTagUrl({ namespace: 'example', repository: 'image', tag: 'candidate/a' })).toBe(
      'https://hub.docker.com/v2/namespaces/example/repositories/image/tags/candidate%2Fa',
    )
  })

  test('deletes requested candidates and verifies their absence without exposing credentials', async () => {
    const requests = []
    let listCount = 0
    const fetchImpl = async (url, options = {}) => {
      requests.push({ url: String(url), method: options.method ?? 'GET', authorization: options.headers?.authorization })
      if (String(url).endsWith('/v2/auth/token')) {
        expect(JSON.parse(options.body)).toEqual({ identifier: 'maintainer', secret: 'private-token' })
        return Response.json({ access_token: 'short-lived-token' })
      }
      if ((options.method ?? 'GET') === 'DELETE') return new Response(null, { status: 204 })
      listCount += 1
      return Response.json({
        next: null,
        results: listCount === 1
          ? [{ name: 'latest' }, { name: 'candidate-one-arm64' }, { name: 'candidate-one-amd64' }]
          : [{ name: 'latest' }],
      })
    }

    const result = await cleanupDockerHubCandidateTags({
      fetchImpl,
      credentialsProvider: async () => ({ username: 'maintainer', secret: 'private-token' }),
      namespace: 'example',
      repository: 'image',
      tags: ['candidate-one-arm64', 'candidate-one-amd64'],
    })

    expect(result).toEqual({ deleted: ['candidate-one-arm64', 'candidate-one-amd64'], remaining: [] })
    expect(requests.filter((request) => request.method === 'DELETE')).toHaveLength(2)
    expect(requests.slice(1).every((request) => request.authorization === 'Bearer short-lived-token')).toBe(true)
    expect(JSON.stringify(result)).not.toContain('private-token')
    expect(JSON.stringify(result)).not.toContain('short-lived-token')
  })

  test('treats an already absent candidate as an idempotent cleanup', async () => {
    let listCount = 0
    const result = await cleanupDockerHubCandidateTags({
      credentialsProvider: async () => ({ username: 'maintainer', secret: 'private-token' }),
      fetchImpl: async (url, options = {}) => {
        if (String(url).endsWith('/v2/auth/token')) return Response.json({ access_token: 'token' })
        if ((options.method ?? 'GET') === 'DELETE') return new Response(null, { status: 404 })
        listCount += 1
        return Response.json({ next: null, results: listCount === 1 ? [{ name: 'candidate-old-arm64' }] : [] })
      },
      tags: ['candidate-old-arm64'],
    })

    expect(result).toEqual({ deleted: ['candidate-old-arm64'], remaining: [] })
  })

  test('fails closed when a requested candidate remains visible', async () => {
    await expect(cleanupDockerHubCandidateTags({
      credentialsProvider: async () => ({ username: 'maintainer', secret: 'private-token' }),
      fetchImpl: async (url, options = {}) => {
        if (String(url).endsWith('/v2/auth/token')) return Response.json({ access_token: 'token' })
        if ((options.method ?? 'GET') === 'DELETE') return new Response(null, { status: 204 })
        return Response.json({ next: null, results: [{ name: 'candidate-stuck-arm64' }] })
      },
      tags: ['candidate-stuck-arm64'],
    })).rejects.toThrow('remain on Docker Hub')
  })
})
