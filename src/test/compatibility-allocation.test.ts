import { describe, expect, it } from 'vitest'
import {
  normalizeCompatibilityProject,
  planHostAllocations,
} from '@/lib/compatibility'
import type { ComponentAssignment, InventoryItem, ProjectState } from '@/types/inventory'

const host = (
  id: string,
  overrides: InventoryItem['compatibility'] = {},
  type: 'server' | 'nas' = 'server',
): InventoryItem => ({
  id: Number(id.split(':')[1]),
  key: id,
  type,
  name: `Host ${id}`,
  compatibility: {
    host: {
      memory: {
        generations: ['DDR4'],
        slots: 4,
        maxCapacityGb: 128,
        maxModuleCapacityGb: 32,
        maxSpeedMt: 3200,
      },
      storageSlots: [
        {
          id: 1, key: 'm2',
          label: 'M.2 slots',
          count: 2,
          interfaces: ['NVMe'],
          formFactors: ['2280'],
          pcieGeneration: 4,
        },
      ],
      expansionSlots: [
        {
          id: 3, key: 'pcie-x16',
          label: 'PCIe slots',
          count: 4,
          interfaceFamily: 'pcie',
          pcieGeneration: 4,
          mechanicalLanes: 16,
          electricalLanes: 16,
          acceptedHeights: ['low-profile'],
          maxSlotWidth: 2,
          maxPowerWatts: 75,
        },
      ],
      maxExpansionPowerWatts: 150,
      ...overrides.host,
    },
  },
})

const ram = (id: number, moduleCount = 2): InventoryItem => ({
  id,
  key: `ram:${id}`,
  type: 'ram',
  name: `RAM ${id}`,
  specs: {
    capacityGb: moduleCount * 16,
    moduleCount,
    generation: 'DDR4',
    speedMt: 3200,
  },
})

const storage = (id: number): InventoryItem => ({
  id,
  key: `storage:${id}`,
  type: 'storage',
  name: `Storage ${id}`,
  specs: { interface: 'NVMe', formFactor: '2280', pcie: 'PCIe 4.0 x4' },
})

const card = (id: number, slotWidth = 2): InventoryItem => ({
  id,
  key: `network:${id}`,
  type: 'network',
  name: `Card ${id}`,
  compatibility: {
    requirements: {
      expansion: {
        interfaceFamily: 'pcie',
        pcieGeneration: 4,
        connectorLanes: 4,
        minimumElectricalLanes: 4,
        height: 'low-profile',
        slotWidth,
        powerWatts: 25,
      },
    },
  },
})

const assignment = (
  id: number,
  serverId: string,
  item: InventoryItem,
  assignedAt: string,
  allocation?: ComponentAssignment['allocation'],
): ComponentAssignment => ({
  id,
  serverId,
  itemId: item.key!,
  type: item.type as ComponentAssignment['type'],
  assignedAt,
  allocation,
})

const project = (
  hostItems: InventoryItem[],
  components: InventoryItem[],
  assignments: ComponentAssignment[],
): ProjectState => ({
  id: 'default',
  metadata: { name: 'Compatibility allocation', version: 1, updatedAt: '2026-07-19T00:00:00Z' },
  items: Object.fromEntries([...hostItems, ...components].map((item) => [item.key!, item])),
  placements: hostItems.map((item, index) => ({ serverId: item.key!, x: index * 100, y: 0 })),
  assignments,
  connections: [],
})

