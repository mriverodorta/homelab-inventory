import { describe, expect, it } from 'vitest'
import { createConnection } from '@/lib/project'
import { getItemAuditWarnings, getProjectAuditWarnings } from '@/lib/audit'
import {
  monitorPowerInputEndpoint,
  powerOutletEndpoint,
} from '@/lib/power-topology'
import { runtimeItemKey } from '@/lib/item-keys'
import type { InventoryItem, ProjectState } from '@/types/inventory'

function createProject(items: InventoryItem[]): ProjectState {
  return {
    id: 'test-project',
    metadata: {
      name: 'Test Project',
      version: 1,
      updatedAt: '2026-06-26T00:00:00.000Z',
    },
    items: Object.fromEntries(items.map((item) => [runtimeItemKey(item), item])),
    placements: [],
    assignments: [],
    connections: [],
  }
}

const server: InventoryItem = {
  id: 1,
  key: 'server:1',
  name: 'Server',
  type: 'server',
  ports: [
    {
      id: 1,
      kind: 'server-port',
      type: 'rj45',
      slotNumber: 1,
      speed: '1G',
    },
    {
      id: 2,
      kind: 'server-port',
      type: 'displayport',
      slotNumber: 2,
    },
  ],
}

const patchPanel: InventoryItem = {
  id: 1,
  key: 'patchPanel:1',
  name: 'Patch Panel',
  type: 'patchPanel',
  ports: [
    {
      id: 1,
      kind: 'keystone',
      type: 'rj45',
      slotNumber: 1,
      endpoints: [
        { id: 1, side: 'front' },
        { id: 2, side: 'back' },
      ],
    },
  ],
}

const hdmiPatchPanel: InventoryItem = {
  id: 2,
  key: 'patchPanel:2',
  name: 'HDMI Patch Panel',
  type: 'patchPanel',
  ports: [
    {
      id: 1,
      kind: 'keystone',
      type: 'hdmi',
      slotNumber: 1,
      endpoints: [
        { id: 1, side: 'front' },
        { id: 2, side: 'back' },
      ],
    },
  ],
}

