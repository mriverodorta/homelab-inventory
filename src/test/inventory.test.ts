import { describe, expect, it } from 'vitest'
import { assignComponent } from '@/lib/constraints'
import { mergeInventoryWithProject, normalizeInventory, getUnassignedItems } from '@/lib/inventory'
import { upsertPlacement } from '@/lib/project'
import type { CompatibilityAllocation } from '@/types/compatibility'
import type { InventoryItem } from '@/types/inventory'

const starter: InventoryItem[] = [
  { id: 1, key: 'server:1', name: 'Server One', type: 'server' },
  { id: 1, key: 'cpu:1', name: 'CPU One', type: 'cpu' },
]

describe('inventory parsing and merge', () => {
  it('preserves structured compatibility profiles and assignment allocations', () => {
    const host: InventoryItem = {
      id: 1,
      name: 'Example Mini Host',
      type: 'server',
      compatibility: {
        host: {
          cpu: { sockets: ['LGA1200'], generations: ['10'], maxTdpWatts: 65 },
          memory: {
            generations: ['DDR4'],
            slots: 2,
            maxCapacityGb: 64,
            maxModuleCapacityGb: 32,
            maxSpeedMt: 2933,
          },
          storageSlots: [
            {
              id: 10, key: 'm2-1',
              label: 'M.2 Slot',
              count: 1,
              interfaces: ['NVMe'],
              formFactors: ['2280'],
            },
          ],
        },
      },
    }

    const allocation: CompatibilityAllocation = {
      resourceType: 'storage',
      groupId: 10,
      positions: [0],
    }

    expect(structuredClone({ host, allocation })).toEqual({ host, allocation })
  })

  it('normalizes valid inventory items', () => {
    const items = normalizeInventory([
      { id: 1, name: 'Server One', type: 'server' },
      {
        id: 1,
        name: 'RAM One',
        type: 'ram',
        family: 'DDR4',
        number: 'kit-01',
        specs: { capacityGb: 32 },
        properties: { displayName: 'Memory Kit', ignored: 123 },
      },
    ])

    expect(items).toHaveLength(2)
    expect(items[1]?.specs?.capacityGb).toBe(32)
    expect(items[1]?.family).toBe('DDR4')
    expect(items[1]?.number).toBe('kit-01')
    expect(items[1]?.properties).toEqual({ displayName: 'Memory Kit' })
  })

  it('preserves compatibility profiles and forward-compatible extensions during normalization', () => {
    const compatibility = {
      host: {
        storageSlots: [{ id: 10, key: 'm2-1', label: 'M.2', count: 1, interfaces: ['NVMe'] }],
      },
      extension: { retained: true },
    }
    const [item] = normalizeInventory([{
      id: 1,
      name: 'Host',
      type: 'server',
      compatibility,
    }])

    expect(item.compatibility).toEqual(compatibility)
    expect(item.compatibility).not.toBe(compatibility)
  })

  it('normalizes switch and patch panel ports', () => {
    const items = normalizeInventory([
      {
        id: 1,
        name: 'Switch One',
        type: 'switch',
        ports: [
          {
            id: 1,
            kind: 'switch-port',
            type: 'rj45',
            slotNumber: 1,
            speed: '2.5G',
            poe: true,
          },
        ],
      },
      {
        id: 1,
        name: 'Patch One',
        type: 'patchPanel',
        ports: [
          {
            id: 1,
            kind: 'keystone',
            type: 'hdmi',
            slotNumber: 1,
            label: '',
            endpoints: [
              { id: 1, side: 'front' },
              { id: 2, side: 'back' },
            ],
          },
        ],
      },
      {
        id: 1,
        name: 'Server One',
        type: 'server',
        ports: [
          {
            id: 1,
            kind: 'server-port',
            type: 'displayport',
            slotNumber: 2,
            label: '',
          },
        ],
      },
    ])

    expect(items[0]?.ports).toEqual([
      {
        id: 1,
        kind: 'switch-port',
        type: 'rj45',
        slotNumber: 1,
        speed: '2.5G',
        poe: true,
      },
    ])
    expect(items[1]?.ports?.[0]?.type).toBe('hdmi')
    expect(items[1]?.ports?.[0]?.endpoints).toEqual([
      { id: 1, side: 'front' },
      { id: 2, side: 'back' },
    ])
    expect(items[2]?.ports?.[0]?.kind).toBe('server-port')
    expect(items[2]?.ports?.[0]?.type).toBe('displayport')
  })

  it('rejects duplicate ids', () => {
    expect(() =>
      normalizeInventory([
        { id: 1, name: 'One', type: 'server' },
        { id: 1, name: 'Two', type: 'server' },
      ]),
    ).toThrow(/duplicate id/i)
  })

  it('preserves saved placements and adds new starter JSON items as unassigned', () => {
    const savedBase = mergeInventoryWithProject(starter, null)
    const savedWithPlacement = upsertPlacement(savedBase, { serverId: 'server:1', x: 24, y: 48 })
    const savedWithAssignment = assignComponent(savedWithPlacement, 'server:1', 'cpu:1')
    const merged = mergeInventoryWithProject(
      [...starter, { id: 1, key: 'ram:1', name: 'New RAM', type: 'ram' }],
      savedWithAssignment,
    )

    expect(merged.placements).toEqual([{ serverId: 'server:1', x: 24, y: 48 }])
    expect(merged.assignments).toHaveLength(1)
    expect(getUnassignedItems(merged).map((item) => item.key)).toContain('ram:1')
  })

  it('drops unreferenced saved orphan items when they are no longer in starter JSON', () => {
    const saved = mergeInventoryWithProject(
      [...starter, { id: 1, key: 'gpu:1', name: 'Old GPU', type: 'gpu' }],
      null,
    )
    const merged = mergeInventoryWithProject(starter, saved)

    expect(merged.items['gpu:1']).toBeUndefined()
  })

  it('keeps referenced saved orphan items when they are no longer in starter JSON', () => {
    const saved = assignComponent(
      mergeInventoryWithProject(
        [
          ...starter,
          { id: 1, key: 'storage:1', name: 'Old Storage', type: 'storage' },
        ],
        null,
      ),
      'server:1',
      'storage:1',
    )
    const merged = mergeInventoryWithProject(starter, saved)

    expect(merged.items['storage:1']?.name).toBe('Old Storage')
  })
})
