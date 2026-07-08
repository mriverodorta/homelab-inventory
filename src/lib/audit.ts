import {
  connectionEndpointAvailable,
  endpointKey,
  getConnectionPort,
} from '@/lib/project'
import { runtimeItemKey } from '@/lib/item-keys'
import { getItemNetworkTraces } from '@/lib/network-trace'
import type {
  ConnectionEndpoint,
  InventoryItem,
  InventoryPort,
  ProjectState,
} from '@/types/inventory'

export type AuditWarning = {
  id: string
  itemId: string
  message: string
}

export type ProjectAuditGroup = {
  item: InventoryItem
  warnings: AuditWarning[]
}

function portSlot(port: InventoryPort): string {
  return String(port.slotNumber).padStart(2, '0')
}

function isEndpointConnected(project: ProjectState, endpoint: ConnectionEndpoint): boolean {
  return !connectionEndpointAvailable(project, endpoint)
}

function endpointForPort(item: InventoryItem, port: InventoryPort): ConnectionEndpoint {
  return {
    itemId: runtimeItemKey(item),
    portId: port.id,
  }
}

function endpointForPortSide(
  item: InventoryItem,
  port: InventoryPort,
  endpointId: string | number,
): ConnectionEndpoint {
  return {
    itemId: runtimeItemKey(item),
    portId: port.id,
    endpointId,
  }
}

function getPortEndpoints(item: InventoryItem, port: InventoryPort): ConnectionEndpoint[] {
  if (port.endpoints && port.endpoints.length > 0) {
    return port.endpoints.map((endpoint) => endpointForPortSide(item, port, endpoint.id))
  }

  return [endpointForPort(item, port)]
}

function getConnectedPortEndpoints(
  project: ProjectState,
  item: InventoryItem,
  port: InventoryPort,
): ConnectionEndpoint[] {
  return getPortEndpoints(item, port).filter((endpoint) => isEndpointConnected(project, endpoint))
}

function isPortConnected(project: ProjectState, item: InventoryItem, port: InventoryPort): boolean {
  return getConnectedPortEndpoints(project, item, port).length > 0
}

function getStaleConnectionWarnings(project: ProjectState, item: InventoryItem): AuditWarning[] {
  const key = runtimeItemKey(item)

  return (project.connections ?? []).flatMap((connection) =>
    [connection.from, connection.to].flatMap((endpoint) => {
      if (endpoint.itemId !== key || getConnectionPort(project, endpoint)) {
        return []
      }

      return [
        {
          id: `stale-${connection.id}-${endpointKey(endpoint)}`,
          itemId: key,
          message: 'Saved connection points to a port that no longer exists.',
        },
      ]
    }),
  )
}

function getDisabledSwitchPortTraceWarning(
  project: ProjectState,
  trace: ReturnType<typeof getItemNetworkTraces>[number],
): AuditWarning | null {
  const startPort = getConnectionPort(project, trace.start)

  if (!startPort || !isEndpointConnected(project, trace.start)) {
    return null
  }

  const disabledSwitchStep = trace.steps.find((step) => {
    const stepItem = project.items[step.endpoint.itemId]
    const stepPort = getConnectionPort(project, step.endpoint)

    return stepItem?.type === 'switch' && stepPort?.role === 'disabled'
  })

  if (!disabledSwitchStep) {
    return null
  }

  const switchItem = project.items[disabledSwitchStep.endpoint.itemId]
  const switchPort = getConnectionPort(project, disabledSwitchStep.endpoint)

  if (!switchItem || !switchPort) {
    return null
  }

  return {
    id: `server-network-disabled-switch-${startPort.id}`,
    itemId: trace.start.itemId,
    message: `LAN port ${portSlot(startPort)} traces to disabled switch port ${portSlot(switchPort)} on ${switchItem.name}.`,
  }
}

function getServerAuditWarnings(project: ProjectState, item: InventoryItem): AuditWarning[] {
  const warnings: AuditWarning[] = []
  const key = runtimeItemKey(item)

  for (const trace of getItemNetworkTraces(project, item)) {
    const startPort = getConnectionPort(project, trace.start)
    const disabledSwitchWarning = getDisabledSwitchPortTraceWarning(project, trace)

    if (!trace.complete && startPort && isEndpointConnected(project, trace.start)) {
      warnings.push({
        id: `server-network-path-incomplete-${startPort.id}`,
        itemId: key,
        message: `LAN port ${portSlot(startPort)} does not trace to a switch.`,
      })
    }

    if (disabledSwitchWarning) {
      warnings.push(disabledSwitchWarning)
    }
  }

  return warnings
}

function getSwitchAuditWarnings(project: ProjectState, item: InventoryItem): AuditWarning[] {
  const ports = item.ports ?? []
  const key = runtimeItemKey(item)

  if (ports.length === 0) {
    return []
  }

  const warnings: AuditWarning[] = []
  const connectedPorts = ports.filter((port) => isPortConnected(project, item, port))
  const hasConnectedPort = connectedPorts.length > 0

  if (!hasConnectedPort) {
    return []
  }

  for (const port of connectedPorts) {
    if (port.role !== 'disabled') {
      continue
    }

    warnings.push({
      id: `switch-disabled-port-connected-${port.id}`,
      itemId: key,
      message: `Switch port ${portSlot(port)} is disabled but connected.`,
    })
  }

  const hasUplinkOrTrunk = ports.some((port) => port.role === 'uplink' || port.role === 'trunk')

  if (!hasUplinkOrTrunk) {
    warnings.push({
      id: `switch-no-uplink-trunk-${item.id}`,
      itemId: key,
      message: 'Switch has active connections but no uplink or trunk port marked.',
    })
  }

  return warnings
}

export function getItemAuditWarnings(project: ProjectState, itemId: string): AuditWarning[] {
  const item = project.items[itemId]

  if (!item) {
    return []
  }

  const warnings = getStaleConnectionWarnings(project, item)

  if (item.type === 'server') {
    warnings.push(...getServerAuditWarnings(project, item))
  }

  if (item.type === 'switch') {
    warnings.push(...getSwitchAuditWarnings(project, item))
  }

  return warnings
}

export function getProjectAuditWarnings(project: ProjectState): ProjectAuditGroup[] {
  const placedItemIds = new Set(project.placements.map((placement) => placement.serverId))

  return Object.values(project.items)
    .filter((item) => placedItemIds.has(runtimeItemKey(item)))
    .map((item) => ({
      item,
      warnings: getItemAuditWarnings(project, runtimeItemKey(item)),
    }))
    .filter((group) => group.warnings.length > 0)
    .sort((first, second) => first.item.name.localeCompare(second.item.name))
}
