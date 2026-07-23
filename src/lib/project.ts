import type {
  ConnectionEndpoint,
  ComponentAssignment,
  InventoryItem,
  InventoryPort,
  InventoryProperties,
  InventorySpecs,
  ProjectState,
  ServerPlacement,
} from '@/types/inventory'
import type { InventoryItemInput } from '@/lib/db'
import { runtimeItemKey } from '@/lib/item-keys'
import { isCanvasEquipmentType } from '@/lib/inventory-capabilities'
import { getPowerEquipmentOrientation } from '@/lib/power-equipment-layout'
import {
  PC_BUILD_COMPONENT_ORDER,
  REQUIRED_PC_BUILD_COMPONENT_TYPES,
} from '@/lib/pc-build'

export const DEFAULT_PROJECT_ID = 'default'
export const SERVER_CARD_WIDTH = 282
export const SERVER_CARD_HEADER_HEIGHT = 54
export const SERVER_CARD_BOARD_PORT_ROW_HEIGHT = 42
export const SERVER_CARD_ROW_HEIGHT = 44
export const SERVER_CARD_HOSTED_PORT_ROW_HEIGHT = 42
export const SERVER_CARD_VERTICAL_PADDING = 28
export const SERVER_CARD_COLLISION_GAP = 24
export const EQUIPMENT_CARD_HEIGHT = 124
export const EQUIPMENT_CARD_MIN_WIDTH = 282
export const EQUIPMENT_PORT_CHIP_WIDTH = 30
export const EQUIPMENT_PORT_CHIP_GAP = 6
export const EQUIPMENT_CARD_HORIZONTAL_PADDING = 32
export const NAS_CARD_WIDTH = 360
export const NAS_CARD_HEADER_HEIGHT = 54
export const NAS_CARD_SECTION_HEIGHT = 50
export const NAS_CARD_VERTICAL_PADDING = 84
export const PC_BUILD_CARD_WIDTH = 318
export const MONITOR_CARD_WIDTH = 360
export const POWER_EQUIPMENT_CARD_WIDTH = 420
export const VERTICAL_UPS_CARD_WIDTH = 248
export const VERTICAL_POWER_STRIP_CARD_WIDTH = 176
const PC_BUILD_CARD_BASE_HEIGHT = 72
const PC_BUILD_EMPTY_SLOT_HEIGHT = 34
const PC_BUILD_ASSIGNED_SLOT_HEIGHT = 46
const PC_BUILD_HOSTED_PORT_ROW_HEIGHT = 56
const PC_BUILD_MOTHERBOARD_IO_HEIGHT = 58
const PC_BUILD_OPERATING_SYSTEM_HEIGHT = 36
const STANDALONE_CARD_BASE_HEIGHT = 123
const STANDALONE_PORT_GROUP_FIXED_HEIGHT = 44
const STANDALONE_VERTICAL_PORT_GROUP_FIXED_HEIGHT = 44
const POWER_STRIP_HEADER_HEIGHT_DELTA = 8
const STANDALONE_PORT_ROW_HEIGHT = 44
const STANDALONE_PORT_ROW_GAP = 6
const STANDALONE_HORIZONTAL_GROUP_GAP = 8
const MONITOR_PORT_COLUMNS = 5
const POWER_EQUIPMENT_PORT_COLUMNS = 6

export function isCanvasItem(item: InventoryItem | undefined): boolean {
  return Boolean(item && isCanvasEquipmentType(item.type))
}

export function isArchivedItem(item: InventoryItem | undefined): boolean {
  return typeof item?.archivedAt === 'string' && item.archivedAt.trim().length > 0
}

export function createEmptyProject(items: InventoryItem[] = []): ProjectState {
  const now = new Date().toISOString()

  return {
    id: DEFAULT_PROJECT_ID,
    revision: 1,
    metadata: {
      name: 'Homelab Inventory',
      version: 1,
      updatedAt: now,
    },
    items: Object.fromEntries(items.map((item) => [runtimeItemKey(item), item])),
    placements: [],
    assignments: [],
    connections: [],
  }
}

export function touchProject(project: ProjectState): ProjectState {
  return {
    ...project,
    metadata: {
      ...project.metadata,
      updatedAt: new Date().toISOString(),
    },
  }
}

function connectionEndpointTargetsItem(
  endpoint: ConnectionEndpoint,
  runtimeItemId: string,
): boolean {
  return endpoint.hostedItemId === runtimeItemId
    || (endpoint.hostedItemId === undefined && endpoint.itemId === runtimeItemId)
}

