import type { ConnectionEndpoint } from '@/types/inventory'

export const POWER_INPUT_PORT_KEY = 'ac-input'

export function powerOutletEndpoint(itemId: string, portId: number): ConnectionEndpoint {
  return { itemId, portId }
}

export function monitorPowerInputEndpoint(itemId: string, portId = 1): ConnectionEndpoint {
  return { itemId, portId }
}

export function powerStripPowerInputEndpoint(itemId: string, portId = 1): ConnectionEndpoint {
  return { itemId, portId }
}