describe('deterministic compatibility allocation', () => {
  it('allocates RAM, storage, and wide expansion cards to the lowest free consecutive positions', () => {
    const server = host('server:1')
    const components = [ram(1), storage(1), card(1)]
    const input = project(
      [server],
      components,
      components.map((item, index) =>
        assignment(index + 1, server.key!, item, `2026-01-01T00:00:0${index}Z`),
      ),
    )

    expect(planHostAllocations(input, server.key!).assignments).toEqual([
      expect.objectContaining({
        id: 1,
        allocation: { resourceType: 'memory', positions: [0, 1] },
      }),
      expect.objectContaining({
        id: 2,
        allocation: { resourceType: 'storage', groupId: 1, positions: [0] },
      }),
      expect.objectContaining({
        id: 3,
        allocation: { resourceType: 'expansion', groupId: 3, positions: [0, 1] },
      }),
    ])
  })

  it('is stable across repeated project normalization', () => {
    const server = host('server:1')
    const components = [ram(1), storage(1), card(1)]
    const input = project(
      [server],
      components,
      components.map((item, index) =>
        assignment(index + 1, server.key!, item, `2026-01-01T00:00:0${index}Z`),
      ),
    )

    const once = normalizeCompatibilityProject(input)
    const twice = normalizeCompatibilityProject(once)

    expect(twice).toEqual(once)
    expect(input.assignments.every((entry) => entry.allocation === undefined)).toBe(true)
  })

  it('keeps numeric assignment IDs distinct during project normalization', () => {
    const server = host('server:1')
    const firstDrive = storage(1)
    const secondDrive = storage(2)
    const input = project(
      [server],
      [firstDrive, secondDrive],
      [
        assignment(1, server.key!, firstDrive, '2026-01-01T00:00:00Z'),
        assignment(2, server.key!, secondDrive, '2026-01-02T00:00:00Z'),
      ],
    )

    const normalized = normalizeCompatibilityProject(input)

    expect(normalized.assignments).toEqual([
      expect.objectContaining({
        id: 1,
        serverId: server.key,
        itemId: firstDrive.key,
        allocation: { resourceType: 'storage', groupId: 1, positions: [0] },
      }),
      expect.objectContaining({
        id: 2,
        serverId: server.key,
        itemId: secondDrive.key,
        allocation: { resourceType: 'storage', groupId: 1, positions: [1] },
      }),
    ])
  })

  it('sorts assignments by assignedAt and then numeric ID before allocating', () => {
    const server = host('server:1', {
      host: {
        storageSlots: [{ id: 1, key: 'm2', label: 'M.2', count: 3, interfaces: ['NVMe'], formFactors: ['2280'] }],
      },
    })
    const items = [storage(1), storage(2), storage(3)]
    const input = project(
      [server],
      items,
      [
        assignment(10, server.key!, items[0], '2026-01-02T00:00:00Z'),
        assignment(3, server.key!, items[2], '2026-01-01T00:00:00Z'),
        assignment(2, server.key!, items[1], '2026-01-02T00:00:00Z'),
      ],
    )

    const planned = planHostAllocations(input, server.key!).assignments
    expect(planned.map((entry) => entry.id)).toEqual([3, 2, 10])
    expect(planned.map((entry) => entry.allocation?.positions)).toEqual([[0], [1], [2]])
  })

  it('preserves valid allocations and replaces stale or requirement-invalid allocations', () => {
    const server = host('server:1')
    const first = storage(1)
    const second = card(1, 2)
    const input = project(
      [server],
      [first, second],
      [
        assignment(1, server.key!, first, '2026-01-01T00:00:00Z', {
          resourceType: 'storage',
          groupId: 1,
          positions: [1],
        }),
        assignment(2, server.key!, second, '2026-01-02T00:00:00Z', {
          resourceType: 'expansion',
          groupId: 3,
          positions: [3],
        }),
      ],
    )

    const planned = planHostAllocations(input, server.key!).assignments
    expect(planned[0].allocation).toEqual({ resourceType: 'storage', groupId: 1, positions: [1] })
    expect(planned[1].allocation).toEqual({
      resourceType: 'expansion',
      groupId: 3,
      positions: [0, 1],
    })
  })

  it('reserves later valid allocations before filling earlier unallocated assignments', () => {
    const server = host('server:1')
    const first = storage(1)
    const second = storage(2)
    const input = project(
      [server],
      [first, second],
      [
        assignment(1, server.key!, first, '2026-01-01T00:00:00Z'),
        assignment(2, server.key!, second, '2026-01-02T00:00:00Z', {
          resourceType: 'storage',
          groupId: 1,
          positions: [0],
        }),
      ],
    )

    const planned = planHostAllocations(input, server.key!).assignments
    expect(planned[0].allocation?.positions).toEqual([1])
    expect(planned[1].allocation?.positions).toEqual([0])
  })

  it('does not overbook RAM, storage, or expansion positions', () => {
    const server = host('server:1', {
      host: {
        memory: {
          generations: ['DDR4'],
          slots: 2,
          maxCapacityGb: 128,
          maxModuleCapacityGb: 64,
          maxSpeedMt: 3200,
        },
        storageSlots: [{ id: 1, key: 'm2', label: 'M.2', count: 1, interfaces: ['NVMe'], formFactors: ['2280'] }],
        expansionSlots: [{
          id: 4, key: 'pcie',
          label: 'PCIe',
          count: 2,
          interfaceFamily: 'pcie',
          pcieGeneration: 4,
          mechanicalLanes: 16,
          electricalLanes: 16,
          acceptedHeights: ['low-profile'],
          maxSlotWidth: 2,
          maxPowerWatts: 75,
        }],
      },
    })
    const items = [ram(1, 2), ram(2, 1), storage(1), storage(2), card(1, 2), card(2, 1)]
    const input = project(
      [server],
      items,
      items.map((item, index) => assignment(index + 1, server.key!, item, `2026-01-01T00:00:0${index}Z`)),
    )

    const planned = planHostAllocations(input, server.key!)
    expect(planned.assignments.map((entry) => entry.allocation)).toEqual([
      { resourceType: 'memory', positions: [0, 1] },
      undefined,
      { resourceType: 'storage', groupId: 1, positions: [0] },
      undefined,
      { resourceType: 'expansion', groupId: 4, positions: [0, 1] },
      undefined,
    ])
    expect(planned.results.filter((entry) => entry.status === 'incompatible')).toHaveLength(3)
  })

  it('does not allocate duplicate group IDs or groups with non-positive counts', () => {
    const server = host('server:1', {
      host: {
        storageSlots: [
          { id: 19, key: 'duplicate', label: 'First', count: 1, interfaces: ['NVMe'], formFactors: ['2280'] },
          { id: 19, key: 'duplicate', label: 'Second', count: 2, interfaces: ['NVMe'], formFactors: ['2280'] },
          { id: 20, key: 'zero', label: 'Zero', count: 0, interfaces: ['NVMe'], formFactors: ['2280'] },
          { id: 21, key: 'negative', label: 'Negative', count: -1, interfaces: ['NVMe'], formFactors: ['2280'] },
        ],
      },
    })
    const drive = storage(1)
    const input = project(
      [server],
      [drive],
      [assignment(1, server.key!, drive, '2026-01-01T00:00:00Z')],
    )

    const planned = planHostAllocations(input, server.key!)
    expect(planned.assignments[0].allocation).toBeUndefined()
    expect(planned.results[0]).toMatchObject({ status: 'unknown' })
  })

  it('leaves unknown component resource matches unallocated', () => {
    const server = host('server:1')
    const unknown: InventoryItem = { id: 1, key: 'storage:1', type: 'storage', name: 'Unknown drive' }
    const input = project(
      [server],
      [unknown],
      [assignment(1, server.key!, unknown, '2026-01-01T00:00:00Z')],
    )

    const planned = planHostAllocations(input, server.key!)
    expect(planned.assignments[0].allocation).toBeUndefined()
    expect(planned.results[0].status).toBe('unknown')
  })

  it('allocates unknown memory, storage, and expansion candidates on disabled hosts without overbooking', () => {
    const server = host('server:1', {
      host: {
        memory: {
          generations: ['DDR4'],
          slots: 1,
          maxCapacityGb: 128,
          maxModuleCapacityGb: 32,
          maxSpeedMt: 3200,
        },
        storageSlots: [{ id: 1, key: 'm2', label: 'M.2', count: 1, interfaces: ['NVMe'], formFactors: ['2280'] }],
        expansionSlots: [{
          id: 4, key: 'pcie',
          label: 'PCIe',
          count: 1,
          interfaceFamily: 'pcie',
          pcieGeneration: 4,
          mechanicalLanes: 16,
          electricalLanes: 16,
          acceptedHeights: ['low-profile'],
          maxSlotWidth: 1,
          maxPowerWatts: 75,
        }],
      },
    })
    const unknownItems: InventoryItem[] = [
      { id: 1, key: 'ram:1', type: 'ram', name: 'Unknown RAM 1', specs: { capacityGb: 16, moduleCount: 1 } },
      { id: 2, key: 'ram:2', type: 'ram', name: 'Unknown RAM 2', specs: { capacityGb: 16, moduleCount: 1 } },
      { id: 1, key: 'storage:1', type: 'storage', name: 'Unknown storage 1', specs: { formFactor: '2280' } },
      { id: 2, key: 'storage:2', type: 'storage', name: 'Unknown storage 2', specs: { formFactor: '2280' } },
      {
        id: 1,
        key: 'network:1',
        type: 'network',
        name: 'Unknown card 1',
        compatibility: { requirements: { expansion: { interfaceFamily: 'pcie', slotWidth: 1 } } },
      },
      {
        id: 1,
        key: 'gpu:1',
        type: 'gpu',
        name: 'Unknown card 2',
        compatibility: { requirements: { expansion: { interfaceFamily: 'pcie', slotWidth: 1 } } },
      },
    ]
    const input = project(
      [server],
      unknownItems,
      unknownItems.map((item, index) =>
        assignment(index + 1, server.key!, item, `2026-01-01T00:00:0${index}Z`),
      ),
    )
    input.compatibilityPolicy = {
      disabledHosts: [{ hostType: 'server', hostId: server.id }],
      ignoredWarningIds: [],
    }

    const planned = planHostAllocations(input, server.key!)

    expect(planned.assignments.map((entry) => entry.allocation)).toEqual([
      { resourceType: 'memory', positions: [0] },
      undefined,
      { resourceType: 'storage', groupId: 1, positions: [0] },
      undefined,
      { resourceType: 'expansion', groupId: 4, positions: [0] },
      undefined,
    ])
    expect([0, 2, 4].map((index) => planned.results[index].status)).toEqual([
      'unknown',
      'unknown',
      'unknown',
    ])
    for (const index of [1, 3, 5]) {
      expect(planned.results[index].findings).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'compatibility.resource.exhausted', severity: 'error' }),
      ]))
    }
  })

  it('reports known storage exhaustion even when the next drive has unknown compatibility fields', () => {
    const server = host('server:1', {
      host: {
        storageSlots: [{ id: 1, key: 'm2', label: 'M.2', count: 1, interfaces: ['NVMe'], formFactors: ['2280'] }],
      },
    })
    const known = storage(1)
    const unknown: InventoryItem = {
      id: 2,
      key: 'storage:2',
      type: 'storage',
      name: 'Drive with unknown interface',
      specs: { formFactor: '2280' },
    }
    const input = project(
      [server],
      [known, unknown],
      [
        assignment(1, server.key!, known, '2026-01-01T00:00:00Z'),
        assignment(2, server.key!, unknown, '2026-01-02T00:00:00Z'),
      ],
    )

    const planned = planHostAllocations(input, server.key!)

    expect(planned.assignments[0].allocation).toEqual({
      resourceType: 'storage',
      groupId: 1,
      positions: [0],
    })
    expect(planned.assignments[1].allocation).toBeUndefined()
    expect(planned.results[1]).toMatchObject({
      assignmentId: 2,
      status: 'incompatible',
    })
    expect(planned.results[1].findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: 'unknown' }),
        expect.objectContaining({ code: 'compatibility.resource.exhausted', severity: 'error' }),
      ]),
    )
  })

  it('reports known expansion exhaustion even when the next card has unknown compatibility fields', () => {
    const server = host('server:1', {
      host: {
        expansionSlots: [{
          id: 4, key: 'pcie',
          label: 'PCIe',
          count: 1,
          interfaceFamily: 'pcie',
          pcieGeneration: 4,
          mechanicalLanes: 16,
          electricalLanes: 16,
          acceptedHeights: ['low-profile'],
          maxSlotWidth: 1,
          maxPowerWatts: 75,
        }],
      },
    })
    const known = card(1, 1)
    const unknown: InventoryItem = {
      id: 2,
      key: 'network:2',
      type: 'network',
      name: 'Card with unknown PCIe details',
      compatibility: {
        requirements: {
          expansion: { interfaceFamily: 'pcie', slotWidth: 1 },
        },
      },
    }
    const input = project(
      [server],
      [known, unknown],
      [
        assignment(1, server.key!, known, '2026-01-01T00:00:00Z'),
        assignment(2, server.key!, unknown, '2026-01-02T00:00:00Z'),
      ],
    )

    const planned = planHostAllocations(input, server.key!)

    expect(planned.assignments[0].allocation).toEqual({
      resourceType: 'expansion',
      groupId: 4,
      positions: [0],
    })
    expect(planned.assignments[1].allocation).toBeUndefined()
    expect(planned.results[1]).toMatchObject({ assignmentId: 2, status: 'incompatible' })
    expect(planned.results[1].findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: 'unknown' }),
        expect.objectContaining({ code: 'compatibility.resource.exhausted', severity: 'error' }),
      ]),
    )
  })

  it('returns ordered unknown results for dangling assignments and removes stale allocations', () => {
    const server = host('server:1')
    const drive = storage(1)
    const input = project(
      [server],
      [drive],
      [
        assignment(1, server.key!, drive, '2026-01-01T00:00:00Z'),
        {
          id: 404,
          serverId: server.key!,
          itemId: 'storage:404',
          type: 'storage',
          assignedAt: '2026-01-02T00:00:00Z',
          allocation: { resourceType: 'storage', groupId: 1, positions: [1] },
        },
      ],
    )

    const planned = planHostAllocations(input, server.key!)

    expect(planned.results.map((result) => result.assignmentId)).toEqual([1, 404])
    expect(planned.results[1]).toMatchObject({
      assignmentId: 404,
      hostId: server.key,
      itemId: 'storage:404',
      status: 'unknown',
      findings: [
        expect.objectContaining({
          code: 'compatibility.component.missing',
          severity: 'unknown',
        }),
      ],
    })
    expect(planned.assignments[1].allocation).toBeUndefined()
  })

  it('normalizes only server and NAS assignments while preserving all other project data', () => {
    const server = host('server:1')
    const nas = host('nas:1', {}, 'nas')
    const switchItem: InventoryItem = { id: 1, key: 'switch:1', type: 'switch', name: 'Switch' }
    const drives = [storage(1), storage(2), storage(3)]
    const input = project(
      [server, nas, switchItem],
      drives,
      [
        assignment(1, server.key!, drives[0], '2026-01-01T00:00:00Z'),
        assignment(2, nas.key!, drives[1], '2026-01-01T00:00:00Z'),
        assignment(3, switchItem.key!, drives[2], '2026-01-01T00:00:00Z', {
          resourceType: 'storage',
          groupId: 22,
          positions: [8],
        }),
      ],
    )
    input.connections = [{
      id: 1,
      from: { itemId: server.key!, portId: 1 },
      to: { itemId: switchItem.key!, portId: 1 },
      type: 'network',
      createdAt: '2026-01-01T00:00:00Z',
    }]

    const normalized = normalizeCompatibilityProject(input)

    expect(normalized.items).toBe(input.items)
    expect(normalized.placements).toBe(input.placements)
    expect(normalized.connections).toBe(input.connections)
    expect(normalized.assignments[0].allocation).toEqual({ resourceType: 'storage', groupId: 1, positions: [0] })
    expect(normalized.assignments[1].allocation).toEqual({ resourceType: 'storage', groupId: 1, positions: [0] })
    expect(normalized.assignments[2]).toEqual(input.assignments[2])
    expect(input.assignments[0].allocation).toBeUndefined()
  })
})
