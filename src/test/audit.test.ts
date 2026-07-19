import { describe, expect, it } from 'vitest'
import { createConnection } from '@/lib/project'
import { getItemAuditWarnings, getProjectAuditWarnings } from '@/lib/audit'
import type { InventoryItem, ProjectState } from '@/types/inventory'

function createProject(items: InventoryItem[]): ProjectState {
  return {
    id: 'test-project',
    metadata: {
      name: 'Test Project',
      version: 1,
      updatedAt: '2026-06-26T00:00:00.000Z',
    },
    items: Object.fromEntries(items.map((item) => [item.id, item])),
    placements: [],
    assignments: [],
    connections: [],
  }
}

const server: InventoryItem = {
  id: 'server',
  name: 'Server',
  type: 'server',
  ports: [
    {
      id: 'lan-01',
      kind: 'server-port',
      type: 'rj45',
      slotNumber: 1,
      speed: '1G',
    },
    {
      id: 'dp-01',
      kind: 'server-port',
      type: 'displayport',
      slotNumber: 2,
    },
  ],
}

const patchPanel: InventoryItem = {
  id: 'patch',
  name: 'Patch Panel',
  type: 'patchPanel',
  ports: [
    {
      id: 'keystone-01',
      kind: 'keystone',
      type: 'rj45',
      slotNumber: 1,
      endpoints: [
        { id: 'keystone-01-front', side: 'front' },
        { id: 'keystone-01-back', side: 'back' },
      ],
    },
  ],
}

const hdmiPatchPanel: InventoryItem = {
  id: 'hdmi-patch',
  name: 'HDMI Patch Panel',
  type: 'patchPanel',
  ports: [
    {
      id: 'keystone-01',
      kind: 'keystone',
      type: 'hdmi',
      slotNumber: 1,
      endpoints: [
        { id: 'keystone-01-front', side: 'front' },
        { id: 'keystone-01-back', side: 'back' },
      ],
    },
  ],
}

const switchItem: InventoryItem = {
  id: 'switch',
  name: 'Switch',
  type: 'switch',
  ports: [
    {
      id: 'rj45-01',
      kind: 'switch-port',
      type: 'rj45',
      slotNumber: 1,
      role: 'uplink',
      speed: '2.5G',
    },
  ],
}

