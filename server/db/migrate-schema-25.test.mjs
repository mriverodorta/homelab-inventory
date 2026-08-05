import { describe, expect, it } from 'vitest'
import { migrateSchema24To25 } from './migrate-schema-25.mjs'

function legacyStores() {
  return {
    agents: {
      enrollments: {
        1: { id: 1, serverId: 4, tokenHash: 'enrollment', createdAt: '2026-08-01T00:00:00Z' },
      },
      devices: {
        2: { id: 2, serverId: 4, tokenHash: 'device', lastSeenAt: '2026-08-01T00:01:00Z' },
      },
    },
    agentStatus: {
      servers: {
        4: { serverId: 4, hostname: 'compute-04', cpu: { percent: 25 } },
      },
    },
  }
}

describe('schema 25 typed compute-host agent migration', () => {
  it('preserves record IDs, credentials, timestamps, and telemetry while typing legacy server relationships', () => {
    const source = legacyStores()
    const migrated = migrateSchema24To25(source.agents, source.agentStatus)

    expect(migrated.agents.enrollments['1']).toEqual({
      id: 1,
      hostType: 'server',
      hostId: 4,
      tokenHash: 'enrollment',
      createdAt: '2026-08-01T00:00:00Z',
    })
    expect(migrated.agents.devices['2']).toEqual({
      id: 2,
      hostType: 'server',
      hostId: 4,
      tokenHash: 'device',
      lastSeenAt: '2026-08-01T00:01:00Z',
    })
    expect(migrated.agentStatus).toEqual({
      hosts: {
        'server:4': {
          hostType: 'server',
          hostId: 4,
          hostname: 'compute-04',
          cpu: { percent: 25 },
        },
      },
    })
    expect(source.agents.devices['2'].serverId).toBe(4)
  })

  it('is idempotent for typed server, NAS, and PC build relationships', () => {
    const agents = {
      enrollments: { 1: { id: 1, hostType: 'nas', hostId: 2 } },
      devices: { 1: { id: 1, hostType: 'pcBuild', hostId: 3 } },
    }
    const statuses = {
      hosts: {
        'pcBuild:3': { hostType: 'pcBuild', hostId: 3, hostname: 'gaming-pc' },
      },
    }
    const first = migrateSchema24To25(agents, statuses)
    const second = migrateSchema24To25(first.agents, first.agentStatus)
    expect(second.agents).toEqual(first.agents)
    expect(second.agentStatus).toEqual(first.agentStatus)
    expect(second.summary).toEqual({ migratedEnrollments: 0, migratedDevices: 0, migratedStatuses: 0 })
  })

  it('rejects unsupported, missing, and duplicate host relationships', () => {
    expect(() => migrateSchema24To25(
      { enrollments: { 1: { id: 1, hostType: 'switch', hostId: 1 } }, devices: {} },
      { hosts: {} },
    )).toThrow('supported host type')

    expect(() => migrateSchema24To25(
      { enrollments: {}, devices: {} },
      {
        hosts: {
          first: { hostType: 'server', hostId: 1 },
          second: { hostType: 'server', hostId: 1 },
        },
      },
    )).toThrow('duplicate host server:1')
  })
})