export type ReturnCanvasItemImpact = {
  placementsRemoved: number
  assignmentsReleased: number
  connectionsRemoved: number
}

export type ReturnCanvasItemResult =
  | {
      ok: true
      project: ProjectState
      impact: ReturnCanvasItemImpact
    }
  | {
      ok: false
      message: string
    }

type ReturnCanvasItemTransition = {
  placementIds: Set<string>
  assignmentIds: Set<string | number>
  connectionIds: Set<string | number>
  impact: ReturnCanvasItemImpact
}

function collectReturnCanvasItemTransition(
  project: ProjectState,
  runtimeItemId: string,
): ReturnCanvasItemTransition | null {
  if (!project.items[runtimeItemId]) {
    return null
  }

  const placements = project.placements.filter(
    (placement) => placement.serverId === runtimeItemId,
  )

  if (placements.length === 0) {
    return null
  }

  const assignments = project.assignments.filter(
    (assignment) => assignment.serverId === runtimeItemId,
  )
  const hostedItemIds = new Set(assignments.map((assignment) => assignment.itemId))
  const endpointTargetsReturnedGraph = (endpoint: ConnectionEndpoint): boolean =>
    endpoint.itemId === runtimeItemId
    || Array.from(hostedItemIds).some((hostedItemId) =>
      connectionEndpointTargetsItem(endpoint, hostedItemId),
    )
  const connections = project.connections.filter(
    (connection) =>
      endpointTargetsReturnedGraph(connection.from)
      || endpointTargetsReturnedGraph(connection.to),
  )

  return {
    placementIds: new Set(placements.map((placement) => placement.serverId)),
    assignmentIds: new Set(assignments.map((assignment) => assignment.id)),
    connectionIds: new Set(connections.map((connection) => connection.id)),
    impact: {
      placementsRemoved: placements.length,
      assignmentsReleased: assignments.length,
      connectionsRemoved: connections.length,
    },
  }
}

export function getReturnCanvasItemImpact(
  project: ProjectState,
  runtimeItemId: string,
): ReturnCanvasItemImpact | null {
  return collectReturnCanvasItemTransition(project, runtimeItemId)?.impact ?? null
}

export function returnCanvasItemToInventory(
  project: ProjectState,
  runtimeItemId: string,
): ReturnCanvasItemResult {
  const transition = collectReturnCanvasItemTransition(project, runtimeItemId)

  if (!transition) {
    return {
      ok: false,
      message: 'This item is no longer placed on the canvas.',
    }
  }

  return {
    ok: true,
    impact: transition.impact,
    project: touchProject({
      ...project,
      placements: project.placements.filter(
        (placement) => !transition.placementIds.has(placement.serverId),
      ),
      assignments: project.assignments.filter(
        (assignment) => !transition.assignmentIds.has(assignment.id),
      ),
      connections: project.connections.filter(
        (connection) => !transition.connectionIds.has(connection.id),
      ),
    }),
  }
}

function assertConnectedPortsRetained(
  project: ProjectState,
  runtimeItemId: string,
  input: InventoryItemInput,
): void {
  const ports = input.ports ?? []

  for (const connection of project.connections) {
    for (const endpoint of [connection.from, connection.to]) {
      if (!connectionEndpointTargetsItem(endpoint, runtimeItemId)) {
        continue
      }

      const port = ports.find((candidate) => String(candidate.id) === String(endpoint.portId))

      if (!port) {
        throw new Error(
          `Cannot remove connected port ${String(endpoint.portId)}. Disconnect it first.`,
        )
      }

      if (endpoint.endpointId !== undefined
        && !port.endpoints?.some(
          (candidate) => String(candidate.id) === String(endpoint.endpointId),
        )) {
        throw new Error(
          `Cannot remove connected endpoint ${String(endpoint.endpointId)} from port ${String(endpoint.portId)}. Disconnect it first.`,
        )
      }
    }
  }
}

export function applyInventoryItemInput(
  project: ProjectState,
  runtimeItemId: string,
  input: InventoryItemInput,
): ProjectState {
  const item = project.items[runtimeItemId]

  if (!item) {
    return project
  }

  assertConnectedPortsRetained(project, runtimeItemId, input)

  const nextItem: InventoryItem = {
    ...input,
    id: item.id,
    ...(item.key !== undefined ? { key: item.key } : {}),
  }

  return touchProject({
    ...project,
    items: {
      ...project.items,
      [runtimeItemId]: nextItem,
    },
  })
}

