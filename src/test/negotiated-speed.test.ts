import { describe, expect, it } from 'vitest'
import {
  advertisedSpeedMbps,
  defaultSwitchPortSpeed,
  normalizeNetworkProject,
  recalculateNegotiatedSpeeds,
  SUPPORTED_SWITCH_PORT_SPEEDS,
  SWITCH_NETWORK_PORT_TYPES,
} from '../../server/db/legacy-network-normalization'
import type {
  ComponentAssignment,
  ConnectionEndpoint,
  InventoryConnection,
  InventoryItem,
  InventoryPort,
  ProjectState,
} from '@/types/inventory'

const CREATED_AT = '2026-07-10T00:00:00.000Z'

const ITEM_REFS: Record<string, { id: number; key: string }> = {
  server: { id: 1, key: 'server:1' },
  switch: { id: 1, key: 'switch:1' },
  'valid-switch': { id: 2, key: 'switch:2' },
  'switch-a': { id: 1, key: 'switch:1' },
  'switch-b': { id: 2, key: 'switch:2' },
  nas: { id: 1, key: 'nas:1' },
  patch: { id: 1, key: 'patchPanel:1' },
  'patch-a': { id: 1, key: 'patchPanel:1' },
  'patch-b': { id: 2, key: 'patchPanel:2' },
  nic: { id: 1, key: 'network:1' },
}

const PORT_IDS: Record<string, number> = {
  rj45: 1,
  sfp: 2,
  'sfp-plus': 3,
  valid: 4,
  display: 5,
  'server-port': 1,
  'switch-port': 1,
  'switch-a-port': 1,
  'switch-b-port': 1,
  'patch-port': 1,
  'patch-a-port': 1,
  'patch-b-port': 1,
  'nic-port': 1,
  'nas-port': 1,
  network: 1,
  dp: 1,
  barrel: 2,
}

const ENDPOINT_IDS: Record<string, number> = {
  'patch-front': 1,
  'patch-back': 2,
  'patch-a-front': 1,
  'patch-a-back': 2,
  'patch-b-front': 1,
  'patch-b-back': 2,
}

const CONNECTION_IDS: Record<string, number> = {
  'legacy-uplink': 1,
  'server-patch': 2,
  'patch-switch': 3,
  'hosted-nic': 4,
  'non-network-other': 5,
  direct: 6,
  'open-patch': 7,
  'nas-patch': 8,
  'implicit-sfp-plus': 9,
  'passive-only': 10,
  display: 11,
  other: 12,
}

function networkPort(
  id: string,
  speed: string | undefined,
  overrides: Partial<InventoryPort> = {},
): InventoryPort {
  return {
    id: PORT_IDS[id],
    kind: 'server-port',
    type: 'rj45',
    slotNumber: 1,
    ...(speed ? { speed } : {}),
    ...overrides,
  }
}

function activeItem(
  id: string,
  type: 'server' | 'nas' | 'switch',
  speed: string,
): InventoryItem {
  const ref = ITEM_REFS[id]

  return {
    id: ref.id,
    key: ref.key,
    name: id,
    type,
    ports: [
      networkPort(`${id}-port`, speed, {
        kind: type === 'switch' ? 'switch-port' : 'server-port',
      }),
    ],
  }
}

function patchPanel(id: string): InventoryItem {
  const ref = ITEM_REFS[id]

  return {
    id: ref.id,
    key: ref.key,
    name: id,
    type: 'patchPanel',
    ports: [
      networkPort(`${id}-port`, undefined, {
        kind: 'keystone',
        endpoints: [
          { id: 1, side: 'front' },
          { id: 2, side: 'back' },
        ],
      }),
    ],
  }
}

function endpoint(
  itemId: string,
  portId: string,
  endpointId?: string,
  hostedItemId?: string,
): ConnectionEndpoint {
  return {
    itemId: ITEM_REFS[itemId].key,
    portId: PORT_IDS[portId],
    ...(endpointId === undefined ? {} : { endpointId: ENDPOINT_IDS[endpointId] }),
    ...(hostedItemId === undefined ? {} : { hostedItemId: ITEM_REFS[hostedItemId].key }),
  }
}

