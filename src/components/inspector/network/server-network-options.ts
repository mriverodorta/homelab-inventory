import { sortAssignmentsForDisplay } from '@/lib/constraints'
import { runtimeItemKey } from '@/lib/item-keys'
import { endpointKey } from '@/lib/project'
import type {
  ConnectionEndpoint,
  InventoryItem,
  InventoryPort,
  InventoryPortType,
  ProjectState,
} from '@/types/inventory'

const NETWORK_INTERFACE_PORT_TYPES = new Set<InventoryPortType>(['rj45', 'sfp', 'sfp-plus'])

export type ServerNetworkPortOption = {
  key: string
  endpoint: ConnectionEndpoint
  item: InventoryItem
  itemKey: string
  port: InventoryPort
  sourceLabel: string
}

export function getServerNetworkPortOptions(project: ProjectState, server: InventoryItem): ServerNetworkPortOption[] {
  const serverRuntimeKey = runtimeItemKey(server)
  const boardOptions = (server.ports ?? [])
    .filter((port) => NETWORK_INTERFACE_PORT_TYPES.has(port.type) && !port.endpoints)
    .map((port) => {
      const endpoint = { itemId: serverRuntimeKey, portId: port.id }

      return {
        key: endpointKey(endpoint),
        endpoint,
        item: server,
        itemKey: serverRuntimeKey,
        port,
        sourceLabel: 'Board',
      }
    })

  const cardOptions = sortAssignmentsForDisplay(project, serverRuntimeKey)
    .filter((assignment) => assignment.type === 'network')
    .flatMap((assignment) => {
      const item = project.items[assignment.itemId]
      if (!item) return []

      const itemKey = runtimeItemKey(item)
      return (item.ports ?? [])
        .filter((port) => NETWORK_INTERFACE_PORT_TYPES.has(port.type) && !port.endpoints)
        .map((port) => {
          const endpoint = {
            itemId: serverRuntimeKey,
            hostedItemId: itemKey,
            portId: port.id,
          }

          return {
            key: endpointKey(endpoint),
            endpoint,
            item,
            itemKey,
            port,
            sourceLabel: item.name,
          }
        })
    })

  return [...boardOptions, ...cardOptions].sort((first, second) => {
    if (first.sourceLabel !== second.sourceLabel) {
      return first.sourceLabel.localeCompare(second.sourceLabel)
    }
    return first.port.slotNumber - second.port.slotNumber
  })
}
