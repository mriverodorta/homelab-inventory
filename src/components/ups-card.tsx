import { type Node, type NodeProps } from '@xyflow/react'
import { BatteryCharging } from 'lucide-react'
import { formatInventoryCompactSpec } from '@/lib/format'
import {
  getPowerEquipmentOrientation,
} from '@/lib/power-equipment-layout'
import {
  POWER_EQUIPMENT_CARD_WIDTH,
  VERTICAL_UPS_CARD_WIDTH,
} from '@/lib/project'
import { StandaloneCanvasEquipmentCard } from './standalone-canvas-equipment-card'
import type { StandaloneCanvasNodeData } from './standalone-canvas-equipment-model'
import { upsOutletGroups } from './ups-card-model'

export type UpsNodeData = StandaloneCanvasNodeData
export type UpsFlowNode = Node<UpsNodeData, 'ups'>

export function UpsNode({ data }: NodeProps<UpsFlowNode>) {
  const item = data.project.items[data.itemId]

  if (!item || item.type !== 'ups') {
    return null
  }

  const orientation = getPowerEquipmentOrientation(item)

  return (
    <StandaloneCanvasEquipmentCard
      {...data}
      item={item}
      icon={<BatteryCharging className="size-5" />}
      eyebrow="UPS"
      accentClassName="bg-[#33473f]"
      summary={formatInventoryCompactSpec(item) ?? undefined}
      groups={upsOutletGroups(item)}
      orientation={orientation}
      width={orientation === 'vertical' ? VERTICAL_UPS_CARD_WIDTH : POWER_EQUIPMENT_CARD_WIDTH}
    />
  )
}
