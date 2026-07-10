import { getConnectionPort } from '@/lib/project'
import { formatPortRole } from '@/lib/format'
import type {
  ConnectionEndpoint,
  InventoryConnection,
  InventoryItem,
  InventoryPort,
  ProjectState,
} from '@/types/inventory'

export const CABLE_COLORS = {
  oneGig: '#c96f2d',
  twoPointFiveGig: '#4d9a61',
  fiveGig: '#9b7bd4',
  tenGig: '#2f6fbd',
  display: '#171717',
  other: '#75695d',
} as const

export type CableAppearance = {
  color: string
  label: string
}

const NEGOTIATED_SPEED_APPEARANCES: Partial<Record<number, CableAppearance>> = {
  1000: { color: CABLE_COLORS.oneGig, label: '1G' },
  2500: { color: CABLE_COLORS.twoPointFiveGig, label: '2.5G' },
  5000: { color: CABLE_COLORS.fiveGig, label: '5G' },
  10000: { color: CABLE_COLORS.tenGig, label: '10G' },
}

function formatPortTypeLabel(type: InventoryPort['type']): string {
  if (type === 'sfp-plus') {
    return 'SFP+'
  }

  if (type === 'displayport') {
    return 'DP'
  }

  if (type === 'mini-displayport') {
    return 'MiniDP'
  }

  return type.toUpperCase()
}

function endpointSide(item: InventoryItem, endpoint: ConnectionEndpoint): string | null {
  if (!endpoint.endpointId) {
    return null
  }

  const port = item.ports?.find((candidate) => String(candidate.id) === String(endpoint.portId))
  const portEndpoint = port?.endpoints?.find((candidate) => String(candidate.id) === String(endpoint.endpointId))

  return portEndpoint?.side ?? null
}

export function getCableAppearance(
  _project: ProjectState,
  connection: InventoryConnection,
): CableAppearance {
  if (connection.type === 'display') {
    return {
      color: CABLE_COLORS.display,
      label: 'HDMI',
    }
  }

  const negotiatedSpeedMbps = connection.negotiatedSpeedMbps
  const negotiatedAppearance = negotiatedSpeedMbps
    ? NEGOTIATED_SPEED_APPEARANCES[negotiatedSpeedMbps]
    : undefined

  if (negotiatedAppearance) {
    return negotiatedAppearance
  }

  return {
    color: CABLE_COLORS.other,
    label: connection.type,
  }
}

export function describeConnectionEndpoint(
  project: ProjectState,
  endpoint: ConnectionEndpoint,
): string {
  const item = project.items[endpoint.itemId]
  const hostedItem = endpoint.hostedItemId ? project.items[endpoint.hostedItemId] : null
  const portOwner = hostedItem ?? item
  const port = getConnectionPort(project, endpoint)

  if (!item || !portOwner || !port) {
    return 'Missing port'
  }

  const slot = String(port.slotNumber).padStart(2, '0')
  const side = endpointSide(portOwner, endpoint)
  const label = port.label?.trim()
  const type = port.speed
    ? `${formatPortTypeLabel(port.type)} ${port.speed}`
    : formatPortTypeLabel(port.type)
  const portLabel = label ? (side ? `${label} ${side}` : label) : side ? `${slot} ${side}` : slot
  const role = port.role ? ` / ${formatPortRole(port.role)}` : ''
  const ownerLabel = hostedItem ? `${item.name} / ${hostedItem.name}` : item.name

  return `${ownerLabel} / ${portLabel} / ${type}${role}`
}

export function describeConnection(project: ProjectState, connection: InventoryConnection): string {
  return `${describeConnectionEndpoint(project, connection.from)} -> ${describeConnectionEndpoint(
    project,
    connection.to,
  )}`
}
