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
})