const switchItem: InventoryItem = {
  id: 1,
  key: 'switch:1',
  name: 'Switch',
  type: 'switch',
  ports: [
    {
      id: 1,
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

    expect(getItemAuditWarnings(project, 'server:1')).toEqual([])
  })

  it('does not warn about half-connected patch panel keystones before wiring is complete', () => {
    const project = createProject([server, patchPanel])
    const result = createConnection(
      project,
      { itemId: 'server:1', portId: 1 },
      { itemId: 'patchPanel:1', portId: 1, endpointId: 2 },
    )

    expect(result.ok).toBe(true)
    expect(getItemAuditWarnings(result.ok ? result.project : project, 'patchPanel:1')).toEqual([])
  })

  it('does not warn when an HDMI patch back is connected and front is open', () => {
    const project = createProject([server, hdmiPatchPanel])
    const result = createConnection(
      project,
      { itemId: 'server:1', portId: 2 },
      { itemId: 'patchPanel:2', portId: 1, endpointId: 2 },
    )

    expect(result.ok).toBe(true)
    expect(getItemAuditWarnings(result.ok ? result.project : project, 'patchPanel:2')).toEqual([])
  })

  it('warns when a server LAN path reaches a patch panel but not a switch', () => {
    const project = createProject([server, patchPanel])
    const result = createConnection(
      project,
      { itemId: 'server:1', portId: 1 },
      { itemId: 'patchPanel:1', portId: 1, endpointId: 2 },
    )

    expect(result.ok).toBe(true)
    expect(
      getItemAuditWarnings(result.ok ? result.project : project, 'server:1').map(
        (warning) => warning.message,
      ),
    ).toEqual(['LAN port 01 does not trace to a switch.'])
  })

  it('keeps port warning ignores isolated between hosts with matching local port IDs', () => {
    const secondServer: InventoryItem = {
      ...server,
      id: 2,
      key: 'server:2',
      name: 'Server 2',
    }
    const secondPatchPanel: InventoryItem = {
      ...patchPanel,
      id: 3,
      key: 'patchPanel:3',
      name: 'Patch Panel 2',
    }
    const project = createProject([server, secondServer, patchPanel, secondPatchPanel])
    const firstConnection = createConnection(
      project,
      { itemId: 'server:1', portId: 1 },
      { itemId: 'patchPanel:1', portId: 1, endpointId: 2 },
    )
    const secondConnection = createConnection(
      firstConnection.ok ? firstConnection.project : project,
      { itemId: 'server:2', portId: 1 },
      { itemId: 'patchPanel:3', portId: 1, endpointId: 2 },
    )

    expect(firstConnection.ok).toBe(true)
    expect(secondConnection.ok).toBe(true)

    const connectedProject = secondConnection.ok ? secondConnection.project : project
    const firstWarning = getItemAuditWarnings(connectedProject, 'server:1')[0]
    const secondWarning = getItemAuditWarnings(connectedProject, 'server:2')[0]

    expect(firstWarning.id).toBe('server-network-path-incomplete-server:1-1')
    expect(secondWarning.id).toBe('server-network-path-incomplete-server:2-1')
    expect(firstWarning.id).not.toBe(secondWarning.id)

    const ignoredProject: ProjectState = {
      ...connectedProject,
      compatibilityPolicy: {
        disabledHosts: [],
        ignoredWarningIds: [firstWarning.id],
      },
    }

    expect(getItemAuditWarnings(ignoredProject, 'server:1')).toEqual([])
    expect(getItemAuditWarnings(ignoredProject, 'server:2')).toEqual([secondWarning])
  })

  it('does not warn when a switch has no connected ports before wiring is planned', () => {
    const project = createProject([switchItem])

    expect(getItemAuditWarnings(project, 'switch:1')).toEqual([])
  })

  it('clears disconnected switch warning when a port is connected', () => {
    const project = createProject([patchPanel, switchItem])
    const result = createConnection(
      project,
      { itemId: 'switch:1', portId: 1 },
      { itemId: 'patchPanel:1', portId: 1, endpointId: 1 },
    )

    expect(result.ok).toBe(true)
    expect(getItemAuditWarnings(result.ok ? result.project : project, 'switch:1')).toEqual([])
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
      { itemId: 'switch:1', portId: 1 },
      { itemId: 'patchPanel:1', portId: 1, endpointId: 1 },
    )

    expect(result.ok).toBe(true)
    expect(getItemAuditWarnings(result.ok ? result.project : project, 'switch:1').map((warning) => warning.message)).toEqual([
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
      { itemId: 'switch:1', portId: 1 },
      { itemId: 'patchPanel:1', portId: 1, endpointId: 1 },
    )

    expect(result.ok).toBe(true)
    expect(getItemAuditWarnings(result.ok ? result.project : project, 'switch:1').map((warning) => warning.message)).toEqual([
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
      { itemId: 'server:1', portId: 1 },
      { itemId: 'patchPanel:1', portId: 1, endpointId: 2 },
    )
    const patchToSwitch = createConnection(
      serverToPatch.ok ? serverToPatch.project : project,
      { itemId: 'patchPanel:1', portId: 1, endpointId: 1 },
      { itemId: 'switch:1', portId: 1 },
    )

    expect(serverToPatch.ok).toBe(true)
    expect(patchToSwitch.ok).toBe(true)
    expect(getItemAuditWarnings(patchToSwitch.ok ? patchToSwitch.project : project, 'server:1').map((warning) => warning.message)).toEqual([
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
          serverId: 'switch:1',
          x: 0,
          y: 0,
        },
      ],
      connections: [
        {
          id: 1,
          from: {
            itemId: 'switch:1',
            portId: 1,
          },
          to: {
            itemId: 'server:1',
            portId: 1,
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
      { itemId: 1, warningCount: 1 },
    ])
  })

  it('audits only assigned hardware and preserves compatibility finding metadata', () => {
    const host: InventoryItem = {
      id: 3,
      key: 'server:3',
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
              id: 9, key: 'm2-slot',
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
      id: 1,
      key: 'cpu:1',
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
      id: 1,
      key: 'ram:1',
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
      id: 1,
      key: 'storage:1',
      name: 'Unknown Storage',
      type: 'storage',
      specs: {
        interface: 'NVMe',
      },
    }
    const unassignedCpu: InventoryItem = {
      id: 2,
      key: 'cpu:2',
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
      placements: [{ serverId: 'server:3', x: 0, y: 0 }],
      assignments: [
        {
          id: 1,
          serverId: 'server:3',
          itemId: 'cpu:1',
          type: 'cpu',
          assignedAt: '2026-07-19T00:00:00.000Z',
        },
        {
          id: 2,
          serverId: 'server:3',
          itemId: 'ram:1',
          type: 'ram',
          assignedAt: '2026-07-19T00:01:00.000Z',
        },
        {
          id: 3,
          serverId: 'server:3',
          itemId: 'storage:1',
          type: 'storage',
          assignedAt: '2026-07-19T00:02:00.000Z',
        },
      ],
    }

    const warnings = getItemAuditWarnings(project, 'server:3')

    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'cpu.socket.mismatch', severity: 'error' }),
        expect.objectContaining({ code: 'compatibility.data.missing', severity: 'unknown' }),
        expect.objectContaining({ code: 'memory.speed.negotiated', severity: 'warning' }),
      ]),
    )
    expect(warnings.some((warning) => warning.message.includes('Unassigned Incompatible CPU'))).toBe(false)
    expect(getItemAuditWarnings(project, 'server:3')).toEqual(warnings)
  })

  it('does not create compatibility audit noise from unassigned inventory', () => {
    const host: InventoryItem = {
      id: 4,
      key: 'server:4',
      name: 'Empty Host',
      type: 'server',
    }
    const unassignedCpu: InventoryItem = {
      id: 3,
      key: 'cpu:3',
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
      placements: [{ serverId: 'server:4', x: 0, y: 0 }],
    }

    expect(
      getItemAuditWarnings(project, 'server:4').filter((warning) =>
        warning.code?.startsWith('compatibility.')
        || warning.code?.startsWith('cpu.')
        || warning.code?.startsWith('memory.')
        || warning.code?.startsWith('storage.'),
      ),
    ).toEqual([])
    expect(
      getProjectAuditWarnings(project).flatMap((group) => group.warnings).some((warning) =>
        warning.message.includes('Unassigned CPU'),
      ),
    ).toBe(false)
  })

  it('deduplicates repeated host, code, and resource compatibility findings', () => {
    const host: InventoryItem = {
      id: 5,
      key: 'server:5',
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
      id: 2,
      key: 'ram:2',
      name: 'RAM One',
      type: 'ram',
      specs: { capacityGb: 32, moduleCount: 1, generation: 'DDR4', speedMt: 3200 },
    }
    const secondRam: InventoryItem = {
      id: 3,
      key: 'ram:3',
      name: 'RAM Two',
      type: 'ram',
      specs: { capacityGb: 32, moduleCount: 1, generation: 'DDR4', speedMt: 3200 },
    }
    const project: ProjectState = {
      ...createProject([host, firstRam, secondRam]),
      placements: [{ serverId: 'server:5', x: 0, y: 0 }],
      assignments: [
        {
          id: 1,
          serverId: 'server:5',
          itemId: 'ram:2',
          type: 'ram',
          assignedAt: '2026-07-19T00:00:00.000Z',
        },
        {
          id: 2,
          serverId: 'server:5',
          itemId: 'ram:3',
          type: 'ram',
          assignedAt: '2026-07-19T00:01:00.000Z',
        },
      ],
    }

    const capacityWarnings = getItemAuditWarnings(project, 'server:5').filter(
      (warning) => warning.code === 'memory.capacity.exceeded',
    )

    expect(capacityWarnings).toHaveLength(1)
    expect(capacityWarnings[0]).toEqual(
      expect.objectContaining({
        itemId: 'server:5',
        severity: 'error',
      }),
    )
  })

  it('separates open and ignored audit warnings', () => {
    const switchWithoutRole: InventoryItem = {
      ...switchItem,
      ports: switchItem.ports?.map((port) => ({
        ...port,
        role: undefined,
      })),
    }
    const project: ProjectState = {
      ...createProject([server, switchWithoutRole]),
      placements: [{ serverId: 'switch:1', x: 0, y: 0 }],
      connections: [
        {
          id: 1,
          from: { itemId: 'switch:1', portId: 1 },
          to: { itemId: 'server:1', portId: 1 },
          type: 'network',
          createdAt: '2026-07-19T00:00:00.000Z',
        },
      ],
      compatibilityPolicy: {
        disabledHosts: [],
        ignoredWarningIds: ['switch-no-uplink-trunk-1'],
      },
    }

    expect(getItemAuditWarnings(project, 'switch:1')).toEqual([])
    expect(getProjectAuditWarnings(project)).toEqual([])
    expect(getItemAuditWarnings(project, 'switch:1', { visibility: 'ignored' })).toEqual([
      expect.objectContaining({ id: 'switch-no-uplink-trunk-1' }),
    ])
    expect(getProjectAuditWarnings(project, { visibility: 'ignored' })).toEqual([
      expect.objectContaining({
        item: expect.objectContaining({ id: 1 }),
        warnings: [expect.objectContaining({ id: 'switch-no-uplink-trunk-1' })],
      }),
    ])
  })

  it('suppresses only compatibility warnings for a disabled NAS host', () => {
    const host: InventoryItem = {
      id: 1,
      key: 'nas:1',
      name: 'NAS',
      type: 'nas',
      compatibility: {
        host: {
          cpu: {
            sockets: ['LGA1200'],
            generations: ['10'],
            maxTdpWatts: 35,
          },
        },
      },
    }
    const incompatibleCpu: InventoryItem = {
      id: 4,
      key: 'cpu:4',
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
    const project: ProjectState = {
      ...createProject([host, incompatibleCpu]),
      placements: [{ serverId: 'nas:1', x: 0, y: 0 }],
      assignments: [
        {
          id: 1,
          serverId: 'nas:1',
          itemId: 'cpu:4',
          type: 'cpu',
          assignedAt: '2026-07-19T00:00:00.000Z',
        },
      ],
    }
    const compatibilityWarning = getItemAuditWarnings(project, 'nas:1').find(
      (warning) => warning.code === 'cpu.socket.mismatch',
    )

    expect(compatibilityWarning).toBeDefined()

    const disabledProject: ProjectState = {
      ...project,
      connections: [
        {
          id: 99,
          from: { itemId: 'nas:1', portId: 999 },
          to: { itemId: 'cpu:4', portId: 999 },
          type: 'other',
          createdAt: '2026-07-19T00:01:00.000Z',
        },
      ],
      compatibilityPolicy: {
        disabledHosts: [{ hostType: 'nas', hostId: 1 }],
        ignoredWarningIds: [compatibilityWarning!.id],
      },
    }

    expect(getItemAuditWarnings(disabledProject, 'nas:1')).toEqual([
      expect.objectContaining({
        id: 'stale-99-nas:1:direct:999:port',
      }),
      expect.objectContaining({
        id: 'power.host.missing-input:nas:1',
      }),
    ])
    expect(getItemAuditWarnings(disabledProject, 'nas:1', { visibility: 'ignored' })).toEqual([])
    expect(getProjectAuditWarnings(disabledProject)).toEqual([
      expect.objectContaining({
        warnings: [
          expect.objectContaining({
            id: 'stale-99-nas:1:direct:999:port',
          }),
          expect.objectContaining({
            id: 'power.host.missing-input:nas:1',
          }),
        ],
      }),
    ])
    expect(getProjectAuditWarnings(disabledProject, { visibility: 'ignored' })).toEqual([])
  })

  it('keeps dormant ignored IDs and reapplies them when warnings return', () => {
    const ignoredWarningId = 'switch-no-uplink-trunk-1'
    const switchWithoutRole: InventoryItem = {
      ...switchItem,
      ports: switchItem.ports?.map((port) => ({
        ...port,
        role: undefined,
      })),
    }
    const dormantProject: ProjectState = {
      ...createProject([switchWithoutRole, patchPanel]),
      placements: [{ serverId: 'switch:1', x: 0, y: 0 }],
      compatibilityPolicy: {
        disabledHosts: [],
        ignoredWarningIds: [ignoredWarningId],
      },
    }

    expect(getProjectAuditWarnings(dormantProject)).toEqual([])
    expect(getProjectAuditWarnings(dormantProject, { visibility: 'ignored' })).toEqual([])
    expect(dormantProject.compatibilityPolicy?.ignoredWarningIds).toEqual([ignoredWarningId])

    const returnedProject: ProjectState = {
      ...dormantProject,
      connections: [
        {
          id: 1,
          from: { itemId: 'switch:1', portId: 1 },
          to: {
            itemId: 'patchPanel:1',
            portId: 1,
            endpointId: 1,
          },
          type: 'network',
          createdAt: '2026-07-19T00:00:00.000Z',
        },
      ],
    }

    expect(getProjectAuditWarnings(returnedProject)).toEqual([])
    expect(getProjectAuditWarnings(returnedProject, { visibility: 'ignored' })).toEqual([
      expect.objectContaining({
        warnings: [expect.objectContaining({ id: ignoredWarningId })],
      }),
    ])
  })
})

