import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SharingInstallationIdentityService } from '../server/sharing/installation-identity.mjs'
import { LabGdPublicationClient } from '../server/sharing/labgd-client.mjs'

const roots = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function projectionRepository() {
  let projection = null
  return {
    getInstallationProjection: () => projection,
    saveInstallationProjection: (value) => {
      projection = { id: 1, createdAtMs: 1, updatedAtMs: 1, ...value }
      return projection
    },
  }
}

describe('lab.gd sharing protocol', () => {
  it('enrolls without publishing, then performs one signed manifest-first publication', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'homelab-sharing-e2e-'))
    roots.push(dataDir)
    const paths = []
    const fetchImpl = async (url, init = {}) => {
      const pathname = new URL(url).pathname
      paths.push(pathname)
      if (pathname === '/readyz') return Response.json({ status: 'ready', contractMode: 'packages-enabled', publicationReady: true })
      if (pathname === '/v1/installations/challenge') return Response.json({ value: 'challenge-value' }, { status: 201 })
      if (pathname === '/v1/installations/activate') return Response.json({ status: 'active', installationId: 7, token: 't'.repeat(32) }, { status: 201 })
      expect(init.headers.authorization).toBe(`Bearer ${'t'.repeat(32)}`)
      expect(init.headers['x-labgd-signature']).toMatch(/^[A-Za-z0-9+/]+=*$/u)
      if (pathname === '/v1/publications/manifest') return Response.json({ operation: { id: 11 }, missingHashes: ['a'.repeat(64)] }, { status: 202 })
      if (pathname === `/v1/publications/operations/11/blobs/${'a'.repeat(64)}`) return new Response(null, { status: 204 })
      if (pathname === '/v1/publications/operations/11/activate') return Response.json({ revisionId: 21 })
      throw new Error(`Unexpected request: ${pathname}`)
    }
    const repository = projectionRepository()
    const identity = new SharingInstallationIdentityService({
      dataDir,
      repository,
      labGdOrigin: 'https://lab.example.test',
      fetchImpl,
      now: () => new Date('2026-08-22T12:00:00.000Z'),
    })

    await identity.activate()
    expect(paths).toEqual(['/readyz', '/v1/installations/challenge', '/v1/installations/activate'])
    expect(paths.some((path) => path.startsWith('/v1/publications/'))).toBe(false)

    const client = new LabGdPublicationClient({ identityService: identity })
    const staged = await client.stage({
      idempotencyKey: 'share:1:1',
      sharePublicId: 'share_public_0001',
      manifest: { shareContractVersion: 1 },
      availableHashes: [],
    })
    expect(staged).toEqual({ operationId: 11, missingHashes: ['a'.repeat(64)] })
    await client.upload(11, { contentHash: 'a'.repeat(64), contentJson: '{"viewType":"systems"}', mediaType: 'application/json' })
    expect(await client.activate(11, 0)).toEqual({ revisionId: 21 })
    expect(paths.slice(-3)).toEqual([
      '/v1/publications/manifest',
      `/v1/publications/operations/11/blobs/${'a'.repeat(64)}`,
      '/v1/publications/operations/11/activate',
    ])

    const restarted = new SharingInstallationIdentityService({
      dataDir,
      repository,
      labGdOrigin: 'https://lab.example.test',
      fetchImpl,
      now: () => new Date('2026-08-22T12:00:30.000Z'),
    })
    await restarted.activate()
    expect(paths.filter((path) => path === '/v1/installations/challenge')).toHaveLength(1)
  })
})
