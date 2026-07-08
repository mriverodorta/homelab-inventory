import { describe, expect, it } from 'vitest'
import { assignComponent } from '@/lib/constraints'
import { mergeInventoryWithProject, normalizeInventory, getUnassignedItems } from '@/lib/inventory'
import { upsertPlacement } from '@/lib/project'
import type { InventoryItem } from '@/types/inventory'

const starter: InventoryItem[] = [
  { id: 'srv-one', name: 'Server One', type: 'server' },
  { id: 'cpu-one', name: 'CPU One', type: 'cpu' },
]

describe('inventory parsing and merge', () => {
  it('normalizes valid inventory items', () => {
    const items = normalizeInventory([
      { id: 'srv-one', name: 'Server One', type: 'server' },
      {
        id: 'ram-one',
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

  it('normalizes switch and patch panel ports', () => {
    const items = normalizeInventory([
      {
        id: 'switch-one',
        name: 'Switch One',
        type: 'switch',
        ports: [
          {
            id: 'rj45-01',
            kind: 'switch-port',
            type: 'rj45',
            slotNumber: 1,
            speed: '2.5G',
            poe: true,
          },
        ],
      },
      {
        id: 'patch-one',
        name: 'Patch One',
        type: 'patchPanel',
        ports: [
          {
            id: 'keystone-01',
            kind: 'keystone',
            type: 'hdmi',
            slotNumber: 1,
            label: '',
            endpoints: [
              { id: 'keystone-01-front', side: 'front' },
              { id: 'keystone-01-back', side: 'back' },
            ],
          },
        ],
      },
      {
        id: 'server-one',
        name: 'Server One',
        type: 'server',
        ports: [
          {
            id: 'displayport-01',
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
        id: 'rj45-01',
        kind: 'switch-port',
        type: 'rj45',
        slotNumber: 1,
        speed: '2.5G',
        poe: true,
      },
    ])
    expect(items[1]?.ports?.[0]?.type).toBe('hdmi')
    expect(items[1]?.ports?.[0]?.endpoints).toEqual([
      { id: 'keystone-01-front', side: 'front' },
      { id: 'keystone-01-back', side: 'back' },
    ])
    expect(items[2]?.ports?.[0]?.kind).toBe('server-port')
    expect(items[2]?.ports?.[0]?.type).toBe('displayport')
  })

  it('rejects duplicate ids', () => {
    expect(() =>
      normalizeInventory([
        { id: 'same', name: 'One', type: 'server' },
        { id: 'same', name: 'Two', type: 'cpu' },
      ]),
    ).toThrow(/duplicate id/i)
  })

  it('preserves saved placements and adds new starter JSON items as unassigned', () => {
    const savedBase = mergeInventoryWithProject(starter, null)
    const savedWithPlacement = upsertPlacement(savedBase, { serverId: 'srv-one', x: 24, y: 48 })
    const savedWithAssignment = assignComponent(savedWithPlacement, 'srv-one', 'cpu-one')
    const merged = mergeInventoryWithProject(
      [...starter, { id: 'ram-new', name: 'New RAM', type: 'ram' }],
      savedWithAssignment,
    )

    expect(merged.placements).toEqual([{ serverId: 'srv-one', x: 24, y: 48 }])
    expect(merged.assignments).toHaveLength(1)
    expect(getUnassignedItems(merged).map((item) => item.id)).toContain('ram-new')
  })

  it('drops unreferenced saved orphan items when they are no longer in starter JSON', () => {
    const saved = mergeInventoryWithProject(
      [...starter, { id: 'gpu-old', name: 'Old GPU', type: 'gpu' }],
      null,
    )
    const merged = mergeInventoryWithProject(starter, saved)

    expect(merged.items['gpu-old']).toBeUndefined()
  })

  it('keeps referenced saved orphan items when they are no longer in starter JSON', () => {
    const saved = assignComponent(
      mergeInventoryWithProject(
        [
          ...starter,
          { id: 'storage-old', name: 'Old Storage', type: 'storage' },
        ],
        null,
      ),
      'srv-one',
      'storage-old',
    )
    const merged = mergeInventoryWithProject(starter, saved)

    expect(merged.items['storage-old']?.name).toBe('Old Storage')
  })
})
