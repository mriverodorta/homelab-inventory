import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  activateBuildCache,
  candidateBuildCommand,
  localCandidateImportCommand,
  RELEASE_BUILDER,
} from './oci.mjs'

describe('OCI candidate build', () => {
  test('exports an immutable channel-neutral ARM64 archive with external cache', () => {
    const root = '/repo'
    const paths = { candidatesDir: '/support/candidates', buildkitCacheDir: '/cache/buildkit' }
    const identity = { revision: 'a'.repeat(40), version: '0.12.4', sourceFingerprint: 'b'.repeat(64) }
    const build = candidateBuildCommand({ root, paths, identity, architecture: 'arm64' })
    expect(build.command).toContain(RELEASE_BUILDER)
    expect(build.command).toContain('linux/arm64')
    expect(build.command).toContain('APP_CHANNEL=release')
    expect(build.cache).toBe('/cache/buildkit/arm64')
    expect(build.cacheOutput).toBe('/cache/buildkit/arm64.next')
    expect(build.command).toContain('type=local,dest=/cache/buildkit/arm64.next,mode=max')
    expect(build.command).toContain(`type=oci,dest=${path.join(build.directory, 'candidate.oci.tar')}`)
    expect(build.command).toContain('--sbom=true')
    expect(build.command).toContain('--provenance=mode=max')
    expect(build.command).not.toContain('--push')
  })

  test('atomically replaces a completed external cache', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'release-cache-'))
    const cache = path.join(root, 'arm64')
    const cacheOutput = `${cache}.next`
    await fs.mkdir(cache)
    await fs.writeFile(path.join(cache, 'marker'), 'old')
    await fs.mkdir(cacheOutput)
    await fs.writeFile(path.join(cacheOutput, 'marker'), 'new')

    await activateBuildCache({ cache, cacheOutput })

    expect(await fs.readFile(path.join(cache, 'marker'), 'utf8')).toBe('new')
    await expect(fs.stat(`${cache}.previous`)).rejects.toThrow()
    await fs.rm(root, { recursive: true, force: true })
  })

  test('restores the previous cache when activation fails', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'release-cache-'))
    const cache = path.join(root, 'arm64')
    const cacheOutput = `${cache}.next`
    await fs.mkdir(cache)
    await fs.writeFile(path.join(cache, 'marker'), 'old')

    await expect(activateBuildCache({ cache, cacheOutput })).rejects.toThrow()

    expect(await fs.readFile(path.join(cache, 'marker'), 'utf8')).toBe('old')
    await fs.rm(root, { recursive: true, force: true })
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