describe('item audit warnings', () => {
  it('does not warn about open server LAN ports before wiring is planned', () => {
    const project = createProject([server])

    expect(getItemAuditWarnings(project, 'server')).toEqual([])
  })

  it('does not warn about half-connected patch panel keystones before wiring is complete', () => {
    const project = createProject([server, patchPanel])
    const result = createConnection(
      project,
      { itemId: 'server', portId: 'lan-01' },
      { itemId: 'patch', portId: 'keystone-01', endpointId: 'keystone-01-back' },
    )

    expect(result.ok).toBe(true)
    expect(getItemAuditWarnings(result.ok ? result.project : project, 'patch')).toEqual([])
  })

  it('does not warn when an HDMI patch back is connected and front is open', () => {
    const project = createProject([server, hdmiPatchPanel])
    const result = createConnection(
      project,
      { itemId: 'server', portId: 'dp-01' },
      { itemId: 'hdmi-patch', portId: 'keystone-01', endpointId: 'keystone-01-back' },
    )

    expect(result.ok).toBe(true)
    expect(getItemAuditWarnings(result.ok ? result.project : project, 'hdmi-patch')).toEqual([])
  })

  it('warns when a server LAN path reaches a patch panel but not a switch', () => {
    const project = createProject([server, patchPanel])
    const result = createConnection(
      project,
      { itemId: 'server', portId: 'lan-01' },
      { itemId: 'patch', portId: 'keystone-01', endpointId: 'keystone-01-back' },
    )

    expect(result.ok).toBe(true)
    expect(
      getItemAuditWarnings(result.ok ? result.project : project, 'server').map(
        (warning) => warning.message,
      ),
    ).toEqual(['LAN port 01 does not trace to a switch.'])
  })

  it('does not warn when a switch has no connected ports before wiring is planned', () => {
    const project = createProject([switchItem])

    expect(getItemAuditWarnings(project, 'switch')).toEqual([])
  })

  it('clears disconnected switch warning when a port is connected', () => {
    const project = createProject([patchPanel, switchItem])
    const result = createConnection(
      project,
      { itemId: 'switch', portId: 'rj45-01' },
      { itemId: 'patch', portId: 'keystone-01', endpointId: 'keystone-01-front' },
    )

    expect(result.ok).toBe(true)
    expect(getItemAuditWarnings(result.ok ? result.project : project, 'switch')).toEqual([])
  })

  it('warns when an active switch has no uplink or trunk port marked', () => {
    const switchWithoutRole: InventoryItem = {
      ...switchItem,
      ports: switchItem.ports?.map((port) => ({
        ...port,
        role: undefined,
      })),
    }
    const project = createProject([patchPanel, switchWithoutRole])
    const result = createConnection(
      project,
      { itemId: 'switch', portId: 'rj45-01' },
      { itemId: 'patch', portId: 'keystone-01', endpointId: 'keystone-01-front' },
    )

    expect(result.ok).toBe(true)
    expect(getItemAuditWarnings(result.ok ? result.project : project, 'switch').map((warning) => warning.message)).toEqual([
      'Switch has active connections but no uplink or trunk port marked.',
    ])
  })

  it('warns when a disabled switch port is connected', () => {
    const disabledSwitch: InventoryItem = {
      ...switchItem,
      ports: switchItem.ports?.map((port) => ({
        ...port,
        role: 'disabled',
      })),
    }
    const project = createProject([patchPanel, disabledSwitch])
    const result = createConnection(
      project,
      { itemId: 'switch', portId: 'rj45-01' },
      { itemId: 'patch', portId: 'keystone-01', endpointId: 'keystone-01-front' },
    )

    expect(result.ok).toBe(true)
    expect(getItemAuditWarnings(result.ok ? result.project : project, 'switch').map((warning) => warning.message)).toEqual([
      'Switch port 01 is disabled but connected.',
      'Switch has active connections but no uplink or trunk port marked.',
    ])
  })

  it('warns when a server LAN path traces to a disabled switch port', () => {
    const disabledSwitch: InventoryItem = {
      ...switchItem,
      ports: switchItem.ports?.map((port) => ({
        ...port,
        role: 'disabled',
      })),
    }
    const project = createProject([server, patchPanel, disabledSwitch])
    const serverToPatch = createConnection(
      project,
      { itemId: 'server', portId: 'lan-01' },
      { itemId: 'patch', portId: 'keystone-01', endpointId: 'keystone-01-back' },
    )
    const patchToSwitch = createConnection(
      serverToPatch.ok ? serverToPatch.project : project,
      { itemId: 'patch', portId: 'keystone-01', endpointId: 'keystone-01-front' },
      { itemId: 'switch', portId: 'rj45-01' },
    )

    expect(serverToPatch.ok).toBe(true)
    expect(patchToSwitch.ok).toBe(true)
    expect(getItemAuditWarnings(patchToSwitch.ok ? patchToSwitch.project : project, 'server').map((warning) => warning.message)).toEqual([
      'LAN port 01 traces to disabled switch port 01 on Switch.',
    ])
  })

  it('groups project warnings by placed canvas item', () => {
    const switchWithoutRole: InventoryItem = {
      ...switchItem,
      ports: switchItem.ports?.map((port) => ({
        ...port,
        role: undefined,
      })),
    }
    const project = {
      ...createProject([server, switchWithoutRole]),
      placements: [
        {
          serverId: 'switch',
          x: 0,
          y: 0,
        },
      ],
      connections: [
        {
          id: 'connection-1',
          from: {
            itemId: 'switch',
            portId: 'rj45-01',
          },
          to: {
            itemId: 'server',
            portId: 'lan-01',
          },
          type: 'network',
          createdAt: '2026-06-26T00:00:00.000Z',
        },
      ],
    } satisfies ProjectState

    expect(
      getProjectAuditWarnings(project).map((group) => ({
        itemId: group.item.id,
        warningCount: group.warnings.length,
      })),
    ).toEqual([
      { itemId: 'switch', warningCount: 1 },
    ])
  })

  it('audits only assigned hardware and preserves compatibility finding metadata', () => {
    const host: InventoryItem = {
      id: 'compat-host',
      name: 'Compatibility Host',
      type: 'server',
      compatibility: {
        host: {
          cpu: {
            sockets: ['LGA1200'],
            generations: ['10'],
            maxTdpWatts: 35,
          },
          memory: {
            generations: ['DDR4'],
            slots: 4,
            maxCapacityGb: 64,
            maxModuleCapacityGb: 32,
            maxSpeedMt: 2666,
          },
          storageSlots: [
            {
              id: 'm2-slot',
              label: 'M.2 Slot',
              count: 1,
              interfaces: ['NVMe'],
              formFactors: ['2280'],
              pcieGeneration: 3,
            },
          ],
        },
      },
    }
    const incompatibleCpu: InventoryItem = {
      id: 'bad-cpu',
      name: 'Socket Mismatch CPU',
      type: 'cpu',
      compatibility: {
        requirements: {
          cpu: {
            socket: 'LGA1700',
            generation: '12',
            tdpWatts: 65,
          },
        },
      },
    }
    const performanceRam: InventoryItem = {
      id: 'fast-ram',
      name: 'Fast RAM',
      type: 'ram',
      specs: {
        capacityGb: 16,
        moduleCount: 2,
        generation: 'DDR4',
        speedMt: 3200,
      },
    }
    const unknownStorage: InventoryItem = {
      id: 'unknown-storage',
      name: 'Unknown Storage',
      type: 'storage',
      specs: {
        interface: 'NVMe',
      },
    }
    const unassignedCpu: InventoryItem = {
      id: 'unassigned-cpu',
      name: 'Unassigned Incompatible CPU',
      type: 'cpu',
      compatibility: {
        requirements: {
          cpu: {
            socket: 'AM5',
            generation: 'Zen 5',
            tdpWatts: 170,
          },
        },
      },
    }
    const project: ProjectState = {
      ...createProject([host, incompatibleCpu, performanceRam, unknownStorage, unassignedCpu]),
      placements: [{ serverId: 'compat-host', x: 0, y: 0 }],
      assignments: [
        {
          id: 1,
          serverId: 'compat-host',
          itemId: 'bad-cpu',
          type: 'cpu',
          assignedAt: '2026-07-19T00:00:00.000Z',
        },
        {
          id: 2,
          serverId: 'compat-host',
          itemId: 'fast-ram',
          type: 'ram',
          assignedAt: '2026-07-19T00:01:00.000Z',
        },
        {
          id: 3,
          serverId: 'compat-host',
          itemId: 'unknown-storage',
          type: 'storage',
          assignedAt: '2026-07-19T00:02:00.000Z',
        },
      ],
    }

    const warnings = getItemAuditWarnings(project, 'compat-host')

    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'cpu.socket.mismatch', severity: 'error' }),
        expect.objectContaining({ code: 'compatibility.data.missing', severity: 'unknown' }),
        expect.objectContaining({ code: 'memory.speed.negotiated', severity: 'warning' }),
      ]),
    )
    expect(warnings.some((warning) => warning.message.includes('Unassigned Incompatible CPU'))).toBe(false)
    expect(getItemAuditWarnings(project, 'compat-host')).toEqual(warnings)
  })

  it('does not create compatibility audit noise from unassigned inventory', () => {
    const host: InventoryItem = {
      id: 'empty-host',
      name: 'Empty Host',
      type: 'server',
    }
    const unassignedCpu: InventoryItem = {
      id: 'unassigned',
      name: 'Unassigned CPU',
      type: 'cpu',
      compatibility: {
        requirements: {
          cpu: { socket: 'AM5', generation: 'Zen 5', tdpWatts: 170 },
        },
      },
    }
    const project: ProjectState = {
      ...createProject([host, unassignedCpu]),
      placements: [{ serverId: 'empty-host', x: 0, y: 0 }],
    }

    expect(getItemAuditWarnings(project, 'empty-host')).toEqual([])
    expect(getProjectAuditWarnings(project)).toEqual([])
  })

  it('deduplicates repeated host, code, and resource compatibility findings', () => {
    const host: InventoryItem = {
      id: 'memory-host',
      name: 'Memory Host',
      type: 'server',
      compatibility: {
        host: {
          memory: {
            generations: ['DDR4'],
            slots: 4,
            maxCapacityGb: 32,
            maxModuleCapacityGb: 32,
            maxSpeedMt: 3200,
          },
        },
      },
    }
    const firstRam: InventoryItem = {
      id: 'ram-one',
      name: 'RAM One',
      type: 'ram',
      specs: { capacityGb: 32, moduleCount: 1, generation: 'DDR4', speedMt: 3200 },
    }
    const secondRam: InventoryItem = {
      id: 'ram-two',
      name: 'RAM Two',
      type: 'ram',
      specs: { capacityGb: 32, moduleCount: 1, generation: 'DDR4', speedMt: 3200 },
    }
    const project: ProjectState = {
      ...createProject([host, firstRam, secondRam]),
      placements: [{ serverId: 'memory-host', x: 0, y: 0 }],
      assignments: [
        {
          id: 1,
          serverId: 'memory-host',
          itemId: 'ram-one',
          type: 'ram',
          assignedAt: '2026-07-19T00:00:00.000Z',
        },
        {
          id: 2,
          serverId: 'memory-host',
          itemId: 'ram-two',
          type: 'ram',
          assignedAt: '2026-07-19T00:01:00.000Z',
        },
      ],
    }

    const capacityWarnings = getItemAuditWarnings(project, 'memory-host').filter(
      (warning) => warning.code === 'memory.capacity.exceeded',
    )

    expect(capacityWarnings).toHaveLength(1)
    expect(capacityWarnings[0]).toEqual(
      expect.objectContaining({
        itemId: 'memory-host',
        severity: 'error',
      }),
    )
  })
})
