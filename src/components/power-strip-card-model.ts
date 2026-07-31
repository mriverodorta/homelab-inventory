import { runtimeItemKey } from '@/lib/item-keys'
import {
  powerOutletEndpoint,
  powerStripPowerInputEndpoint,
  POWER_INPUT_PORT_KEY,
} from '@/lib/power-endpoints'
import {
  numericSpec,
  sortedPorts,
  syntheticOutletPort,
  type StandalonePortView,
} from '@/components/standalone-canvas-equipment-model'
import type { InventoryItem } from '@/types/inventory'

export function powerStripOutletViews(item: InventoryItem): StandalonePortView[] {
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

export function powerStripInputView(item: InventoryItem): StandalonePortView {
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
