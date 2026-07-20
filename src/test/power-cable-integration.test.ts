import { describe, expect, it } from 'vitest'
import { getConnectionRoute } from '@/lib/cable-routing'
import { CABLE_COLORS, describeConnection, getCableAppearance } from '@/lib/cables'
import type { InventoryConnection, ProjectState } from '@/types/inventory'

function project(): ProjectState {
  return {
    id: 'default',
    metadata: { name: 'Power cables', version: 1, updatedAt: '2026-07-20T00:00:00.000Z' },
    items: {
      'ups:1': { id: 1, key: 'ups:1', type: 'ups', name: 'Rack UPS', specs: { outlets: 1 } },
      'server:1': { id: 1, key: 'server:1', type: 'server', name: 'Server' },
      'powerAdapter:1': { id: 1, key: 'powerAdapter:1', type: 'powerAdapter', name: '90W adapter' },
    },
    placements: [
      { serverId: 'ups:1', x: 0, y: 0 },
      { serverId: 'server:1', x: 500, y: 0 },
    ],
    assignments: [{
      id: 1,
      serverId: 'server:1',
      itemId: 'powerAdapter:1',
      type: 'powerAdapter',
      assignedAt: '2026-07-20T00:00:00.000Z',
    }],
    connections: [],
  }
}

describe('power cable integration', () => {
  it('renders power distinctly and routes hosted inputs through a host handle', () => {
    const currentProject = project()
    const connection: InventoryConnection = {
      id: 1,
      type: 'power',
      createdAt: '2026-07-20T00:00:00.000Z',
      from: { itemId: 'ups:1', portId: 'outlet-1' },
      to: { itemId: 'server:1', hostedItemId: 'powerAdapter:1', portId: 'ac-input' },
    }
    currentProject.connections = [connection]

    expect(getCableAppearance(currentProject, connection)).toEqual({
      color: CABLE_COLORS.power,
      label: 'Power',
    })
    expect(describeConnection(currentProject, connection)).toBe(
      'Rack UPS / Surge outlet 1 -> Server / 90W adapter / AC input',
    )
    expect(getConnectionRoute(currentProject, connection)?.targetHandle).toMatch(/^target-(left|right|top|bottom)$/)
  })
})
