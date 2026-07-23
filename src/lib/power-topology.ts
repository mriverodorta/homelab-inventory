import { nextNumericId } from '@/lib/ids'
import {
  endpointKey,
  getConnectionPort,
  getConnectionType,
  isArchivedItem,
  touchProject,
} from '@/lib/project'
import type {
  ConnectionEndpoint,
  InventoryConnection,
  InventoryConnectionType,
  InventoryItem,
  ProjectState,
  ValidationResult,
} from '@/types/inventory'

export const POWER_INPUT_PORT_KEY = 'ac-input'

export type PowerEndpointDirection = 'input' | 'output'
export type PowerEndpointKind =
  | 'ups-outlet'
  | 'power-strip-outlet'
  | 'power-strip-input'
  | 'monitor-input'
  | 'nas-internal-input'
  | 'pc-power-supply-input'
  | 'oem-power-adapter-input'

export type PowerEndpoint = {
  endpoint: ConnectionEndpoint
  direction: PowerEndpointDirection
  kind: PowerEndpointKind
  label: string
  allowFanOut: boolean
}

export type PowerTopologyFindingCode =
  | 'power.host.missing-input'
  | 'power.host.unpowered'
  | 'power.monitor.unpowered'
  | 'power.connection.stale-endpoint'
  | 'power.connection.invalid-direction'
  | 'power.connection.duplicate-input'
  | 'power.connection.output-fan-out'
  | 'power.connection.misclassified'

export type PowerTopologyFinding = {
  id: string
  code: PowerTopologyFindingCode
  severity: 'warning' | 'error'
  message: string
  itemId?: string
  connectionId?: string | number
  endpoint?: ConnectionEndpoint
}

type PowerConnectionResult =
  | { ok: true; project: ProjectState; connection: InventoryConnection }
  | { ok: false; message: string }

function itemEntry(project: ProjectState, itemId: string): [string, InventoryItem] | null {
  const item = project.items[itemId]
  return item && !isArchivedItem(item) ? [itemId, item] : null
}

function assignedComponent(
  project: ProjectState,
  hostId: string,
  type: 'powerSupply' | 'powerAdapter',
): [string, InventoryItem] | null {
  const assignment = project.assignments.find(
    (candidate) => candidate.serverId === hostId && candidate.type === type,
  )

  return assignment ? itemEntry(project, assignment.itemId) : null
}

function powerInputPort(item: InventoryItem) {
  return item.ports?.find((port) => port.key === POWER_INPUT_PORT_KEY && port.type === 'ac-input')
}

function outputEndpoints(itemId: string, item: InventoryItem): PowerEndpoint[] {
  if (item.type !== 'ups' && item.type !== 'powerStrip') {
    return []
  }

  return (item.ports ?? [])
    .filter((port) => port.type === 'ac-outlet')
    .map((port) => ({
      endpoint: {
        itemId,
        portId: port.id,
      },
      direction: 'output' as const,
      kind: item.type === 'ups' ? 'ups-outlet' as const : 'power-strip-outlet' as const,
      label: `${item.name} / ${port.label ?? `Outlet ${port.slotNumber}`}`,
      allowFanOut: item.specs?.allowOutletFanOut === true,
    }))
}

function monitorInput(itemId: string, item: InventoryItem): PowerEndpoint | null {
  if (item.type !== 'monitor') {
    return null
  }
  const port = powerInputPort(item)
  if (!port) return null

  return {
    endpoint: { itemId, portId: port.id },
    direction: 'input',
    kind: 'monitor-input',
    label: `${item.name} / AC input`,
    allowFanOut: false,
  }
}

function powerStripInput(itemId: string, item: InventoryItem): PowerEndpoint | null {
  if (item.type !== 'powerStrip') {
    return null
  }
  const port = powerInputPort(item)
  if (!port) return null

  return {
    endpoint: { itemId, portId: port.id },
    direction: 'input',
    kind: 'power-strip-input',
    label: `${item.name} / AC input`,
    allowFanOut: false,
  }
}

function nasInternalInput(itemId: string, item: InventoryItem): PowerEndpoint | null {
  if (item.type !== 'nas' || item.specs?.powerConfiguration !== 'internal-psu') {
    return null
  }
  const port = powerInputPort(item)
  if (!port) return null

  return {
    endpoint: { itemId, portId: port.id },
    direction: 'input',
    kind: 'nas-internal-input',
    label: `${item.name} / AC input`,
    allowFanOut: false,
  }
}

function hostInput(project: ProjectState, itemId: string, item: InventoryItem): PowerEndpoint | null {
  const componentType = item.type === 'pcBuild'
    ? 'powerSupply'
    : item.type === 'server'
      || (item.type === 'nas' && item.specs?.powerConfiguration === 'external-adapter')
      ? 'powerAdapter'
      : null

  if (!componentType) {
    return null
  }

  const component = assignedComponent(project, itemId, componentType)

  if (!component) {
    return null
  }
  const port = powerInputPort(component[1])
  if (!port) return null

  return {
    endpoint: {
      itemId,
      hostedItemId: component[0],
      portId: port.id,
    },
    direction: 'input',
    kind: componentType === 'powerSupply'
      ? 'pc-power-supply-input'
      : 'oem-power-adapter-input',
    label: `${item.name} / ${component[1].name} / AC input`,
    allowFanOut: false,
  }
}

