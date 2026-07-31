import { runtimeItemKey } from '@/lib/item-keys'
import { orderUpsOutletGroups } from '@/lib/power-equipment-layout'
import { powerOutletEndpoint } from '@/lib/power-endpoints'
import {
  numericSpec,
  sortedPorts,
  syntheticOutletPort,
  type StandalonePortView,
} from '@/components/standalone-canvas-equipment-model'
import type { InventoryItem, InventoryPort } from '@/types/inventory'

type UpsOutletClass = 'battery' | 'surge'

function explicitOutletClass(port: InventoryPort): UpsOutletClass | null {
  const description = `${port.label ?? ''} ${port.notes ?? ''}`.toLowerCase()

  if (description.includes('battery')) return 'battery'
  if (description.includes('surge')) return 'surge'
  return null
}

function outletView(itemId: string, port: InventoryPort, outletClass: UpsOutletClass): StandalonePortView {
  return {
    endpoint: powerOutletEndpoint(itemId, port.id),
    port,
    label: outletClass === 'battery' ? 'Battery' : 'Surge',
    detail: port.label ?? `${outletClass === 'battery' ? 'Battery-backed' : 'Surge-only'} outlet ${port.slotNumber}`,
    tone: outletClass === 'battery'
      ? 'bg-[#d7e8cf] text-[#1f3b20]'
      : 'bg-[#fff2c7] text-[#3d2a08]',
  }
}

export function upsOutletGroups(item: InventoryItem) {
  const itemId = runtimeItemKey(item)
  const batteryCount = numericSpec(item, 'batteryBackupOutlets')
  const surgeCount = numericSpec(item, 'surgeProtectedOutlets')
  const total = numericSpec(item, 'outlets') || batteryCount + surgeCount
  const ports = sortedPorts(item).filter((port) => port.type === 'ac-outlet')
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

  return orderUpsOutletGroups(item, [
    { id: 'battery', label: 'Battery-backed outlets', ports: battery },
    { id: 'surge', label: 'Surge-only outlets', ports: surge },
  ])
}
