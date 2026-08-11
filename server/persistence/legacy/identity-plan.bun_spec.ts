import { describe, expect, test } from 'bun:test'
import { buildCanonicalIdentityPlan } from './identity-plan.ts'

function snapshot() {
  return {
    meta: { schemaVersion: 29 },
    inventory: {
      servers: [{
        id: 1,
        type: 'server',
        name: 'Host',
        ports: [{ id: 2, slotNumber: 1, type: 'ethernet' }],
        compatibility: { host: { memory: { slots: 2 } } },
      }],
      nas: [{ id: 1, type: 'nas', name: 'NAS', ports: [{ id: 1, slotNumber: 1 }] }],
      pcBuilds: [], cpus: [{ id: 4, type: 'cpu', name: 'CPU' }], ram: [], storage: [],
      gpus: [], networkCards: [], motherboards: [], cpuCoolers: [], cases: [],
      powerSupplies: [], soundCards: [], wirelessCards: [], powerAdapters: [], switches: [],
      patchPanels: [], monitors: [], upsSystems: [], powerStrips: [],
    },
    project: {
      id: 'default', revision: 4, metadata: { name: 'Lab', version: 1 },
      placements: [{ itemType: 'server', itemId: 1, x: 0, y: 0 }],
      assignments: [{ id: 7, hostType: 'server', hostId: 1, itemType: 'cpu', itemId: 4, type: 'cpu' }],
      connections: [], compatibilityPolicy: { disabledHosts: [], ignoredWarningIds: [] },
    },
    agents: { enrollments: {}, devices: { 8: { id: 8, hostType: 'server', hostId: 1 } }, hardwareSnapshots: {}, hardwareEvents: {} },
    agentStatus: { hosts: {} },
    registry: { settings: {}, sources: [{ id: 3 }], links: [{ id: 9, itemType: 'cpu', itemId: 4, sourceId: 3 }] },
    routingCache: { version: 1, routes: {} },
    backupManagement: { backups: [], restores: [] },
    authentication: { accounts: [], roles: [], rolePermissions: [], accountRoles: [] },
    notifications: { contactPoints: [], rules: [] },
    notificationState: { incidents: [], deliveryJobs: [] },
    notificationSecrets: { secrets: [] },
  }
}

describe('deterministic legacy identity planning', () => {
  test('allocates stable canonical IDs across typed and nested records', () => {
    const first = buildCanonicalIdentityPlan(snapshot())
    const second = buildCanonicalIdentityPlan(structuredClone(snapshot()))

    expect(second).toEqual(first)
    expect(first.items.get('server:1')).toBe(1)
    expect(first.items.get('nas:1')).toBe(2)
    expect(new Set(first.items.values()).size).toBe(first.items.size)
    expect(first.ports.size).toBe(2)
    expect(first.resourceGroups.size).toBeGreaterThan(0)
    expect(first.resourceSlots.size).toBe(2)
    expect(first.agents.get('8')).toBe(1)
    expect(first.registryLinks.get('9')).toBe(1)
    expect(first.assignments.get('7')).toBe(1)
  })

  test('rejects duplicate identities and ambiguous references', () => {
    const duplicate = snapshot()
    duplicate.inventory.servers.push({ id: 1, type: 'server', name: 'Duplicate', ports: [], compatibility: {} })
    expect(() => buildCanonicalIdentityPlan(duplicate)).toThrow(/duplicate inventory identity/iu)

    const ambiguous = snapshot()
    ambiguous.project.assignments[0].hostType = 'nas'
    ambiguous.project.assignments[0].hostId = 99
    expect(() => buildCanonicalIdentityPlan(ambiguous)).toThrow(/missing host/iu)
  })
})
