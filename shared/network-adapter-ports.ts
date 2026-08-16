import type { InventoryPort, InventoryPortType } from '../src/types/inventory'

export type NetworkPortNegotiation = {
  mode: string
  speedBps: number
}

const RADIO_TECHNOLOGIES = new Set(['wifi', 'cellular'])
const PHYSICAL_NETWORK_CONNECTORS = new Set<InventoryPortType>([
  'rj45', 'sfp', 'sfp-plus', 'sfp28', 'qsfp', 'qsfp-plus', 'qsfp28',
  'qsfp56', 'qsfp-dd', 'osfp', 'fc', 'infiniband',
])
const NETWORK_CONNECTOR_FAMILIES: ReadonlyArray<ReadonlySet<InventoryPortType>> = [
  new Set(['sfp', 'sfp-plus', 'sfp28']),
  new Set(['qsfp', 'qsfp-plus', 'qsfp28', 'qsfp56', 'qsfp-dd']),
]

function normalizedValues(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim().toLocaleLowerCase('en-US')).filter(Boolean))]
}

function portModes(port: InventoryPort): string[] {
  const explicit = normalizedValues(port.operatingModes)
  if (explicit.length > 0) return explicit
  return port.networkTechnology ? [port.networkTechnology] : ['ethernet']
}

function legacySpeedBps(speed: string | undefined): number | undefined {
  if (!speed) return undefined
  const normalized = speed.trim().toUpperCase()
  const match = normalized.match(/^(\d+(?:\.\d+)?)\s*([GM])(?:BPS|BE|B\/S)?$/)
  if (!match) return undefined
  const value = Number(match[1]) * (match[2] === 'G' ? 1_000_000_000 : 1_000_000)
  return Number.isSafeInteger(value) && value > 0 ? value : undefined
}

function legacyCompatibleSpeeds(type: InventoryPortType, maximum: number): number[] {
  const family = type === 'rj45'
    ? [1_000_000_000, 2_500_000_000, 5_000_000_000, 10_000_000_000]
    : type === 'sfp' ? [1_000_000_000]
      : type === 'sfp-plus' ? [1_000_000_000, 10_000_000_000]
        : type === 'sfp28' ? [1_000_000_000, 10_000_000_000, 25_000_000_000]
          : [maximum]
  return family.filter((speed) => speed <= maximum)
}

export function supportedNetworkPortSpeedsBps(port: InventoryPort): number[] {
  const legacyMaximum = legacySpeedBps(port.speed)
  const legacySpeeds = port.supportedSpeedsBps?.length || port.speedBps || !legacyMaximum
    ? []
    : legacyCompatibleSpeeds(port.type, legacyMaximum)
  const speeds = [
    ...(port.supportedSpeedsBps ?? []),
    port.speedBps,
    ...legacySpeeds,
  ].filter((value): value is number => Number.isSafeInteger(value) && Number(value) > 0)
  return [...new Set(speeds)].sort((first, second) => first - second)
}

export function areNetworkConnectorsCompatible(
  first: InventoryPortType,
  second: InventoryPortType,
): boolean {
  if (first === second) return true
  return NETWORK_CONNECTOR_FAMILIES.some((family) => family.has(first) && family.has(second))
}

export function isPhysicalNetworkAdapterPort(port: InventoryPort): boolean {
  if (port.kind !== 'network' && port.kind !== 'server-port' && port.kind !== 'switch-port' && port.kind !== 'keystone') {
    return false
  }
  return PHYSICAL_NETWORK_CONNECTORS.has(port.type)
    && !RADIO_TECHNOLOGIES.has(port.networkTechnology ?? '')
}

export function physicalNetworkAdapterPorts(ports: InventoryPort[] | undefined): InventoryPort[] {
  return (ports ?? []).filter(isPhysicalNetworkAdapterPort)
}

export function negotiateNetworkConnection(
  first: InventoryPort,
  second: InventoryPort,
): NetworkPortNegotiation | null {
  if (!isPhysicalNetworkAdapterPort(first) || !isPhysicalNetworkAdapterPort(second)) return null
  if (!areNetworkConnectorsCompatible(first.type, second.type)) return null

  const secondModes = new Set(portModes(second))
  const mode = portModes(first).find((candidate) => secondModes.has(candidate))
  if (!mode) return null

  const secondSpeeds = new Set(supportedNetworkPortSpeedsBps(second))
  const speedBps = supportedNetworkPortSpeedsBps(first)
    .filter((candidate) => secondSpeeds.has(candidate))
    .at(-1)
  return speedBps ? { mode, speedBps } : null
}

export function negotiateNetworkPath(ports: InventoryPort[]): NetworkPortNegotiation | null {
  if (ports.length === 0 || ports.some((port) => !isPhysicalNetworkAdapterPort(port))) return null
  const [first, ...rest] = ports
  if (rest.some((port) => !areNetworkConnectorsCompatible(first.type, port.type))) return null

  const sharedModes = portModes(first).filter((mode) => rest.every((port) => portModes(port).includes(mode)))
  if (sharedModes.length === 0) return null

  const speedSets = rest.map((port) => new Set(supportedNetworkPortSpeedsBps(port)))
  const speedBps = supportedNetworkPortSpeedsBps(first)
    .filter((speed) => speedSets.every((candidates) => candidates.has(speed)))
    .at(-1)
  return speedBps ? { mode: sharedModes[0], speedBps } : null
}
