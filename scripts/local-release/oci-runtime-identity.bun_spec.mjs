import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import tar from 'tar-stream'
import { gzipSync } from 'node:zlib'
import { createDockerLoadArchive, readOciRuntimeIdentity, verifyLoadedRuntimeIdentity } from './oci-runtime-identity.mjs'

function digest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

async function writeArchive({ duplicate = false, corruptConfig = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hli-oci-identity-'))
  const archive = path.join(root, 'candidate.oci.tar')
  const diffIds = [`sha256:${'1'.repeat(64)}`, `sha256:${'2'.repeat(64)}`]
  const configBytes = Buffer.from(JSON.stringify({
    architecture: 'arm64',
    os: 'linux',
    rootfs: { type: 'layers', diff_ids: diffIds },
    config: { Labels: {
      'org.opencontainers.image.version': '0.16.6',
      'org.opencontainers.image.revision': 'a'.repeat(40),
      'io.homelab-inventory.channel': 'release',
    } },
  }))
  const configDigest = digest(configBytes)
  const manifestBytes = Buffer.from(JSON.stringify({
    schemaVersion: 2,
    config: { mediaType: 'application/vnd.oci.image.config.v1+json', digest: configDigest, size: configBytes.length },
    layers: [],
  }))
  const manifestDigest = digest(manifestBytes)
  const attestationBytes = Buffer.from(JSON.stringify({ schemaVersion: 2, config: {}, layers: [] }))
  const attestationDigest = digest(attestationBytes)
  const imageIndexBytes = Buffer.from(JSON.stringify({
    schemaVersion: 2,
    manifests: [
      { digest: manifestDigest, size: manifestBytes.length, platform: { os: 'linux', architecture: 'arm64' } },
      ...(duplicate ? [{ digest: manifestDigest, size: manifestBytes.length, platform: { os: 'linux', architecture: 'arm64' } }] : []),
      {
        digest: attestationDigest,
        size: attestationBytes.length,
        platform: { os: 'unknown', architecture: 'unknown' },
        annotations: { 'vnd.docker.reference.type': 'attestation-manifest' },
      },
    ],
  }))
  const candidateDigest = digest(imageIndexBytes)
  const indexBytes = Buffer.from(JSON.stringify({
    schemaVersion: 2,
    manifests: [{ digest: candidateDigest, size: imageIndexBytes.length }],
  }))
  const pack = tar.pack()
  const output = Bun.file(archive).writer()
  pack.on('data', (chunk) => output.write(chunk))
  const finished = new Promise((resolve, reject) => {
    pack.once('end', async () => { await output.end(); resolve() })
    pack.once('error', reject)
  })
  pack.entry({ name: 'oci-layout' }, JSON.stringify({ imageLayoutVersion: '1.0.0' }))
  pack.entry({ name: 'index.json' }, indexBytes)
  pack.entry({ name: `blobs/sha256/${candidateDigest.slice(7)}` }, imageIndexBytes)
  pack.entry({ name: `blobs/sha256/${manifestDigest.slice(7)}` }, manifestBytes)
  pack.entry({ name: `blobs/sha256/${attestationDigest.slice(7)}` }, attestationBytes)
  pack.entry({ name: `blobs/sha256/${configDigest.slice(7)}` }, corruptConfig ? Buffer.from('{}') : configBytes)
  pack.finalize()
  await finished
  return { root, archive, candidateDigest, configDigest, diffIds }
}

async function tarBuffer(entries) {
  const pack = tar.pack()
  const chunks = []
  pack.on('data', (chunk) => chunks.push(chunk))
  const finished = new Promise((resolve, reject) => {
    pack.once('end', resolve)
    pack.once('error', reject)
  })
  for (const [name, bytes] of entries) pack.entry({ name }, bytes)
  pack.finalize()
  await finished
  return Buffer.concat(chunks)
}

async function writeLoadableArchive() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hli-oci-load-'))
  const archive = path.join(root, 'candidate.oci.tar')
  const layerBytes = await tarBuffer([['hello.txt', Buffer.from('verified layer')]])
  const compressedLayer = gzipSync(layerBytes)
  const layerDigest = digest(compressedLayer)
  const diffId = digest(layerBytes)
  const configBytes = Buffer.from(JSON.stringify({
    architecture: 'arm64',
    os: 'linux',
    rootfs: { type: 'layers', diff_ids: [diffId] },
    config: { Labels: {
      'org.opencontainers.image.version': '0.16.6',
      'org.opencontainers.image.revision': 'a'.repeat(40),
      'io.homelab-inventory.channel': 'release',
    } },
  }))
  const configDigest = digest(configBytes)
  const manifestBytes = Buffer.from(JSON.stringify({
    schemaVersion: 2,
    config: { digest: configDigest, size: configBytes.length },
    layers: [{
      mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip',
      digest: layerDigest,
      size: compressedLayer.length,
    }],
  }))
  const manifestDigest = digest(manifestBytes)
  const imageIndexBytes = Buffer.from(JSON.stringify({
    schemaVersion: 2,
    manifests: [{ digest: manifestDigest, size: manifestBytes.length, platform: { os: 'linux', architecture: 'arm64' } }],
  }))
  const candidateDigest = digest(imageIndexBytes)
  const indexBytes = Buffer.from(JSON.stringify({ schemaVersion: 2, manifests: [{ digest: candidateDigest, size: imageIndexBytes.length }] }))
  const archiveBytes = await tarBuffer([
    ['oci-layout', Buffer.from(JSON.stringify({ imageLayoutVersion: '1.0.0' }))],
    ['index.json', indexBytes],
    [`blobs/sha256/${candidateDigest.slice(7)}`, imageIndexBytes],
    [`blobs/sha256/${manifestDigest.slice(7)}`, manifestBytes],
    [`blobs/sha256/${configDigest.slice(7)}`, configBytes],
    [`blobs/sha256/${layerDigest.slice(7)}`, compressedLayer],
  ])
  await fs.writeFile(archive, archiveBytes)
  return { root, archive, candidateDigest, configDigest, configBytes, layerBytes }
}

