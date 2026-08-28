import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { startLocalRegistry, stopLocalRegistry } from './local-registry.mjs'
import { createDockerLoadArchive, readOciRuntimeIdentity, verifyLoadedRuntimeIdentity } from './oci-runtime-identity.mjs'
import { run } from './process.mjs'
import { ensurePinnedOras } from './tools.mjs'

export const RELEASE_BUILDER = 'homelab-release'

export function candidateBuildCommand({ root, paths, identity, architecture }) {
  const platform = `linux/${architecture}`
  const directory = path.join(paths.candidatesDir, identity.revision, architecture)
  const archive = path.join(directory, 'candidate.oci.tar')
  const metadata = path.join(directory, 'build-metadata.json')
  const image = `homelab-inventory-candidate:${identity.revision.slice(0, 12)}-${architecture}`
  const command = [
    'docker', 'buildx', 'build', '--builder', RELEASE_BUILDER, '--pull', '--no-cache',
    '--platform', platform, '--tag', image,
    '--build-arg', `APP_VERSION=${identity.version}`,
    '--build-arg', `APP_REVISION=${identity.revision}`,
    '--build-arg', 'APP_CHANNEL=release',
    '--provenance=mode=max', '--sbom=true',
    '--output', `type=oci,dest=${archive}`,
  ]
  command.push('--metadata-file', metadata, root)
  return { command, directory, archive, metadata, image, platform }
}

export async function ensureReleaseBuilder() {
  const inspect = await run(['docker', 'buildx', 'inspect', RELEASE_BUILDER], { capture: true, allowFailure: true, log: false })
  if (inspect.exitCode !== 0) {
    await run(['docker', 'buildx', 'create', '--name', RELEASE_BUILDER, '--driver', 'docker-container'])
  }
  await run(['docker', 'buildx', 'inspect', RELEASE_BUILDER, '--bootstrap'])
}

export async function recreateReleaseBuilder(paths) {
  await run(['docker', 'buildx', 'rm', '--force', RELEASE_BUILDER], {
    allowFailure: true,
    log: false,
  })
  await fs.rm(paths.cacheRoot, { recursive: true, force: true })
  await ensureReleaseBuilder()
}

export async function buildOciCandidate({ root, paths, identity, architecture }) {
  if (!['arm64', 'amd64'].includes(architecture)) throw new Error(`Unsupported release architecture ${architecture}.`)
  await fs.access(path.join(root, '.release-artifacts', 'wasm', 'homelab_engine.wasm'))
  await fs.access(path.join(root, '.release-artifacts', 'agent', 'manifest.json'))
  await recreateReleaseBuilder(paths)
  const build = candidateBuildCommand({ root, paths, identity, architecture })
  await fs.rm(build.directory, { recursive: true, force: true })
  await fs.mkdir(build.directory, { recursive: true, mode: 0o700 })
  await run(build.command)
  const metadata = JSON.parse(await fs.readFile(build.metadata, 'utf8'))
  const digest = metadata['containerimage.digest']
  if (typeof digest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(digest)) {
    throw new Error('BuildKit did not return an immutable OCI candidate digest.')
  }
  const candidate = {
    architecture,
    platform: build.platform,
    image: build.image,
    archive: build.archive,
    digest,
    sourceFingerprint: identity.sourceFingerprint,
    revision: identity.revision,
    version: identity.version,
    loadMode: 'local-archive',
    builtAt: new Date().toISOString(),
  }
  candidate.archiveSha256 = createHash('sha256').update(await fs.readFile(build.archive)).digest('hex')
  await fs.writeFile(path.join(build.directory, 'receipt.json'), `${JSON.stringify(candidate, null, 2)}\n`, { mode: 0o600 })
  return candidate
}

export async function validateCandidateArtifact(candidate) {
  const digest = createHash('sha256').update(await fs.readFile(candidate.archive)).digest('hex')
  if (digest !== candidate.archiveSha256) throw new Error(`The ${candidate.architecture} OCI candidate archive changed after validation.`)
  return candidate
}

export function localCandidateImportCommand({ oras, candidate, destination }) {
  return [
    oras, 'cp', '--from-oci-layout', '--to-plain-http', '--no-tty',
    `${candidate.archive}@${candidate.digest}`, destination,
  ]
}

export async function loadOciCandidate(candidate, paths) {
  let identity
  let localLoadUnsupported = candidate.loadMode === 'registry-fallback'
  const loadRoot = path.join(path.dirname(candidate.archive), '.docker-load')
  if (!localLoadUnsupported) {
    try {
      await fs.rm(loadRoot, { recursive: true, force: true })
      await fs.mkdir(loadRoot, { recursive: true, mode: 0o700 })
      const dockerArchive = path.join(loadRoot, 'candidate.docker.tar')
      identity = await createDockerLoadArchive({
        archive: candidate.archive,
        candidateDigest: candidate.digest,
        platform: candidate.platform,
        image: candidate.image,
        output: dockerArchive,
        workDirectory: loadRoot,
      })
      await run(['docker', 'image', 'load', '--input', dockerArchive])
    } catch (error) {
      if (error?.code !== 'OCI_LAYER_COMPRESSION_UNSUPPORTED') throw error
      localLoadUnsupported = true
    } finally {
      await fs.rm(loadRoot, { recursive: true, force: true })
    }
  }
  if (localLoadUnsupported) {
    identity = await readOciRuntimeIdentity({
      archive: candidate.archive,
      candidateDigest: candidate.digest,
      platform: candidate.platform,
    })
    const oras = await ensurePinnedOras(paths)
    const registry = await startLocalRegistry('homelab-inventory-candidate-registry')
    const destination = `${registry.repository}:candidate-${candidate.revision.slice(0, 12)}-${candidate.architecture}`
    try {
      await run(localCandidateImportCommand({ oras, candidate, destination }))
      const remote = await run(['docker', 'buildx', 'imagetools', 'inspect', destination], { capture: true, log: false })
      if (!remote.stdout.includes(candidate.digest)) {
        throw new Error('The local candidate registry did not retain the immutable OCI digest.')
      }
      await run(['docker', 'pull', '--platform', candidate.platform, destination])
      await run(['docker', 'tag', destination, candidate.image])
      await run(['docker', 'image', 'rm', destination], { allowFailure: true, capture: true, log: false })
    } finally {
      await stopLocalRegistry(registry)
    }
  }
  const { stdout } = await run(['docker', 'image', 'inspect', candidate.image], { capture: true, log: false })
  verifyLoadedRuntimeIdentity({ candidate, identity, inspect: stdout })
  return {
    ...candidate,
    loadMode: localLoadUnsupported ? 'registry-fallback' : 'local-archive',
    runtimeProof: {
      candidateDigest: identity.candidateDigest,
      configDigest: identity.configDigest,
      layerCount: identity.diffIds.length,
    },
  }
}
