import {
  getCanvasItemHeight,
  getCanvasItemWidth,
  EQUIPMENT_PORT_CHIP_GAP,
  EQUIPMENT_PORT_CHIP_WIDTH,
  SERVER_CARD_BOARD_PORT_ROW_HEIGHT,
  SERVER_CARD_HEADER_HEIGHT,
  SERVER_CARD_HOSTED_PORT_ROW_HEIGHT,
  SERVER_CARD_ROW_HEIGHT,
} from '@/lib/project'
import { runtimeItemKey } from '@/lib/item-keys'
import { POWER_INPUT_PORT_ID, resolvePowerEndpoint } from '@/lib/power-topology'
import type {
  ConnectionEndpoint,
  ConnectionRouteSide,
  InventoryConnection,
  InventoryItem,
  InventoryPort,
  ProjectState,
} from '@/types/inventory'

export type CableSide = 'left' | 'right' | 'top' | 'bottom'

export type CableRoute = {
  sourceHandle: string
  targetHandle: string
  laneOffset: number
}

type NodeBox = {
  x: number
  y: number
  width: number
  height: number
}

type Point = {
  x: number
  y: number
}

const EQUIPMENT_PORT_ROW_X = 16
const SWITCH_PORT_ROW_CENTER_Y = 123
const PATCH_BACK_PORT_ROW_CENTER_Y = 132
const PATCH_FRONT_PORT_ROW_CENTER_Y = 211
const SERVER_BOARD_PORT_ROW_X = 56
const SERVER_HOSTED_PORT_ROW_X = 22
const SERVER_BOARD_PORT_ROW_CENTER_Y = SERVER_CARD_HEADER_HEIGHT + SERVER_CARD_BOARD_PORT_ROW_HEIGHT / 2
const SERVER_ASSIGNMENT_ROWS_START_Y = SERVER_CARD_HEADER_HEIGHT + SERVER_CARD_BOARD_PORT_ROW_HEIGHT + 22

function getNodeBox(project: ProjectState, itemId: string): NodeBox | null {
  const placement = project.placements.find((candidate) => candidate.serverId === itemId)
  const item = project.items[itemId]

  if (!placement || !item) {
    return null
  }

  return {
    x: placement.x,
    y: placement.y,
    width: getCanvasItemWidth(project, runtimeItemKey(item)),
    height: getCanvasItemHeight(project, runtimeItemKey(item)),
  }
}

function center(box: NodeBox): { x: number; y: number } {
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  }
}

function sideTowardPoint(source: Point, target: Point): CableSide {
  const dx = target.x - source.x
  const dy = target.y - source.y

  if (Math.abs(dx) > Math.abs(dy)) {
    return dx >= 0 ? 'right' : 'left'
  }

  return dy >= 0 ? 'bottom' : 'top'
}

function sideTowardBox(sourceBox: NodeBox, sourcePoint: Point, targetBox: NodeBox, targetPoint: Point): CableSide {
  if (sourceBox.y + sourceBox.height <= targetBox.y) {
    return 'bottom'
  }

  if (targetBox.y + targetBox.height <= sourceBox.y) {
    return 'top'
  }

  if (sourceBox.x + sourceBox.width <= targetBox.x) {
    return 'right'
  }

  if (targetBox.x + targetBox.width <= sourceBox.x) {
    return 'left'
  }

  return sideTowardPoint(sourcePoint, targetPoint)
}

function normalizeRouteSide(side: ConnectionRouteSide | undefined): CableSide | null {
  if (side === 'left' || side === 'right' || side === 'top' || side === 'bottom') {
    return side
  }

  return null
}

function sortPorts(ports: InventoryPort[] | undefined): InventoryPort[] {
  return [...(ports ?? [])].sort((first, second) => first.slotNumber - second.slotNumber)
}

