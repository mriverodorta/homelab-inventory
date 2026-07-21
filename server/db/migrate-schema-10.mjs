import { assertRelationalId, parseLegacyRelationalId } from './relational-ids.mjs'
import { legacyPowerPortKey, withCanonicalPowerPorts } from '../../shared/power-ports.mjs'

const HOST_TYPES = new Set(['server', 'nas', 'pcBuild'])
const RESOURCE_GROUP_FIELD = {
  storage: 'storageSlots',
  expansion: 'expansionSlots',
}
const TYPE_BY_TABLE = {
  servers: 'server', pcBuilds: 'pcBuild', cpus: 'cpu', ram: 'ram', storage: 'storage',
  networkCards: 'network', gpus: 'gpu', motherboards: 'motherboard', cpuCoolers: 'cpuCooler',
  cases: 'case', powerSupplies: 'powerSupply', soundCards: 'soundCard', wirelessCards: 'wireless',
  powerAdapters: 'powerAdapter', nas: 'nas', switches: 'switch', patchPanels: 'patchPanel',
  monitors: 'monitor', upsSystems: 'ups', powerStrips: 'powerStrip',
}

function referenceKey(type, id) {
  return `${type}:${id}`
}

function migrateServerId(value, field) {
  if (typeof value === 'string') {
    const match = value.match(/^server:([1-9]\d*)$/)
    if (match) return parseLegacyRelationalId(match[1], field)
  }

  return parseLegacyRelationalId(value, field)
}

function migrateAgentRecords(records, collection) {
  const migrated = Object.entries(records ?? {}).map(([recordKey, record]) => {
    const id = parseLegacyRelationalId(record?.id ?? recordKey, `${collection}.${recordKey}.id`)
    return [String(id), {
      ...record,
      id,
      serverId: migrateServerId(record?.serverId, `${collection}.${recordKey}.serverId`),
    }]
  })
  if (new Set(migrated.map(([key]) => key)).size !== migrated.length) {
    throw new Error(`${collection} contains duplicate IDs after relational migration.`)
  }
  return Object.fromEntries(migrated)
}

function migrateAgents(agents) {
  return {
    enrollments: migrateAgentRecords(agents?.enrollments, 'agents.enrollments'),
    devices: migrateAgentRecords(agents?.devices, 'agents.devices'),
  }
}

function migrateAgentStatus(agentStatus) {
  const servers = Object.entries(agentStatus?.servers ?? {}).map(([serverKey, status]) => {
      const serverId = migrateServerId(status?.serverId ?? serverKey, `agentStatus.servers.${serverKey}.serverId`)
      return [String(serverId), { ...status, serverId }]
    })
  if (new Set(servers.map(([key]) => key)).size !== servers.length) {
    throw new Error('agentStatus.servers contains duplicate server IDs after relational migration.')
  }
  return { servers: Object.fromEntries(servers) }
}

function migrateGroups(groups, field) {
  if (!Array.isArray(groups)) return []

  const seenKeys = new Set()
  return groups.map((group, index) => {
    const key = String(group?.key ?? group?.id ?? '').trim()
    if (!key || seenKeys.has(key)) {
      throw new Error(`${field}[${index}] must have a unique semantic key.`)
    }
    seenKeys.add(key)

    return {
      ...group,
      id: index + 1,
      key,
    }
  })
}

function migratePorts(record, field) {
  const canonicalRecord = withCanonicalPowerPorts(record)
  if (!Array.isArray(canonicalRecord.ports)) return canonicalRecord

  const seenPortIds = new Set()
  return {
    ...canonicalRecord,
    ports: canonicalRecord.ports.map((port, portIndex) => {
      const portField = `${field}.ports[${portIndex}]`
      const id = parseLegacyRelationalId(port.id, `${portField}.id`)
      if (seenPortIds.has(id)) {
        throw new Error(`${field}.ports contains duplicate ID ${id} after relational migration.`)
      }
      seenPortIds.add(id)

      if (!Array.isArray(port.endpoints)) return { ...port, id }

      const seenEndpointIds = new Set()
      return {
        ...port,
        id,
        endpoints: port.endpoints.map((endpoint, endpointIndex) => {
          const endpointId = parseLegacyRelationalId(
            endpoint.id,
            `${portField}.endpoints[${endpointIndex}].id`,
          )
          if (seenEndpointIds.has(endpointId)) {
            throw new Error(
              `${portField}.endpoints contains duplicate ID ${endpointId} after relational migration.`,
            )
          }
          seenEndpointIds.add(endpointId)
          return { ...endpoint, id: endpointId }
        }),
      }
    }),
  }
}

