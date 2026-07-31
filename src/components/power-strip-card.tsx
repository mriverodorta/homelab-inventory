import { type Node, type NodeProps } from '@xyflow/react'
import { formatInventoryCompactSpec } from '@/lib/format'
import { getPowerEquipmentOrientation } from '@/lib/power-equipment-layout'
import {
  POWER_EQUIPMENT_CARD_WIDTH,
  VERTICAL_POWER_STRIP_CARD_WIDTH,
} from '@/lib/project'
import { StandaloneCanvasEquipmentCard } from './standalone-canvas-equipment-card'
import type { StandaloneCanvasNodeData } from './standalone-canvas-equipment-model'
import { powerStripInputView, powerStripOutletViews } from './power-strip-card-model'

export type PowerStripNodeData = StandaloneCanvasNodeData
export type PowerStripFlowNode = Node<PowerStripNodeData, 'powerStrip'>

export function PowerStripNode({ data }: NodeProps<PowerStripFlowNode>) {
  const item = data.project.items[data.itemId]

  if (!item || item.type !== 'powerStrip') {
    return null
  }

  const orientation = getPowerEquipmentOrientation(item)

  return (
    <StandaloneCanvasEquipmentCard
      {...data}
      item={item}
      headerPort={powerStripInputView(item)}
      eyebrow="Power strip"
      accentClassName="bg-[#453a4d]"
      summary={formatInventoryCompactSpec(item) ?? undefined}
      subtitle={item.smart?.displayName?.trim() || undefined}
      groups={[
        { id: 'outlets', label: 'Power outlets', ports: powerStripOutletViews(item) },
      ]}
      orientation={orientation}
      width={orientation === 'vertical'
        ? VERTICAL_POWER_STRIP_CARD_WIDTH
        : POWER_EQUIPMENT_CARD_WIDTH}
    />
  )
}
