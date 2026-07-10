import { describe, expect, it } from 'vitest'
import {
  groupSwitchPorts,
  resizeSwitchPortGroup,
  updateSwitchPortGroupDefinition,
} from '@/lib/switch-ports'
import type { InventoryConnection, InventoryPort } from '@/types/inventory'

const ports: InventoryPort[] = [1, 2, 3, 4, 5].map((id) => ({
  id,
  kind: 'switch-port',
  type: 'rj45',
  slotNumber: id,
  speed: '2.5G',
  role: 'access',
}))

describe('switch port groups', () => {
  it('reduces an unused group while preserving retained port IDs', () => {
    const group = groupSwitchPorts(ports)[0]
    const result = resizeSwitchPortGroup({
      ports,
      connections: [],
      itemId: 'switch:1',
      groupKey: group.key,
      count: 4,
    })

    expect(result).toEqual({
      ok: true,
      ports: ports.slice(0, 4),
    })
  })

  it('blocks reductions that would remove a connected trailing port', () => {
    const connections: InventoryConnection[] = [{
      id: 1,
      from: { itemId: 'switch:1', portId: 5 },
      to: { itemId: 'switch:2', portId: 1 },
      type: 'network',
      createdAt: '2026-07-10T00:00:00.000Z',
    }]
    const result = resizeSwitchPortGroup({
      ports,
      connections,
      itemId: 'switch:1',
      groupKey: groupSwitchPorts(ports)[0].key,
      count: 4,
    })

    expect(result).toEqual({
      ok: false,
      message: 'Port 05 has a connection or saved details. Clear it before reducing this group.',
    })
  })

  it('updates a group definition without replacing its ports', () => {
    const result = updateSwitchPortGroupDefinition({
      ports,
      groupKey: groupSwitchPorts(ports)[0].key,
      definition: { type: 'sfp-plus', speed: '10G', role: 'uplink' },
    })

    expect(result.map((port) => port.id)).toEqual([1, 2, 3, 4, 5])
    expect(result[0]).toMatchObject({
      type: 'sfp-plus',
      speed: '10G',
      role: 'uplink',
    })
  })
})
