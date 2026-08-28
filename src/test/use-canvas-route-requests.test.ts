import { describe, expect, it } from 'vitest'
import { collectMeasuredNodeSizes } from '@/components/canvas/use-canvas-route-requests'

describe('collectMeasuredNodeSizes', () => {
  it('retains only measured node geometry as typed, rounded tuples', () => {
    expect(collectMeasuredNodeSizes([
      { id: 'server:7', position: { x: 0, y: 0 }, data: {}, measured: { width: 320.2, height: 180.01 } },
      { id: 'nas:2', position: { x: 0, y: 0 }, data: {} },
      { id: 'switch:4', position: { x: 0, y: 0 }, data: {}, measured: { width: 0, height: 80 } },
    ])).toEqual([
      ['server:7', 321, 181],
    ])
  })
})
