import { describe, expect, it } from 'vitest'
import { agentCommandPlatform } from './command-platform.mjs'

describe('Agent command platform', () => {
  it.each([
    ['Alpine Linux 3.22', 'alpine'],
    ['alpine', 'alpine'],
    ['FreeBSD 14.3', 'freebsd'],
    ['OPNsense 26.1', 'freebsd'],
    ['Ubuntu 24.04', 'linux'],
    ['', 'linux'],
    [null, 'linux'],
    ['Unknown appliance', 'linux'],
  ])('maps %s to %s', (value, expected) => {
    expect(agentCommandPlatform(value)).toBe(expected)
  })
})