function migrateInventory(inventory) {
  const migrated = structuredClone(inventory)
  const items = new Map()

  for (const [table, records] of Object.entries(migrated)) {
    if (!Array.isArray(records)) continue
    const type = TYPE_BY_TABLE[table]
    if (!type) continue

    migrated[table] = records.map((record, index) => {
      const id = parseLegacyRelationalId(record.id, `${table}[${index}].id`)
      const compatibility = record.compatibility?.host
        ? {
            ...record.compatibility,
            host: {
              ...record.compatibility.host,
              ...(Array.isArray(record.compatibility.host.storageSlots)
                ? {
                    storageSlots: migrateGroups(
                      record.compatibility.host.storageSlots,
                      `${table}[${index}].compatibility.host.storageSlots`,
                    ),
                  }
                : {}),
              ...(Array.isArray(record.compatibility.host.expansionSlots)
                ? {
                    expansionSlots: migrateGroups(
                      record.compatibility.host.expansionSlots,
                      `${table}[${index}].compatibility.host.expansionSlots`,
                    ),
                  }
                : {}),
            },
          }
        : record.compatibility
      const migratedRecord = migratePorts({
        ...record,
        id,
        type,
        ...(compatibility ? { compatibility } : {}),
      }, `${table}[${index}]`)
      delete migratedRecord.type
      items.set(referenceKey(type, id), { ...migratedRecord, type })
      return migratedRecord
    })
  }

  return { inventory: migrated, items }
}

function findCapabilitySource(project, items, assignment) {
  const host = items.get(referenceKey(assignment.hostType, assignment.hostId))
  if (host?.type !== 'pcBuild') return host

  const motherboardAssignment = project.assignments.find((candidate) => (
    candidate.hostType === assignment.hostType
    && candidate.hostId === assignment.hostId
    && candidate.itemType === 'motherboard'
  ))
  return motherboardAssignment
    ? items.get(referenceKey('motherboard', motherboardAssignment.itemId))
    : undefined
}

function migrateAllocation(project, items, assignment, allocation) {
  if (!allocation) return undefined
  const migrated = {
    ...allocation,
    positions: (allocation.positions ?? []).map((position, index) => {
      if (!Number.isSafeInteger(position) || position < 0) {
        throw new Error(`Assignment ${assignment.id} allocation.positions[${index}] is invalid.`)
      }
      return position
    }),
  }

  const groupField = RESOURCE_GROUP_FIELD[allocation.resourceType]
  if (!groupField) {
    delete migrated.groupId
    return migrated
  }

  const source = findCapabilitySource(project, items, assignment)
  const groups = source?.compatibility?.host?.[groupField] ?? []
  const legacyGroupId = allocation.groupId
  const matches = groups.filter((group) => (
    group.id === legacyGroupId
    || group.key === legacyGroupId
    || String(group.id) === String(legacyGroupId)
  ))
  if (matches.length !== 1) {
    throw new Error(
      `Assignment ${assignment.id} allocation group ${String(legacyGroupId)} resolved to ${matches.length} ${groupField} groups.`,
    )
  }
  migrated.groupId = assertRelationalId(matches[0].id, `Assignment ${assignment.id} allocation.groupId`)
  return migrated
}

function resolveEndpointPort(items, endpoint, field) {
  const ownerType = endpoint.hostedItemType ?? endpoint.itemType
  const ownerId = endpoint.hostedItemId ?? endpoint.itemId
  const owner = items.get(referenceKey(ownerType, ownerId))
  if (!owner) throw new Error(`${field} references a missing port owner.`)

  if (
    typeof endpoint.portId === 'number'
    || (typeof endpoint.portId === 'string' && /^[1-9]\d*$/.test(endpoint.portId))
  ) {
    const portId = parseLegacyRelationalId(endpoint.portId, `${field}.portId`)
    const matches = (owner.ports ?? []).filter((port) => port.id === portId)
    if (matches.length === 1) return portId

    throw new Error(`${field}.portId ${portId} resolved to ${matches.length} ports.`)
  }

  const semanticKey = legacyPowerPortKey(owner, endpoint.portId) ?? endpoint.portId
  const matches = (owner.ports ?? []).filter((port) => port.key === semanticKey)
  if (matches.length === 1) return assertRelationalId(matches[0].id, `${field}.portId`)

  if (endpoint.portId === null && (owner.ports ?? []).length === 1) {
    return assertRelationalId(owner.ports[0].id, `${field}.portId`)
  }

  throw new Error(`${field}.portId ${String(endpoint.portId)} cannot be resolved unambiguously.`)
}

