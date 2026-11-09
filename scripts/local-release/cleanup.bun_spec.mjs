import { describe, expect, test } from 'bun:test'
import { RELEASE_BUILDER } from './oci.mjs'
import { TRIVY_IMAGE } from '../container-security/trivy.mjs'
import { buildCanonicalWasm } from '../release-artifacts/store.mjs'
import { buildCanonicalAgent } from '../release-artifacts/agent-store.mjs'
import {
  dockerRawReclaimCommands,
  DOCKER_RAW_RECLAIM_IMAGE,
  releaseCleanupCommands,
  RELEASE_TRIVY_CACHE_VOLUME,
} from './cleanup.mjs'

describe('release Docker cleanup', () => {
  test('targets only release-owned Docker state during ARM64 review', () => {
    const commands = releaseCleanupCommands({ revision: 'a'.repeat(40) })

    expect(commands).toContainEqual(['docker', 'buildx', 'prune', '--builder', RELEASE_BUILDER, '--all', '--force'])
    expect(commands).toContainEqual(['docker', 'buildx', 'rm', '--force', '--keep-state', RELEASE_BUILDER])
    expect(commands).toContainEqual(['docker', 'scout', 'cache', 'prune', '--force', '--sboms'])
    expect(commands).toContainEqual(['docker', 'run', '--rm', '--volume', `${RELEASE_TRIVY_CACHE_VOLUME}:/root/.cache/`, TRIVY_IMAGE, 'clean', '--all'])
    expect(commands.some((command) => command[1] === 'volume')).toBe(false)
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
    expect(commands.some((command) => command.includes('clean'))).toBe(false)
    expect(commands).not.toContainEqual(['docker', 'buildx', 'rm', '--force', '--keep-state', RELEASE_BUILDER])
  })

  test('artifact cleanup preserves builder volumes even when a build fails', async () => {
    for (const build of [buildCanonicalWasm, buildCanonicalAgent]) {
      const commands = []
      await expect(build({ root: '/fixture', destination: '/output', pin: { version: '0.3.4', sourceRevision: 'fixture' }, runCommand: async (command) => {
        commands.push(command)
        if (command[2] === 'build') throw new Error('injected build failure')
      } })).rejects.toThrow('injected build failure')
      const removals = commands.filter((command) => command[1] === 'buildx' && command[2] === 'rm')
      expect(removals.length).toBe(2)
      expect(removals.every((command) => command.includes('--keep-state'))).toBe(true)
      expect(commands.filter((command) => command[2] === 'prune').length).toBe(2)
    }
  })

  test('reclaims Docker.raw only on macOS and removes the helper afterward', () => {
    expect(dockerRawReclaimCommands({ platform: 'linux' })).toEqual([])
    expect(dockerRawReclaimCommands({ platform: 'darwin' })).toEqual([
      ['docker', 'run', '--rm', '--privileged', '--pid=host', '--platform', 'linux/amd64', DOCKER_RAW_RECLAIM_IMAGE],
      ['docker', 'image', 'rm', '--force', DOCKER_RAW_RECLAIM_IMAGE],
    ])
  })
})
