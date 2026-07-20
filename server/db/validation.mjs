import {
  ASSIGNABLE_COMPONENT_TYPE_SET,
  INVENTORY_TYPE_SET,
} from './inventory-capabilities.mjs'

const componentTypes = ASSIGNABLE_COMPONENT_TYPE_SET
const inventoryTypes = INVENTORY_TYPE_SET
const tableTypes = {
  servers: 'server',
  pcBuilds: 'pcBuild',
  cpus: 'cpu',
  ram: 'ram',
  storage: 'storage',
  networkCards: 'network',
  gpus: 'gpu',
  motherboards: 'motherboard',
  cpuCoolers: 'cpuCooler',
  cases: 'case',
  powerSupplies: 'powerSupply',
  soundCards: 'soundCard',
  wirelessCards: 'wireless',
  powerAdapters: 'powerAdapter',
  nas: 'nas',
  switches: 'switch',
  patchPanels: 'patchPanel',
  monitors: 'monitor',
  upsSystems: 'ups',
  powerStrips: 'powerStrip',
}
const portKinds = new Set(['switch-port', 'keystone', 'server-port'])
const portTypes = new Set(['rj45', 'sfp', 'sfp-plus', 'hdmi', 'displayport', 'mini-displayport', 'barrel'])
const portRoles = new Set(['access', 'trunk', 'uplink', 'management', 'disabled'])
const portSides = new Set(['front', 'back'])
const switchNetworkPortTypes = new Set(['rj45', 'sfp', 'sfp-plus'])
const switchNetworkPortSpeeds = new Set(['1G', '2.5G', '5G', '10G'])
const compatibilityResourceTypes = new Set([
  'cpu',
  'memory',
  'storage',
  'expansion',
  'motherboard',
  'cooling',
  'power',
  'case',
])
const logicalCompatibilityResourceTypes = new Set(['motherboard', 'power', 'case'])
const groupedCompatibilityResourceTypes = new Set(['cpu', 'cooling', 'storage', 'expansion'])
const expansionInterfaceFamilies = new Set(['pcie', 'm2-ae', 'usb', 'onboard'])
const cardHeights = new Set(['full-height', 'low-profile'])

function parseInventoryKey(key) {
  if (typeof key !== 'string') return null

  const [type, rawId] = key.split(':')
  const id = Number(rawId)

  return inventoryTypes.has(type) && Number.isInteger(id) ? { type, id } : null
}

function canonicalSequenceId(id, index) {
  const numericId = Number(id)
  return Number.isInteger(numericId) ? numericId : index + 1
}

function assertUniqueCanonicalIds(records, collectionPath) {
  const seen = new Map()

  records.forEach((record, index) => {
    const id = canonicalSequenceId(record?.id, index)
    const previousIndex = seen.get(id)
    if (previousIndex !== undefined) {
      throw new Error(
        `${collectionPath}[${index}].id duplicates canonical id ${id} from ${collectionPath}[${previousIndex}].id.`,
      )
    }
    seen.set(id, index)
  })
}

function assertOptionalObject(value, fieldPath) {
  if (value === undefined) return
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${fieldPath} must be an object.`)
  }
}

function assertOptionalString(value, fieldPath) {
  if (value === undefined) return
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${fieldPath} must be a non-empty string.`)
  }
}

function assertRequiredString(value, fieldPath) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${fieldPath} must be a non-empty string.`)
  }
}

function assertOptionalStringArray(value, fieldPath) {
  if (value === undefined) return
  if (!Array.isArray(value)) {
    throw new Error(`${fieldPath} must be an array.`)
  }
  value.forEach((entry, index) => assertRequiredString(entry, `${fieldPath}[${index}]`))
}

function assertUniqueStringArray(value, fieldPath) {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldPath} must contain unique strings.`)
  }

  const normalized = value.map((entry) => typeof entry === 'string' ? entry.trim() : entry)
  if (
    normalized.some((entry) => typeof entry !== 'string' || entry === '') ||
    new Set(normalized).size !== normalized.length
  ) {
    throw new Error(`${fieldPath} must contain unique strings.`)
  }
}

