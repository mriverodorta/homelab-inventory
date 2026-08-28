import { describe, expect, test } from 'bun:test'
import { RELEASE_BUILDER } from './oci.mjs'
import {
  dockerRawReclaimCommands,
  DOCKER_RAW_RECLAIM_IMAGE,
  releaseCleanupCommands,
  RELEASE_TRIVY_CACHE_VOLUME,
} from './cleanup.mjs'

describe('release Docker cleanup', () => {
  test('targets only release-owned Docker state during ARM64 review', () => {
    const commands = releaseCleanupCommands({ revision: 'a'.repeat(40) })

    expect(commands).toContainEqual(['docker', 'buildx', 'rm', '--force', RELEASE_BUILDER])
    expect(commands).toContainEqual(['docker', 'scout', 'cache', 'prune', '--force', '--sboms'])
    expect(commands).toContainEqual(['docker', 'volume', 'rm', '--force', RELEASE_TRIVY_CACHE_VOLUME])
    expect(commands.some((command) => command.includes('volume') && command.includes('prune'))).toBe(false)
    expect(commands.some((command) => command.includes('system') && command.includes('prune'))).toBe(false)
    expect(commands.some((command) => command.includes('homelab-inventory-candidate'))).toBe(false)
  })

  test('removes loaded candidate images after publication', () => {
    const revision = 'b'.repeat(40)
    const commands = releaseCleanupCommands({ revision, candidateArchitectures: ['arm64', 'amd64'] })

    expect(commands).toContainEqual([
      'docker', 'image', 'rm', '--force',
      `homelab-inventory-candidate:${revision.slice(0, 12)}-arm64`,
      `homelab-inventory-candidate:${revision.slice(0, 12)}-amd64`,
    ])
  })

  test('retains only the release scanner database while ARM64 awaits approval', () => {
    const commands = releaseCleanupCommands({ revision: 'c'.repeat(40), preserveBuilder: true, preserveScanner: true })
    expect(commands).not.toContainEqual(['docker', 'volume', 'rm', '--force', RELEASE_TRIVY_CACHE_VOLUME])
    expect(commands).not.toContainEqual(['docker', 'buildx', 'rm', '--force', RELEASE_BUILDER])
  })

  test('reclaims Docker.raw only on macOS and removes the helper afterward', () => {
    expect(dockerRawReclaimCommands({ platform: 'linux' })).toEqual([])
    expect(dockerRawReclaimCommands({ platform: 'darwin' })).toEqual([
      ['docker', 'run', '--rm', '--privileged', '--pid=host', '--platform', 'linux/amd64', DOCKER_RAW_RECLAIM_IMAGE],
      ['docker', 'image', 'rm', '--force', DOCKER_RAW_RECLAIM_IMAGE],
    ])
  })
})
