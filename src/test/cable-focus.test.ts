import { describe, expect, it } from 'vitest'
import { connectionMatchesSelectedItem, getFocusedCableItemIds } from '@/lib/cable-focus'
import type { ProjectState } from '@/types/inventory'

const project: ProjectState = {
  id: 'test-project',
  metadata: {
    name: 'Test',
    version: 1,
    updatedAt: '2026-06-26T00:00:00.000Z',
  },
  items: {
    'server:1': { id: 1, key: 'server:1', name: 'Server A', type: 'server' },
    'server:2': { id: 2, key: 'server:2', name: 'Server B', type: 'server' },
    'switch:1': { id: 1, key: 'switch:1', name: 'Switch A', type: 'switch' },
    'patchPanel:1': { id: 1, key: 'patchPanel:1', name: 'Patch A', type: 'patchPanel' },
    'ram:1': { id: 1, key: 'ram:1', name: 'RAM A', type: 'ram' },
    'ram:2': { id: 2, key: 'ram:2', name: 'RAM B', type: 'ram' },
  },
  placements: [
    { serverId: 'server:1', x: 0, y: 0 },
    { serverId: 'server:2', x: 320, y: 0 },
    { serverId: 'switch:1', x: 0, y: 320 },
    { serverId: 'patchPanel:1', x: 320, y: 320 },
  ],
  assignments: [
    {
      id: 1,
      serverId: 'server:1',
      itemId: 'ram:1',
      type: 'ram',
      assignedAt: '2026-06-26T00:00:00.000Z',
    },
  ],
  connections: [
    {
      id: 1,
      type: 'network',
      createdAt: '2026-06-26T00:00:00.000Z',
      from: { itemId: 'server:1', portId: 1 },
      to: { itemId: 'switch:1', portId: 1 },
    },
    {
      id: 2,
      type: 'display',
      createdAt: '2026-06-26T00:00:00.000Z',
      from: { itemId: 'server:2', portId: 2 },
      to: { itemId: 'patchPanel:1', portId: 1 },
    },
  ],
}

describe('cable focus', () => {
  it('focuses selected cable endpoints', () => {
    expect(getFocusedCableItemIds(project, null, 1)).toEqual(['server:1', 'switch:1'])
  })

  it('focuses selected item and directly connected items', () => {
    expect(getFocusedCableItemIds(project, 'server:1', null)).toEqual(['server:1', 'switch:1'])
  })

  it('focuses the host when an assigned component is selected', () => {
    expect(getFocusedCableItemIds(project, 'ram:1', null)).toEqual(['server:1'])
  })

  it('does not activate canvas focus for an unassigned component', () => {
    expect(getFocusedCableItemIds(project, 'ram:2', null)).toEqual([])
  })

  it('detects whether a cable belongs to the selected item', () => {
    expect(connectionMatchesSelectedItem('server:1', 'server:1', 'switch:1')).toBe(true)
    expect(connectionMatchesSelectedItem('server:1', 'server:2', 'patchPanel:1')).toBe(false)
  })
})