function migrateEndpoint(items, endpoint, field) {
  const migrated = {
    ...endpoint,
    itemId: parseLegacyRelationalId(endpoint.itemId, `${field}.itemId`),
    portId: resolveEndpointPort(items, endpoint, field),
  }
  if (endpoint.hostedItemId !== undefined) {
    migrated.hostedItemId = parseLegacyRelationalId(endpoint.hostedItemId, `${field}.hostedItemId`)
  }
  if (endpoint.endpointId !== undefined) {
    migrated.endpointId = parseLegacyRelationalId(endpoint.endpointId, `${field}.endpointId`)
  }
  return migrated
}

function migratePolicy(policy, items) {
  const disabledHosts = []
  for (const [index, value] of (policy?.disabledHostIds ?? policy?.disabledHosts ?? []).entries()) {
    let hostType
    let hostId
    if (typeof value === 'string') {
      const match = value.match(/^([^:]+):([1-9]\d*)$/)
      if (!match) continue
      hostType = match[1]
      hostId = parseLegacyRelationalId(match[2], `compatibilityPolicy.disabledHostIds[${index}]`)
    } else {
      hostType = value?.hostType
      try {
        hostId = parseLegacyRelationalId(value?.hostId, `compatibilityPolicy.disabledHosts[${index}].hostId`)
      } catch {
        continue
      }
    }
    if (!HOST_TYPES.has(hostType) || !items.has(referenceKey(hostType, hostId))) {
      continue
    }
    if (!disabledHosts.some((entry) => entry.hostType === hostType && entry.hostId === hostId)) {
      disabledHosts.push({ hostType, hostId })
    }
  }
  return {
    disabledHosts,
    ignoredWarningIds: [...new Set(
      (policy?.ignoredWarningIds ?? []).filter((value) => typeof value === 'string' && value.trim()),
    )],
  }
}

export function migrateSchema9To10(inventory, project, agents, agentStatus) {
  const migratedProject = structuredClone(project)
  const migratedInventory = migrateInventory(inventory)

  migratedProject.placements = (migratedProject.placements ?? []).map((placement, index) => ({
    ...placement,
    itemId: parseLegacyRelationalId(placement.itemId, `placements[${index}].itemId`),
  }))
  migratedProject.assignments = (migratedProject.assignments ?? []).map((assignment, index) => ({
    ...assignment,
    id: parseLegacyRelationalId(assignment.id, `assignments[${index}].id`),
    hostId: parseLegacyRelationalId(assignment.hostId, `assignments[${index}].hostId`),
    itemId: parseLegacyRelationalId(assignment.itemId, `assignments[${index}].itemId`),
  }))
  migratedProject.assignments = migratedProject.assignments.map((assignment) => {
    const migrated = {
      ...assignment,
    }
    const allocation = migrateAllocation(migratedProject, migratedInventory.items, migrated, assignment.allocation)
    if (allocation) migrated.allocation = allocation
    return migrated
  })
  migratedProject.connections = (migratedProject.connections ?? []).map((connection, index) => ({
    ...connection,
    id: parseLegacyRelationalId(connection.id, `connections[${index}].id`),
    from: migrateEndpoint(migratedInventory.items, connection.from, `connections[${index}].from`),
    to: migrateEndpoint(migratedInventory.items, connection.to, `connections[${index}].to`),
  }))
  migratedProject.compatibilityPolicy = migratePolicy(
    migratedProject.compatibilityPolicy,
    migratedInventory.items,
  )

  return {
    inventory: migratedInventory.inventory,
    project: migratedProject,
    agents: migrateAgents(agents),
    agentStatus: migrateAgentStatus(agentStatus),
  }
}
