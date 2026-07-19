import { formatPortType } from '@/lib/format'
import { runtimeItemKey } from '@/lib/item-keys'
import {
  connectionEndpointAvailable,
  endpointKey,
  isArchivedItem,
  portsCompatible,
} from '@/lib/project'
import type {
  ConnectionEndpoint,
  InventoryItem,
  InventoryPort,
  InventoryPortSide,
  ProjectState,
} from '@/types/inventory'

export type ConnectionEndpointOption = {
  key: string
  endpoint: ConnectionEndpoint
  host: InventoryItem
  owner: InventoryItem
  port: InventoryPort
  label: string
}

export type ConnectionEndpointGroup = {
  key: string
  host: InventoryItem
  label: string
  options: ConnectionEndpointOption[]
}

const CONNECTION_HOST_TYPES = new Set<InventoryItem['type']>([
  'server',
  'nas',
  'switch',
  'patchPanel',
])

function portNumber(port: InventoryPort): string {
  return String(port.slotNumber).padStart(2, '0')
}

function portSpeedSuffix(port: InventoryPort): string {
  return port.speed ? ` / ${port.speed}` : ''
}

function directPortLabel(host: InventoryItem, port: InventoryPort): string {
  const type = formatPortType(port.type)

  if (host.type === 'server' || host.type === 'nas') {
    return `Board / ${type} ${portNumber(port)}${portSpeedSuffix(port)}`
  }

  return `Port ${portNumber(port)} / ${type}${portSpeedSuffix(port)}`
}

function patchPanelEndpointLabel(
  port: InventoryPort,
  side: InventoryPortSide,
): string {
  const sideLabel = side === 'front' ? 'Front' : 'Back'

  return `Port ${portNumber(port)} / ${sideLabel} / ${formatPortType(port.type)}`
}

function hostedPortLabel(owner: InventoryItem, port: InventoryPort): string {
  return `${owner.name} / ${formatPortType(port.type)} ${portNumber(port)}${portSpeedSuffix(port)}`
}

function directEndpointOptions(host: InventoryItem): ConnectionEndpointOption[] {
  const hostKey = runtimeItemKey(host)

  return (host.ports ?? []).flatMap((port) => {
    if (port.endpoints?.length) {
      return port.endpoints.map((portEndpoint) => {
        const endpoint: ConnectionEndpoint = {
          itemId: hostKey,
          portId: port.id,
          endpointId: portEndpoint.id,
        }

        return {
          key: endpointKey(endpoint),
          endpoint,
          host,
          owner: host,
          port,
          label: patchPanelEndpointLabel(port, portEndpoint.side),
        }
      })
    }

    const endpoint: ConnectionEndpoint = {
      itemId: hostKey,
      portId: port.id,
    }

    return [{
      key: endpointKey(endpoint),
      endpoint,
      host,
      owner: host,
      port,
      label: directPortLabel(host, port),
    }]
  })
}

function hostedEndpointOptions(
  project: ProjectState,
  host: InventoryItem,
): ConnectionEndpointOption[] {
  if (host.type !== 'server' && host.type !== 'nas') {
    return []
  }

  const hostKey = runtimeItemKey(host)

  return project.assignments
    .filter(
      (assignment) =>
        assignment.serverId === hostKey &&
        (assignment.type === 'network' || assignment.type === 'gpu'),
    )
    .flatMap((assignment) => {
      const owner = project.items[assignment.itemId]

      if (!owner || isArchivedItem(owner)) {
        return []
      }

      return (owner.ports ?? []).flatMap((port) => {
        if (port.endpoints?.length) {
          return port.endpoints.map((portEndpoint) => {
            const endpoint: ConnectionEndpoint = {
              itemId: hostKey,
              hostedItemId: assignment.itemId,
              portId: port.id,
              endpointId: portEndpoint.id,
            }

            return {
              key: endpointKey(endpoint),
              endpoint,
              host,
              owner,
              port,
              label: `${hostedPortLabel(owner, port)} / ${portEndpoint.side === 'front' ? 'Front' : 'Back'}`,
            }
          })
        }

        const endpoint: ConnectionEndpoint = {
          itemId: hostKey,
          hostedItemId: assignment.itemId,
          portId: port.id,
        }

        return [{
          key: endpointKey(endpoint),
          endpoint,
          host,
          owner,
          port,
          label: hostedPortLabel(owner, port),
        }]
      })
    })
}

export function getEndpointGroupForHost(
  project: ProjectState,
  host: InventoryItem,
): ConnectionEndpointGroup | null {
  if (!CONNECTION_HOST_TYPES.has(host.type) || isArchivedItem(host)) {
    return null
  }

  const options = [
    ...directEndpointOptions(host),
    ...hostedEndpointOptions(project, host),
  ]

  if (options.length === 0) {
    return null
  }

  return {
    key: runtimeItemKey(host),
    host,
    label: host.name,
    options,
  }
}

export function getHostEndpointGroups(project: ProjectState): ConnectionEndpointGroup[] {
  const placedHostKeys = new Set(project.placements.map((placement) => placement.serverId))

  return Object.values(project.items)
    .filter((item) => !isArchivedItem(item) && placedHostKeys.has(runtimeItemKey(item)))
    .map((host) => getEndpointGroupForHost(project, host))
    .filter((group): group is ConnectionEndpointGroup => group !== null)
    .sort((first, second) => first.label.localeCompare(second.label))
}

export function getCompatibleDestinationGroups(
  project: ProjectState,
  source: ConnectionEndpointOption,
): ConnectionEndpointGroup[] {
  return getHostEndpointGroups(project)
    .filter((group) => group.key !== runtimeItemKey(source.host))
    .map((group) => ({
      ...group,
      options: group.options.filter(
        (option) =>
          portsCompatible(source.port.type, option.port.type) &&
          connectionEndpointAvailable(project, option.endpoint),
      ),
    }))
    .filter((group) => group.options.length > 0)
}