export function upsertPlacement(project: ProjectState, placement: ServerPlacement): ProjectState {
  if (isArchivedItem(project.items[placement.serverId])) {
    return project
  }

  const placements = project.placements.some((existing) => existing.serverId === placement.serverId)
    ? project.placements.map((existing) =>
        existing.serverId === placement.serverId ? placement : existing,
      )
    : [...project.placements, placement]

  return touchProject({
    ...project,
    placements,
  })
}

export function upsertPlacements(project: ProjectState, nextPlacements: ServerPlacement[]): ProjectState {
  if (nextPlacements.length === 0) {
    return project
  }

  if (nextPlacements.some((placement) => isArchivedItem(project.items[placement.serverId]))) {
    return project
  }

  const placementMap = new Map(nextPlacements.map((placement) => [placement.serverId, placement]))
  const existingIds = new Set(project.placements.map((placement) => placement.serverId))
  const placements = [
    ...project.placements.map((placement) => placementMap.get(placement.serverId) ?? placement),
    ...nextPlacements.filter((placement) => !existingIds.has(placement.serverId)),
  ]

  return touchProject({
    ...project,
    placements,
  })
}

export function updateItemProperties(
  project: ProjectState,
  itemId: string,
  properties: InventoryProperties,
): ProjectState {
  const item = project.items[itemId]

  if (!item) {
    return project
  }

  const nextProperties = Object.fromEntries(
    Object.entries({
      ...item.properties,
      ...properties,
    }).filter(([, value]) => value.trim() !== ''),
  )

  return touchProject({
    ...project,
    items: {
      ...project.items,
      [itemId]: {
        ...item,
        properties: Object.keys(nextProperties).length > 0 ? nextProperties : undefined,
      },
    },
  })
}

export function updateItemManufacturer(
  project: ProjectState,
  itemId: string,
  manufacturer: string,
  key: 'manufacturer' | 'secondaryManufacturer' = 'manufacturer',
): ProjectState {
  const item = project.items[itemId]

  if (!item) {
    return project
  }

  const nextItem = {
    ...item,
    [key]: manufacturer.trim() === '' ? undefined : manufacturer,
  }

  return touchProject({
    ...project,
    items: {
      ...project.items,
      [itemId]: nextItem,
    },
  })
}

export function updateItemIdentity(
  project: ProjectState,
  itemId: string,
  identity: Partial<Pick<InventoryItem, 'name' | 'manufacturer' | 'model' | 'family' | 'number'>>,
): ProjectState {
  const item = project.items[itemId]

  if (!item) {
    return project
  }

  const nextItem = { ...item }

  for (const [key, value] of Object.entries(identity)) {
    const normalized = typeof value === 'string' && value.trim() !== '' ? value : undefined

    ;(nextItem as Record<string, unknown>)[key] = normalized
  }

  return touchProject({
    ...project,
    items: {
      ...project.items,
      [itemId]: nextItem,
    },
  })
}

export function updateItemSpecs(
  project: ProjectState,
  itemId: string,
  specs: Record<string, InventorySpecs[string] | undefined>,
): ProjectState {
  const item = project.items[itemId]

  if (!item) {
    return project
  }

  const nextSpecs = {
    ...item.specs,
  }

  for (const [key, value] of Object.entries(specs)) {
    if (value === undefined) {
      delete nextSpecs[key]
    } else {
      nextSpecs[key] = value
    }
  }

  return touchProject({
    ...project,
    items: {
      ...project.items,
      [itemId]: {
        ...item,
        specs: Object.keys(nextSpecs).length > 0 ? nextSpecs : undefined,
      },
    },
  })
}

export function updateItemPorts(
  project: ProjectState,
  itemId: string,
  ports: InventoryPort[],
): ProjectState {
  const item = project.items[itemId]

  if (!item) {
    return project
  }

  return touchProject({
    ...project,
    items: {
      ...project.items,
      [itemId]: {
        ...item,
        ports,
      },
    },
  })
}

export function endpointKey(endpoint: ConnectionEndpoint): string {
  return [
    endpoint.itemId,
    endpoint.hostedItemId ?? 'direct',
    endpoint.portId,
    endpoint.endpointId ?? 'port',
  ].join(':')
}

