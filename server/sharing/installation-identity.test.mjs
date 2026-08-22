import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SharingInstallationIdentityService, SharingRecoveryPendingError } from './installation-identity.mjs'

const roots = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function repository() {
  let projection = null
  return {
    getInstallationProjection: () => projection,
    saveInstallationProjection: (value) => {
      projection = { id: 1, createdAtMs: 1, updatedAtMs: 1, ...value }
      return projection
    },
    deleteInstallationProjection: () => { projection = null },
  }
}

async function setup(handler = null) {
  const dataDir = await mkdtemp(join(tmpdir(), 'homelab-sharing-identity-'))
  roots.push(dataDir)
  const requests = []
  const repo = repository()
  const fetchImpl = async (url, init = {}) => {
    const rawBody = init.body ? Buffer.from(init.body).toString() : ''
    let body = null
    if (rawBody) {
      try {
        body = JSON.parse(rawBody)
      } catch (error) {
        throw new Error(`Invalid test request body: ${JSON.stringify(rawBody)}`, { cause: error })
      }
    }
    const request = { url: new URL(url), init, body }
    requests.push(request)
    if (handler) return handler(request, requests)
    if (request.url.pathname === '/readyz') return Response.json({ status: 'ready', contractMode: 'packages-enabled', publicationReady: true })
    if (request.url.pathname.endsWith('/challenge')) return Response.json({ value: 'challenge-value' }, { status: 201 })
    if (request.url.pathname.endsWith('/activate')) return Response.json({ status: 'active', installationId: 7, token: 't'.repeat(32) }, { status: 201 })
    throw new Error(`Unexpected request ${request.url.pathname}`)
  }
  const service = new SharingInstallationIdentityService({
    dataDir,
    repository: repo,
    labGdOrigin: 'https://lab.example.test',
    fetchImpl,
    now: () => new Date('2026-08-22T12:00:00.000Z'),
  })
  return { dataDir, repo, service, requests }
}

