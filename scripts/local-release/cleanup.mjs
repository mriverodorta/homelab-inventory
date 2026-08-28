import fs from 'node:fs/promises'
import { LOCAL_REGISTRY_IMAGE } from './local-registry.mjs'
import { RELEASE_BUILDER } from './oci.mjs'
import { run } from './process.mjs'
import { TRIVY_IMAGE } from '../container-security/trivy.mjs'

export const RELEASE_TRIVY_CACHE_VOLUME = 'homelab-inventory-trivy-cache'
export const RELEASE_BUILDKIT_IMAGE = 'moby/buildkit:buildx-stable-1'
export const DOCKER_RAW_RECLAIM_IMAGE = 'docker/desktop-reclaim-space@sha256:8b26e45c51632fd78131f3bddca76122bebc1dd8376f16dd26f769c7f33121fd'

function candidateImages(revision, architectures) {
  if (typeof revision !== 'string' || !/^[0-9a-f]{40}$/.test(revision)) return []
  const prefix = revision.slice(0, 12)
  return architectures.map((architecture) => `homelab-inventory-candidate:${prefix}-${architecture}`)
}

export function releaseCleanupCommands({ revision, candidateArchitectures = [], preserveScanner = false } = {}) {
  const commands = [
    ['docker', 'buildx', 'rm', '--force', RELEASE_BUILDER],
    ['docker', 'scout', 'cache', 'prune', '--force', '--sboms'],
  ]
  if (!preserveScanner) commands.push(['docker', 'volume', 'rm', '--force', RELEASE_TRIVY_CACHE_VOLUME])
  if (candidateArchitectures.length > 0) {
    const images = candidateImages(revision, candidateArchitectures)
    if (images.length > 0) commands.push(['docker', 'image', 'rm', '--force', ...images])
  }
  return commands
}

export function dockerRawReclaimCommands({ platform = process.platform } = {}) {
  if (platform !== 'darwin') return []
  return [
    ['docker', 'run', '--rm', '--privileged', '--pid=host', '--platform', 'linux/amd64', DOCKER_RAW_RECLAIM_IMAGE],
    ['docker', 'image', 'rm', '--force', DOCKER_RAW_RECLAIM_IMAGE],
  ]
}

async function removeOrphanedReleaseRegistries() {
  const result = await run([
    'docker', 'ps', '--all', '--quiet',
    '--filter', 'name=homelab-inventory-release-registry-',
    '--filter', 'name=homelab-inventory-candidate-registry-',
  ], { capture: true, allowFailure: true, log: false })
  const containers = result.stdout.split(/\s+/).filter(Boolean)
  if (containers.length > 0) {
    await run(['docker', 'rm', '--force', ...containers], { allowFailure: true, log: false })
  }
}

export async function cleanupReleaseDockerState({
  paths,
  revision,
  candidateArchitectures = [],
  reclaimDockerRaw = true,
  preserveScanner = false,
}) {
  for (const command of releaseCleanupCommands({ revision, candidateArchitectures, preserveScanner })) {
    await run(command, { allowFailure: true, capture: true, log: false })
  }
  await removeOrphanedReleaseRegistries()
  const disposableImages = [LOCAL_REGISTRY_IMAGE, RELEASE_BUILDKIT_IMAGE]
  if (!preserveScanner) disposableImages.unshift(TRIVY_IMAGE)
  await run(['docker', 'image', 'rm', '--force', ...disposableImages], {
    allowFailure: true,
    capture: true,
    log: false,
  })
  await fs.rm(paths.cacheRoot, { recursive: true, force: true })
  if (reclaimDockerRaw) {
    for (const command of dockerRawReclaimCommands()) {
      await run(command, { allowFailure: true, capture: true, log: false })
    }
  }
}
