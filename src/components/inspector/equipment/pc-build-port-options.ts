import { sortAssignmentsForDisplay } from '@/lib/constraints'
import { runtimeItemKey } from '@/lib/item-keys'
import { endpointKey } from '@/lib/project'
import type {
  ComponentType,
  ConnectionEndpoint,
  InventoryItem,
  InventoryPort,
  InventoryPortType,
  ProjectState,
} from '@/types/inventory'

const NETWORK_INTERFACE_PORT_TYPES = new Set<InventoryPortType>(['rj45', 'sfp', 'sfp-plus'])

export type HostedPortOption = {
  key: string
  endpoint: ConnectionEndpoint
  item: InventoryItem
  itemKey: string
  port: InventoryPort
  sourceLabel: string
}

export function getPcBuildPortOptions(
  project: ProjectState,
  host: InventoryItem,
  networkOnly = false,
): HostedPortOption[] {
  const hostKey = runtimeItemKey(host)
  const portedTypes = new Set<ComponentType>([
    'motherboard',
    'gpu',
    'network',
    'soundCard',
  ])

  return sortAssignmentsForDisplay(project, hostKey)
    .filter((assignment) => portedTypes.has(assignment.type))
    .flatMap((assignment) => {
      const item = project.items[assignment.itemId]
      if (!item) return []

      const itemKey = runtimeItemKey(item)
      return (item.ports ?? [])
        .filter((port) => !port.endpoints && (!networkOnly || NETWORK_INTERFACE_PORT_TYPES.has(port.type)))
        .map((port) => {
          const endpoint = {
            itemId: hostKey,
            hostedItemId: itemKey,
            portId: port.id,
          }

          return {
            key: endpointKey(endpoint),
            endpoint,
            item,
            itemKey,
            port,
            sourceLabel: assignment.type === 'motherboard' ? 'Motherboard' : item.name,
          }
        })
    })
}