export function getConnectionPort(
  project: ProjectState,
  endpoint: ConnectionEndpoint,
): InventoryPort | null {
  const item = project.items[endpoint.itemId]

  if (isArchivedItem(item)) {
    return null
  }

  const resolvedPort = endpoint.hostedItemId
    ? getHostedConnectionPort(project, endpoint)
    : item?.ports?.find((candidate) => String(candidate.id) === String(endpoint.portId)) ??
      getHostedConnectionPort(project, endpoint)

  if (!resolvedPort) {
    return null
  }

  if (endpoint.endpointId && !resolvedPort.endpoints?.some((candidate) => candidate.id === endpoint.endpointId)) {
    return null
  }

  if (!endpoint.endpointId && resolvedPort.endpoints && resolvedPort.endpoints.length > 0) {
    return null
  }

  return resolvedPort
}

function getHostedConnectionPort(
  project: ProjectState,
  endpoint: ConnectionEndpoint,
): InventoryPort | null {
  const host = project.items[endpoint.itemId]

  if (host?.type !== 'nas' && host?.type !== 'server') {
    return null
  }

  const legacyPortId = String(endpoint.portId)
  const [legacyComponentItemId, legacyHostedPortId] = legacyPortId.includes('::')
    ? legacyPortId.split('::')
    : [undefined, undefined]
  const componentItemId = endpoint.hostedItemId ?? legacyComponentItemId
  const hostedPortId = endpoint.hostedItemId ? endpoint.portId : legacyHostedPortId

  if (!componentItemId || !hostedPortId) {
    return null
  }

  if (isArchivedItem(project.items[componentItemId])) {
    return null
  }

  const assignment = project.assignments.find(
    (candidate: ComponentAssignment) =>
      candidate.serverId === endpoint.itemId &&
      candidate.itemId === componentItemId &&
      (candidate.type === 'network' || candidate.type === 'gpu'),
  )

  if (!assignment) {
    return null
  }

  return project.items[componentItemId]?.ports?.find(
    (candidate) => String(candidate.id) === String(hostedPortId),
  ) ?? null
}

export function getServerCardHeight(project: ProjectState, serverId: string): number {
  const item = project.items[serverId]

  if (item?.type === 'nas') {
    return getNasCardHeight(project, serverId)
  }

  if (item && item.type !== 'server') {
    return EQUIPMENT_CARD_HEIGHT
  }

  const assignments = project.assignments.filter((assignment) => assignment.serverId === serverId)
  const storageRows = Math.max(
    1,
    assignments.filter((assignment) => assignment.type === 'storage').length,
  )
  const optionalRows = Number(assignments.some((assignment) => assignment.type === 'gpu')) +
    Number(assignments.some((assignment) => assignment.type === 'network'))
  const hostedPortRows = assignments.filter((assignment) => {
    if (assignment.type !== 'network' && assignment.type !== 'gpu') {
      return false
    }

    return (project.items[assignment.itemId]?.ports ?? []).length > 0
  }).length
  const visibleRows = 2 + storageRows + optionalRows

  return SERVER_CARD_HEADER_HEIGHT +
    SERVER_CARD_BOARD_PORT_ROW_HEIGHT +
    SERVER_CARD_VERTICAL_PADDING +
    visibleRows * SERVER_CARD_ROW_HEIGHT +
    hostedPortRows * SERVER_CARD_HOSTED_PORT_ROW_HEIGHT
}

export function getNasCardHeight(project: ProjectState, itemId: string): number {
  const hasNetworkCard = project.assignments.some(
    (assignment) => assignment.serverId === itemId && assignment.type === 'network',
  )

  return NAS_CARD_HEADER_HEIGHT +
    NAS_CARD_VERTICAL_PADDING +
    NAS_CARD_SECTION_HEIGHT * (hasNetworkCard ? 3 : 2)
}

function positiveInteger(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0
}

