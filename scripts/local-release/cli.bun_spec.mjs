import { describe, expect, test } from 'bun:test'
import { parseLocalReleaseCommand } from './cli.mjs'

describe('local release CLI', () => {
  test.each([
    [],
    ['help'],
    ['--help'],
    ['reset', '--help'],
    ['publish', '--channel', 'latest', '-h'],
  ])('treats help anywhere as a side-effect-free command', (...args) => {
    expect(parseLocalReleaseCommand(args)).toEqual({ command: 'help', options: [] })
  })

  test('retains normal command options', () => {
    expect(parseLocalReleaseCommand(['publish', '--channel', 'latest', '--dry-run'])).toEqual({
      command: 'publish',
      options: ['--channel', 'latest', '--dry-run'],
    })
  })
})
