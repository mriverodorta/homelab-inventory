import { describe, expect, it, vi } from 'vitest'
import type { DomainEngineClient } from '@/engine/client'
import { updateProjectPlacements } from '@/engine/placements'
import type { ProjectState } from '@/types/inventory'

function project(): ProjectState {
  return {
    id: 'default',
    revision: 7,
    metadata: { name: 'Lab', version: 1, updatedAt: '2026-07-23T00:00:00.000Z' },
    items: {
      'server:1': { id: 1, type: 'server', name: 'One' },
      'server:2': { id: 2, type: 'server', name: 'Two' },
      'server:3': { id: 3, type: 'server', name: 'Three' },
    },
    placements: [
      { serverId: 'server:1', x: 120, y: 240 },
      { serverId: 'server:2', x: 480, y: 240 },
      { serverId: 'server:3', x: 840, y: 240 },
    ],
    assignments: [],
    connections: [],
  }
}

describe('engine placement mutations', () => {
  it('sends one atomic command containing only moved placements', async () => {
    const mutate = vi.fn().mockResolvedValue({ result: { kind: 'patch' } })
    const current = project()

    await updateProjectPlacements(
      { mutate } as unknown as DomainEngineClient,
      current,
      [
        { serverId: 'server:1', x: 108, y: 240 },
        { serverId: 'server:2', x: 468, y: 240 },
        { serverId: 'server:3', x: 840, y: 240 },
      ],
    )

    expect(mutate).toHaveBeenCalledOnce()
    expect(mutate).toHaveBeenCalledWith({
      operation: {
        kind: 'update-placements',
        payload: {
          changes: [
            {
              previous: { item: { item_type: 'server', id: 1 }, x: 120, y: 240 },
              next: { item: { item_type: 'server', id: 1 }, x: 108, y: 240 },
            },
            {
              previous: { item: { item_type: 'server', id: 2 }, x: 480, y: 240 },
              next: { item: { item_type: 'server', id: 2 }, x: 468, y: 240 },
            },
          ],
        },
      },
    })
  })
})