function getPortEndpointSide(item: InventoryItem, endpoint: ConnectionEndpoint): 'front' | 'back' | null {
  if (!endpoint.endpointId) {
    return null
  }

  const port = item.ports?.find((candidate) => String(candidate.id) === String(endpoint.portId))
  const portEndpoint = port?.endpoints?.find((candidate) => String(candidate.id) === String(endpoint.endpointId))

  return portEndpoint?.side ?? null
}

function getEquipmentEndpointPoint(
  item: InventoryItem,
  box: NodeBox,
  endpoint: ConnectionEndpoint,
): Point | null {
  if (item.type !== 'switch' && item.type !== 'patchPanel') {
    return null
  }

  const ports = sortPorts(item.ports)
  const portIndex = ports.findIndex((port) => String(port.id) === String(endpoint.portId))

  if (portIndex < 0) {
    return null
  }

  const side = getPortEndpointSide(item, endpoint)
  const y = item.type === 'patchPanel'
    ? side === 'front'
      ? PATCH_FRONT_PORT_ROW_CENTER_Y
      : PATCH_BACK_PORT_ROW_CENTER_Y
    : SWITCH_PORT_ROW_CENTER_Y

  return {
    x: box.x +
      EQUIPMENT_PORT_ROW_X +
      portIndex * (EQUIPMENT_PORT_CHIP_WIDTH + EQUIPMENT_PORT_CHIP_GAP) +
      EQUIPMENT_PORT_CHIP_WIDTH / 2,
    y: box.y + y,
  }
}

function getServerHostedRowIndex(project: ProjectState, serverId: string, hostedItemId: string): number {
  const assignments = project.assignments
    .filter((assignment) => assignment.serverId === serverId)
    .sort((first, second) => {
      const order = ['cpu', 'ram', 'storage', 'gpu', 'network']
      const typeDelta = order.indexOf(first.type) - order.indexOf(second.type)

      if (typeDelta !== 0) {
        return typeDelta
      }

      return first.assignedAt.localeCompare(second.assignedAt)
    })

  return assignments.findIndex((assignment) => assignment.itemId === hostedItemId)
}

function getHostedPortRowsBefore(project: ProjectState, serverId: string, hostedItemId: string): number {
  const assignments = project.assignments
    .filter((assignment) => assignment.serverId === serverId)
    .sort((first, second) => {
      const order = ['cpu', 'ram', 'storage', 'gpu', 'network']
      const typeDelta = order.indexOf(first.type) - order.indexOf(second.type)

      if (typeDelta !== 0) {
        return typeDelta
      }

      return first.assignedAt.localeCompare(second.assignedAt)
    })
  let hostedRows = 0

  for (const assignment of assignments) {
    if (assignment.itemId === hostedItemId) {
      return hostedRows
    }

    const item = project.items[assignment.itemId]

    if ((assignment.type === 'network' || assignment.type === 'gpu') && (item?.ports ?? []).length > 0) {
      hostedRows += 1
    }
  }

  return hostedRows
}

function getServerEndpointPoint(
  project: ProjectState,
  item: InventoryItem,
  box: NodeBox,
  endpoint: ConnectionEndpoint,
): Point | null {
  if (item.type !== 'server') {
    return null
  }

  const portOwner = endpoint.hostedItemId ? project.items[endpoint.hostedItemId] : item
  const ports = sortPorts(portOwner?.ports)
  const portIndex = ports.findIndex((port) => String(port.id) === String(endpoint.portId))

  if (portIndex < 0) {
    return null
  }

  if (!endpoint.hostedItemId) {
    return {
      x: box.x +
        SERVER_BOARD_PORT_ROW_X +
        portIndex * (EQUIPMENT_PORT_CHIP_WIDTH + EQUIPMENT_PORT_CHIP_GAP) +
        EQUIPMENT_PORT_CHIP_WIDTH / 2,
      y: box.y + SERVER_BOARD_PORT_ROW_CENTER_Y,
    }
  }

  const rowIndex = getServerHostedRowIndex(project, endpoint.itemId, endpoint.hostedItemId)

  if (rowIndex < 0) {
    return null
  }

  return {
    x: box.x +
      SERVER_HOSTED_PORT_ROW_X +
      portIndex * (EQUIPMENT_PORT_CHIP_WIDTH + EQUIPMENT_PORT_CHIP_GAP) +
      EQUIPMENT_PORT_CHIP_WIDTH / 2,
    y: box.y +
      SERVER_ASSIGNMENT_ROWS_START_Y +
      rowIndex * SERVER_CARD_ROW_HEIGHT +
      getHostedPortRowsBefore(project, endpoint.itemId, endpoint.hostedItemId) * SERVER_CARD_HOSTED_PORT_ROW_HEIGHT +
      SERVER_CARD_ROW_HEIGHT +
      EQUIPMENT_PORT_CHIP_WIDTH / 2,
  }
}

