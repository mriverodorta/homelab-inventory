import { describe, expect, test } from 'bun:test'
import { SMOKE_DATA_TMPFS, smokeRunCommand } from './smoke-runtime.mjs'

describe('container smoke runtime', () => {
  test('uses a non-root task-scoped data filesystem instead of an anonymous volume', () => {
    const command = smokeRunCommand({
      containerName: 'smoke-test',
      platform: 'linux/arm64',
      image: 'candidate:test',
    })

    expect(command).toEqual([
      'docker', 'run', '--detach', '--name', 'smoke-test',
      '--platform', 'linux/arm64',
      '--tmpfs', SMOKE_DATA_TMPFS,
      '--publish', '127.0.0.1::8798',
      'candidate:test',
    ])
    expect(SMOKE_DATA_TMPFS).toBe('/data:rw,noexec,nosuid,nodev,uid=10001,gid=10001,mode=0700')
    expect(command.indexOf('--tmpfs')).toBeLessThan(command.indexOf('candidate:test'))
  })
})
