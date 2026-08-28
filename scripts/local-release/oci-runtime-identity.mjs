import { createHash } from 'node:crypto'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import tar from 'tar-stream'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'

const MAX_JSON_BLOB_BYTES = 8 * 1024 * 1024
const MAX_JSON_BLOBS = 256
const SHA256_DIGEST = /^sha256:([0-9a-f]{64})$/

function digestBytes(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new Error(`${label} is not valid JSON.`)
  }
}

async function readLayoutJson(archive) {
  const extract = tar.extract()
  const blobs = new Map()
  let index = null
  let failure = null

  extract.on('entry', (header, stream, next) => {
    const isIndex = header.name === 'index.json'
    const digestMatch = header.name.match(/^blobs\/sha256\/([0-9a-f]{64})$/)
    const retain = (isIndex || digestMatch)
      && header.size <= MAX_JSON_BLOB_BYTES
      && (isIndex || blobs.size < MAX_JSON_BLOBS)
    if (!retain) {
      stream.resume()
      stream.once('end', next)
      return
    }

    const chunks = []
    let size = 0
    stream.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_JSON_BLOB_BYTES) failure = new Error(`OCI JSON entry ${header.name} exceeds the size limit.`)
      else chunks.push(chunk)
    })
    stream.once('end', () => {
      if (!failure) {
        const bytes = Buffer.concat(chunks)
        if (isIndex) index = bytes
        else blobs.set(`sha256:${digestMatch[1]}`, bytes)
      }
      next()
    })
  })

  const completed = new Promise((resolve, reject) => {
    extract.once('finish', resolve)
    extract.once('error', reject)
  })
  fs.createReadStream(archive).on('error', (error) => extract.destroy(error)).pipe(extract)
  await completed
  if (failure) throw failure
  if (!index) throw new Error('OCI archive does not contain index.json.')
  return { index, blobs }
}

function verifiedBlob(blobs, digest, label) {
  if (!SHA256_DIGEST.test(digest ?? '')) throw new Error(`${label} has an invalid SHA-256 digest.`)
  const bytes = blobs.get(digest)
  if (!bytes) throw new Error(`${label} ${digest} is not available in the bounded OCI projection.`)
  if (digestBytes(bytes) !== digest) throw new Error(`${label} ${digest} failed SHA-256 verification.`)
  return parseJson(bytes, label)
}

function isAttestationDescriptor(descriptor) {
  return descriptor?.platform?.os === 'unknown'
    || descriptor?.platform?.architecture === 'unknown'
    || descriptor?.annotations?.['vnd.docker.reference.type'] === 'attestation-manifest'
}

function matchesPlatform(descriptor, platform) {
  const [os, architecture] = platform.split('/')
  return descriptor?.platform?.os === os && descriptor?.platform?.architecture === architecture
}

function resolveRuntimeManifest({ descriptor, blobs, platform, depth = 0 }) {
  if (depth > 4) throw new Error('OCI runtime descriptor nesting exceeds the supported depth.')
  const document = verifiedBlob(blobs, descriptor.digest, 'OCI descriptor')
  if (Array.isArray(document.manifests)) {
    const matches = document.manifests.filter((candidate) => (
      !isAttestationDescriptor(candidate) && matchesPlatform(candidate, platform)
    ))
    if (matches.length !== 1) {
      throw new Error(`OCI candidate must contain exactly one runtime descriptor for ${platform}; found ${matches.length}.`)
    }
    return resolveRuntimeManifest({ descriptor: matches[0], blobs, platform, depth: depth + 1 })
  }
  if (!document.config?.digest || !Array.isArray(document.layers)) {
    throw new Error('OCI runtime descriptor does not resolve to an image manifest.')
  }
  return document
}