describe('power topology audit warnings', () => {
  const createdAt = '2026-07-20T12:00:00.000Z'
  const ups: InventoryItem = {
    id: 1,
    key: 'ups:1',
    name: 'Rack UPS',
    type: 'ups',
    specs: { outlets: 2 },
    ports: [1, 2].map((id) => ({
      id,
      key: `outlet-${id}`,
      kind: 'power-port' as const,
      type: 'ac-outlet' as const,
      slotNumber: id,
    })),
  }
  const monitor: InventoryItem = {
    id: 1,
    key: 'monitor:1',
    name: 'Main display',
    type: 'monitor',
    ports: [{ id: 1, key: 'ac-input', kind: 'power-port', type: 'ac-input', slotNumber: 1 }],
  }
  const spareMonitor: InventoryItem = {
    id: 2,
    key: 'monitor:2',
    name: 'Spare display',
    type: 'monitor',
    ports: [{ id: 1, key: 'ac-input', kind: 'power-port', type: 'ac-input', slotNumber: 1 }],
  }
  const poweredServer: InventoryItem = {
    id: 6,
    key: 'server:6',
    name: 'Mini server',
    type: 'server',
  }
  const adapter: InventoryItem = {
    id: 1,
    key: 'powerAdapter:1',
    name: '90W adapter',
    type: 'powerAdapter',
    ports: [{ id: 1, key: 'ac-input', kind: 'power-port', type: 'ac-input', slotNumber: 1 }],
  }

  function createPowerProject(overrides: Partial<ProjectState> = {}): ProjectState {
    return {
      ...createProject([ups, monitor, spareMonitor, poweredServer, adapter]),
      assignments: [{
        id: 1,
        serverId: 'server:6',
        itemId: 'powerAdapter:1',
        type: 'powerAdapter',
        assignedAt: createdAt,
      }],
      ...overrides,
    }
  }

  it('reports unpowered monitors and hosts only while they are placed', () => {
    const project = createPowerProject({
      placements: [
        { serverId: 'monitor:1', x: 0, y: 0 },
        { serverId: 'server:6', x: 100, y: 0 },
      ],
    })

    expect(getItemAuditWarnings(project, 'monitor:1')).toEqual([
      expect.objectContaining({
        id: 'power.monitor.unpowered:monitor:1',
        code: 'power.monitor.unpowered',
        severity: 'warning',
      }),
    ])
    expect(getItemAuditWarnings(project, 'server:6')).toEqual([
      expect.objectContaining({
        id: 'power.host.unpowered:server:6',
        code: 'power.host.unpowered',
        severity: 'warning',
      }),
    ])
    expect(getItemAuditWarnings(project, 'monitor:2')).toEqual([])
  })

  it('clears placed load warnings once valid power connections exist', () => {
    const project = createPowerProject({
      placements: [
        { serverId: 'ups:1', x: 0, y: 0 },
        { serverId: 'monitor:1', x: 100, y: 0 },
        { serverId: 'server:6', x: 200, y: 0 },
      ],
      connections: [
        {
          id: 1,
          from: powerOutletEndpoint('ups:1', 1),
          to: monitorPowerInputEndpoint('monitor:1'),
          type: 'power',
          createdAt,
        },
        {
          id: 2,
          from: powerOutletEndpoint('ups:1', 2),
          to: {
            itemId: 'server:6',
            hostedItemId: 'powerAdapter:1',
            portId: 1,
          },
          type: 'power',
          createdAt,
        },
      ],
    })

    expect(getProjectAuditWarnings(project)).toEqual([])
  })

  it('assigns outlet faults to placed power equipment without duplicate stale warnings', () => {
    const project = createPowerProject({
      placements: [
        { serverId: 'ups:1', x: 0, y: 0 },
        { serverId: 'monitor:1', x: 100, y: 0 },
      ],
      connections: [{
        id: 7,
        from: powerOutletEndpoint('ups:1', 99),
        to: monitorPowerInputEndpoint('monitor:1'),
        type: 'power',
        createdAt,
      }],
    })

    expect(getItemAuditWarnings(project, 'ups:1')).toEqual([
      expect.objectContaining({
        id: 'power.connection.stale-endpoint:7',
        code: 'power.connection.stale-endpoint',
        severity: 'error',
      }),
    ])
    expect(getItemAuditWarnings(project, 'ups:1')).toHaveLength(1)
  })

  it('keeps power warnings in the existing project-scoped ignored view', () => {
    const ignoredWarningId = 'power.monitor.unpowered:monitor:1'
    const project = createPowerProject({
      placements: [{ serverId: 'monitor:1', x: 0, y: 0 }],
      compatibilityPolicy: {
        disabledHosts: [],
        ignoredWarningIds: [ignoredWarningId],
      },
    })

    expect(getItemAuditWarnings(project, 'monitor:1')).toEqual([])
    expect(getProjectAuditWarnings(project)).toEqual([])
    expect(getItemAuditWarnings(project, 'monitor:1', { visibility: 'ignored' })).toEqual([
      expect.objectContaining({ id: ignoredWarningId }),
    ])
    expect(getProjectAuditWarnings(project, { visibility: 'ignored' })).toEqual([
      expect.objectContaining({
        item: expect.objectContaining({ id: 1 }),
        warnings: [expect.objectContaining({ id: ignoredWarningId })],
      }),
    ])
  })

  it('does not surface power connection findings for entirely unplaced inventory', () => {
    const project = createPowerProject({
      connections: [{
        id: 9,
        from: powerOutletEndpoint('ups:1', 1),
        to: monitorPowerInputEndpoint('monitor:1'),
        type: 'other',
        createdAt,
      }],
    })

    expect(getItemAuditWarnings(project, 'ups:1')).toEqual([])
    expect(getItemAuditWarnings(project, 'monitor:1')).toEqual([])
    expect(getProjectAuditWarnings(project)).toEqual([])
  })
})
