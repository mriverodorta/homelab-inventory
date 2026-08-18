import { nasOwnsPowerEndpoint, nasPowerTopology } from '../../shared/power-ports.mjs'
import {
  isLegacyWlanExpansionResource,
  planWlanResourceMigration,
  wlanResourceReclassification,
} from './wlan-resource-migration.mjs'

function runtimeKey(type, id) {
  return `${type}:${id}`
}

function endpointRole(connection, endpoint) {
  if (connection.from === endpoint) return 'from'
  if (connection.to === endpoint) return 'to'
  return null
}

function normalizedText(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function unique(values) {
  return values.length === 1 ? values[0] : null
}

function uniquePortByKey(ports, key, type) {
  const normalizedKey = normalizedText(key)
  if (!normalizedKey) return null
  return unique(ports.filter((port) => (
    normalizedText(port.key) === normalizedKey
    && (type === undefined || port.type === type)
  )))
}

function targetPort(currentPort, nextPorts) {
  const sameId = nextPorts.find((port) => port.id === currentPort.id)
  if (sameId?.type === currentPort.type) return sameId
  return uniquePortByKey(nextPorts, currentPort.key, currentPort.type)
}

function itemIdentityMatches(item, definition) {
  if (!item || !definition || item.type !== definition.type) return false
  const fields = ['manufacturer', 'model', 'number']
  const comparable = fields.filter((field) => normalizedText(definition[field]))
  return comparable.length > 0 && comparable.every((field) => (
    normalizedText(item[field]) === normalizedText(definition[field])
  ))
}

function fixedComponentOperations({ current, next, project, hostKey }) {
  const currentFixed = Array.isArray(current.fixedComponents) ? current.fixedComponents : []
  const nextFixed = Array.isArray(next.fixedComponents) ? next.fixedComponents : []
  const existingKeys = new Set(currentFixed.map((component) => (
    `${component.componentType}:${component.id}`
  )))
  const operations = []
  for (const component of nextFixed.filter((entry) => !existingKeys.has(`${entry.componentType}:${entry.id}`))) {
    const assignments = project.assignments.filter((assignment) => (
      assignment.serverId === hostKey
      && assignment.type === component.componentType
      && itemIdentityMatches(project.items[assignment.itemId], component.item)
    ))
    if (assignments.length > 1) {
      return { available: false, reason: `More than one assigned ${component.componentType} matches fixed component ${component.id}.` }
    }
    const assignment = assignments[0]
    if (!assignment) continue
    const connected = project.connections.some((connection) => (
      connection.from.hostedItemId === assignment.itemId
      || connection.to.hostedItemId === assignment.itemId
    ))
    if (connected) {
      return { available: false, reason: `Assigned ${component.componentType} ${assignment.itemId} has a connected port without a unique fixed endpoint.` }
    }
    operations.push({
      kind: 'unassign-item',
      assignmentId: assignment.id,
      itemType: project.items[assignment.itemId]?.type ?? component.componentType,
      itemId: project.items[assignment.itemId]?.id,
      returnToInventory: true,
    })
  }
  return { available: true, operations }
}

const RESOURCE_COLLECTIONS = Object.freeze([
  ['storageSlots', 'storage'],
  ['expansionSlots', 'expansion'],
  ['optionalModuleSlots', 'optionalModule'],
  ['controllerSlots', 'controllerSlot'],
  ['bootDeviceSlots', 'bootDeviceSlot'],
])

function hostResources(item) {
  const host = item.compatibility?.host ?? {}
  return RESOURCE_COLLECTIONS.flatMap(([collection, resourceType]) => (
    Array.isArray(host[collection])
      ? host[collection].map((resource) => ({ ...resource, collection, resourceType }))
      : []
  ))
}

function resourceIdentity(resource) {
  return Number.isSafeInteger(resource?.id) && resource.id > 0
    ? `${resource.resourceType}:${resource.id}`
    : null
}

function resourceAssignments(project, hostKey, resource) {
  return project.assignments.filter((assignment) => (
    assignment.serverId === hostKey
    && assignment.allocation?.resourceType === resource.resourceType
    && (
      assignment.allocation?.groupId === resource.id
      || (
        assignment.allocation?.groupId == null
        && assignment.allocation?.resourceKey === resource.key
      )
    )
  ))
}

function releaseAssignment(project, assignment) {
  return {
    kind: 'unassign-item',
    assignmentId: assignment.id,
    itemType: project.items[assignment.itemId]?.type ?? assignment.type,
    itemId: project.items[assignment.itemId]?.id,
    returnToInventory: true,
  }
}

function resourceRelationshipOperations({ current, next, project, hostKey }) {
  const currentResources = hostResources(current)
  const nextResources = hostResources(next)
  if (currentResources.length === 0) {
    return { available: true, operations: [] }
  }
  const nextByIdentity = new Map()
  for (const resource of nextResources) {
    const identity = resourceIdentity(resource)
    if (!identity) continue
    if (nextByIdentity.has(identity)) {
      return { available: false, reason: `The proposed topology contains duplicate resource identity ${identity}.` }
    }
    nextByIdentity.set(identity, resource)
  }

  const operations = []
  const handledResources = new Set()
  const wlanMigration = planWlanResourceMigration(current, next)
  const legacyWlanResources = currentResources.filter((resource) => (
    resource.resourceType === 'expansion' && isLegacyWlanExpansionResource(resource)
  ))
  if (wlanMigration.status === 'ambiguous' && legacyWlanResources.length > 0) {
    return { available: false, reason: wlanMigration.reason }
  }
  if (wlanMigration.status === 'ready') {
    const source = { ...wlanMigration.source, resourceType: 'expansion' }
    const assignments = resourceAssignments(project, hostKey, source)
    for (const assignment of assignments) {
      for (const position of assignment.allocation?.positions ?? []) {
        if (!Number.isSafeInteger(position) || position < 0 || position >= wlanMigration.count) {
          return {
            available: false,
            reason: `Assigned WLAN resource uses position ${Number(position) + 1}, but the proposed resource has ${wlanMigration.count} slots.`,
          }
        }
      }
    }
    operations.push(wlanResourceReclassification(
      wlanMigration,
      assignments.map((assignment) => assignment.id),
    ))
    handledResources.add(`expansion:${wlanMigration.source.id}:${wlanMigration.source.key}`)
  }
  for (const resource of currentResources) {
    if (handledResources.has(`${resource.resourceType}:${resource.id}:${resource.key}`)) continue
    const assignments = resourceAssignments(project, hostKey, resource)
    if (assignments.length === 0) continue
    const identity = resourceIdentity(resource)
    const sameIdentity = identity ? nextByIdentity.get(identity) : null
    if (sameIdentity) {
      if (sameIdentity.key === resource.key) continue
      const count = Number.isSafeInteger(sameIdentity.count) && sameIdentity.count > 0 ? sameIdentity.count : 1
      for (const assignment of assignments) {
        for (const position of assignment.allocation?.positions ?? []) {
          if (!Number.isSafeInteger(position) || position < 0 || position >= count) {
            return {
              available: false,
              reason: `Assigned resource ${identity} uses position ${Number(position) + 1}, but the proposed resource has ${count} slots.`,
            }
          }
        }
      }
      operations.push({
        kind: 'remap-resource-key',
        resourceType: resource.resourceType,
        resourceId: resource.id,
        fromKey: resource.key,
        toKey: sameIdentity.key,
        assignmentIds: assignments.map((assignment) => assignment.id).sort((left, right) => left - right),
      })
      continue
    }
    const sameKeyTargets = nextResources.filter((candidate) => (
      candidate.resourceType === resource.resourceType && candidate.key === resource.key
    ))
    if (sameKeyTargets.length === 1) continue
    operations.push(...assignments.map((assignment) => releaseAssignment(project, assignment)))
  }
  return { available: true, operations }
}

function portRemapOperations({ current, next, project, link, hostKey }) {
  const currentPorts = Array.isArray(current.ports) ? current.ports : []
  const nextPorts = Array.isArray(next.ports) ? next.ports : []
  const operations = []
  for (const connection of project.connections) {
    for (const endpoint of [connection.from, connection.to]) {
      if (endpoint.itemId !== hostKey || endpoint.hostedItemId) continue
      const currentPort = currentPorts.find((port) => port.id === endpoint.portId)
      if (!currentPort) {
        return { available: false, reason: `Connection ${connection.id} references missing current port ${endpoint.portId}.` }
      }
      const target = targetPort(currentPort, nextPorts)
      if (!target) {
        return { available: false, reason: `Connected port ${endpoint.portId} has no unique target in the Registry definition.` }
      }
      if (target.id === endpoint.portId) continue
      operations.push({
        kind: 'move-connection-endpoint',
        connectionId: connection.id,
        endpointRole: endpointRole(connection, endpoint),
        from: { itemType: link.itemType, itemId: link.itemId, portId: endpoint.portId },
        to: { itemType: link.itemType, itemId: link.itemId, portId: target.id },
      })
    }
  }
  return { available: true, operations }
}

function powerAdapterOperations({ current, next, project, link, hostKey }) {
  if (link.itemType !== 'nas') return { available: true, operations: [] }
  const currentPower = nasPowerTopology(current)
  if (
    currentPower.configuration !== 'external-adapter'
    || currentPower.adapterDisposition !== 'replaceable'
    || !nasOwnsPowerEndpoint(next)
  ) return { available: true, operations: [] }

  const assignments = project.assignments.filter((assignment) => (
    assignment.serverId === hostKey && assignment.type === 'powerAdapter'
  ))
  if (assignments.length > 1) return { available: false, reason: 'More than one power adapter is assigned to this NAS.' }
  const assignment = assignments[0]
  if (!assignment) return { available: true, operations: [] }
  const target = unique((next.ports ?? []).filter((port) => port.key === 'ac-input' && port.type === 'ac-input'))
  if (!target) return { available: false, reason: 'The fixed NAS power topology has no unique AC input.' }

  const operations = []
  for (const connection of project.connections) {
    for (const endpoint of [connection.from, connection.to]) {
      if (endpoint.itemId !== hostKey || endpoint.hostedItemId !== assignment.itemId) continue
      operations.push({
        kind: 'move-connection-endpoint',
        connectionId: connection.id,
        endpointRole: endpointRole(connection, endpoint),
        from: {
          itemType: link.itemType,
          itemId: link.itemId,
          hostedItemType: 'powerAdapter',
          hostedItemId: project.items[assignment.itemId]?.id,
          portId: endpoint.portId,
        },
        to: { itemType: link.itemType, itemId: link.itemId, portId: target.id },
      })
    }
  }
  operations.push({
    kind: 'unassign-item',
    assignmentId: assignment.id,
    itemType: 'powerAdapter',
    itemId: project.items[assignment.itemId]?.id,
    returnToInventory: true,
  })
  return { available: true, operations }
}

function deduplicateOperations(operations) {
  const seen = new Set()
  return operations.filter((operation) => {
    const key = operation.kind === 'unassign-item'
      ? `assignment:${operation.assignmentId}`
      : operation.kind === 'remap-resource-key'
        ? `resource:${operation.resourceType}:${operation.resourceId}:${operation.fromKey}:${operation.toKey}`
        : ['remap-resource', 'reclassify-resource'].includes(operation.kind)
          ? `resource:${operation.from.resourceType}:${operation.from.resourceId}:${operation.from.key}:${operation.to.resourceType}:${operation.to.resourceId}:${operation.to.key}`
        : `connection:${operation.connectionId}:${operation.endpointRole}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function buildCatalogResolutionPlan({ current, next, project, link }) {
  const hostKey = runtimeKey(link.itemType, link.itemId)
  const partials = [
    portRemapOperations({ current, next, project, link, hostKey }),
    powerAdapterOperations({ current, next, project, link, hostKey }),
    fixedComponentOperations({ current, next, project, hostKey }),
    resourceRelationshipOperations({ current, next, project, hostKey }),
  ]
  const unavailable = partials.find((partial) => !partial.available)
  if (unavailable) {
    return {
      available: false,
      operations: [],
      affectedRelationships: { connectionIds: [], assignmentIds: [] },
      reason: unavailable.reason,
    }
  }
  const operations = deduplicateOperations([
    ...partials.flatMap((partial) => partial.operations),
  ])
  return {
    available: operations.length > 0,
    operations,
    affectedRelationships: {
      connectionIds: [...new Set(operations.filter((entry) => entry.kind === 'move-connection-endpoint').map((entry) => entry.connectionId))],
      assignmentIds: [...new Set(operations.flatMap((entry) => (
        entry.kind === 'unassign-item' ? [entry.assignmentId]
          : ['remap-resource-key', 'remap-resource', 'reclassify-resource'].includes(entry.kind) ? entry.assignmentIds
            : []
      )))],
    },
    reason: operations.length > 0 ? 'A deterministic relationship migration is available.' : 'No relationship migration is required.',
  }
}

export function applyCatalogResolutionPlan(project, plan) {
  if (!plan.available) throw new Error(plan.reason || 'Catalog update resolution is unavailable.')
  const draft = structuredClone(project)
  for (const operation of plan.operations) {
    if (operation.kind === 'remap-resource-key') {
      for (const assignmentId of operation.assignmentIds) {
        const assignment = draft.assignments.find((entry) => entry.id === assignmentId)
        if (!assignment) throw new Error(`Assignment ${assignmentId} does not exist.`)
        if (
          assignment.allocation?.resourceType !== operation.resourceType
          || assignment.allocation?.resourceKey !== operation.fromKey
          || assignment.allocation?.groupId !== operation.resourceId
        ) throw new Error(`Assignment ${assignmentId} changed after the resource remap was planned.`)
        assignment.allocation.resourceKey = operation.toKey
      }
      continue
    }
    if (['remap-resource', 'reclassify-resource'].includes(operation.kind)) {
      for (const assignmentId of operation.assignmentIds) {
        const assignment = draft.assignments.find((entry) => entry.id === assignmentId)
        if (!assignment) throw new Error(`Assignment ${assignmentId} does not exist.`)
        if (
          assignment.allocation?.resourceType !== operation.from.resourceType
          || assignment.allocation?.resourceKey !== operation.from.key
          || assignment.allocation?.groupId !== operation.from.resourceId
        ) throw new Error(`Assignment ${assignmentId} changed after the resource migration was planned.`)
        Object.assign(assignment.allocation, {
          resourceType: operation.to.resourceType,
          groupId: operation.to.resourceId,
          resourceKey: operation.to.key,
        })
      }
      continue
    }
    if (operation.kind === 'unassign-item') {
      const index = draft.assignments.findIndex((assignment) => assignment.id === operation.assignmentId)
      if (index < 0) throw new Error(`Assignment ${operation.assignmentId} does not exist.`)
      draft.assignments.splice(index, 1)
      continue
    }
    const connection = draft.connections.find((entry) => entry.id === operation.connectionId)
    if (!connection || !['from', 'to'].includes(operation.endpointRole)) {
      throw new Error(`Connection ${operation.connectionId} endpoint does not exist.`)
    }
    const endpoint = connection[operation.endpointRole]
    const expectedHost = runtimeKey(operation.from.itemType, operation.from.itemId)
    if (
      endpoint.itemId !== expectedHost
      || endpoint.portId !== operation.from.portId
      || (operation.from.hostedItemId !== undefined
        && endpoint.hostedItemId !== runtimeKey(operation.from.hostedItemType, operation.from.hostedItemId))
    ) throw new Error(`Connection ${operation.connectionId} changed after the resolution was planned.`)
    connection[operation.endpointRole] = {
      itemId: runtimeKey(operation.to.itemType, operation.to.itemId),
      portId: operation.to.portId,
      ...(operation.to.hostedItemId === undefined
        ? {}
        : { hostedItemId: runtimeKey(operation.to.hostedItemType, operation.to.hostedItemId) }),
    }
  }
  return draft
}