async function readOciRuntimeProjection({ archive, candidateDigest, platform }) {
  if (!SHA256_DIGEST.test(candidateDigest ?? '')) throw new Error('OCI candidate digest is invalid.')
  if (!/^linux\/(arm64|amd64)$/.test(platform ?? '')) throw new Error(`Unsupported OCI runtime platform ${String(platform)}.`)
  const { index: indexBytes, blobs } = await readLayoutJson(archive)
  const index = parseJson(indexBytes, 'OCI index')
  const rootMatches = (index.manifests ?? []).filter((descriptor) => descriptor.digest === candidateDigest)
  if (rootMatches.length !== 1) {
    throw new Error(`OCI index must reference candidate digest ${candidateDigest} exactly once; found ${rootMatches.length}.`)
  }
  const manifest = resolveRuntimeManifest({ descriptor: rootMatches[0], blobs, platform })
  const configDigest = manifest.config.digest
  const config = verifiedBlob(blobs, configDigest, 'OCI image config')
  const [os, architecture] = platform.split('/')
  if (config.os !== os || config.architecture !== architecture) {
    throw new Error(`OCI image config platform ${config.os}/${config.architecture} does not match ${platform}.`)
  }
  const diffIds = config.rootfs?.diff_ids
  if (!Array.isArray(diffIds) || diffIds.some((digest) => !SHA256_DIGEST.test(digest))) {
    throw new Error('OCI image config has invalid rootfs diff IDs.')
  }
  return {
    configBytes: blobs.get(configDigest),
    manifest,
    identity: {
    candidateDigest,
    configDigest,
    diffIds: [...diffIds],
    os,
    architecture,
    labels: { ...(config.config?.Labels ?? {}) },
    },
  }
}

export async function readOciRuntimeIdentity(options) {
  return (await readOciRuntimeProjection(options)).identity
}

function hashingTransform(hash) {
  return new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk)
      callback(null, chunk)
    },
  })
}

async function extractRuntimeLayers({ archive, layers, diffIds, directory }) {
  await fsPromises.mkdir(directory, { recursive: true, mode: 0o700 })
  const targets = new Map()
  const occurrences = layers.map((layer, index) => {
    const diffId = diffIds[index]
    const existing = targets.get(layer.digest)
    if (existing && existing.diffId !== diffId) {
      throw new Error(`OCI layer blob ${layer.digest} maps to conflicting diff IDs.`)
    }
    if (!existing) {
      targets.set(layer.digest, {
        ...layer,
        diffId,
        firstIndex: index,
        file: path.join(directory, `${targets.size}.tar`),
      })
    }
    return { index, diffId, target: targets.get(layer.digest) }
  })
  const completed = new Set()
  const extract = tar.extract()

  extract.on('entry', (header, stream, next) => {
    const match = header.name.match(/^blobs\/sha256\/([0-9a-f]{64})$/)
    const target = match ? targets.get(`sha256:${match[1]}`) : null
    if (!target) {
      stream.resume()
      stream.once('end', next)
      return
    }
    const compressedHash = createHash('sha256')
    const uncompressedHash = createHash('sha256')
    const transforms = [stream, hashingTransform(compressedHash)]
    if (target.mediaType?.endsWith('+gzip')) transforms.push(createGunzip())
    else if (target.mediaType !== 'application/vnd.oci.image.layer.v1.tar') {
      const error = new Error(`OCI layer media type ${String(target.mediaType)} cannot be loaded locally.`)
      error.code = 'OCI_LAYER_COMPRESSION_UNSUPPORTED'
      extract.destroy(error)
      return
    }
    transforms.push(hashingTransform(uncompressedHash), fs.createWriteStream(target.file, { mode: 0o600 }))
    pipeline(transforms).then(() => {
      const compressedDigest = `sha256:${compressedHash.digest('hex')}`
      const uncompressedDigest = `sha256:${uncompressedHash.digest('hex')}`
      if (compressedDigest !== target.digest) throw new Error(`OCI layer ${target.firstIndex} failed compressed SHA-256 verification.`)
      if (uncompressedDigest !== target.diffId) throw new Error(`OCI layer ${target.firstIndex} failed diff-ID verification.`)
      completed.add(target.digest)
      next()
    }).catch((error) => extract.destroy(error))
  })

  const finished = new Promise((resolve, reject) => {
    extract.once('finish', resolve)
    extract.once('error', reject)
  })
  fs.createReadStream(archive).on('error', (error) => extract.destroy(error)).pipe(extract)
  await finished
  if (completed.size !== targets.size) throw new Error(`OCI archive provided ${completed.size} of ${targets.size} runtime layers.`)
  return occurrences.map(({ index, diffId, target }) => ({ index, diffId, file: target.file }))
}