describe('sharing installation identity', () => {
  it('creates one stable protected identity and rebuilds its SQLite projection', async () => {
    const { dataDir, repo, service } = await setup()
    const first = await service.ensure()
    const instanceBody = await readFile(join(dataDir, 'sharing', 'installation-instance.json'), 'utf8')
    const keyBody = await readFile(join(dataDir, 'sharing', 'installation-ed25519.pem'), 'utf8')
    expect((await stat(join(dataDir, 'sharing', 'installation-instance.json'))).mode & 0o777).toBe(0o600)
    expect((await stat(join(dataDir, 'sharing', 'installation-ed25519.pem'))).mode & 0o777).toBe(0o600)
    repo.deleteInstallationProjection()
    const rebuilt = await service.ensure()
    expect(rebuilt.instance.clientInstanceId).toBe(first.instance.clientInstanceId)
    expect(rebuilt.keys.keyId).toBe(first.keys.keyId)
    expect(await readFile(join(dataDir, 'sharing', 'installation-instance.json'), 'utf8')).toBe(instanceBody)
    expect(await readFile(join(dataDir, 'sharing', 'installation-ed25519.pem'), 'utf8')).toBe(keyBody)
  })

  it('enrolls with a privacy-minimal activation payload and reuses credentials', async () => {
    const { dataDir, repo, service, requests } = await setup()
    const credentials = await service.activate()
    expect(credentials).toMatchObject({ installationId: 7, clientInstanceId: expect.any(String) })
    const challenge = requests.find(({ url }) => url.pathname.endsWith('/challenge'))
    const activation = requests.find(({ url }) => url.pathname.endsWith('/activate'))
    expect(Object.keys(challenge.body)).toEqual(['clientInstanceId'])
    expect(Object.keys(activation.body).sort()).toEqual(['challenge', 'clientInstanceId', 'publicKeySpki', 'signature'])
    expect(JSON.stringify([challenge.body, activation.body])).not.toMatch(/hostname|inventory|project|telemetry|registry|agent|tag|custom/iu)
    expect(repo.getInstallationProjection()).toMatchObject({ state: 'active', remoteInstallationId: 7 })
    expect((await stat(join(dataDir, 'sharing', 'installation-credentials.json'))).mode & 0o777).toBe(0o600)
    await service.activate()
    expect(requests.filter(({ url }) => url.pathname.endsWith('/challenge'))).toHaveLength(1)
  })

  it('persists recovery pending without generating repeated replacement keys', async () => {
    const { dataDir, repo, service, requests } = await setup((request) => {
      if (request.url.pathname === '/readyz') return Response.json({ status: 'ready', contractMode: 'packages-enabled', publicationReady: true })
      if (request.url.pathname.endsWith('/challenge')) return Response.json({ value: 'challenge-value' }, { status: 201 })
      return Response.json({ status: 'recovery-pending', installationId: 8 }, { status: 409 })
    })
    const keyBefore = (await service.ensure()).keys.keyId
    await expect(service.activate()).rejects.toBeInstanceOf(SharingRecoveryPendingError)
    expect(repo.getInstallationProjection()).toMatchObject({ state: 'recovery-pending', recoveryPublicKeySpki: expect.any(String) })
    await expect(service.resumeRecovery()).rejects.toBeInstanceOf(SharingRecoveryPendingError)
    expect((await service.ensure()).keys.keyId).toBe(keyBefore)
    expect(requests.filter(({ url }) => url.pathname.endsWith('/activate'))).toHaveLength(2)
    expect(await readFile(join(dataDir, 'sharing', 'installation-ed25519.pem'), 'utf8')).toContain('PRIVATE KEY')
  })

  it('keeps the old key and credentials when authenticated rotation fails', async () => {
    const { dataDir, service } = await setup((request) => {
      if (request.url.pathname === '/readyz') return Response.json({ status: 'ready', contractMode: 'packages-enabled', publicationReady: true })
      if (request.url.pathname.endsWith('/challenge')) return Response.json({ value: 'challenge-value' }, { status: 201 })
      if (request.url.pathname.endsWith('/activate')) return Response.json({ status: 'active', installationId: 7, token: 't'.repeat(32) }, { status: 201 })
      if (request.url.pathname.endsWith('/rotate')) return Response.json({ error: 'rotation-unavailable' }, { status: 503 })
      throw new Error('Unexpected request')
    })
    await service.activate()
    const key = await readFile(join(dataDir, 'sharing', 'installation-ed25519.pem'), 'utf8')
    const credentials = await readFile(join(dataDir, 'sharing', 'installation-credentials.json'), 'utf8')
    await expect(service.rotateKey()).rejects.toThrow()
    expect(await readFile(join(dataDir, 'sharing', 'installation-ed25519.pem'), 'utf8')).toBe(key)
    expect(await readFile(join(dataDir, 'sharing', 'installation-credentials.json'), 'utf8')).toBe(credentials)
  })

  it('retains one replacement key when rotation requires owner recovery', async () => {
    const { dataDir, repo, service } = await setup((request) => {
      if (request.url.pathname === '/readyz') return Response.json({ status: 'ready', contractMode: 'packages-enabled', publicationReady: true })
      if (request.url.pathname.endsWith('/challenge')) return Response.json({ value: 'challenge-value' }, { status: 201 })
      if (request.url.pathname.endsWith('/activate')) return Response.json({ status: 'active', installationId: 7, token: 't'.repeat(32) }, { status: 201 })
      if (request.url.pathname.endsWith('/rotate')) return Response.json({ status: 'recovery-pending', installationId: 7 }, { status: 409 })
      throw new Error('Unexpected request')
    })
    await service.activate()
    const originalKey = await readFile(join(dataDir, 'sharing', 'installation-ed25519.pem'), 'utf8')
    await expect(service.rotateKey()).rejects.toBeInstanceOf(SharingRecoveryPendingError)
    expect(await readFile(join(dataDir, 'sharing', 'installation-ed25519.pem'), 'utf8')).toBe(originalKey)
    expect(await readFile(join(dataDir, 'sharing', 'installation-recovery-ed25519.pem'), 'utf8')).toContain('PRIVATE KEY')
    expect(repo.getInstallationProjection()).toMatchObject({ state: 'recovery-pending', recoveryPublicKeySpki: expect.any(String) })
  })
})
