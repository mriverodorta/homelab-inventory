import {
  endpointKey,
  getConnectionPort,
} from '@/lib/project'
import {
  evaluateProjectCompatibility,
  isHostCompatibilityEnabled,
  normalizeCompatibilityPolicy,
} from '@/lib/compatibility'
import { runtimeItemKey } from '@/lib/item-keys'
import type {
  RuntimeNetworkTrace,
  RuntimePowerEndpoint,
  RuntimePowerFinding,
  RuntimeTopologyEndpointDescriptor,
} from '@/engine/topology'
import type { CompatibilityFinding, CompatibilitySeverity } from '@/types/compatibility'
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
  code?: string
  severity?: CompatibilitySeverity
}

export type ProjectAuditGroup = {
  item: InventoryItem
  warnings: AuditWarning[]
}

export type AuditVisibility = 'open' | 'ignored'

export type AuditQuery = {
  visibility?: AuditVisibility
}

export type AuditTopologySnapshot = {
  endpoints: readonly RuntimeTopologyEndpointDescriptor[]
  networkTraces: readonly RuntimeNetworkTrace[]
  powerEndpoints: readonly RuntimePowerEndpoint[]
  powerFindings: readonly RuntimePowerFinding[]
}

type AuditEvaluationContext = {
  compatibilityResults: ReturnType<typeof evaluateProjectCompatibility>
  placedItemIds: Set<string>
  endpointsByKey: ReadonlyMap<string, RuntimeTopologyEndpointDescriptor>
  networkTraces: readonly RuntimeNetworkTrace[]
  powerEndpointsByKey: ReadonlyMap<string, RuntimePowerEndpoint>
  powerFindings: readonly RuntimePowerFinding[]
}

function createAuditEvaluationContext(
  project: ProjectState,
  topology?: AuditTopologySnapshot,
): AuditEvaluationContext {
  return {
    compatibilityResults: evaluateProjectCompatibility(project),
    placedItemIds: new Set(project.placements.map((placement) => placement.serverId)),
    endpointsByKey: new Map(
      (topology?.endpoints ?? []).map((endpoint) => [endpointKey(endpoint.endpoint), endpoint]),
    ),
    networkTraces: topology?.networkTraces ?? [],
    powerEndpointsByKey: new Map(
      (topology?.powerEndpoints ?? []).map((endpoint) => [endpointKey(endpoint.endpoint), endpoint]),
    ),
    powerFindings: topology?.powerFindings ?? [],
  }
}

function portSlot(port: InventoryPort): string {
  return String(port.slotNumber).padStart(2, '0')
}

function isEndpointConnected(
  context: AuditEvaluationContext,
  endpoint: ConnectionEndpoint,
): boolean {
  return (context.endpointsByKey.get(endpointKey(endpoint))?.connection_ids.length ?? 0) > 0
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
  endpointId: number,
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
  item: InventoryItem,
  port: InventoryPort,
  context: AuditEvaluationContext,
): ConnectionEndpoint[] {
  return getPortEndpoints(item, port).filter((endpoint) => isEndpointConnected(context, endpoint))
}

function isPortConnected(
  item: InventoryItem,
  port: InventoryPort,
  context: AuditEvaluationContext,
): boolean {
  return getConnectedPortEndpoints(item, port, context).length > 0
}

