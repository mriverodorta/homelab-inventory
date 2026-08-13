import { describe, expect, test } from 'bun:test'
import path from 'node:path'
import { releasePaths } from './config.mjs'
import { releaseStateSurvivesDockerCleanup } from './cache.mjs'

describe('release cache boundary', () => {
  test('stores candidates, receipts, data, and cache outside Docker Desktop', () => {
    const paths = releasePaths({ HOME: '/Users/maintainer' })
    expect(releaseStateSurvivesDockerCleanup(paths)).toBe(true)
    expect(paths.candidatesDir.startsWith(paths.supportRoot)).toBe(true)
    expect(paths.buildkitCacheDir.startsWith(paths.cacheRoot)).toBe(true)
    expect(path.dirname(paths.supportRoot)).not.toContain('Docker')
  })

  test('rejects Docker-managed release storage', () => {
    const paths = releasePaths({ HOME: '/Users/maintainer' })
    expect(releaseStateSurvivesDockerCleanup({ ...paths, cacheRoot: '/var/lib/docker/cache' })).toBe(false)
  })
})
