import { describe, expect, test } from 'bun:test'
import path from 'node:path'
import { candidateBuildCommand, RELEASE_BUILDER } from './oci.mjs'

describe('OCI candidate build', () => {
  test('exports an immutable channel-neutral ARM64 archive with external cache', () => {
    const root = '/repo'
    const paths = { candidatesDir: '/support/candidates', buildkitCacheDir: '/cache/buildkit' }
    const identity = { revision: 'a'.repeat(40), version: '0.12.4', sourceFingerprint: 'b'.repeat(64) }
    const build = candidateBuildCommand({ root, paths, identity, architecture: 'arm64' })
    expect(build.command).toContain(RELEASE_BUILDER)
    expect(build.command).toContain('linux/arm64')
    expect(build.command).toContain('APP_CHANNEL=release')
    expect(build.command).toContain('type=local,dest=/cache/buildkit/arm64,mode=max')
    expect(build.command).toContain(`type=oci,dest=${path.join(build.directory, 'candidate.oci.tar')}`)
    expect(build.command).toContain('--sbom=true')
    expect(build.command).toContain('--provenance=mode=max')
    expect(build.command).not.toContain('--push')
  })
})
