export type InventoryDragPreviewPresentation = {
  scale: number
  transform: string | undefined
  transformOrigin: 'top left'
}

export function getInventoryDragPreviewPresentation(
  overCanvas: boolean,
  viewportZoom: number | null | undefined,
): InventoryDragPreviewPresentation {
  const scale = overCanvas
    && typeof viewportZoom === 'number'
    && Number.isFinite(viewportZoom)
    && viewportZoom > 0
    ? viewportZoom
    : 1

  return {
    scale,
    transform: scale === 1 ? undefined : `scale(${scale})`,
    transformOrigin: 'top left',
  }
}

export function isInventoryDragOverCanvas(overId: string | null): boolean {
  return overId === 'canvas' || Boolean(overId?.startsWith('server:'))
}
