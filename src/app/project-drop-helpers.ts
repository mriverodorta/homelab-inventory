import type { DragEndEvent } from '@dnd-kit/core'
import type { ProjectPatch } from '../../shared/engine/protocol.mjs'
import { snapToGrid, type CanvasController } from '@/components/workbench-canvas-contract'
import type {
  InventoryDependencyReason,
  InventoryDependencyReport,
  InventoryRef,
} from '@/lib/inventory-lifecycle'
import type { InventoryItem } from '@/types/inventory'

export function addedConnectionId(patch: ProjectPatch): number | null {
  if (patch.kind === 'add-connection') return patch.payload.connection.id
  if (patch.kind !== 'batch') return null

  for (const childPatch of patch.payload.patches) {
    const connectionId = addedConnectionId(childPatch)
    if (connectionId !== null) return connectionId
  }

  return null
}

export function inventoryRef(item: InventoryItem): InventoryRef {
  return { type: item.type, id: item.id }
}

export function aggregateDependencyReports(
  reports: InventoryDependencyReport[],
): InventoryDependencyReport {
  const grouped = new Map<string, InventoryDependencyReason>()

  for (const report of reports) {
    for (const reason of report.reasons) {
      const key = `${reason.kind}:${reason.message}`
      const current = grouped.get(key)
      grouped.set(key, current ? { ...current, count: current.count + reason.count } : { ...reason })
    }
  }

  const reasons = [...grouped.values()]
  return { blocked: reasons.length > 0, reasons }
}

export function parseMemorySlotOver(
  overId: string | null,
): { serverId: string; position: number } | null {
  const match = overId?.match(/^memory-slot:(.+):([0-9]+)$/)
  if (!match) return null
  const position = Number(match[2])

  return Number.isSafeInteger(position) ? { serverId: match[1], position } : null
}

export function getServerIdFromOver(overId: string | null): string | null {
  const memorySlot = parseMemorySlotOver(overId)
  if (memorySlot) return memorySlot.serverId
  if (!overId?.startsWith('server:')) return null

  return overId.replace('server:', '')
}

export function getCanvasDropPoint(
  event: DragEndEvent,
  canvasController: CanvasController | null,
  snapItemsToGrid: boolean,
) {
  const translated = event.active.rect.current.translated

  if (!translated || !canvasController) return { x: 48, y: 48 }

  const flowPoint = canvasController.screenToFlowPosition({
    x: translated.left,
    y: translated.top,
  })

  return {
    x: snapItemsToGrid ? snapToGrid(flowPoint.x) : flowPoint.x,
    y: snapItemsToGrid ? snapToGrid(flowPoint.y) : flowPoint.y,
  }
}