async function readTarEntries(file) {
  const extract = tar.extract()
  const entries = new Map()
  extract.on('entry', (header, stream, next) => {
    const chunks = []
    stream.on('data', (chunk) => chunks.push(chunk))
    stream.once('end', () => { entries.set(header.name, Buffer.concat(chunks)); next() })
  })
  const finished = new Promise((resolve, reject) => {
    extract.once('finish', resolve)
    extract.once('error', reject)
  })
  extract.end(await fs.readFile(file))
  await finished
  return entries
}

const candidate = {
  version: '0.16.6',
  revision: 'a'.repeat(40),
}

describe('OCI runtime identity', () => {
  test('selects one runtime manifest, excludes attestations, and proves Docker identity', async () => {
    const fixture = await writeArchive()
    try {
      const identity = await readOciRuntimeIdentity({
        archive: fixture.archive,
        candidateDigest: fixture.candidateDigest,
        platform: 'linux/arm64',
      })
      expect(identity).toMatchObject({
        configDigest: fixture.configDigest,
        diffIds: fixture.diffIds,
        os: 'linux',
        architecture: 'arm64',
      })
      expect(verifyLoadedRuntimeIdentity({
        candidate,
        identity,
        inspect: [{
          Id: fixture.configDigest,
          Os: 'linux',
          Architecture: 'arm64',
          RootFS: { Layers: fixture.diffIds },
          Config: { Labels: identity.labels },
        }],
      })).toEqual(identity)
    } finally {
      await fs.rm(fixture.root, { recursive: true, force: true })
    }
  })

  test('rejects changed config, rootfs, platform, and metadata', async () => {
    const fixture = await writeArchive()
    try {
      const identity = await readOciRuntimeIdentity({ archive: fixture.archive, candidateDigest: fixture.candidateDigest, platform: 'linux/arm64' })
      const inspect = [{ Id: fixture.configDigest, Os: 'linux', Architecture: 'arm64', RootFS: { Layers: fixture.diffIds }, Config: { Labels: identity.labels } }]
      expect(() => verifyLoadedRuntimeIdentity({ candidate, identity, inspect: [{ ...inspect[0], Id: `sha256:${'3'.repeat(64)}` }] })).toThrow('config digest')
      expect(() => verifyLoadedRuntimeIdentity({ candidate, identity, inspect: [{ ...inspect[0], RootFS: { Layers: [fixture.diffIds[0]] } }] })).toThrow('rootfs diff IDs')
      expect(() => verifyLoadedRuntimeIdentity({ candidate, identity, inspect: [{ ...inspect[0], Architecture: 'amd64' }] })).toThrow('platform')
      expect(() => verifyLoadedRuntimeIdentity({ candidate, identity, inspect: [{ ...inspect[0], Config: { Labels: {} } }] })).toThrow('metadata')
    } finally {
      await fs.rm(fixture.root, { recursive: true, force: true })
    }
  })

  test('rejects duplicate runtime descriptors and a corrupted selected blob', async () => {
    const duplicate = await writeArchive({ duplicate: true })
    const corrupted = await writeArchive({ corruptConfig: true })
    try {
      await expect(readOciRuntimeIdentity({ archive: duplicate.archive, candidateDigest: duplicate.candidateDigest, platform: 'linux/arm64' })).rejects.toThrow('exactly one runtime descriptor')
      await expect(readOciRuntimeIdentity({ archive: corrupted.archive, candidateDigest: corrupted.candidateDigest, platform: 'linux/arm64' })).rejects.toThrow('SHA-256 verification')
    } finally {
      await fs.rm(duplicate.root, { recursive: true, force: true })
      await fs.rm(corrupted.root, { recursive: true, force: true })
    }
  })

  test('creates a Docker load archive while preserving config bytes and verified diff IDs', async () => {
    const fixture = await writeLoadableArchive()
    const output = path.join(fixture.root, 'candidate.docker.tar')
    try {
      const identity = await createDockerLoadArchive({
        archive: fixture.archive,
        candidateDigest: fixture.candidateDigest,
        platform: 'linux/arm64',
        image: 'candidate:test-arm64',
        output,
        workDirectory: path.join(fixture.root, 'work'),
      })
      const entries = await readTarEntries(output)
      const manifest = JSON.parse(entries.get('manifest.json').toString('utf8'))
      expect(identity.configDigest).toBe(fixture.configDigest)
      expect(entries.get(`${fixture.configDigest.slice(7)}.json`)).toEqual(fixture.configBytes)
      expect(manifest[0].RepoTags).toEqual(['candidate:test-arm64'])
      expect(entries.get(manifest[0].Layers[0])).toEqual(fixture.layerBytes)
    } finally {
      await fs.rm(fixture.root, { recursive: true, force: true })
    }
  })
})