export function powerOutletEndpoint(itemId: string, portId: number): ConnectionEndpoint {
  return { itemId, portId }
}

export function monitorPowerInputEndpoint(itemId: string, portId = 1): ConnectionEndpoint {
  return { itemId, portId }
}

export function powerStripPowerInputEndpoint(itemId: string, portId = 1): ConnectionEndpoint {
  return { itemId, portId }
}

export function getPowerEndpoints(project: ProjectState): PowerEndpoint[] {
  return Object.entries(project.items).flatMap(([itemId, item]) => {
    if (isArchivedItem(item)) {
      return []
    }

    const directInput = monitorInput(itemId, item)
      ?? powerStripInput(itemId, item)
      ?? nasInternalInput(itemId, item)
    const assignedInput = hostInput(project, itemId, item)
    return [
      ...outputEndpoints(itemId, item),
      ...(directInput ? [directInput] : []),
      ...(assignedInput ? [assignedInput] : []),
    ]
  })
}

export function resolvePowerEndpoint(
  project: ProjectState,
  endpoint: ConnectionEndpoint,
): PowerEndpoint | null {
  const key = endpointKey(endpoint)
  return getPowerEndpoints(project).find(
    (candidate) => endpointKey(candidate.endpoint) === key,
  ) ?? null
}

export function classifyConnectionEndpoints(
  project: ProjectState,
  from: ConnectionEndpoint,
  to: ConnectionEndpoint,
): InventoryConnectionType {
  const fromPower = resolvePowerEndpoint(project, from)
  const toPower = resolvePowerEndpoint(project, to)

  if (fromPower || toPower) {
    return fromPower && toPower ? 'power' : 'other'
  }

  const fromPort = getConnectionPort(project, from)
  const toPort = getConnectionPort(project, to)
  return fromPort && toPort ? getConnectionType(fromPort.type, toPort.type) : 'other'
}

function endpointConnectionCount(project: ProjectState, endpoint: ConnectionEndpoint): number {
  const key = endpointKey(endpoint)
  return project.connections.filter(
    (connection) => endpointKey(connection.from) === key || endpointKey(connection.to) === key,
  ).length
}

export function validatePowerConnection(
  project: ProjectState,
  from: ConnectionEndpoint,
  to: ConnectionEndpoint,
): ValidationResult {
  if (endpointKey(from) === endpointKey(to)) {
    return { ok: false, message: 'Choose two different power endpoints to connect.' }
  }

  const output = resolvePowerEndpoint(project, from)
  const input = resolvePowerEndpoint(project, to)

  if (!output || !input) {
    return { ok: false, message: 'One of the selected power endpoints is no longer available.' }
  }

  if (output.direction !== 'output' || input.direction !== 'input') {
    return { ok: false, message: 'Power connections must run from an outlet to an AC input.' }
  }

  if (from.itemId === to.itemId) {
    return { ok: false, message: 'Power equipment cannot connect to itself.' }
  }

  if (endpointConnectionCount(project, to) > 0) {
    return { ok: false, message: 'That AC input already has a power connection.' }
  }

  if (!output.allowFanOut && endpointConnectionCount(project, from) > 0) {
    return { ok: false, message: 'That outlet already has a power connection.' }
  }

  return { ok: true }
}

export function createPowerConnection(
  project: ProjectState,
  from: ConnectionEndpoint,
  to: ConnectionEndpoint,
): PowerConnectionResult {
  const validation = validatePowerConnection(project, from, to)

  if (!validation.ok) {
    return validation
  }

  const connection: InventoryConnection = {
    id: nextNumericId(project.connections.map((candidate) => candidate.id)),
    from,
    to,
    type: 'power',
    createdAt: new Date().toISOString(),
  }

  return {
    ok: true,
    connection,
    project: touchProject({
      ...project,
      connections: [...project.connections, connection],
    }),
  }
}

export function removePowerConnection(
  project: ProjectState,
  connectionId: string | number,
): { ok: true; project: ProjectState } | { ok: false; message: string } {
  const connection = project.connections.find(
    (candidate) => String(candidate.id) === String(connectionId),
  )

  if (!connection) {
    return { ok: false, message: 'That power connection no longer exists.' }
  }

  if (connection.type !== 'power') {
    return { ok: false, message: 'Only power connections can be removed with this operation.' }
  }

  return {
    ok: true,
    project: touchProject({
      ...project,
      connections: project.connections.filter(
        (candidate) => String(candidate.id) !== String(connectionId),
      ),
    }),
  }
}

function findingId(
  code: PowerTopologyFindingCode,
  subject: string | number,
  detail = '',
): string {
  return [code, subject, detail].filter(Boolean).join(':')
}