function getPcBuildCardHeight(project: ProjectState, itemId: string): number {
  const item = project.items[itemId]
  const assignments = project.assignments.filter((assignment) => assignment.serverId === itemId)
  const assignedTypes = new Set(assignments.map((assignment) => assignment.type))
  const visibleTypes = PC_BUILD_COMPONENT_ORDER.filter(
    (type) => REQUIRED_PC_BUILD_COMPONENT_TYPES.includes(type) || assignedTypes.has(type),
  )
  const motherboardAssignment = assignments.find((assignment) => assignment.type === 'motherboard')
  const motherboard = motherboardAssignment
    ? project.items[motherboardAssignment.itemId]
    : undefined
  let height = PC_BUILD_CARD_BASE_HEIGHT

  if ((motherboard?.ports?.length ?? 0) > 0) {
    height += PC_BUILD_MOTHERBOARD_IO_HEIGHT
  }

  if (String(item?.specs?.operatingSystem ?? '').trim()) {
    height += PC_BUILD_OPERATING_SYSTEM_HEIGHT
  }

  for (const type of visibleTypes) {
    const matchingAssignments = assignments.filter((assignment) => assignment.type === type)

    if (matchingAssignments.length === 0) {
      height += PC_BUILD_EMPTY_SLOT_HEIGHT
      continue
    }

    for (const assignment of matchingAssignments) {
      height += PC_BUILD_ASSIGNED_SLOT_HEIGHT

      if (
        assignment.type !== 'motherboard'
        && (project.items[assignment.itemId]?.ports?.length ?? 0) > 0
      ) {
        height += PC_BUILD_HOSTED_PORT_ROW_HEIGHT
      }
    }
  }

  return height
}

function standalonePortGroupHeight(portCount: number, columns: number): number {
  if (portCount <= 0) return 0

  const rows = Math.ceil(portCount / columns)
  return STANDALONE_PORT_GROUP_FIXED_HEIGHT
    + rows * STANDALONE_PORT_ROW_HEIGHT
    + Math.max(0, rows - 1) * STANDALONE_PORT_ROW_GAP
}

function standaloneVerticalPortGroupHeight(portCount: number): number {
  if (portCount <= 0) return 0

  return STANDALONE_VERTICAL_PORT_GROUP_FIXED_HEIGHT
    + portCount * STANDALONE_PORT_ROW_HEIGHT
    + Math.max(0, portCount - 1) * STANDALONE_PORT_ROW_GAP
}

function standaloneHorizontalGroupGap(...portCounts: number[]): number {
  const visibleGroupCount = portCounts.filter((portCount) => portCount > 0).length

  return Math.max(0, visibleGroupCount - 1) * STANDALONE_HORIZONTAL_GROUP_GAP
}

function getMonitorCardHeight(item: InventoryItem): number {
  const ports = item.ports ?? []
  const displayPorts = ports.filter((port) => port.type !== 'ac-input').length
  const powerPorts = ports.some(
    (port) => port.type === 'ac-input' && port.key === 'ac-input',
  ) ? 1 : 0

  return STANDALONE_CARD_BASE_HEIGHT
    + standalonePortGroupHeight(displayPorts, MONITOR_PORT_COLUMNS)
    + standalonePortGroupHeight(powerPorts, MONITOR_PORT_COLUMNS)
    + standaloneHorizontalGroupGap(displayPorts, powerPorts)
}

function getUpsCardHeight(item: InventoryItem): number {
  const explicitPorts = (item.ports ?? []).filter((port) => port.type === 'ac-outlet')
  const batteryOutlets = positiveInteger(item.specs?.batteryBackupOutlets)
  const surgeOutlets = positiveInteger(item.specs?.surgeProtectedOutlets)
  const totalOutlets = explicitPorts.length
    || positiveInteger(item.specs?.outlets)
    || batteryOutlets + surgeOutlets
  let batteryCount = 0
  let surgeCount = 0

  if (explicitPorts.length > 0) {
    explicitPorts.forEach((port, index) => {
      const description = `${port.label ?? ''} ${port.notes ?? ''}`.toLowerCase()
      const battery = description.includes('battery')
        || (!description.includes('surge') && index < batteryOutlets)

      if (battery) batteryCount += 1
      else surgeCount += 1
    })
  } else {
    batteryCount = Math.min(totalOutlets, batteryOutlets)
    surgeCount = Math.max(0, totalOutlets - batteryCount)
  }

  if (getPowerEquipmentOrientation(item) === 'vertical') {
    return STANDALONE_CARD_BASE_HEIGHT
      + standaloneVerticalPortGroupHeight(Math.max(batteryCount, surgeCount))
  }

  return STANDALONE_CARD_BASE_HEIGHT
    + standalonePortGroupHeight(batteryCount, POWER_EQUIPMENT_PORT_COLUMNS)
    + standalonePortGroupHeight(surgeCount, POWER_EQUIPMENT_PORT_COLUMNS)
    + standaloneHorizontalGroupGap(batteryCount, surgeCount)
}

