import { describe, expect, test } from 'bun:test'
import {
  assertSmokeIsolation,
  DEMO_SMOKE_ENVIRONMENT,
  demoSmokeRunCommand,
  SMOKE_DATA_TMPFS,
  SMOKE_ENVIRONMENT,
  smokeHealthCommand,
  smokeIdentityAuditCommand,
  smokeRunCommand,
} from './smoke-runtime.mjs'

describe('container smoke runtime', () => {
  test('uses a non-root task-scoped data filesystem instead of an anonymous volume', () => {
    const command = smokeRunCommand({
      containerName: 'smoke-test',
      platform: 'linux/arm64',
      image: 'candidate:test',
    })

    expect(command).toContain('--network')
    expect(command[command.indexOf('--network') + 1]).toBe('none')
    expect(command).not.toContain('--publish')
    expect(command).not.toContain('-p')
    for (const [name, value] of Object.entries(SMOKE_ENVIRONMENT)) {
      expect(command).toContain(`${name}=${value}`)
    }
    expect(SMOKE_DATA_TMPFS).toBe('/data:rw,noexec,nosuid,nodev,uid=10001,gid=10001,mode=0700')
    expect(command.indexOf('--tmpfs')).toBeLessThan(command.indexOf('candidate:test'))
  })

  test.each(['linux/amd64', 'linux/arm64'])('uses the same complete external isolation policy on %s', (platform) => {
    const command = smokeRunCommand({ containerName: `smoke-${platform}`, platform, image: 'candidate:test' })
    expect(command).toContain('APP_MODE=staging')
    expect(command).toContain('LABGD_ENABLED=false')
    expect(command).toContain('UPDATE_CHECK_ENABLED=false')
    expect(command).toContain('REGISTRY_REFRESH_INTERVAL_MS=0')
    expect(command).toContain('REGISTRY_IDENTITY_ENABLED=false')
    expect(command).toContain('REGISTRY_CONTRIBUTION_ENABLED=false')
  })

  test('fails closed when any required isolation control is missing', () => {
    const command = smokeRunCommand({ containerName: 'smoke-test', platform: 'linux/arm64', image: 'candidate:test' })
    expect(() => assertSmokeIsolation(command.filter((entry) => entry !== 'LABGD_ENABLED=false'))).toThrow('LABGD_ENABLED=false')
    expect(() => assertSmokeIsolation(command.filter((entry) => entry !== 'none'))).toThrow('--network none')
  })

  test('checks health inside the container and audits every external identity path', () => {
    const health = smokeHealthCommand('smoke-test')
    const identity = smokeIdentityAuditCommand('smoke-test')
    expect(health.slice(0, 3)).toEqual(['docker', 'exec', 'smoke-test'])
    expect(health.join(' ')).toContain('127.0.0.1:8798/api/health')
    expect(health.join(' ')).not.toContain('lab.gd')
    expect(identity.join(' ')).toContain('/data/sharing/installation-instance.json')
    expect(identity.join(' ')).toContain('/data/registry/installation-credentials.json')
  })

  test.each(['linux/amd64', 'linux/arm64'])('boots demo mode with the same network and service isolation on %s', (platform) => {
    const command = demoSmokeRunCommand({
      containerName: `demo-${platform}`,
      platform,
      image: 'candidate:test',
      sourceDir: '/private/tmp/demo fixture',
    })
    expect(command).toContain('--network')
    expect(command[command.indexOf('--network') + 1]).toBe('none')
    expect(command).toContain('APP_MODE=demo')
    for (const [name, value] of Object.entries(DEMO_SMOKE_ENVIRONMENT)) {
      expect(command).toContain(`${name}=${value}`)
    }
    expect(command).toContain('type=bind,source=/private/tmp/demo fixture,target=/read-only-data,readonly')
    expect(smokeHealthCommand('demo-test', 'demo').join(' ')).toContain('p.mode!=="demo"')
  })
})
