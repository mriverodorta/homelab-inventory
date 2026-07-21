import { type Node, type NodeProps } from '@xyflow/react'
import { Monitor } from 'lucide-react'
import { formatInventoryCompactSpec } from '@/lib/format'
import { monitorPowerInputEndpoint, POWER_INPUT_PORT_KEY } from '@/lib/power-topology'
import type { InventoryPort } from '@/types/inventory'
import {
  sortedPorts,
  StandaloneCanvasEquipmentCard,
  type StandaloneCanvasNodeData,
  type StandalonePortView,
} from './standalone-canvas-equipment-card'

export type MonitorNodeData = StandaloneCanvasNodeData
export type MonitorFlowNode = Node<MonitorNodeData, 'monitor'>

function monitorPortView(port: InventoryPort): StandalonePortView {
  const label = port.type === 'displayport'
      ? 'DP'
      : port.type === 'mini-displayport'
        ? 'mDP'
        : port.type.toUpperCase()

  return {
    port,
    label,
    detail: port.label ?? `${label} ${String(port.slotNumber).padStart(2, '0')}`,
    tone: 'bg-[#d8ddf4] text-[#1b2448]',
  }
}

export function MonitorNode({ data }: NodeProps<MonitorFlowNode>) {
  const item = data.project.items[data.itemId]

  if (!item || item.type !== 'monitor') {
    return null
  }

  const ports = sortedPorts(item).filter((port) => port.type !== 'ac-input').map(monitorPortView)
  const powerPort = item.ports?.find(
    (port) => port.key === POWER_INPUT_PORT_KEY && port.type === 'ac-input',
  )
  if (!powerPort) return null
  const powerEndpoint = monitorPowerInputEndpoint(data.itemId, powerPort.id)
  const power: StandalonePortView = {
    endpoint: powerEndpoint,
    port: powerPort,
    label: 'AC',
    detail: 'AC input',
    tone: 'bg-[#f3dfc1] text-[#3a2812]',
  }

  return (
    <StandaloneCanvasEquipmentCard
      {...data}
      item={item}
      icon={<Monitor className="size-5" />}
      eyebrow="Monitor"
      accentClassName="bg-[#354154]"
      summary={formatInventoryCompactSpec(item) ?? undefined}
      groups={[
        { id: 'display', label: 'Display inputs', ports },
        { id: 'power', label: 'Power', ports: [power] },
      ]}
    />
  )
}
