import type { InventoryPortType } from '@/types/inventory'

export const SWITCH_NETWORK_PORT_TYPES = new Set<InventoryPortType>([
  'rj45',
  'sfp',
  'sfp-plus',
])

export const SUPPORTED_SWITCH_PORT_SPEEDS = ['1G', '2.5G', '5G', '10G'] as const

export type SupportedSwitchPortSpeed = (typeof SUPPORTED_SWITCH_PORT_SPEEDS)[number]

export function defaultSwitchPortSpeed(
  type: InventoryPortType,
): SupportedSwitchPortSpeed | null {
  if (type === 'sfp-plus') return '10G'
  if (type === 'rj45' || type === 'sfp') return '1G'
  return null
}