function getStaleConnectionWarnings(
  project: ProjectState,
  item: InventoryItem,
  context: AuditEvaluationContext,
): AuditWarning[] {
  const key = runtimeItemKey(item)

  return (project.connections ?? []).flatMap((connection) =>
    [connection.from, connection.to].flatMap((endpoint) => {
      if (
        connection.type === 'power'
        || context.powerEndpointsByKey.has(endpointKey(endpoint))
        || endpoint.itemId !== key
        || getConnectionPort(project, endpoint)
      ) {
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

function getPowerFindingConnection(
  project: ProjectState,
  finding: RuntimePowerFinding,
) {
  if (finding.connectionId === undefined) {
    return undefined
  }

  return project.connections.find(
    (connection) => String(connection.id) === String(finding.connectionId),
  )
}

function getPowerFindingOwnerId(
  project: ProjectState,
  finding: RuntimePowerFinding,
  placedItemIds: Set<string>,
  powerEndpointsByKey: ReadonlyMap<string, RuntimePowerEndpoint>,
): string | null {
  const candidates = [finding.itemId, finding.endpoint?.itemId].filter(
    (itemId): itemId is string => Boolean(itemId),
  )
  const connection = getPowerFindingConnection(project, finding)

  if (connection) {
    const powerEndpoints = [connection.from, connection.to].filter((endpoint) =>
      powerEndpointsByKey.has(endpointKey(endpoint)),
    )
    candidates.push(
      ...powerEndpoints.map((endpoint) => endpoint.itemId),
      connection.from.itemId,
      connection.to.itemId,
    )
  }

  return candidates.find((itemId) => placedItemIds.has(itemId)) ?? null
}

function getPowerAuditWarnings(
  project: ProjectState,
  itemId: string,
  context: AuditEvaluationContext,
): AuditWarning[] {
  if (!context.placedItemIds.has(itemId)) {
    return []
  }

  return context.powerFindings.flatMap((finding) => {
    const ownerId = getPowerFindingOwnerId(
      project,
      finding,
      context.placedItemIds,
      context.powerEndpointsByKey,
    )

    if (ownerId !== itemId) {
      return []
    }

    return [{
      id: finding.id,
      itemId: ownerId,
      message: finding.message,
      code: finding.code,
      severity: finding.severity,
    }]
  })
}

function getDisabledSwitchPortTraceWarning(
  project: ProjectState,
  trace: RuntimeNetworkTrace,
  context: AuditEvaluationContext,
): AuditWarning | null {
  const startPort = getConnectionPort(project, trace.start)

  if (!startPort || !isEndpointConnected(context, trace.start)) {
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
    id: `server-network-disabled-switch-${trace.start.itemId}-${startPort.id}`,
    itemId: trace.start.itemId,
    message: `LAN port ${portSlot(startPort)} traces to disabled switch port ${portSlot(switchPort)} on ${switchItem.name}.`,
  }
}

function getServerAuditWarnings(
  project: ProjectState,
  item: InventoryItem,
  context: AuditEvaluationContext,
): AuditWarning[] {
  const warnings: AuditWarning[] = []
  const key = runtimeItemKey(item)

  for (const trace of context.networkTraces.filter((candidate) => candidate.start.itemId === key)) {
    const startPort = getConnectionPort(project, trace.start)
    const disabledSwitchWarning = getDisabledSwitchPortTraceWarning(project, trace, context)

    if (!trace.complete && startPort && isEndpointConnected(context, trace.start)) {
      warnings.push({
        id: `server-network-path-incomplete-${key}-${startPort.id}`,
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

function getSwitchAuditWarnings(
  item: InventoryItem,
  context: AuditEvaluationContext,
): AuditWarning[] {
  const ports = item.ports ?? []
  const key = runtimeItemKey(item)

  if (ports.length === 0) {
    return []
  }

  const warnings: AuditWarning[] = []
  const connectedPorts = ports.filter((port) => isPortConnected(item, port, context))
  const hasConnectedPort = connectedPorts.length > 0

  if (!hasConnectedPort) {
    return []
  }

  for (const port of connectedPorts) {
    if (port.role !== 'disabled') {
      continue
    }

    warnings.push({
      id: `switch-disabled-port-connected-${key}-${port.id}`,
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

function compatibilityResourceKey(
  finding: CompatibilityFinding,
  componentKey: string,
): string {
  return String(finding.resourceId ?? finding.field ?? componentKey)
}

function compatibilityWarningId(
  hostKey: string,
  finding: CompatibilityFinding,
  componentKey: string,
): string {
  return `compatibility:${JSON.stringify([
    hostKey,
    finding.code,
    componentKey,
    compatibilityResourceKey(finding, componentKey),
  ])}`
}

function getCompatibilityAuditWarnings(
  project: ProjectState,
  host: InventoryItem,
  context: AuditEvaluationContext,
): AuditWarning[] {
  if (host.type !== 'server' && host.type !== 'nas') {
    return []
  }

  const hostKey = runtimeItemKey(host)
  const seen = new Set<string>()
  const warnings: AuditWarning[] = []

  for (const result of context.compatibilityResults) {
    if (String(result.hostId) !== hostKey) {
      continue
    }

    const componentKey = String(result.itemId)
    const component = project.items[componentKey]

    for (const finding of result.findings) {
      const resourceKey = compatibilityResourceKey(finding, componentKey)
      const dedupeKey = JSON.stringify([hostKey, finding.code, resourceKey])

      if (seen.has(dedupeKey)) {
        continue
      }

      seen.add(dedupeKey)
      warnings.push({
        id: compatibilityWarningId(hostKey, finding, componentKey),
        itemId: hostKey,
        message: component ? `${component.name}: ${finding.message}` : finding.message,
        code: finding.code,
        severity: finding.severity,
      })
    }
  }

  return warnings
}

function getRawItemAuditWarnings(
  project: ProjectState,
  itemId: string,
  context: AuditEvaluationContext,
): AuditWarning[] {
  const item = project.items[itemId]

  if (!item) {
    return []
  }

  const warnings = getStaleConnectionWarnings(project, item, context)

  if (item.type === 'server') {
    warnings.push(...getServerAuditWarnings(project, item, context))
  }

  if (item.type === 'switch') {
    warnings.push(...getSwitchAuditWarnings(item, context))
  }

  if (isHostCompatibilityEnabled(project, itemId)) {
    warnings.push(...getCompatibilityAuditWarnings(project, item, context))
  }

  warnings.push(...getPowerAuditWarnings(project, itemId, context))

  return warnings
}

function warningMatchesVisibility(
  ignoredIds: Set<string>,
  warning: AuditWarning,
  visibility: AuditVisibility,
): boolean {
  return visibility === 'ignored'
    ? ignoredIds.has(warning.id)
    : !ignoredIds.has(warning.id)
}

export function getItemAuditWarnings(
  project: ProjectState,
  itemId: string,
  query: AuditQuery = {},
  topology?: AuditTopologySnapshot,
): AuditWarning[] {
  const visibility = query.visibility ?? 'open'
  const policy = normalizeCompatibilityPolicy(project.compatibilityPolicy)
  const ignoredIds = new Set(policy.ignoredWarningIds)

  return getRawItemAuditWarnings(project, itemId, createAuditEvaluationContext(project, topology)).filter((warning) =>
    warningMatchesVisibility(ignoredIds, warning, visibility),
  )
}

export function getProjectAuditWarnings(
  project: ProjectState,
  query: AuditQuery = {},
  topology?: AuditTopologySnapshot,
): ProjectAuditGroup[] {
  const context = createAuditEvaluationContext(project, topology)
  const visibility = query.visibility ?? 'open'
  const policy = normalizeCompatibilityPolicy(project.compatibilityPolicy)
  const ignoredIds = new Set(policy.ignoredWarningIds)

  return Object.values(project.items)
    .filter((item) => context.placedItemIds.has(runtimeItemKey(item)))
    .map((item) => ({
      item,
      warnings: getRawItemAuditWarnings(project, runtimeItemKey(item), context).filter((warning) =>
        warningMatchesVisibility(ignoredIds, warning, visibility),
      ),
    }))
    .filter((group) => group.warnings.length > 0)
    .sort((first, second) => first.item.name.localeCompare(second.item.name))
}
