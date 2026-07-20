import { type Node, type NodeProps } from '@xyflow/react'
import { BatteryCharging } from 'lucide-react'
import { formatInventoryCompactSpec } from '@/lib/format'
import { runtimeItemKey } from '@/lib/item-keys'
import { powerOutletEndpoint } from '@/lib/power-topology'
import type { InventoryPort } from '@/types/inventory'
import {
  numericSpec,
  sortedPorts,
  StandaloneCanvasEquipmentCard,
  syntheticOutletPort,
  type StandaloneCanvasNodeData,
  type StandalonePortView,
} from './standalone-canvas-equipment-card'

export type UpsNodeData = StandaloneCanvasNodeData
export type UpsFlowNode = Node<UpsNodeData, 'ups'>

type UpsOutletClass = 'battery' | 'surge'

function explicitOutletClass(port: InventoryPort): UpsOutletClass | null {
  const description = `${port.label ?? ''} ${port.notes ?? ''}`.toLowerCase()

  if (description.includes('battery')) return 'battery'
  if (description.includes('surge')) return 'surge'
  return null
}

function outletView(itemId: string, port: InventoryPort, outletClass: UpsOutletClass): StandalonePortView {
  return {
    endpoint: powerOutletEndpoint(itemId, port.slotNumber),
    port,
    label: outletClass === 'battery' ? 'Battery' : 'Surge',
    detail: port.label ?? `${outletClass === 'battery' ? 'Battery-backed' : 'Surge-only'} outlet ${port.slotNumber}`,
    tone: outletClass === 'battery'
      ? 'bg-[#d7e8cf] text-[#1f3b20]'
      : 'bg-[#fff2c7] text-[#3d2a08]',
  }
}

export function upsOutletGroups(item: Parameters<typeof sortedPorts>[0]) {
  const itemId = runtimeItemKey(item)
  const batteryCount = numericSpec(item, 'batteryBackupOutlets')
  const surgeCount = numericSpec(item, 'surgeProtectedOutlets')
  const total = numericSpec(item, 'outlets') || batteryCount + surgeCount
  const ports = sortedPorts(item)
  const outlets = ports.length > 0
    ? ports
    : Array.from({ length: total }, (_, index) => syntheticOutletPort(itemId, index + 1).port)

  const battery: StandalonePortView[] = []
  const surge: StandalonePortView[] = []

  outlets.forEach((port, index) => {
    const explicit = explicitOutletClass(port)
    const outletClass = explicit ?? (index < batteryCount ? 'battery' : 'surge')
    const target = outletClass === 'battery' ? battery : surge
    target.push(outletView(itemId, port, outletClass))
  })

  return [
    { id: 'battery', label: 'Battery-backed outlets', ports: battery },
    { id: 'surge', label: 'Surge-only outlets', ports: surge },
  ]
}

export function UpsNode({ data }: NodeProps<UpsFlowNode>) {
  const item = data.project.items[data.itemId]

  if (!item || item.type !== 'ups') {
    return null
  }

  return (
    <StandaloneCanvasEquipmentCard
      {...data}
      item={item}
      icon={<BatteryCharging className="size-5" />}
      eyebrow="UPS"
      accentClassName="bg-[#33473f]"
      summary={formatInventoryCompactSpec(item) ?? undefined}
      groups={upsOutletGroups(item)}
      width={420}
    />
  )
}
