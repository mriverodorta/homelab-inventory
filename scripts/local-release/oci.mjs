import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { run } from './process.mjs'

export const RELEASE_BUILDER = 'homelab-release'

export function candidateBuildCommand({ root, paths, identity, architecture }) {
  const platform = `linux/${architecture}`
  const directory = path.join(paths.candidatesDir, identity.revision, architecture)
  const archive = path.join(directory, 'candidate.oci.tar')
  const metadata = path.join(directory, 'build-metadata.json')
  const image = `homelab-inventory-candidate:${identity.revision.slice(0, 12)}-${architecture}`
  const cache = path.join(paths.buildkitCacheDir, architecture)
  const command = [
    'docker', 'buildx', 'build', '--builder', RELEASE_BUILDER, '--pull',
    '--platform', platform, '--tag', image,
    '--build-arg', `APP_VERSION=${identity.version}`,
    '--build-arg', `APP_REVISION=${identity.revision}`,
    '--build-arg', 'APP_CHANNEL=release',
    '--provenance=mode=max', '--sbom=true',
    '--cache-to', `type=local,dest=${cache},mode=max`,
    '--output', `type=oci,dest=${archive}`,
    '--metadata-file', metadata,
    root,
  ]
  return { command, directory, archive, metadata, image, platform, cache }
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
  await ensureReleaseBuilder()
  const build = candidateBuildCommand({ root, paths, identity, architecture })
  await fs.rm(build.directory, { recursive: true, force: true })
  await fs.mkdir(build.directory, { recursive: true, mode: 0o700 })
  await fs.mkdir(build.cache, { recursive: true, mode: 0o700 })
  if ((await fs.readdir(build.cache)).length > 0) {
    build.command.splice(build.command.indexOf('--cache-to'), 0, '--cache-from', `type=local,src=${build.cache}`)
  }
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

export async function loadOciCandidate(candidate) {
  await run(['docker', 'load', '--input', candidate.archive])
  const { stdout } = await run(['docker', 'image', 'inspect', '--format', '{{json .Config.Labels}}', candidate.image], { capture: true })
  const labels = JSON.parse(stdout)
  if (
    labels['org.opencontainers.image.version'] !== candidate.version
    || labels['org.opencontainers.image.revision'] !== candidate.revision
    || labels['io.homelab-inventory.channel'] !== 'release'
  ) throw new Error('Loaded candidate metadata does not match its immutable receipt.')
  return candidate
}
