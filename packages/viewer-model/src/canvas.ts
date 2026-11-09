import {
  parseShareViewBlob,
  type CanvasViewBlob,
  type PublicItem,
} from '@homelab-inventory/share-contract'

import { deepFreeze, type DeepReadonly } from './immutable'
import { presentSharedItems, type SharedPresentationContext, type SharedPresentedItem } from './item-presentation'

type CanvasNode = CanvasViewBlob['nodes'][number]
type CanvasConnection = CanvasViewBlob['connections'][number]
type PublicPort = PublicItem['ports'][number]

export interface SharedCanvasNode extends CanvasNode {
  item: SharedPresentedItem
}

export interface SharedCanvasEndpoint {
  publicItemId: string
  publicPortId?: string
  item: SharedPresentedItem
  port?: PublicPort
}

export interface SharedCanvasConnection extends Omit<CanvasConnection, 'source' | 'target'> {
  source: SharedCanvasEndpoint
  target: SharedCanvasEndpoint
}

export interface SharedCanvasModel {
  publicViewId: string
  items: SharedPresentedItem[]
  nodes: SharedCanvasNode[]
  connections: SharedCanvasConnection[]
  viewport: CanvasViewBlob['viewport'] | null
}

function uniqueMap<T>(entries: readonly T[], keyOf: (entry: T) => string, label: string): Map<string, T> {
  const result = new Map<string, T>()
  for (const entry of entries) {
    const key = keyOf(entry)
    if (result.has(key)) throw new TypeError(`Duplicate ${label} ${key}.`)
    result.set(key, entry)
  }
  return result
}

function resolveEndpoint(
  endpoint: CanvasConnection['source'],
  items: Map<string, SharedPresentedItem>,
): SharedCanvasEndpoint {
  const item = items.get(endpoint.publicItemId)
  if (!item) throw new TypeError(`Connection references missing item ${endpoint.publicItemId}.`)

  if (!endpoint.publicPortId) return { publicItemId: endpoint.publicItemId, item }
  const port = item.ports.find((candidate) => candidate.publicPortId === endpoint.publicPortId)
  if (!port) throw new TypeError(`Connection references missing port ${endpoint.publicPortId}.`)

  return {
    publicItemId: endpoint.publicItemId,
    publicPortId: endpoint.publicPortId,
    item,
    port,
  }
}

export function createSharedCanvasModel(value: unknown, presentation?: SharedPresentationContext): DeepReadonly<SharedCanvasModel> {
  const blob = parseShareViewBlob(value)
  if (blob.viewType !== 'canvas') throw new TypeError('Expected a Canvas share view.')

  const presentedItems = presentSharedItems(blob.items, presentation)
  const items = uniqueMap(presentedItems, (item) => item.publicItemId, 'item')
  const rawNodes = uniqueMap(blob.nodes, (node) => node.publicNodeId, 'node')
  uniqueMap(blob.connections, (connection) => connection.publicConnectionId, 'connection')

  const nodes = blob.nodes.map((node): SharedCanvasNode => {
    const item = items.get(node.publicItemId)
    if (!item) throw new TypeError(`Canvas node references missing item ${node.publicItemId}.`)
    if (node.parentPublicNodeId && !rawNodes.has(node.parentPublicNodeId)) {
      throw new TypeError(`Canvas node references missing parent ${node.parentPublicNodeId}.`)
    }
    if (node.parentPublicNodeId === node.publicNodeId) {
      throw new TypeError(`Canvas node ${node.publicNodeId} cannot parent itself.`)
    }
    return { ...node, item }
  })

  const connections = blob.connections.map((connection): SharedCanvasConnection => ({
    ...connection,
    source: resolveEndpoint(connection.source, items),
    target: resolveEndpoint(connection.target, items),
  }))

  return deepFreeze({
    publicViewId: blob.publicViewId,
    items: presentedItems,
    nodes,
    connections,
    viewport: blob.viewport ?? null,
  })
}
