import { describe, expect, it } from 'vitest'
import { filterAndSortInventory, isItemAssigned } from '@/lib/sort'
import type { InventoryItem, ProjectState } from '@/types/inventory'

function archived(item: InventoryItem): InventoryItem {
  return {
    ...item,
    archivedAt: '2026-07-19T12:00:00.000Z',
  }
}

const availableCpu: InventoryItem = { id: 'cpu-available', name: 'Available CPU', type: 'cpu' }
const assignedCpu: InventoryItem = { id: 'cpu-assigned', name: 'Assigned CPU', type: 'cpu' }
const activeServer: InventoryItem = { id: 'server-active', name: 'Active Server', type: 'server' }
const archivedCpu = archived({ id: 'cpu-archived', name: 'Archived CPU', type: 'cpu' })
const archivedServer = archived({ id: 'server-archived', name: 'Archived Server', type: 'server' })

const project: ProjectState = {
  id: 'default',
  metadata: { name: 'Test', version: 1, updatedAt: '2026-07-19T12:00:00.000Z' },
  items: {
    'cpu-available': availableCpu,
    'cpu-assigned': assignedCpu,
    'server-active': activeServer,
    'cpu-archived': archivedCpu,
    'server-archived': archivedServer,
  },
  placements: [
    { serverId: 'server-active', x: 0, y: 0 },
    { serverId: 'server-archived', x: 400, y: 0 },
  ],
  assignments: [
    {
      id: 1,
      serverId: 'server-active',
      itemId: 'cpu-assigned',
      type: 'cpu',
      assignedAt: '2026-07-19T12:00:00.000Z',
    },
    {
      id: 2,
      serverId: 'server-active',
      itemId: 'cpu-archived',
      type: 'cpu',
      assignedAt: '2026-07-19T12:00:00.000Z',
    },
  ],
  connections: [],
}

function namesFor(status: 'available' | 'assigned' | 'archived' | 'all'): string[] {
  return filterAndSortInventory(project, {
    query: '',
    type: 'all',
    status,
    sort: 'name',
  }).map((item) => item.name)
}

describe('inventory lifecycle status filtering', () => {
  it('shows only active unassigned records as available', () => {
    expect(namesFor('available')).toEqual(['Available CPU'])
  })

  it('shows only active placed or assigned records as assigned', () => {
    expect(namesFor('assigned')).toEqual(['Active Server', 'Assigned CPU'])
  })

  it('shows archived records even if stale relationships still reference them', () => {
    expect(namesFor('archived')).toEqual(['Archived CPU', 'Archived Server'])
  })

  it('shows active and archived records in the all view', () => {
    expect(namesFor('all')).toEqual([
      'Active Server',
      'Archived CPU',
      'Archived Server',
      'Assigned CPU',
      'Available CPU',
    ])
  })

  it('keeps assignment detection independent from lifecycle status', () => {
    expect(isItemAssigned(project, archivedCpu)).toBe(true)
    expect(isItemAssigned(project, archivedServer)).toBe(true)
  })
})