async function addBuffer(pack, name, bytes) {
  await new Promise((resolve, reject) => {
    pack.entry({ name, size: bytes.length, mode: 0o644 }, bytes, (error) => error ? reject(error) : resolve())
  })
}

async function addFile(pack, name, file) {
  const stat = await fsPromises.stat(file)
  await new Promise((resolve, reject) => {
    const entry = pack.entry({ name, size: stat.size, mode: 0o644 }, (error) => error ? reject(error) : resolve())
    fs.createReadStream(file).on('error', reject).pipe(entry)
  })
}

export async function createDockerLoadArchive({ archive, candidateDigest, platform, image, output, workDirectory }) {
  const projection = await readOciRuntimeProjection({ archive, candidateDigest, platform })
  const layers = await extractRuntimeLayers({
    archive,
    layers: projection.manifest.layers,
    diffIds: projection.identity.diffIds,
    directory: path.join(workDirectory, 'layers'),
  })
  const configName = `${projection.identity.configDigest.slice(7)}.json`
  const layerNames = layers.map((layer) => `${layer.index}-${layer.diffId.slice(7)}/layer.tar`)
  const manifestBytes = Buffer.from(`${JSON.stringify([{
    Config: configName,
    RepoTags: [image],
    Layers: layerNames,
  }])}\n`)
  const pack = tar.pack()
  const destination = fs.createWriteStream(output, { mode: 0o600 })
  pack.pipe(destination)
  const finished = new Promise((resolve, reject) => {
    destination.once('close', resolve)
    destination.once('error', reject)
    pack.once('error', reject)
  })
  await addBuffer(pack, configName, projection.configBytes)
  for (let index = 0; index < layers.length; index += 1) {
    await addFile(pack, layerNames[index], layers[index].file)
  }
  await addBuffer(pack, 'manifest.json', manifestBytes)
  pack.finalize()
  await finished
  return projection.identity
}

export function verifyLoadedRuntimeIdentity({ candidate, identity, inspect }) {
  const value = typeof inspect === 'string' ? JSON.parse(inspect) : inspect
  const loaded = Array.isArray(value) ? value[0] : value
  if (!loaded || typeof loaded !== 'object') throw new Error('Docker inspect did not return a loaded candidate image.')
  if (loaded.Id !== identity.configDigest) throw new Error('Loaded candidate config digest differs from the OCI archive.')
  if (loaded.Os !== identity.os || loaded.Architecture !== identity.architecture) {
    throw new Error('Loaded candidate platform differs from the OCI archive.')
  }
  const layers = loaded.RootFS?.Layers
  if (!Array.isArray(layers) || layers.length !== identity.diffIds.length || layers.some((digest, index) => digest !== identity.diffIds[index])) {
    throw new Error('Loaded candidate rootfs diff IDs differ from the OCI archive.')
  }
  const labels = loaded.Config?.Labels ?? {}
  if (
    labels['org.opencontainers.image.version'] !== candidate.version
    || labels['org.opencontainers.image.revision'] !== candidate.revision
    || labels['io.homelab-inventory.channel'] !== 'release'
  ) throw new Error('Loaded candidate metadata does not match its immutable receipt.')
  return identity
}
