import { describe, expect, it } from 'vitest'
import {
  getInventoryDragPreviewPresentation,
  isInventoryDragOverCanvas,
} from '@/lib/inventory-drag-preview'

describe('inventory drag preview presentation', () => {
  it('keeps the preview readable outside the canvas', () => {
    expect(getInventoryDragPreviewPresentation(false, 0.25)).toEqual({
      scale: 1,
      transform: undefined,
      transformOrigin: 'top left',
    })
  })

  it.each([
    [0.25, 'scale(0.25)'],
    [1, undefined],
    [1.5, 'scale(1.5)'],
  ])('uses canvas zoom %s inside the canvas', (zoom, transform) => {
    expect(getInventoryDragPreviewPresentation(true, zoom)).toEqual({
      scale: zoom,
      transform,
      transformOrigin: 'top left',
    })
  })

  it.each([null, undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'falls back to scale 1 for invalid zoom %s',
    (zoom) => {
      expect(getInventoryDragPreviewPresentation(true, zoom).scale).toBe(1)
    },
  )

  it('recognizes the empty canvas and host drop targets as canvas space', () => {
    expect(isInventoryDragOverCanvas('canvas')).toBe(true)
    expect(isInventoryDragOverCanvas('server:1')).toBe(true)
    expect(isInventoryDragOverCanvas('server:nas:1')).toBe(true)
    expect(isInventoryDragOverCanvas(null)).toBe(false)
    expect(isInventoryDragOverCanvas('inventory:server:1')).toBe(false)
  })
})