function getEndpointPoint(project: ProjectState, box: NodeBox, endpoint: ConnectionEndpoint): Point {
  const item = project.items[endpoint.itemId]
  const equipmentPoint = item ? getEquipmentEndpointPoint(item, box, endpoint) : null
  const serverPoint = item ? getServerEndpointPoint(project, item, box, endpoint) : null

  return equipmentPoint ?? serverPoint ?? center(box)
}

function baseLaneOffset(connection: InventoryConnection): number {
  if (connection.type === 'display') {
    return 42
  }

  if (connection.type === 'network') {
    return 24
  }

  return 32
}

export function getEndpointHandleKey(endpoint: ConnectionEndpoint): string {
  if (endpoint.hostedItemId) {
    return [endpoint.hostedItemId, endpoint.portId, endpoint.endpointId ?? 'port'].join(':')
  }

  return [endpoint.portId, endpoint.endpointId ?? 'port'].join(':')
}

export function getEndpointHandleId(
  kind: 'source' | 'target',
  side: CableSide,
  endpoint: ConnectionEndpoint,
): string {
  return `${kind}-${side}-${getEndpointHandleKey(endpoint)}`
}

export function getConnectionRoute(
  project: ProjectState,
  connection: InventoryConnection,
  connectionIndex = 0,
): CableRoute | null {
  const sourceBox = getNodeBox(project, connection.from.itemId)
  const targetBox = getNodeBox(project, connection.to.itemId)

  if (!sourceBox || !targetBox) {
    return null
  }

  const sourcePoint = getEndpointPoint(project, sourceBox, connection.from)
  const targetPoint = getEndpointPoint(project, targetBox, connection.to)
  const sourceSide = normalizeRouteSide(connection.route?.sourceSide) ??
    sideTowardBox(sourceBox, sourcePoint, targetBox, targetPoint)
  const targetSide = normalizeRouteSide(connection.route?.targetSide) ??
    sideTowardBox(targetBox, targetPoint, sourceBox, sourcePoint)
  const parallelLaneOffset = (connectionIndex % 3) * 8
  const sourcePower = resolvePowerEndpoint(project, connection.from)
  const targetPower = resolvePowerEndpoint(project, connection.to)
  const sourceUsesHostHandle = Boolean(
    sourcePower && connection.from.hostedItemId && connection.from.portId === POWER_INPUT_PORT_ID,
  )
  const targetUsesHostHandle = Boolean(
    targetPower && connection.to.hostedItemId && connection.to.portId === POWER_INPUT_PORT_ID,
  )

  return {
    sourceHandle: sourceUsesHostHandle
      ? `source-${sourceSide}`
      : getEndpointHandleId('source', sourceSide, connection.from),
    targetHandle: targetUsesHostHandle
      ? `target-${targetSide}`
      : getEndpointHandleId('target', targetSide, connection.to),
    laneOffset: baseLaneOffset(connection) + parallelLaneOffset,
  }
}
