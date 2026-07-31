import { describe, expect, it } from 'vitest'
import {
  reconcileFlowNodes,
  type WorkbenchFlowNode,
} from '@/components/canvas/flow-reconciliation'

function makeNode({
  id,
  x,
  selected,
}: {
  id: string
  x: number
  selected?: boolean
}): WorkbenchFlowNode {
  return {
    id,
    type: 'equipment',
    position: { x, y: 24 },
    zIndex: 1,
    dragHandle: '.server-node-drag-handle',
    selected,
    data: {
      itemId: id,
      requiredHandleIds: ['port:1'],
    },
  } as unknown as WorkbenchFlowNode
}

describe('reconcileFlowNodes', () => {
  it('preserves the outer array when canonical nodes are unchanged', () => {
    const currentNodes = [makeNode({ id: 'switch:1', x: 48, selected: true })]
    const nextNodes = [makeNode({ id: 'switch:1', x: 48 })]

    const result = reconcileFlowNodes(currentNodes, nextNodes)

    expect(result).toBe(currentNodes)
    expect(result[0]).toBe(currentNodes[0])
    expect(result[0].selected).toBe(true)
  })

  it('replaces only changed canonical nodes', () => {
    const currentNodes = [
      makeNode({ id: 'switch:1', x: 48 }),
      makeNode({ id: 'server:1', x: 96, selected: true }),
    ]
    const nextNodes = [
      makeNode({ id: 'switch:1', x: 72 }),
      makeNode({ id: 'server:1', x: 96 }),
    ]

    const result = reconcileFlowNodes(currentNodes, nextNodes)

    expect(result).not.toBe(currentNodes)
    expect(result[0]).not.toBe(currentNodes[0])
    expect(result[0].position.x).toBe(72)
    expect(result[1]).toBe(currentNodes[1])
    expect(result[1].selected).toBe(true)
  })

  it('returns a new sequence when canonical node order changes', () => {
    const firstNode = makeNode({ id: 'switch:1', x: 48 })
    const secondNode = makeNode({ id: 'server:1', x: 96 })
    const currentNodes = [firstNode, secondNode]

    const result = reconcileFlowNodes(currentNodes, [
      makeNode({ id: 'server:1', x: 96 }),
      makeNode({ id: 'switch:1', x: 48 }),
    ])

    expect(result).not.toBe(currentNodes)
    expect(result).toEqual([secondNode, firstNode])
  })
})
