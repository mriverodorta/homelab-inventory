import { describe, expect, test } from 'vitest'
import { parseArguments } from './verify-published-image.mjs'

const metadata = ['--version', '0.1.20', '--revision', 'abc123']

describe('published image verification arguments', () => {
  test.each([
    ['latest', 'latest'],
    ['stable', 'stable'],
    ['0.1.20', 'release'],
    ['0.1.20', 'stable'],
  ])('accepts tag %s with channel %s', (tag, channel) => {
    expect(parseArguments(['--tag', tag, ...metadata, '--channel', channel])).toMatchObject({ tag, channel })
  })

  test.each([
    ['latest', 'stable'],
    ['stable', 'latest'],
    ['not-semver', 'release'],
  ])('rejects tag %s with channel %s', (tag, channel) => {
    expect(() => parseArguments(['--tag', tag, ...metadata, '--channel', channel])).toThrow()
  })
})