function connectionFindings(project: ProjectState): PowerTopologyFinding[] {
  const findings: PowerTopologyFinding[] = []
  const inputConnections = new Map<string, InventoryConnection[]>()
  const outputConnections = new Map<string, InventoryConnection[]>()

  for (const connection of project.connections) {
    const from = resolvePowerEndpoint(project, connection.from)
    const to = resolvePowerEndpoint(project, connection.to)

    if (connection.type !== 'power') {
      if (from || to) {
        findings.push({
          id: findingId('power.connection.misclassified', connection.id),
          code: 'power.connection.misclassified',
          severity: 'error',
          message: `Connection ${String(connection.id)} uses a power endpoint but is classified as ${connection.type}.`,
          connectionId: connection.id,
        })
      }
      continue
    }

    if (!from || !to) {
      findings.push({
        id: findingId('power.connection.stale-endpoint', connection.id),
        code: 'power.connection.stale-endpoint',
        severity: 'error',
        message: `Power connection ${String(connection.id)} references a missing endpoint.`,
        connectionId: connection.id,
        endpoint: !from ? connection.from : connection.to,
      })
      continue
    }

    if (from.direction !== 'output' || to.direction !== 'input' || from.endpoint.itemId === to.endpoint.itemId) {
      findings.push({
        id: findingId('power.connection.invalid-direction', connection.id),
        code: 'power.connection.invalid-direction',
        severity: 'error',
        message: `Power connection ${String(connection.id)} must run from an outlet to a different device's AC input.`,
        connectionId: connection.id,
      })
      continue
    }

    const inputKey = endpointKey(to.endpoint)
    inputConnections.set(inputKey, [...(inputConnections.get(inputKey) ?? []), connection])
    const outputKey = endpointKey(from.endpoint)
    outputConnections.set(outputKey, [...(outputConnections.get(outputKey) ?? []), connection])
  }

  for (const connections of inputConnections.values()) {
    if (connections.length <= 1) {
      continue
    }

    for (const connection of connections.slice(1)) {
      findings.push({
        id: findingId('power.connection.duplicate-input', connection.id),
        code: 'power.connection.duplicate-input',
        severity: 'error',
        message: `Power connection ${String(connection.id)} shares an AC input with another connection.`,
        connectionId: connection.id,
        endpoint: connection.to,
      })
    }
  }

  for (const connections of outputConnections.values()) {
    const output = resolvePowerEndpoint(project, connections[0].from)
    if (connections.length <= 1 || output?.allowFanOut) {
      continue
    }

    for (const connection of connections.slice(1)) {
      findings.push({
        id: findingId('power.connection.output-fan-out', connection.id),
        code: 'power.connection.output-fan-out',
        severity: 'error',
        message: `Power connection ${String(connection.id)} shares an outlet that does not allow fan-out.`,
        connectionId: connection.id,
        endpoint: connection.from,
      })
    }
  }

  return findings
}

function inputIsPowered(project: ProjectState, input: PowerEndpoint): boolean {
  const key = endpointKey(input.endpoint)
  return project.connections.some(
    (connection) => connection.type === 'power'
      && endpointKey(connection.to) === key
      && resolvePowerEndpoint(project, connection.from)?.direction === 'output',
  )
}

function unpoweredFindings(project: ProjectState): PowerTopologyFinding[] {
  const findings: PowerTopologyFinding[] = []
  const placedIds = new Set(project.placements.map((placement) => placement.serverId))

  for (const itemId of placedIds) {
    const item = project.items[itemId]
    if (!item || isArchivedItem(item)) {
      continue
    }

    if (item.type === 'monitor') {
      const input = monitorInput(itemId, item)
      if (input && !inputIsPowered(project, input)) {
        findings.push({
          id: findingId('power.monitor.unpowered', itemId),
          code: 'power.monitor.unpowered',
          severity: 'warning',
          message: `${item.name} is not connected to a power source.`,
          itemId,
          endpoint: input.endpoint,
        })
      }
      continue
    }

    if (item.type !== 'server' && item.type !== 'nas' && item.type !== 'pcBuild') {
      continue
    }

    const input = nasInternalInput(itemId, item) ?? hostInput(project, itemId, item)
    if (!input) {
      const requiredComponent = item.type === 'pcBuild' ? 'power supply' : 'power adapter'
      findings.push({
        id: findingId('power.host.missing-input', itemId),
        code: 'power.host.missing-input',
        severity: 'warning',
        message: `${item.name} needs an assigned ${requiredComponent} before it can be powered.`,
        itemId,
      })
    } else if (!inputIsPowered(project, input)) {
      findings.push({
        id: findingId('power.host.unpowered', itemId),
        code: 'power.host.unpowered',
        severity: 'warning',
        message: `${item.name} is not connected to a power source.`,
        itemId,
        endpoint: input.endpoint,
      })
    }
  }

  return findings
}

export function getPowerTopologyFindings(project: ProjectState): PowerTopologyFinding[] {
  return [...connectionFindings(project), ...unpoweredFindings(project)]
}
