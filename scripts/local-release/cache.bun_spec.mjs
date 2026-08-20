import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { releasePaths } from './config.mjs'
import { compactOciCache, pruneCandidateArchives, releaseStateSurvivesDockerCleanup } from './cache.mjs'

describe('release cache boundary', () => {
  test('stores candidates, receipts, data, and cache outside Docker Desktop', () => {
    const paths = releasePaths({ HOME: '/Users/maintainer' })
    expect(releaseStateSurvivesDockerCleanup(paths)).toBe(true)
    expect(paths.candidatesDir.startsWith(paths.supportRoot)).toBe(true)
    expect(paths.buildkitCacheDir.startsWith(paths.cacheRoot)).toBe(true)
    expect(path.dirname(paths.supportRoot)).not.toContain('Docker')
  })

  test('rejects Docker-managed release storage', () => {
    const paths = releasePaths({ HOME: '/Users/maintainer' })
    expect(releaseStateSurvivesDockerCleanup({ ...paths, cacheRoot: '/var/lib/docker/cache' })).toBe(false)
  })

  test('retains the active revision and the newest previous candidate', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'release-retention-'))
    const candidatesDir = path.join(root, 'candidates')
    await fs.mkdir(candidatesDir)
    const revisions = [
      ['active', 0],
      ['newest', 3],
      ['older', 2],
      ['oldest', 1],
    ]
    for (const [revision, order] of revisions) {
      const directory = path.join(candidatesDir, revision)
      await fs.mkdir(directory)
      const timestamp = new Date(1_700_000_000_000 + order * 1_000)
      await fs.utimes(directory, timestamp, timestamp)
    }

    const result = await pruneCandidateArchives(
      { candidatesDir },
      { identity: { revision: 'active' } },
      { keepRevisions: 2 },
    )

    expect(result.retained).toEqual(['active', 'newest'])
    expect(result.removed).toEqual(['older', 'oldest'])
    expect((await fs.readdir(candidatesDir)).sort()).toEqual(['active', 'newest'])
    await fs.rm(root, { recursive: true, force: true })
  })

  test('uses revision name as a deterministic tie breaker', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'release-retention-'))
    const candidatesDir = path.join(root, 'candidates')
    await fs.mkdir(candidatesDir)
    const timestamp = new Date(1_700_000_000_000)
    for (const revision of ['b', 'a', 'c']) {
      const directory = path.join(candidatesDir, revision)
      await fs.mkdir(directory)
      await fs.utimes(directory, timestamp, timestamp)
    }

    const result = await pruneCandidateArchives(
      { candidatesDir },
      { identity: null },
      { keepRevisions: 2 },
    )

    expect(result.retained).toEqual(['a', 'b'])
    expect(result.removed).toEqual(['c'])
    await fs.rm(root, { recursive: true, force: true })
  })

  test('treats an absent candidate directory as an empty cache', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'release-retention-'))
    await expect(pruneCandidateArchives(
      { candidatesDir: path.join(root, 'missing') },
      { identity: null },
    )).resolves.toEqual({ retained: [], removed: [] })
    await fs.rm(root, { recursive: true, force: true })
  })

  test('removes only OCI blobs unreachable from the cache index', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'release-oci-cache-'))
    const blobs = path.join(root, 'blobs', 'sha256')
    await fs.mkdir(blobs, { recursive: true })
    const layer = Buffer.from('reachable layer')
    const layerDigest = new Bun.CryptoHasher('sha256').update(layer).digest('hex')
    const manifest = Buffer.from(JSON.stringify({ layers: [{ digest: `sha256:${layerDigest}` }] }))
    const manifestDigest = new Bun.CryptoHasher('sha256').update(manifest).digest('hex')
    const orphan = Buffer.from('orphan')
    const orphanDigest = new Bun.CryptoHasher('sha256').update(orphan).digest('hex')
    await Promise.all([
      fs.writeFile(path.join(root, 'index.json'), JSON.stringify({ manifests: [{ digest: `sha256:${manifestDigest}` }] })),
      fs.writeFile(path.join(blobs, layerDigest), layer),
      fs.writeFile(path.join(blobs, manifestDigest), manifest),
      fs.writeFile(path.join(blobs, orphanDigest), orphan),
    ])

    const result = await compactOciCache(root)

    expect(result.removedBlobs).toBe(1)
    expect(result.reclaimedBytes).toBe(orphan.byteLength)
    expect((await fs.readdir(blobs)).sort()).toEqual([layerDigest, manifestDigest].sort())
    await fs.rm(root, { recursive: true, force: true })
  })

  test('does not treat a missing OCI cache as an error', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'release-oci-cache-'))
    await expect(compactOciCache(path.join(root, 'missing'))).resolves.toEqual({
      removedBlobs: 0,
      reclaimedBytes: 0,
    })
    await fs.rm(root, { recursive: true, force: true })
  })
})