function connection(
  id: string,
  from: ConnectionEndpoint,
  to: ConnectionEndpoint,
  type: InventoryConnection['type'] = 'network',
  negotiatedSpeedMbps?: number,
): InventoryConnection {
  return {
    id: CONNECTION_IDS[id],
    from,
    to,
    type,
    ...(negotiatedSpeedMbps === undefined ? {} : { negotiatedSpeedMbps }),
    createdAt: CREATED_AT,
  }
}

function project(
  items: InventoryItem[],
  connections: InventoryConnection[],
  assignments: ComponentAssignment[] = [],
): ProjectState {
  return {
    id: 'test-project',
    metadata: {
      name: 'Test project',
      version: 1,
      updatedAt: CREATED_AT,
    },
    items: Object.fromEntries(items.map((item) => [item.key ?? `${item.type}:${item.id}`, item])),
    placements: [],
    assignments,
    connections,
  }
}

describe('advertisedSpeedMbps', () => {
  it.each([
    ['1G', 1000],
    ['2.5G', 2500],
    ['5G', 5000],
    ['10G', 10000],
    ['2500 Mbps', 2500],
    [undefined, null],
    ['unknown', null],
  ])('parses %s as %s Mbps', (speed, expected) => {
    expect(advertisedSpeedMbps(speed)).toBe(expected)
  })
})

describe('switch network port defaults', () => {
  it('exports the supported network receptacles and advertised speeds', () => {
    expect([...SWITCH_NETWORK_PORT_TYPES]).toEqual(['rj45', 'sfp', 'sfp-plus'])
    expect(SUPPORTED_SWITCH_PORT_SPEEDS).toEqual(['1G', '2.5G', '5G', '10G'])
  })

  it.each([
    ['rj45', '1G'],
    ['sfp', '1G'],
    ['sfp-plus', '10G'],
    ['displayport', null],
  ] as const)('defaults %s ports to %s', (type, expected) => {
    expect(defaultSwitchPortSpeed(type)).toBe(expected)
  })
})