function assertOptionalEnum(value, allowed, fieldPath) {
  if (value === undefined) return
  if (!allowed.has(value)) {
    throw new Error(`${fieldPath} has an unsupported value.`)
  }
}

function assertOptionalNonNegativeNumber(value, fieldPath) {
  if (value === undefined) return
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${fieldPath} must be a finite non-negative number.`)
  }
}

function assertOptionalPositiveNumber(value, fieldPath) {
  if (value === undefined) return
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${fieldPath} must be a finite positive number.`)
  }
}

function assertOptionalPositiveInteger(value, fieldPath) {
  if (value === undefined) return
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${fieldPath} must be a positive integer.`)
  }
}

function assertCompatibilityGroupIds(groups, fieldPath) {
  const ids = new Set()
  groups.forEach((group, index) => {
    const idPath = `${fieldPath}[${index}].id`
    assertRequiredString(group.id, idPath)
    if (ids.has(group.id)) {
      throw new Error(`${idPath} must be unique.`)
    }
    ids.add(group.id)
  })
}

function assertStorageSlots(value, fieldPath) {
  if (value === undefined) return
  if (!Array.isArray(value)) throw new Error(`${fieldPath} must be an array.`)
  value.forEach((group, index) => {
    const path = `${fieldPath}[${index}]`
    assertOptionalObject(group, path)
    assertRequiredString(group.id, `${path}.id`)
    assertRequiredString(group.label, `${path}.label`)
    if (!Number.isInteger(group.count) || group.count < 1) {
      throw new Error(`${path}.count must be a positive integer.`)
    }
    assertOptionalStringArray(group.interfaces, `${path}.interfaces`)
    assertOptionalStringArray(group.formFactors, `${path}.formFactors`)
    assertOptionalPositiveNumber(group.pcieGeneration, `${path}.pcieGeneration`)
  })
  assertCompatibilityGroupIds(value, fieldPath)
}

function assertExpansionSlots(value, fieldPath) {
  if (value === undefined) return
  if (!Array.isArray(value)) throw new Error(`${fieldPath} must be an array.`)
  value.forEach((group, index) => {
    const path = `${fieldPath}[${index}]`
    assertOptionalObject(group, path)
    assertRequiredString(group.id, `${path}.id`)
    assertRequiredString(group.label, `${path}.label`)
    if (!Number.isInteger(group.count) || group.count < 1) {
      throw new Error(`${path}.count must be a positive integer.`)
    }
    if (!expansionInterfaceFamilies.has(group.interfaceFamily)) {
      throw new Error(`${path}.interfaceFamily has an unsupported value.`)
    }
    assertOptionalPositiveNumber(group.pcieGeneration, `${path}.pcieGeneration`)
    assertOptionalPositiveInteger(group.mechanicalLanes, `${path}.mechanicalLanes`)
    assertOptionalPositiveInteger(group.electricalLanes, `${path}.electricalLanes`)
    if (group.acceptedHeights !== undefined) {
      if (!Array.isArray(group.acceptedHeights)) {
        throw new Error(`${path}.acceptedHeights must be an array.`)
      }
      group.acceptedHeights.forEach((height, heightIndex) => {
        assertOptionalEnum(height, cardHeights, `${path}.acceptedHeights[${heightIndex}]`)
      })
    }
    assertOptionalPositiveInteger(group.maxSlotWidth, `${path}.maxSlotWidth`)
    assertOptionalNonNegativeNumber(group.maxPowerWatts, `${path}.maxPowerWatts`)
  })
  assertCompatibilityGroupIds(value, fieldPath)
}

function assertInventoryCompatibility(itemId, compatibility) {
  if (compatibility === undefined) return
  const root = `Inventory item ${itemId} compatibility`
  assertOptionalObject(compatibility, root)

  if (compatibility.host !== undefined) {
    const host = compatibility.host
    assertOptionalObject(host, `${root}.host`)

    if (host.cpu !== undefined) {
      assertOptionalObject(host.cpu, `${root}.host.cpu`)
      assertOptionalStringArray(host.cpu.sockets, `${root}.host.cpu.sockets`)
      assertOptionalStringArray(host.cpu.generations, `${root}.host.cpu.generations`)
      assertOptionalNonNegativeNumber(host.cpu.maxTdpWatts, `${root}.host.cpu.maxTdpWatts`)
    }
    if (host.memory !== undefined) {
      assertOptionalObject(host.memory, `${root}.host.memory`)
      assertOptionalStringArray(host.memory.generations, `${root}.host.memory.generations`)
      assertOptionalPositiveInteger(host.memory.slots, `${root}.host.memory.slots`)
      assertOptionalNonNegativeNumber(host.memory.maxCapacityGb, `${root}.host.memory.maxCapacityGb`)
      assertOptionalNonNegativeNumber(
        host.memory.maxModuleCapacityGb,
        `${root}.host.memory.maxModuleCapacityGb`,
      )
      assertOptionalNonNegativeNumber(host.memory.maxSpeedMt, `${root}.host.memory.maxSpeedMt`)
    }
    assertStorageSlots(host.storageSlots, `${root}.host.storageSlots`)
    assertExpansionSlots(host.expansionSlots, `${root}.host.expansionSlots`)
    assertOptionalNonNegativeNumber(
      host.maxExpansionPowerWatts,
      `${root}.host.maxExpansionPowerWatts`,
    )
  }

  if (compatibility.requirements !== undefined) {
    const requirements = compatibility.requirements
    assertOptionalObject(requirements, `${root}.requirements`)
    if (requirements.cpu !== undefined) {
      assertOptionalObject(requirements.cpu, `${root}.requirements.cpu`)
      assertOptionalString(requirements.cpu.socket, `${root}.requirements.cpu.socket`)
      assertOptionalString(requirements.cpu.generation, `${root}.requirements.cpu.generation`)
      assertOptionalNonNegativeNumber(
        requirements.cpu.tdpWatts,
        `${root}.requirements.cpu.tdpWatts`,
      )
    }
    if (requirements.expansion !== undefined) {
      const expansion = requirements.expansion
      const path = `${root}.requirements.expansion`
      assertOptionalObject(expansion, path)
      assertOptionalEnum(expansion.interfaceFamily, expansionInterfaceFamilies, `${path}.interfaceFamily`)
      assertOptionalPositiveNumber(expansion.pcieGeneration, `${path}.pcieGeneration`)
      assertOptionalPositiveInteger(expansion.connectorLanes, `${path}.connectorLanes`)
      assertOptionalPositiveInteger(
        expansion.minimumElectricalLanes,
        `${path}.minimumElectricalLanes`,
      )
      assertOptionalEnum(expansion.height, cardHeights, `${path}.height`)
      assertOptionalPositiveInteger(expansion.slotWidth, `${path}.slotWidth`)
      assertOptionalNonNegativeNumber(expansion.powerWatts, `${path}.powerWatts`)
    }
  }
}

function assertAssignmentAllocation(assignment) {
  if (assignment.allocation === undefined) return
  const path = `Project assignment ${assignment.id} allocation`
  const allocation = assignment.allocation
  assertOptionalObject(allocation, path)
  if (!compatibilityResourceTypes.has(allocation.resourceType)) {
    throw new Error(`${path}.resourceType has an unsupported value.`)
  }
  if (logicalCompatibilityResourceTypes.has(allocation.resourceType)) {
    if (allocation.groupId !== undefined) {
      throw new Error(`${path}.groupId is not supported for ${allocation.resourceType} allocations.`)
    }
  } else if (groupedCompatibilityResourceTypes.has(allocation.resourceType)) {
    assertRequiredString(allocation.groupId, `${path}.groupId`)
  } else if (allocation.groupId !== undefined) {
    assertRequiredString(allocation.groupId, `${path}.groupId`)
  }
  if (!Array.isArray(allocation.positions) || allocation.positions.length === 0) {
    throw new Error(`${path}.positions must be a non-empty array.`)
  }
  const positions = new Set()
  allocation.positions.forEach((position, index) => {
    if (!Number.isInteger(position) || position < 0) {
      throw new Error(`${path}.positions[${index}] must be a non-negative integer.`)
    }
    if (positions.has(position)) {
      throw new Error(`${path}.positions[${index}] must be unique.`)
    }
    positions.add(position)
  })
}

export function assertInventoryStoreShape(store) {
  if (!store || typeof store !== 'object' || Array.isArray(store)) {
    throw new Error('Inventory store must be an object.')
  }

  if (store.items && typeof store.items === 'object' && !Array.isArray(store.items)) {
    for (const [itemId, item] of Object.entries(store.items)) {
      assertInventoryItem(itemId, item, item.type)
    }

    return
  }

  for (const [table, type] of Object.entries(tableTypes)) {
    if (!Array.isArray(store[table])) {
      throw new Error(`Inventory store is missing a ${table} array.`)
    }

    for (const item of store[table]) {
      assertInventoryItem(`${type}:${item?.id}`, item, type)
    }
  }
}

function assertInventoryItem(itemId, item, expectedType, options = {}) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error(`Inventory item ${itemId} must be an object.`)
  }

  if (typeof item.id !== 'string' && typeof item.id !== 'number') {
    throw new Error(`Inventory item ${itemId} is missing an id.`)
  }

  if (typeof item.name !== 'string' || item.name.trim() === '') {
    throw new Error(`Inventory item ${itemId} is missing a name.`)
  }

  const type = item.type ?? expectedType

  if (!inventoryTypes.has(type)) {
    throw new Error(`Inventory item ${itemId} has an unsupported type.`)
  }

  if (type !== expectedType) {
    throw new Error(`Inventory item ${itemId} is in the wrong table.`)
  }

  if (
    item.archivedAt !== undefined &&
    (typeof item.archivedAt !== 'string' || !Number.isFinite(Date.parse(item.archivedAt)))
  ) {
    throw new Error(`Inventory item ${itemId} has an invalid archivedAt timestamp.`)
  }

  assertInventoryCompatibility(itemId, item.compatibility)

  if (item.ports === undefined) {
    return
  }

  if (!Array.isArray(item.ports)) {
    throw new Error(`Inventory item ${itemId} ports must be an array.`)
  }

  for (const port of item.ports) {
    if (
      !port ||
      (typeof port.id !== 'string' && typeof port.id !== 'number') ||
      !portKinds.has(port.kind) ||
      !portTypes.has(port.type) ||
      typeof port.slotNumber !== 'number'
    ) {
      throw new Error(`Inventory item ${itemId} has an invalid port.`)
    }

    if (port.role !== undefined && !portRoles.has(port.role)) {
      throw new Error(`Inventory item ${itemId} port ${port.id} has an unsupported role.`)
    }

    if (
      type === 'switch' &&
      switchNetworkPortTypes.has(port.type) &&
      !(options.allowLegacyMissingSwitchSpeed && port.speed === undefined) &&
      !switchNetworkPortSpeeds.has(port.speed)
    ) {
      throw new Error(`Switch network port ${port.id} must advertise 1G, 2.5G, 5G, or 10G.`)
    }

    if (port.endpoints === undefined) {
      continue
    }

    if (!Array.isArray(port.endpoints)) {
      throw new Error(`Inventory item ${itemId} port ${port.id} endpoints must be an array.`)
    }

    for (const endpoint of port.endpoints) {
      if (
        !endpoint ||
        (typeof endpoint.id !== 'string' && typeof endpoint.id !== 'number') ||
        !portSides.has(endpoint.side)
      ) {
        throw new Error(`Inventory item ${itemId} port ${port.id} has an invalid endpoint.`)
      }
    }
  }
}

export function assertProjectStoreShape(store) {
  if (!store || typeof store !== 'object' || Array.isArray(store)) {
    throw new Error('Project store must be an object.')
  }

  if (!Array.isArray(store.placements)) {
    throw new Error('Project store is missing a placements array.')
  }

  if (!Array.isArray(store.assignments)) {
    throw new Error('Project store is missing an assignments array.')
  }

  if (store.connections !== undefined && !Array.isArray(store.connections)) {
    throw new Error('Project store connections must be an array.')
  }

  if (store.compatibilityPolicy !== undefined) {
    assertOptionalObject(store.compatibilityPolicy, 'compatibilityPolicy')
    assertUniqueStringArray(
      store.compatibilityPolicy.disabledHostIds,
      'compatibilityPolicy.disabledHostIds',
    )
    assertUniqueStringArray(
      store.compatibilityPolicy.ignoredWarningIds,
      'compatibilityPolicy.ignoredWarningIds',
    )
  }

  assertUniqueCanonicalIds(store.assignments, 'Project assignments')
  assertUniqueCanonicalIds(store.connections ?? [], 'Project connections')

  for (const placement of store.placements) {
    if (
      !placement ||
      !(
        typeof placement.serverId === 'string' ||
        (typeof placement.itemType === 'string' && typeof placement.itemId === 'number')
      ) ||
      typeof placement.x !== 'number' ||
      typeof placement.y !== 'number'
    ) {
      throw new Error('Each placement must include serverId, x, and y.')
    }
  }

  for (const assignment of store.assignments) {
    if (
      !assignment ||
      (typeof assignment.id !== 'string' && typeof assignment.id !== 'number') ||
      !(
        typeof assignment.serverId === 'string' ||
        (typeof assignment.hostType === 'string' && typeof assignment.hostId === 'number')
      ) ||
      !(
        typeof assignment.itemId === 'string' ||
        (typeof assignment.itemType === 'string' && typeof assignment.itemId === 'number')
      ) ||
      !componentTypes.has(assignment.type)
    ) {
      throw new Error('Each assignment must include id, serverId, itemId, and component type.')
    }

    assertAssignmentAllocation(assignment)
  }

  for (const connection of store.connections ?? []) {
    if (
      !connection ||
      (typeof connection.id !== 'string' && typeof connection.id !== 'number') ||
      typeof connection.createdAt !== 'string' ||
      typeof connection.type !== 'string' ||
      !connection.from ||
      !isValidEndpoint(connection.from) ||
      !connection.to ||
      !isValidEndpoint(connection.to)
    ) {
      throw new Error('Each connection must include id, from, to, type, and createdAt.')
    }

    if (
      connection.negotiatedSpeedMbps !== undefined &&
      ![1000, 2500, 5000, 10000].includes(connection.negotiatedSpeedMbps)
    ) {
      throw new Error('Connection negotiated speed must be 1000, 2500, 5000, or 10000 Mbps.')
    }
  }
}

function isValidEndpoint(endpoint) {
  return Boolean(
    endpoint &&
    (
      typeof endpoint.itemId === 'string' ||
      (typeof endpoint.itemType === 'string' && typeof endpoint.itemId === 'number')
    ) &&
    (typeof endpoint.portId === 'string' || typeof endpoint.portId === 'number') &&
    (endpoint.endpointId === undefined ||
      typeof endpoint.endpointId === 'string' ||
      typeof endpoint.endpointId === 'number') &&
    (endpoint.hostedItemId === undefined ||
      typeof endpoint.hostedItemId === 'string' ||
      (
        typeof endpoint.hostedItemType === 'string' &&
        typeof endpoint.hostedItemId === 'number'
      ))
  )
}

export function assertProjectShape(project) {
  if (!project || typeof project !== 'object' || Array.isArray(project)) {
    throw new Error('Project payload must be an object.')
  }

  assertInventoryStoreShape({ items: project.items })
  assertProjectStoreShape(project)
  assertProjectAssignmentReferences(project)
  assertProjectAllocationReferences(project)
  assertProjectAllocationExclusivity(project)
}

export function assertLegacyProjectShape(project) {
  if (!project || typeof project !== 'object' || Array.isArray(project)) {
    throw new Error('Project payload must be an object.')
  }
  if (!project.items || typeof project.items !== 'object' || Array.isArray(project.items)) {
    throw new Error('Project items must be an object.')
  }

  const nextIdsByType = Object.fromEntries([...inventoryTypes].map((type) => [type, 0]))
  const normalizedKeys = new Map()

  for (const [originalKey, item] of Object.entries(project.items)) {
    const itemPath = `Project items[${JSON.stringify(originalKey)}]`
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`${itemPath} must be an object.`)
    }

    const parsed = parseInventoryKey(originalKey) ?? parseInventoryKey(item.key)
    const type = parsed?.type ?? item.type
    if (!inventoryTypes.has(type)) {
      throw new Error(`${itemPath}.type has an unsupported value.`)
    }

    let id = parsed?.id
    if (!Number.isInteger(id)) {
      const numericId = Number(item.id)
      id = Number.isInteger(numericId) ? numericId : nextIdsByType[type] + 1
    }
    nextIdsByType[type] = Math.max(nextIdsByType[type], id)

    const normalizedKey = `${type}:${id}`
    const previousKey = normalizedKeys.get(normalizedKey)
    if (previousKey !== undefined) {
      throw new Error(
        `${itemPath} normalizes to duplicate inventory key ${normalizedKey} from Project items[${JSON.stringify(previousKey)}].`,
      )
    }
    normalizedKeys.set(normalizedKey, originalKey)

    assertInventoryItem(
      originalKey,
      { ...item, id, type },
      type,
      { allowLegacyMissingSwitchSpeed: true },
    )
  }

  assertProjectStoreShape(project)
}

function projectItem(project, reference, type, id) {
  if (typeof reference === 'string') return project.items?.[reference]
  if (type && id !== undefined) return project.items?.[`${type}:${id}`]
  return undefined
}

function projectReference(reference, type, id) {
  if (typeof reference === 'string') return reference
  if (type && id !== undefined) return `${type}:${id}`
  return undefined
}

function assertProjectAssignmentReferences(project) {
  const assignedComponents = new Map()

  for (const [index, assignment] of (project.assignments ?? []).entries()) {
    const itemReference = projectReference(
      assignment.itemId,
      assignment.itemType,
      assignment.itemId,
    )
    const item = projectItem(project, assignment.itemId, assignment.itemType, assignment.itemId)

    if (item && assignment.type !== item.type) {
      throw new Error(
        `Project assignments[${index}].type ${assignment.type} does not match referenced inventory item ${itemReference} type ${item.type}.`,
      )
    }

    if (itemReference) {
      const previousIndex = assignedComponents.get(itemReference)
      if (previousIndex !== undefined) {
        throw new Error(
          `Project assignments[${index}].itemId duplicates component ${itemReference} from Project assignments[${previousIndex}].itemId.`,
        )
      }
      assignedComponents.set(itemReference, index)
    }
  }
}

function assertProjectAllocationReferences(project) {
  for (const assignment of project.assignments ?? []) {
    const allocation = assignment.allocation
    if (!allocation) continue

    const host = projectItem(
      project,
      assignment.serverId,
      assignment.hostType,
      assignment.hostId,
    )
    const hostReference = projectReference(
      assignment.serverId,
      assignment.hostType,
      assignment.hostId,
    )
    const motherboardAssignment = host?.type === 'pcBuild'
      ? project.assignments?.find((candidate) => (
          candidate.type === 'motherboard'
          && projectReference(candidate.serverId, candidate.hostType, candidate.hostId) === hostReference
        ))
      : undefined
    const motherboard = motherboardAssignment
      ? projectItem(
          project,
          motherboardAssignment.itemId,
          motherboardAssignment.itemType,
          motherboardAssignment.itemId,
        )
      : undefined
    const capabilitySource = host?.type === 'pcBuild' ? motherboard : host
    const hostCompatibility = capabilitySource?.compatibility?.host

    if (host?.type === 'pcBuild' && logicalCompatibilityResourceTypes.has(allocation.resourceType)) {
      if (allocation.positions.some((position) => position !== 0)) {
        throw new Error(
          `Project assignment ${assignment.id} allocation.positions must reference the single ${allocation.resourceType} position.`,
        )
      }
      continue
    }

    if (!hostCompatibility) {
      throw new Error(
        `Project assignment ${assignment.id} allocation references a host without compatibility capabilities.`,
      )
    }

    let group
    let groupPath
    let capacity
    if (allocation.resourceType === 'cpu' || allocation.resourceType === 'cooling') {
      groupPath = 'compatibility.host.cpu'
      group = allocation.groupId === 'cpu' ? { id: 'cpu' } : undefined
      if (!group) {
        throw new Error(
          `Project assignment ${assignment.id} allocation.groupId references missing ${groupPath} group ${allocation.groupId}.`,
        )
      }
      const configuredCount = Number(
        capabilitySource?.specs?.cpuSocketCount ?? capabilitySource?.specs?.cpuSockets ?? 1,
      )
      capacity = hostCompatibility.cpu?.sockets?.length > 0 && Number.isInteger(configuredCount)
        ? configuredCount
        : undefined
    } else if (allocation.resourceType === 'memory') {
      groupPath = 'compatibility.host.memory'
      if (allocation.groupId !== undefined && allocation.groupId !== 'dimm') {
        throw new Error(
          `Project assignment ${assignment.id} allocation.groupId references missing ${groupPath} group ${allocation.groupId}.`,
        )
      }
      capacity = hostCompatibility.memory?.slots
    } else {
      const groupsField = allocation.resourceType === 'storage' ? 'storageSlots' : 'expansionSlots'
      groupPath = `compatibility.host.${groupsField}`
      group = hostCompatibility[groupsField]?.find((entry) => entry.id === allocation.groupId)
      if (!group) {
        throw new Error(
          `Project assignment ${assignment.id} allocation.groupId references missing ${groupPath} group ${allocation.groupId}.`,
        )
      }
      capacity = group.count
    }

    allocation.positions.forEach((position, index) => {
      if (!Number.isInteger(capacity) || position >= capacity) {
        const suffix = group ? ` group ${group.id}` : ''
        throw new Error(
          `Project assignment ${assignment.id} allocation.positions[${index}] is outside ${groupPath}${suffix}.`,
        )
      }
    })
  }
}

function assertProjectAllocationExclusivity(project) {
  const occupied = new Map()

  for (const [assignmentIndex, assignment] of (project.assignments ?? []).entries()) {
    const allocation = assignment.allocation
    if (!allocation) continue

    const hostReference = projectReference(
      assignment.serverId,
      assignment.hostType,
      assignment.hostId,
    )
    const groupId = allocation.resourceType === 'memory' ? '' : allocation.groupId

    allocation.positions.forEach((position, positionIndex) => {
      const key = JSON.stringify([hostReference, allocation.resourceType, groupId, position])
      const previous = occupied.get(key)
      if (previous) {
        throw new Error(
          `Project assignments[${assignmentIndex}].allocation.positions[${positionIndex}] conflicts with Project assignments[${previous.assignmentIndex}].allocation.positions[${previous.positionIndex}].`,
        )
      }
      occupied.set(key, { assignmentIndex, positionIndex })
    })
  }
}
