import { describe, expect, it } from 'vitest'
import { getConnectionRoute } from '@/lib/cable-routing'
import { CABLE_COLORS, describeConnection, getCableAppearance } from '@/lib/cables'
import { createConnectionForEndpoints } from '@/lib/connection-endpoints'
import type { InventoryConnection, InventoryItem, ProjectState } from '@/types/inventory'
import { migrateSchema10To11 } from '../../server/db/migrate-schema-11.mjs'
import { withCanonicalPowerPorts } from '../../shared/power-ports.mjs'

function project(): ProjectState {
  return {
    id: 'default',
    metadata: { name: 'Power cables', version: 1, updatedAt: '2026-07-20T00:00:00.000Z' },
    items: {
      'ups:1': withCanonicalPowerPorts({
        id: 1,
        key: 'ups:1',
        type: 'ups',
        name: 'Rack UPS',
        specs: { outlets: 1, batteryBackupOutlets: 0, surgeProtectedOutlets: 1 },
      } satisfies InventoryItem),
      'server:1': { id: 1, key: 'server:1', type: 'server', name: 'Server' },
      'powerAdapter:1': withCanonicalPowerPorts({
        id: 1,
        key: 'powerAdapter:1',
        type: 'powerAdapter',
        name: '90W adapter',
      } satisfies InventoryItem),
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
  it('connects a migrated UPS battery outlet to a power-strip AC input', () => {
    const migrated = migrateSchema10To11({
      upsSystems: [{
        id: 1,
        name: 'CyberPower CP1500PFCLCD',
        specs: {
          outlets: 10,
          batteryBackupOutlets: 5,
          surgeProtectedOutlets: 5,
        },
      }],
      powerStrips: [withCanonicalPowerPorts({
        id: 1,
        name: 'Kasa HS300',
        type: 'powerStrip',
        specs: { outlets: 6, surgeProtectedOutlets: 6 },
      })],
    })
    const ups = {
      ...migrated.upsSystems[0],
      key: 'ups:1',
      type: 'ups',
    } satisfies InventoryItem
    const powerStrip = {
      ...migrated.powerStrips[0],
      key: 'powerStrip:1',
      type: 'powerStrip',
    } satisfies InventoryItem
    const currentProject: ProjectState = {
      id: 'default',
      metadata: { name: 'Migrated power cables', version: 1, updatedAt: '2026-07-21T00:00:00.000Z' },
      items: {
        'ups:1': ups,
        'powerStrip:1': powerStrip,
      },
      placements: [
        { serverId: 'ups:1', x: 0, y: 0 },
        { serverId: 'powerStrip:1', x: 500, y: 0 },
      ],
      assignments: [],
      connections: [],
    }

    expect(ups.ports?.[0]).toMatchObject({
      id: 1,
      key: 'battery-outlet-1',
      kind: 'power-port',
      type: 'ac-outlet',
      slotNumber: 1,
    })

    const result = createConnectionForEndpoints(
      currentProject,
      { itemId: 'ups:1', portId: 1 },
      { itemId: 'powerStrip:1', portId: 1 },
    )

    expect(result).toMatchObject({
      ok: true,
      connection: {
        type: 'power',
        from: { itemId: 'ups:1', portId: 1 },
        to: { itemId: 'powerStrip:1', portId: 1 },
      },
    })
  })

  it('renders power distinctly and routes hosted inputs through the adapter port handle', () => {
    const currentProject = project()
    const connection: InventoryConnection = {
      id: 1,
      type: 'power',
      createdAt: '2026-07-20T00:00:00.000Z',
      from: { itemId: 'ups:1', portId: 1 },
      to: { itemId: 'server:1', hostedItemId: 'powerAdapter:1', portId: 1 },
    }
    currentProject.connections = [connection]

    expect(getCableAppearance(currentProject, connection)).toEqual({
      color: CABLE_COLORS.power,
      label: 'Power',
    })
    expect(describeConnection(currentProject, connection)).toBe(
      'Rack UPS / Surge outlet 1 -> Server / 90W adapter / AC input',
    )
    expect(getConnectionRoute(currentProject, connection)?.targetHandle).toMatch(
      /^target-(left|right|top|bottom)-powerAdapter:1:1:port$/,
    )
  })
})