function getPowerStripCardHeight(item: InventoryItem): number {
  const outletCount = (item.ports ?? []).filter((port) => port.type === 'ac-outlet').length
    || positiveInteger(item.specs?.outlets)

  if (getPowerEquipmentOrientation(item) === 'vertical') {
    return STANDALONE_CARD_BASE_HEIGHT
      + POWER_STRIP_HEADER_HEIGHT_DELTA
      + standaloneVerticalPortGroupHeight(outletCount)
  }

  return STANDALONE_CARD_BASE_HEIGHT
    + POWER_STRIP_HEADER_HEIGHT_DELTA
    + standalonePortGroupHeight(outletCount, POWER_EQUIPMENT_PORT_COLUMNS)
}

export function getEquipmentPortColumns(item: InventoryItem | undefined): number {
  if (!item?.ports?.length) {
    return 0
  }

  return item.ports.length
}

export function getEquipmentCardWidth(item: InventoryItem | undefined): number {
  if (!item || (item.type !== 'switch' && item.type !== 'patchPanel')) {
    return EQUIPMENT_CARD_MIN_WIDTH
  }

  const portColumns = getEquipmentPortColumns(item)

  if (portColumns === 0) {
    return EQUIPMENT_CARD_MIN_WIDTH
  }

  return Math.max(
    EQUIPMENT_CARD_MIN_WIDTH,
    EQUIPMENT_CARD_HORIZONTAL_PADDING +
      portColumns * EQUIPMENT_PORT_CHIP_WIDTH +
      Math.max(0, portColumns - 1) * EQUIPMENT_PORT_CHIP_GAP,
  )
}

export function getEquipmentCardHeight(item: InventoryItem | undefined): number {
  if (!item || (item.type !== 'switch' && item.type !== 'patchPanel')) {
    return EQUIPMENT_CARD_HEIGHT
  }

  if (!item.ports?.length) {
    return EQUIPMENT_CARD_HEIGHT
  }

  if (item.type === 'patchPanel') {
    return 244
  }

  return 156
}

export function getCanvasItemWidth(project: ProjectState, itemId: string): number {
  const item = project.items[itemId]

  if (item?.type === 'server') {
    return SERVER_CARD_WIDTH
  }

  if (item?.type === 'nas') {
    return NAS_CARD_WIDTH
  }

  if (item?.type === 'pcBuild') {
    return PC_BUILD_CARD_WIDTH
  }

  if (item?.type === 'monitor') {
    return MONITOR_CARD_WIDTH
  }

  if (item?.type === 'ups') {
    return getPowerEquipmentOrientation(item) === 'vertical'
      ? VERTICAL_UPS_CARD_WIDTH
      : POWER_EQUIPMENT_CARD_WIDTH
  }

  if (item?.type === 'powerStrip') {
    return getPowerEquipmentOrientation(item) === 'vertical'
      ? VERTICAL_POWER_STRIP_CARD_WIDTH
      : POWER_EQUIPMENT_CARD_WIDTH
  }

  return getEquipmentCardWidth(item)
}

export function getCanvasItemHeight(project: ProjectState, itemId: string): number {
  const item = project.items[itemId]

  if (item?.type === 'nas') {
    return getNasCardHeight(project, itemId)
  }

  if (item?.type === 'pcBuild') {
    return getPcBuildCardHeight(project, itemId)
  }

  if (item?.type === 'monitor') {
    return getMonitorCardHeight(item)
  }

  if (item?.type === 'ups') {
    return getUpsCardHeight(item)
  }

  if (item?.type === 'powerStrip') {
    return getPowerStripCardHeight(item)
  }

  if (item?.type !== 'server') {
    return getEquipmentCardHeight(item)
  }

  return getServerCardHeight(project, itemId)
}

export function removeAssignment(project: ProjectState, assignmentId: string | number): ProjectState {
  return touchProject({
    ...project,
    assignments: project.assignments.filter((assignment) => String(assignment.id) !== String(assignmentId)),
  })
}

export function getPlacedServerIds(project: ProjectState): Set<string> {
  return new Set(
    project.placements
      .filter((placement) => project.items[placement.serverId]?.type === 'server')
      .map((placement) => placement.serverId),
  )
}

export function getPlacedCanvasItemIds(project: ProjectState): Set<string> {
  return new Set(project.placements.map((placement) => placement.serverId))
}

export function getAssignedItemIds(project: ProjectState): Set<string> {
  return new Set(project.assignments.map((assignment) => assignment.itemId))
}
