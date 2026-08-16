import { describe, expect, it } from 'vitest'
import {
  areNetworkConnectorsCompatible,
  isPhysicalNetworkAdapterPort,
  negotiateNetworkConnection,
  negotiateNetworkPath,
  physicalNetworkAdapterPorts,
  supportedNetworkPortSpeedsBps,
} from '@/lib/network-adapter-ports'
import type { InventoryPort } from '@/types/inventory'

function port(overrides: Partial<InventoryPort> = {}): InventoryPort {
  return {
    id: 1,
    kind: 'network',
    type: 'sfp-plus',
    slotNumber: 1,
    networkTechnology: 'ethernet',
    operatingModes: ['ethernet'],
    supportedSpeedsBps: [1_000_000_000, 10_000_000_000],
    ...overrides,
  }
}

describe('network adapter ports', () => {
  it('negotiates the greatest shared speed and mode', () => {
    expect(negotiateNetworkConnection(
      port({ operatingModes: ['ethernet', 'fibre-channel'] }),
      port({ type: 'sfp28', operatingModes: ['ethernet'], supportedSpeedsBps: [1_000_000_000, 10_000_000_000, 25_000_000_000] }),
    )).toEqual({ mode: 'ethernet', speedBps: 10_000_000_000 })
  })

  it('rejects connector and operating-mode mismatches', () => {
    expect(negotiateNetworkConnection(port(), port({ type: 'rj45' }))).toBeNull()
    expect(negotiateNetworkConnection(port(), port({ operatingModes: ['fibre-channel'] }))).toBeNull()
  })

  it('does not turn radio PHY rates into physical cable endpoints', () => {
    const radio = port({ networkTechnology: 'wifi', supportedSpeedsBps: [2_400_000_000] })
    expect(isPhysicalNetworkAdapterPort(radio)).toBe(false)
    expect(physicalNetworkAdapterPorts([radio])).toEqual([])
    expect(negotiateNetworkConnection(radio, port())).toBeNull()
  })

  it('negotiates all active endpoints across a passive path', () => {
    expect(negotiateNetworkPath([
      port(),
      port({ type: 'sfp28', supportedSpeedsBps: [10_000_000_000, 25_000_000_000] }),
    ])).toEqual({ mode: 'ethernet', speedBps: 10_000_000_000 })
  })

  it('accepts canonical and legacy singleton speed boundaries', () => {
    expect(supportedNetworkPortSpeedsBps(port({ supportedSpeedsBps: undefined, speedBps: 2_500_000_000 }))).toEqual([2_500_000_000])
    expect(supportedNetworkPortSpeedsBps(port({ type: 'rj45', supportedSpeedsBps: undefined, speedBps: undefined, speed: '2.5G' }))).toEqual([1_000_000_000, 2_500_000_000])
  })

  it('recognizes compatible pluggable connector families', () => {
    expect(areNetworkConnectorsCompatible('sfp', 'sfp28')).toBe(true)
    expect(areNetworkConnectorsCompatible('qsfp-plus', 'qsfp-dd')).toBe(true)
    expect(areNetworkConnectorsCompatible('sfp-plus', 'qsfp-plus')).toBe(false)
  })
})
