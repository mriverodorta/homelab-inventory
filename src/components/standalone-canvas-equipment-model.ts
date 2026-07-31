import type { CanvasProjectIndex } from '@/lib/canvas-project-index'
import type { PowerEquipmentOrientation } from '@/lib/power-equipment-layout'
import { powerOutletEndpoint } from '@/lib/power-endpoints'
import type { CanvasPortDragPoint } from '@/types/canvas'
import type { ConnectionEndpoint, InventoryItem, InventoryPort, ProjectState } from '@/types/inventory'

export type StandaloneCanvasNodeData = {
  project: ProjectState
  registryLinkedItemKeys?: ReadonlySet<string>
  canvasIndex: CanvasProjectIndex
  requiredHandleIds: ReadonlySet<string>
  itemId: string
  selectedItemId: string | null
  focusedItemIds: string[]
  focusActive: boolean
  spotlightItemId: string | null
  pendingEndpoint: ConnectionEndpoint | null
  draggingEndpoint: ConnectionEndpoint | null
  onSelect: (itemId: string) => void
  onEndpointClick: (endpoint: ConnectionEndpoint, point: CanvasPortDragPoint) => void
  onEndpointDragStart: (endpoint: ConnectionEndpoint, point: CanvasPortDragPoint) => void
  onEndpointDrop: (endpoint: ConnectionEndpoint) => void
}

export type StandalonePortView = {
  port: InventoryPort
  endpoint?: ConnectionEndpoint
  label: string
  detail?: string
  tone: string
}

export type StandalonePortGroup = {
  id: string
  label: string
  ports: StandalonePortView[]
}

export type StandaloneCanvasEquipmentModel = StandaloneCanvasNodeData & {
  accentClassName: string
  eyebrow: string
  groups: StandalonePortGroup[]
  headerPort?: StandalonePortView
  item: InventoryItem
  orientation?: PowerEquipmentOrientation
  summary?: string
  subtitle?: string
  width?: number
}

export function sortedPorts(item: InventoryItem): InventoryPort[] {
  return [...(item.ports ?? [])].sort((first, second) => first.slotNumber - second.slotNumber)
}

export function numericSpec(item: InventoryItem, key: string): number {
  const value = Number(item.specs?.[key])
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

export function syntheticOutletPort(itemId: string, slotNumber: number): StandalonePortView {
  const endpoint = powerOutletEndpoint(itemId, slotNumber)

  return {
    endpoint,
    port: {
      id: endpoint.portId,
      kind: 'power-port',
      type: 'ac-outlet',
      slotNumber,
    },
    label: 'Outlet',
    tone: 'bg-[#f3dfc1] text-[#3a2812]',
  }
}