describe('normalizeNetworkProject', () => {
  it('backfills missing and unsupported switch network speeds without replacing valid speeds', () => {
    const malformedSwitch: InventoryItem = {
      id: 1,
      key: 'switch:1',
      name: 'Switch',
      type: 'switch',
      notes: 'Preserve item metadata',
      ports: [
        networkPort('rj45', undefined, { kind: 'switch-port' }),
        networkPort('sfp', 'unsupported', { kind: 'switch-port', type: 'sfp' }),
        networkPort('sfp-plus', undefined, { kind: 'switch-port', type: 'sfp-plus' }),
        networkPort('valid', '5G', { kind: 'switch-port', type: 'sfp-plus' }),
        networkPort('display', undefined, { kind: 'switch-port', type: 'displayport' }),
      ],
    }
    const validSwitch = activeItem('valid-switch', 'switch', '2.5G')
    const input = project([malformedSwitch, validSwitch], [])

    const result = normalizeNetworkProject(input)

    expect(result.items['switch:1']).toMatchObject({
      name: 'Switch',
      notes: 'Preserve item metadata',
    })
    expect(result.items['switch:1'].ports?.map((port) => port.speed)).toEqual([
      '1G',
      '1G',
      '10G',
      '5G',
      undefined,
    ])
    expect(input.items['switch:1'].ports?.map((port) => port.speed)).toEqual([
      undefined,
      'unsupported',
      undefined,
      '5G',
      undefined,
    ])
    expect(result.items['switch:2']).toBe(validSwitch)
  })

  it('repairs a direct 10G switch link and preserves all connection metadata', () => {
    const firstSwitch: InventoryItem = {
      ...activeItem('switch-a', 'switch', '10G'),
      ports: [
        networkPort('switch-a-port', '10G', {
          kind: 'switch-port',
          type: 'sfp-plus',
        }),
      ],
    }
    const secondSwitch: InventoryItem = {
      ...activeItem('switch-b', 'switch', '10G'),
      ports: [
        networkPort('switch-b-port', '10G', {
          kind: 'switch-port',
          type: 'sfp-plus',
        }),
      ],
    }
    const legacyConnection: InventoryConnection = {
      ...connection(
        'legacy-uplink',
        endpoint('switch-a', 'switch-a-port'),
        endpoint('switch-b', 'switch-b-port'),
        'other',
      ),
      label: 'Core uplink',
      route: {
        sourceSide: 'right',
        targetSide: 'left',
        bendPoints: [
          { x: 120, y: 40 },
          { x: 280, y: 40 },
        ],
      },
    }
    const input = project([firstSwitch, secondSwitch], [legacyConnection])

    const result = normalizeNetworkProject(input)

    expect(result.connections[0]).toEqual({
      ...legacyConnection,
      type: 'network',
      negotiatedSpeedMbps: 10000,
    })
    expect(input.connections[0]).toBe(legacyConnection)
    expect(input.connections[0]).not.toHaveProperty('negotiatedSpeedMbps')
  })

  it('repairs network cables through a patch-panel keystone', () => {
    const server = activeItem('server', 'server', '1G')
    const switchItem = activeItem('switch', 'switch', '10G')
    const patch = patchPanel('patch')
    const input = project(
      [server, switchItem, patch],
      [
        connection(
          'server-patch',
          endpoint('server', 'server-port'),
          endpoint('patch', 'patch-port', 'patch-back'),
          'other',
        ),
        connection(
          'patch-switch',
          endpoint('patch', 'patch-port', 'patch-front'),
          endpoint('switch', 'switch-port'),
          'other',
        ),
      ],
    )

    const result = normalizeNetworkProject(input)

    expect(result.connections.map((candidate) => candidate.type)).toEqual([
      'network',
      'network',
    ])
    expect(result.connections.map((candidate) => candidate.negotiatedSpeedMbps)).toEqual([
      1000,
      1000,
    ])
  })

  it('repairs a hosted NIC connection resolved through its assignment', () => {
    const server: InventoryItem = {
      id: 1,
      key: 'server:1',
      name: 'Server',
      type: 'server',
    }
    const nic: InventoryItem = {
      id: 1,
      key: 'network:1',
      name: 'Hosted NIC',
      type: 'network',
      ports: [networkPort('nic-port', '2.5G')],
    }
    const switchItem = activeItem('switch', 'switch', '10G')
    const input = project(
      [server, nic, switchItem],
      [
        connection(
          'hosted-nic',
          endpoint('server', 'nic-port', undefined, 'nic'),
          endpoint('switch', 'switch-port'),
          'other',
        ),
      ],
      [
        {
          id: 1,
          serverId: 'server:1',
          itemId: 'network:1',
          type: 'network',
          assignedAt: CREATED_AT,
        },
      ],
    )

    expect(normalizeNetworkProject(input).connections[0]).toMatchObject({
      type: 'network',
      negotiatedSpeedMbps: 2500,
    })
  })

  it('leaves other connections unchanged when either endpoint is not a network receptacle', () => {
    const server: InventoryItem = {
      id: 1,
      key: 'server:1',
      name: 'Server',
      type: 'server',
      ports: [
        networkPort('network', '1G'),
        networkPort('display', undefined, { type: 'displayport' }),
      ],
    }
    const legacyConnection = connection(
      'non-network-other',
      endpoint('server', 'network'),
      endpoint('server', 'display'),
      'other',
    )
    const input = project([server], [legacyConnection])

    const result = normalizeNetworkProject(input)

    expect(result).toBe(input)
    expect(result.connections[0]).toBe(legacyConnection)
    expect(result.connections[0].type).toBe('other')
  })

  it('preserves project identity when normalized and is idempotent after repairs', () => {
    const server = activeItem('server', 'server', '1G')
    const switchItem = activeItem('switch', 'switch', '2.5G')
    const normalized = project(
      [server, switchItem],
      [
        connection(
          'direct',
          endpoint('server', 'server-port'),
          endpoint('switch', 'switch-port'),
          'network',
          1000,
        ),
      ],
    )

    expect(normalizeNetworkProject(normalized)).toBe(normalized)

    const legacy = {
      ...normalized,
      connections: normalized.connections.map((candidate) => ({
        ...candidate,
        type: 'other' as const,
        negotiatedSpeedMbps: undefined,
      })),
    }
    const first = normalizeNetworkProject(legacy)
    const second = normalizeNetworkProject(first)

    expect(first).not.toBe(legacy)
    expect(second).toBe(first)
    expect(second.connections[0]).toBe(first.connections[0])
  })

  it('accepts legacy project payloads without a connections field', () => {
    const legacyProject = project([activeItem('switch', 'switch', '10G')], [])
    const { connections: _connections, ...withoutConnections } = legacyProject

    expect(() => normalizeNetworkProject(withoutConnections as ProjectState)).not.toThrow()
  })
})

