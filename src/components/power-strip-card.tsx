import { type Node, type NodeProps } from '@xyflow/react'
import { PlugZap } from 'lucide-react'
import { formatInventoryCompactSpec } from '@/lib/format'
import { runtimeItemKey } from '@/lib/item-keys'
import {
  powerOutletEndpoint,
  powerStripPowerInputEndpoint,
  POWER_INPUT_PORT_ID,
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
  const ports = sortedPorts(item)
  const outlets = ports.length > 0
    ? ports
    : Array.from({ length: total }, (_, index) => syntheticOutletPort(itemId, index + 1).port)

  return outlets.map((port, index) => {
    const protectedOutlet = surgeProtected || index < surgeCount || `${port.label ?? ''} ${port.notes ?? ''}`.toLowerCase().includes('surge')

    return {
      endpoint: powerOutletEndpoint(itemId, port.slotNumber),
      port,
      label: protectedOutlet ? 'Surge' : 'Outlet',
      detail: port.label ?? `${protectedOutlet ? 'Surge-protected outlet' : 'Power outlet'} ${port.slotNumber}`,
      tone: protectedOutlet
        ? 'bg-[#ead8f4] text-[#332047]'
        : 'bg-[#f3dfc1] text-[#3a2812]',
    }
  })
}

export function powerStripInputView(item: Parameters<typeof sortedPorts>[0]): StandalonePortView {
  const itemId = runtimeItemKey(item)

  return {
    endpoint: powerStripPowerInputEndpoint(itemId),
    port: {
      id: POWER_INPUT_PORT_ID,
      kind: 'server-port',
      type: 'barrel',
      slotNumber: 1,
    },
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

  return (
    <StandaloneCanvasEquipmentCard
      {...data}
      item={item}
      icon={<PlugZap className="size-5" />}
      eyebrow="Power strip"
      accentClassName="bg-[#453a4d]"
      summary={formatInventoryCompactSpec(item) ?? undefined}
      groups={[
        { id: 'input', label: 'Power input', ports: [powerStripInputView(item)] },
        { id: 'outlets', label: 'Power outlets', ports: powerStripOutletViews(item) },
      ]}
      width={420}
    />
  )
}
