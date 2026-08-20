import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { startLocalRegistry, stopLocalRegistry } from './local-registry.mjs'
import { run } from './process.mjs'
import { ensurePinnedOras } from './tools.mjs'
import { verifyCurrentGoToolchain } from '../container-security/go-toolchain-policy.mjs'

export const RELEASE_BUILDER = 'homelab-release'

export function candidateBuildCommand({ root, paths, identity, architecture }) {
  const platform = `linux/${architecture}`
  const directory = path.join(paths.candidatesDir, identity.revision, architecture)
  const archive = path.join(directory, 'candidate.oci.tar')
  const metadata = path.join(directory, 'build-metadata.json')
  const image = `homelab-inventory-candidate:${identity.revision.slice(0, 12)}-${architecture}`
  const cache = path.join(paths.buildkitCacheDir, architecture)
  const cacheOutput = `${cache}.next`
  const command = [
    'docker', 'buildx', 'build', '--builder', RELEASE_BUILDER, '--pull',
    '--platform', platform, '--tag', image,
    '--build-arg', `APP_VERSION=${identity.version}`,
    '--build-arg', `APP_REVISION=${identity.revision}`,
    '--build-arg', 'APP_CHANNEL=release',
    '--provenance=mode=max', '--sbom=true',
    '--cache-to', `type=local,dest=${cacheOutput},mode=max`,
    '--output', `type=oci,dest=${archive}`,
    '--metadata-file', metadata,
    root,
  ]
  return { command, directory, archive, metadata, image, platform, cache, cacheOutput }
}

async function exists(target) {
  return fs.stat(target).then(() => true, (error) => {
    if (error?.code === 'ENOENT') return false
    throw error
  })
}

export async function activateBuildCache({ cache, cacheOutput }) {
  const previous = `${cache}.previous`
  await fs.rm(previous, { recursive: true, force: true })
  const hadCache = await exists(cache)
  if (hadCache) await fs.rename(cache, previous)
  try {
    await fs.rename(cacheOutput, cache)
  } catch (error) {
    if (hadCache && await exists(previous)) await fs.rename(previous, cache)
    throw error
  }
  await fs.rm(previous, { recursive: true, force: true })
}

async function recoverBuildCache(cache) {
  const previous = `${cache}.previous`
  if (!await exists(previous)) return
  if (!await exists(cache)) await fs.rename(previous, cache)
  else await fs.rm(previous, { recursive: true, force: true })
}

export async function ensureReleaseBuilder() {
  const inspect = await run(['docker', 'buildx', 'inspect', RELEASE_BUILDER], { capture: true, allowFailure: true, log: false })
  if (inspect.exitCode !== 0) {
    await run(['docker', 'buildx', 'create', '--name', RELEASE_BUILDER, '--driver', 'docker-container'])
  }
  await run(['docker', 'buildx', 'inspect', RELEASE_BUILDER, '--bootstrap'])
}

export async function buildOciCandidate({ root, paths, identity, architecture }) {
  if (!['arm64', 'amd64'].includes(architecture)) throw new Error(`Unsupported release architecture ${architecture}.`)
  await verifyCurrentGoToolchain()
  await ensureReleaseBuilder()
  const build = candidateBuildCommand({ root, paths, identity, architecture })
  await fs.rm(build.directory, { recursive: true, force: true })
  await fs.mkdir(build.directory, { recursive: true, mode: 0o700 })
  await fs.mkdir(path.dirname(build.cache), { recursive: true, mode: 0o700 })
  await recoverBuildCache(build.cache)
  await fs.rm(build.cacheOutput, { recursive: true, force: true })
  if ((await fs.readdir(build.cache).catch(() => [])).length > 0) {
    build.command.splice(build.command.indexOf('--cache-to'), 0, '--cache-from', `type=local,src=${build.cache}`)
  }
  try {
    await run(build.command)
    await activateBuildCache(build)
  } catch (error) {
    await fs.rm(build.cacheOutput, { recursive: true, force: true })
    throw error
  }
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
  } finally {
    await stopLocalRegistry(registry)
  }
  const { stdout } = await run(['docker', 'image', 'inspect', '--format', '{{json .Config.Labels}}', candidate.image], { capture: true })
  const labels = JSON.parse(stdout)
  if (
    labels['org.opencontainers.image.version'] !== candidate.version
    || labels['org.opencontainers.image.revision'] !== candidate.revision
    || labels['io.homelab-inventory.channel'] !== 'release'
  ) throw new Error('Loaded candidate metadata does not match its immutable receipt.')
  return candidate
}