describe('recalculateNegotiatedSpeeds', () => {
  it('uses the lower advertised speed for a direct active-device connection', () => {
    const server = activeItem('server', 'server', '1G')
    const switchItem = activeItem('switch', 'switch', '2.5G')
    const input = project(
      [server, switchItem],
      [
        connection(
          'direct',
          endpoint('server', 'server-port'),
          endpoint('switch', 'switch-port'),
        ),
      ],
    )

    expect(recalculateNegotiatedSpeeds(input).connections[0].negotiatedSpeedMbps).toBe(1000)
  })

  it('keeps the known switch speed on an open one-sided patch-panel segment', () => {
    const switchItem = activeItem('switch', 'switch', '2.5G')
    const patch = patchPanel('patch')
    const input = project(
      [switchItem, patch],
      [
        connection(
          'open-patch',
          endpoint('switch', 'switch-port'),
          endpoint('patch', 'patch-port', 'patch-front'),
        ),
      ],
    )

    expect(recalculateNegotiatedSpeeds(input).connections[0].negotiatedSpeedMbps).toBe(2500)
  })

  it('negotiates every cable across a transparent patch panel at the lowest speed', () => {
    const server = activeItem('server', 'server', '1G')
    const switchItem = activeItem('switch', 'switch', '2.5G')
    const patch = patchPanel('patch')
    const input = project(
      [server, switchItem, patch],
      [
        connection(
          'server-patch',
          endpoint('server', 'server-port'),
          endpoint('patch', 'patch-port', 'patch-back'),
        ),
        connection(
          'patch-switch',
          endpoint('patch', 'patch-port', 'patch-front'),
          endpoint('switch', 'switch-port'),
        ),
      ],
    )

    expect(
      recalculateNegotiatedSpeeds(input).connections.map(
        (candidate) => candidate.negotiatedSpeedMbps,
      ),
    ).toEqual([1000, 1000])
  })

  it('includes NAS speeds and negotiates 5G across a passive path', () => {
    const nas = activeItem('nas', 'nas', '5G')
    const switchItem = activeItem('switch', 'switch', '10G')
    const patch = patchPanel('patch')
    const input = project(
      [nas, switchItem, patch],
      [
        connection(
          'nas-patch',
          endpoint('nas', 'nas-port'),
          endpoint('patch', 'patch-port', 'patch-back'),
        ),
        connection(
          'patch-switch',
          endpoint('patch', 'patch-port', 'patch-front'),
          endpoint('switch', 'switch-port'),
        ),
      ],
    )

    expect(
      recalculateNegotiatedSpeeds(input).connections.map(
        (candidate) => candidate.negotiatedSpeedMbps,
      ),
    ).toEqual([5000, 5000])
  })

  it('resolves an assigned hosted NIC port through its server endpoint', () => {
    const server: InventoryItem = {
      id: 1,
      key: 'server:1',
      name: 'Server',
      type: 'server',
    }
    const nic: InventoryItem = {
      id: 1,
      key: 'network:1',
      name: 'Hosted NIC',
      type: 'network',
      ports: [networkPort('nic-port', '2.5G')],
    }
    const switchItem = activeItem('switch', 'switch', '10G')
    const input = project(
      [server, nic, switchItem],
      [
        connection(
          'hosted-nic',
          endpoint('server', 'nic-port', undefined, 'nic'),
          endpoint('switch', 'switch-port'),
        ),
      ],
      [
        {
          id: 1,
          serverId: 'server:1',
          itemId: 'network:1',
          type: 'network',
          assignedAt: CREATED_AT,
        },
      ],
    )

    expect(recalculateNegotiatedSpeeds(input).connections[0].negotiatedSpeedMbps).toBe(2500)
  })

  it('treats an sfp-plus active port without an explicit speed as 10G', () => {
    const server = activeItem('server', 'server', '10G')
    const switchItem: InventoryItem = {
      id: 1,
      key: 'switch:1',
      name: 'Switch',
      type: 'switch',
      ports: [
        networkPort('switch-port', undefined, {
          kind: 'switch-port',
          type: 'sfp-plus',
        }),
      ],
    }
    const input = project(
      [server, switchItem],
      [
        connection(
          'implicit-sfp-plus',
          endpoint('server', 'server-port'),
          endpoint('switch', 'switch-port'),
        ),
      ],
    )

    expect(recalculateNegotiatedSpeeds(input).connections[0].negotiatedSpeedMbps).toBe(10000)
  })

  it('omits speed for passive-only and unknown network segments', () => {
    const firstPatch = patchPanel('patch-a')
    const secondPatch = patchPanel('patch-b')
    const input = project(
      [firstPatch, secondPatch],
      [
        connection(
          'passive-only',
          endpoint('patch-a', 'patch-a-port', 'patch-a-front'),
          endpoint('patch-b', 'patch-b-port', 'patch-b-front'),
          'network',
          10000,
        ),
      ],
    )

    expect(recalculateNegotiatedSpeeds(input).connections[0]).not.toHaveProperty(
      'negotiatedSpeedMbps',
    )
  })

  it('removes stale negotiated speeds from display and other connections', () => {
    const server: InventoryItem = {
      id: 1,
      key: 'server:1',
      name: 'Server',
      type: 'server',
      ports: [
        networkPort('dp', undefined, { type: 'displayport' }),
        networkPort('barrel', undefined, { type: 'barrel' }),
      ],
    }
    const input = project(
      [server],
      [
        connection(
          'display',
          endpoint('server', 'dp'),
          endpoint('server', 'dp'),
          'display',
          2500,
        ),
        connection(
          'other',
          endpoint('server', 'barrel'),
          endpoint('server', 'barrel'),
          'other',
          5000,
        ),
      ],
    )

    const result = recalculateNegotiatedSpeeds(input)

    expect(result.connections[0]).not.toHaveProperty('negotiatedSpeedMbps')
    expect(result.connections[1]).not.toHaveProperty('negotiatedSpeedMbps')
  })

  it('does not mutate input and preserves references once values are current', () => {
    const server = activeItem('server', 'server', '1G')
    const switchItem = activeItem('switch', 'switch', '2.5G')
    const originalConnection = connection(
      'direct',
      endpoint('server', 'server-port'),
      endpoint('switch', 'switch-port'),
    )
    const input = project([server, switchItem], [originalConnection])

    const first = recalculateNegotiatedSpeeds(input)
    const second = recalculateNegotiatedSpeeds(first)

    expect(input.connections[0]).toBe(originalConnection)
    expect(input.connections[0]).not.toHaveProperty('negotiatedSpeedMbps')
    expect(first).not.toBe(input)
    expect(first.connections[0]).not.toBe(originalConnection)
    expect(second).toBe(first)
    expect(second.connections[0]).toBe(first.connections[0])
  })
})
