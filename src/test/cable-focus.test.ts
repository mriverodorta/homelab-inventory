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
    'server-a': { id: 'server-a', name: 'Server A', type: 'server' },
    'server-b': { id: 'server-b', name: 'Server B', type: 'server' },
    'switch-a': { id: 'switch-a', name: 'Switch A', type: 'switch' },
    'patch-a': { id: 'patch-a', name: 'Patch A', type: 'patchPanel' },
    'ram-a': { id: 'ram-a', name: 'RAM A', type: 'ram' },
    'ram-b': { id: 'ram-b', name: 'RAM B', type: 'ram' },
  },
  placements: [
    { serverId: 'server-a', x: 0, y: 0 },
    { serverId: 'server-b', x: 320, y: 0 },
    { serverId: 'switch-a', x: 0, y: 320 },
    { serverId: 'patch-a', x: 320, y: 320 },
  ],
  assignments: [
    {
      id: 'server-a:ram-a',
      serverId: 'server-a',
      itemId: 'ram-a',
      type: 'ram',
      assignedAt: '2026-06-26T00:00:00.000Z',
    },
  ],
  connections: [
    {
      id: 'conn-a',
      type: 'network',
      createdAt: '2026-06-26T00:00:00.000Z',
      from: { itemId: 'server-a', portId: 'lan-01' },
      to: { itemId: 'switch-a', portId: 'rj45-01' },
    },
    {
      id: 'conn-b',
      type: 'display',
      createdAt: '2026-06-26T00:00:00.000Z',
      from: { itemId: 'server-b', portId: 'dp-01' },
      to: { itemId: 'patch-a', portId: 'hdmi-01' },
    },
  ],
}

describe('cable focus', () => {
  it('focuses selected cable endpoints', () => {
    expect(getFocusedCableItemIds(project, null, 'conn-a')).toEqual(['server-a', 'switch-a'])
  })

  it('focuses selected item and directly connected items', () => {
    expect(getFocusedCableItemIds(project, 'server-a', null)).toEqual(['server-a', 'switch-a'])
  })

  it('focuses the host when an assigned component is selected', () => {
    expect(getFocusedCableItemIds(project, 'ram-a', null)).toEqual(['server-a'])
  })

  it('does not activate canvas focus for an unassigned component', () => {
    expect(getFocusedCableItemIds(project, 'ram-b', null)).toEqual([])
  })

  it('detects whether a cable belongs to the selected item', () => {
    expect(connectionMatchesSelectedItem('server-a', 'server-a', 'switch-a')).toBe(true)
    expect(connectionMatchesSelectedItem('server-a', 'server-b', 'patch-a')).toBe(false)
  })
})
