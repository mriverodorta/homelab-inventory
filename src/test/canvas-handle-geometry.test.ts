import { describe, expect, it } from 'vitest'
import {
  canvasHandleGeometryEqual,
  normalizeCanvasHandleGeometry,
  reconcileCanvasHandleGeometry,
  type MeasuredHandleNode,
} from '@/lib/canvas-handle-geometry'

function node(id: string, handleId: string): MeasuredHandleNode {
  return {
    id,
    internals: {
      handleBounds: {
        source: [{ id: handleId, position: 'right', x: 100, y: 20, width: 8, height: 8 }],
        target: [{ id: handleId, position: 'left', x: 0, y: 20, width: 8, height: 8 }],
      },
    },
  }
}

describe('canvas handle geometry', () => {
  it('normalizes nodes and handles deterministically', () => {
    const result = normalizeCanvasHandleGeometry([node('node:2', 'port:2'), node('node:1', 'port:1')])

    expect(result.map((entry) => entry.nodeId)).toEqual(['node:1', 'node:2'])
    expect(result[0].source[0]).toEqual({
      id: 'port:1',
      position: 'right',
      x: 100,
      y: 20,
      width: 8,
      height: 8,
    })
  })

  it('treats equivalent geometry as equal regardless of source iteration order', () => {
    const first = normalizeCanvasHandleGeometry([node('node:1', 'port:1'), node('node:2', 'port:2')])
    const second = normalizeCanvasHandleGeometry([node('node:2', 'port:2'), node('node:1', 'port:1')])

    expect(canvasHandleGeometryEqual(first, second)).toBe(true)
  })

  it('detects actual handle geometry changes', () => {
    const firstNode = node('node:1', 'port:1')
    const secondNode = node('node:1', 'port:1')
    secondNode.internals.handleBounds!.source![0].x = 112

    expect(canvasHandleGeometryEqual(
      normalizeCanvasHandleGeometry([firstNode]),
      normalizeCanvasHandleGeometry([secondNode]),
    )).toBe(false)
  })

  it('keeps the current geometry when React Flow briefly drops a required handle', () => {
    const current = normalizeCanvasHandleGeometry([node('node:1', 'port:1')])
    const incomplete = normalizeCanvasHandleGeometry([{
      id: 'node:1',
      internals: { handleBounds: { source: [], target: [] } },
    }])
    const requiredHandles = new Map([
      ['node:1', new Set(['port:1'])],
    ])

    expect(reconcileCanvasHandleGeometry(current, incomplete, requiredHandles)).toBe(current)
  })

  it('accepts complete geometry changes and preserves equivalent geometry identity', () => {
    const current = normalizeCanvasHandleGeometry([node('node:1', 'port:1')])
    const equivalent = normalizeCanvasHandleGeometry([node('node:1', 'port:1')])
    const movedNode = node('node:1', 'port:1')
    movedNode.internals.handleBounds!.source![0].x = 124
    const moved = normalizeCanvasHandleGeometry([movedNode])
    const requiredHandles = new Map([
      ['node:1', new Set(['port:1'])],
    ])

    expect(reconcileCanvasHandleGeometry(current, equivalent, requiredHandles)).toBe(current)
    const reconciled = reconcileCanvasHandleGeometry(current, moved, requiredHandles)
    expect(reconciled).not.toBe(current)
    expect(reconciled).toEqual(moved)
  })
})
