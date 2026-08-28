import { describe, expect, test } from 'bun:test'
import path from 'node:path'
import {
  candidateBuildCommand,
  localCandidateImportCommand,
  RELEASE_BUILDER,
} from './oci.mjs'

describe('OCI candidate build', () => {
  test('exports an immutable channel-neutral ARM64 archive without reusable cache', () => {
    const root = '/repo'
    const paths = { candidatesDir: '/support/candidates' }
    const identity = { revision: 'a'.repeat(40), version: '0.12.4', sourceFingerprint: 'b'.repeat(64) }
    const build = candidateBuildCommand({ root, paths, identity, architecture: 'arm64' })
    expect(build.command).toContain(RELEASE_BUILDER)
    expect(build.command).toContain('linux/arm64')
    expect(build.command).toContain('APP_CHANNEL=release')
    expect(build.command).toContain('--no-cache')
    expect(build.command.some((argument) => argument.startsWith('--cache-from'))).toBe(false)
    expect(build.command.some((argument) => argument.startsWith('--cache-to'))).toBe(false)
    expect(build.command).toContain(`type=oci,dest=${path.join(build.directory, 'candidate.oci.tar')}`)
    expect(build.command).toContain('--sbom=true')
    expect(build.command).toContain('--provenance=mode=max')
    expect(build.command).not.toContain('--push')
  })

  test('keeps one attested OCI output for deterministic local loading', () => {
    const root = '/repo'
    const paths = { candidatesDir: '/support/candidates' }
    const identity = { revision: 'a'.repeat(40), version: '0.12.4', sourceFingerprint: 'b'.repeat(64) }
    const build = candidateBuildCommand({ root, paths, identity, architecture: 'arm64' })
    expect(build.command).toContain(`type=oci,dest=${build.archive}`)
    expect(build.command.filter((argument) => argument === '--output')).toHaveLength(1)
    expect(build.command).toContain('--tag')
    expect(build.command).toContain(build.image)
  })

  test('imports the exact OCI digest through an isolated local registry', () => {
    const candidate = {
      archive: '/candidate.oci.tar',
      digest: `sha256:${'c'.repeat(64)}`,
    }
    expect(localCandidateImportCommand({
      oras: '/tools/oras',
      candidate,
      destination: '127.0.0.1:5000/homelab-inventory:candidate',
    })).toEqual([
      '/tools/oras', 'cp', '--from-oci-layout', '--to-plain-http', '--no-tty',
      `/candidate.oci.tar@${candidate.digest}`,
      '127.0.0.1:5000/homelab-inventory:candidate',
    ])
  })
})
