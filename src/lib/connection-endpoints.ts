import { formatPortType } from '@/lib/format'
import { runtimeItemKey } from '@/lib/item-keys'
import {
  createConnection,
  connectionEndpointAvailable,
  endpointKey,
  isArchivedItem,
  portsCompatible,
} from '@/lib/project'
import {
  createPowerConnection,
  getPowerEndpoints,
  resolvePowerEndpoint,
  validatePowerConnection,
  type PowerEndpoint,
} from '@/lib/power-topology'
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
  powerEndpoint?: PowerEndpoint
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
  'pcBuild',
  'monitor',
  'ups',
  'powerStrip',
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

  return (host.ports ?? []).filter(
    (port) => !(['monitor', 'ups', 'powerStrip'] as InventoryItem['type'][]).includes(host.type) || port.type !== 'barrel',
  ).flatMap((port) => {
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
  if (host.type !== 'server' && host.type !== 'nas' && host.type !== 'pcBuild') {
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

function powerEndpointOptions(
  project: ProjectState,
  host: InventoryItem,
): ConnectionEndpointOption[] {
  const hostKey = runtimeItemKey(host)

  return getPowerEndpoints(project)
    .filter((powerEndpoint) => powerEndpoint.endpoint.itemId === hostKey)
    .flatMap((powerEndpoint) => {
      const owner = powerEndpoint.endpoint.hostedItemId
        ? project.items[powerEndpoint.endpoint.hostedItemId]
        : host

      if (!owner || isArchivedItem(owner)) {
        return []
      }
      const port = owner.ports?.find(
        (candidate) => candidate.id === powerEndpoint.endpoint.portId,
      )
      if (!port) return []

      return [{
        key: endpointKey(powerEndpoint.endpoint),
        endpoint: powerEndpoint.endpoint,
        host,
        owner,
        port,
        label: powerEndpoint.label,
        powerEndpoint,
      }]
    })
}

function optionAvailable(project: ProjectState, option: ConnectionEndpointOption): boolean {
  if (!option.powerEndpoint) {
    return connectionEndpointAvailable(project, option.endpoint)
  }

  return option.powerEndpoint.allowFanOut || connectionEndpointAvailable(project, option.endpoint)
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
    ...powerEndpointOptions(project, host),
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
      options: group.options.filter((option) => {
        if (source.powerEndpoint || option.powerEndpoint) {
          if (!source.powerEndpoint || !option.powerEndpoint || !optionAvailable(project, option)) {
            return false
          }

          const from = source.powerEndpoint.direction === 'output' ? source.endpoint : option.endpoint
          const to = source.powerEndpoint.direction === 'input' ? source.endpoint : option.endpoint
          return validatePowerConnection(project, from, to).ok
        }

        return portsCompatible(source.port.type, option.port.type) && optionAvailable(project, option)
      }),
    }))
    .filter((group) => group.options.length > 0)
}

export function createConnectionForEndpoints(
  project: ProjectState,
  first: ConnectionEndpoint,
  second: ConnectionEndpoint,
) {
  const firstPower = resolvePowerEndpoint(project, first)
  const secondPower = resolvePowerEndpoint(project, second)

  if (firstPower || secondPower) {
    if (!firstPower || !secondPower) {
      return { ok: false as const, message: 'Power endpoints can only connect to other power endpoints.' }
    }

    return firstPower.direction === 'output'
      ? createPowerConnection(project, first, second)
      : createPowerConnection(project, second, first)
  }

  return createConnection(project, first, second)
}
