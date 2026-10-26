import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { assertCurrentGoToolchain, latestStablePatch, parsePinnedGoToolchain } from './go-toolchain-policy.mjs'

const digest = 'a'.repeat(64)
const dockerfile = (version) => `FROM golang:${version}-alpine@sha256:${digest} AS agent-build\n`
const releases = [
  { version: 'go1.27rc1', stable: false },
  { version: 'go1.26.6', stable: true },
  { version: 'go1.26.5', stable: true },
  { version: 'go1.25.13', stable: true },
]

describe('Go agent toolchain security policy', () => {
  test('the repository builder includes the October 2026 security patch', () => {
    const source = readFileSync(new URL('../../docker/agent-artifact.Dockerfile', import.meta.url), 'utf8')
    const securityReleases = [{ version: 'go1.26.10', stable: true }, { version: 'go1.26.9', stable: true }]
    expect(assertCurrentGoToolchain({ dockerfile: source, releases: securityReleases }).pinned.version).toBe('1.26.10')
    expect(() => assertCurrentGoToolchain({ dockerfile: dockerfile('1.26.9'), releases: securityReleases })).toThrow('Go 1.26.10 is the latest')
  })

  test('accepts the latest stable patch in the pinned minor line', () => {
    expect(assertCurrentGoToolchain({ dockerfile: dockerfile('1.26.6'), releases }).pinned.version).toBe('1.26.6')
  })

  test('rejects a superseded patch release', () => {
    expect(() => assertCurrentGoToolchain({ dockerfile: dockerfile('1.26.5'), releases })).toThrow('Go 1.26.6 is the latest')
  })

  test('rejects an unpinned builder image', () => {
    expect(() => parsePinnedGoToolchain('FROM golang:1.26.6-alpine AS agent-build')).toThrow('must pin the agent builder')
  })

  test('rejects malformed release metadata', () => {
    expect(() => latestStablePatch({}, { major: 1, minor: 26 })).toThrow('did not return an array')
    expect(() => latestStablePatch([], { major: 1, minor: 26 })).toThrow('has no stable 1.26.x release')
  })
})
