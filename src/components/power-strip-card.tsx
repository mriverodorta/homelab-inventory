import { type Node, type NodeProps } from '@xyflow/react'
import { formatInventoryCompactSpec } from '@/lib/format'
import { runtimeItemKey } from '@/lib/item-keys'
import { getPowerEquipmentOrientation } from '@/lib/power-equipment-layout'
import {
  POWER_EQUIPMENT_CARD_WIDTH,
  VERTICAL_POWER_STRIP_CARD_WIDTH,
} from '@/lib/project'
import {
  powerOutletEndpoint,
  powerStripPowerInputEndpoint,
  POWER_INPUT_PORT_KEY,
} from '@/lib/power-topology'
import {
  numericSpec,
  sortedPorts,
  StandaloneCanvasEquipmentCard,
  syntheticOutletPort,
  type StandaloneCanvasNodeData,
  type StandalonePortView,
} from './standalone-canvas-equipment-card'

export type PowerStripNodeData = StandaloneCanvasNodeData
export type PowerStripFlowNode = Node<PowerStripNodeData, 'powerStrip'>

export function powerStripOutletViews(item: Parameters<typeof sortedPorts>[0]): StandalonePortView[] {
  const itemId = runtimeItemKey(item)
  const total = numericSpec(item, 'outlets')
  const surgeProtected = item.specs?.surgeProtected === true
  const surgeCount = numericSpec(item, 'surgeProtectedOutlets')
  const ports = sortedPorts(item).filter((port) => port.type === 'ac-outlet')
  const outlets = ports.length > 0
    ? ports
    : Array.from({ length: total }, (_, index) => syntheticOutletPort(itemId, index + 1).port)
  const customNames = new Map(item.smart?.outlets.map((entry) => [entry.portId, entry.name]) ?? [])

  return outlets.map((port, index) => {
    const protectedOutlet = surgeProtected || index < surgeCount || `${port.label ?? ''} ${port.notes ?? ''}`.toLowerCase().includes('surge')
    const defaultDetail = `${protectedOutlet ? 'Surge-protected outlet' : 'Power outlet'} ${port.slotNumber}`
    const customName = customNames.get(port.id)

    return {
      endpoint: powerOutletEndpoint(itemId, port.id),
      port,
      label: protectedOutlet ? 'Surge' : 'Outlet',
      detail: customName ? `${customName} - ${defaultDetail}` : port.label ?? defaultDetail,
      tone: protectedOutlet
        ? 'bg-[#ead8f4] text-[#332047]'
        : 'bg-[#f3dfc1] text-[#3a2812]',
    }
  })
}

export function powerStripInputView(item: Parameters<typeof sortedPorts>[0]): StandalonePortView {
  const itemId = runtimeItemKey(item)
  const port = item.ports?.find(
    (candidate) => candidate.key === POWER_INPUT_PORT_KEY && candidate.type === 'ac-input',
  )
  if (!port) {
    throw new Error(`${item.name} is missing its persisted AC input port.`)
  }

  return {
    endpoint: powerStripPowerInputEndpoint(itemId, port.id),
    port,
    label: 'AC IN',
    detail: `${item.name} AC input`,
    tone: 'bg-[#d9c7b2] text-[#33261b]',
  }
}

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
