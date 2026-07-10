import { describe, expect, it } from 'vitest'
import {
  defaultSwitchPortSpeed,
  getSwitchPortSpeedForType,
  groupSwitchPorts,
  isSupportedSwitchPortSpeed,
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
  it('defines mandatory supported speeds and receptacle defaults', () => {
    expect(isSupportedSwitchPortSpeed('1G')).toBe(true)
    expect(isSupportedSwitchPortSpeed('2.5G')).toBe(true)
    expect(isSupportedSwitchPortSpeed('5G')).toBe(true)
    expect(isSupportedSwitchPortSpeed('10G')).toBe(true)
    expect(isSupportedSwitchPortSpeed(undefined)).toBe(false)
    expect(isSupportedSwitchPortSpeed('100G')).toBe(false)

    expect(defaultSwitchPortSpeed('rj45')).toBe('1G')
    expect(defaultSwitchPortSpeed('sfp')).toBe('1G')
    expect(defaultSwitchPortSpeed('sfp-plus')).toBe('10G')
    expect(defaultSwitchPortSpeed('displayport')).toBeUndefined()
  })

  it('fills network defaults only when the current speed is missing or unsupported', () => {
    expect(getSwitchPortSpeedForType('sfp-plus', undefined)).toBe('10G')
    expect(getSwitchPortSpeedForType('sfp-plus', '100G')).toBe('10G')
    expect(getSwitchPortSpeedForType('sfp-plus', '2.5G')).toBe('2.5G')
    expect(getSwitchPortSpeedForType('displayport', undefined)).toBeUndefined()
  })

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

  it('repairs a malformed network group when resizing it', () => {
    const malformedPorts = ports.map((port) => ({ ...port, speed: undefined }))
    const result = resizeSwitchPortGroup({
      ports: malformedPorts,
      connections: [],
      itemId: 'switch:1',
      groupKey: groupSwitchPorts(malformedPorts)[0].key,
      count: 4,
    })

    expect(result.ok).toBe(true)
    expect(result.ok && result.ports.every((port) => port.speed === '1G')).toBe(true)
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

  it('applies a default on network type changes while preserving valid speeds', () => {
    const missingSpeedPorts = ports.map((port) => ({ ...port, speed: undefined }))
    const defaulted = updateSwitchPortGroupDefinition({
      ports: missingSpeedPorts,
      groupKey: groupSwitchPorts(missingSpeedPorts)[0].key,
      definition: { type: 'sfp-plus', speed: undefined, role: 'uplink' },
    })

    expect(defaulted[0].speed).toBe('10G')

    const preserved = updateSwitchPortGroupDefinition({
      ports,
      groupKey: groupSwitchPorts(ports)[0].key,
      definition: { type: 'sfp-plus', role: 'uplink' },
    })

    expect(preserved[0].speed).toBe('2.5G')
  })
})
