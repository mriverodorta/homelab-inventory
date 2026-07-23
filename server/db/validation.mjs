import {
  ASSIGNABLE_COMPONENT_TYPE_SET,
  INVENTORY_TYPE_SET,
} from './inventory-capabilities.mjs'
import {
  assertRelationalId,
  isLegacyRelationalId,
  isRelationalId,
  parseLegacyRelationalId,
} from './relational-ids.mjs'
import {
  canonicalPowerPorts,
  isNasPowerConfiguration,
} from '../../shared/power-ports.mjs'

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
const portKinds = new Set(['switch-port', 'keystone', 'server-port', 'power-port'])
const portTypes = new Set([
  'rj45',
  'sfp',
  'sfp-plus',
  'hdmi',
  'displayport',
  'mini-displayport',
  'barrel',
  'ac-input',
  'ac-outlet',
])
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
const groupedCompatibilityResourceTypes = new Set(['storage', 'expansion'])
const expansionInterfaceFamilies = new Set(['pcie', 'm2-ae', 'usb', 'onboard'])
const cardHeights = new Set(['full-height', 'low-profile'])
const canonicalPowerItemTypes = new Set([
  'monitor',
  'ups',
  'powerStrip',
  'powerAdapter',
  'powerSupply',
  'nas',
])

function parseInventoryKey(key) {
  if (typeof key !== 'string') return null

  const [type, rawId] = key.split(':')
  if (!isLegacyRelationalId(rawId)) return null
  const id = parseLegacyRelationalId(rawId, `inventory key ${key}`)

  return inventoryTypes.has(type) && id !== undefined ? { type, id } : null
}

function isTypedInventoryReference(type, id) {
  return inventoryTypes.has(type) && isRelationalId(id)
}

function isRuntimeOrTypedReference(reference, type, id) {
  return parseInventoryKey(reference) !== null || isTypedInventoryReference(type, id)
}

function assertUniqueCanonicalIds(records, collectionPath) {
  const seen = new Map()

  records.forEach((record, index) => {
    const id = assertRelationalId(record?.id, `${collectionPath}[${index}].id`)
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

function assertLegacyCompatibilityGroupId(value, fieldPath) {
  if (isRelationalId(value)) return value
  if (typeof value === 'string' && value.trim() !== '') return value.trim()
  throw new Error(`${fieldPath} must be a positive integer or a non-empty legacy key.`)
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

function assertCompatibilityGroupIds(groups, fieldPath, options = {}) {
  const ids = new Set()
  const keys = new Set()
  groups.forEach((group, index) => {
    const idPath = `${fieldPath}[${index}].id`
    const id = options.allowLegacyIds
      ? assertLegacyCompatibilityGroupId(group.id, idPath)
      : assertRelationalId(group.id, idPath)
    const key = group.key ?? (options.allowLegacyIds ? String(group.id) : undefined)
    assertRequiredString(key, `${fieldPath}[${index}].key`)
    if (ids.has(id)) {
      throw new Error(`${idPath} must be unique.`)
    }
    if (keys.has(key)) {
      throw new Error(`${fieldPath}[${index}].key must be unique.`)
    }
    ids.add(id)
    keys.add(key)
  })
}

function assertStorageSlots(value, fieldPath, options = {}) {
  if (value === undefined) return
  if (!Array.isArray(value)) throw new Error(`${fieldPath} must be an array.`)
  value.forEach((group, index) => {
    const path = `${fieldPath}[${index}]`
    assertOptionalObject(group, path)
    if (options.allowLegacyIds) {
      assertLegacyCompatibilityGroupId(group.id, `${path}.id`)
      if (group.key !== undefined) assertRequiredString(group.key, `${path}.key`)
    } else {
      assertRelationalId(group.id, `${path}.id`)
      assertRequiredString(group.key, `${path}.key`)
    }
    assertRequiredString(group.label, `${path}.label`)
    if (!Number.isInteger(group.count) || group.count < 1) {
      throw new Error(`${path}.count must be a positive integer.`)
    }
    assertOptionalStringArray(group.interfaces, `${path}.interfaces`)
    assertOptionalStringArray(group.formFactors, `${path}.formFactors`)
    assertOptionalPositiveNumber(group.pcieGeneration, `${path}.pcieGeneration`)
  })
  assertCompatibilityGroupIds(value, fieldPath, options)
}

function assertExpansionSlots(value, fieldPath, options = {}) {
  if (value === undefined) return
  if (!Array.isArray(value)) throw new Error(`${fieldPath} must be an array.`)
  value.forEach((group, index) => {
    const path = `${fieldPath}[${index}]`
    assertOptionalObject(group, path)
    if (options.allowLegacyIds) {
      assertLegacyCompatibilityGroupId(group.id, `${path}.id`)
      if (group.key !== undefined) assertRequiredString(group.key, `${path}.key`)
    } else {
      assertRelationalId(group.id, `${path}.id`)
      assertRequiredString(group.key, `${path}.key`)
    }
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
  assertCompatibilityGroupIds(value, fieldPath, options)
}

function assertInventoryCompatibility(itemId, compatibility, options = {}) {
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
    assertStorageSlots(host.storageSlots, `${root}.host.storageSlots`, options)
    assertExpansionSlots(host.expansionSlots, `${root}.host.expansionSlots`, options)
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

function assertAssignmentAllocation(assignment, options = {}) {
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
    if (options.allowLegacyIds) {
      assertLegacyCompatibilityGroupId(allocation.groupId, `${path}.groupId`)
    } else {
      assertRelationalId(allocation.groupId, `${path}.groupId`)
    }
  } else if (allocation.groupId !== undefined) {
    if (
      !options.allowLegacyIds
      || !['cpu', 'cooling', 'memory'].includes(allocation.resourceType)
      || !['cpu', 'dimm'].includes(allocation.groupId)
    ) {
      throw new Error(`${path}.groupId is not supported for ${allocation.resourceType} allocations.`)
    }
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

    assertUniqueCanonicalIds(store[table], `Inventory ${table}`)
    for (const item of store[table]) {
      assertInventoryItem(`${type}:${item?.id}`, item, type)
    }
  }
}

function assertAgentRecordCollection(records, fieldPath) {
  if (!records || typeof records !== 'object' || Array.isArray(records)) {
    throw new Error(`${fieldPath} must be an object.`)
  }

  const seenIds = new Set()
  for (const [recordKey, record] of Object.entries(records)) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new Error(`${fieldPath}.${recordKey} must be an object.`)
    }
    const id = assertRelationalId(record.id, `${fieldPath}.${recordKey}.id`)
    assertRelationalId(record.serverId, `${fieldPath}.${recordKey}.serverId`)
    if (String(id) !== recordKey) {
      throw new Error(`${fieldPath}.${recordKey}.id must match its object key.`)
    }
    if (seenIds.has(id)) throw new Error(`${fieldPath}.${recordKey}.id must be unique.`)
    seenIds.add(id)
  }
}

export function assertAgentsStoreShape(store) {
  if (!store || typeof store !== 'object' || Array.isArray(store)) {
    throw new Error('Agents store must be an object.')
  }
  assertAgentRecordCollection(store.enrollments, 'agents.enrollments')
  assertAgentRecordCollection(store.devices, 'agents.devices')
}

export function assertAgentStatusStoreShape(store) {
  if (!store || typeof store !== 'object' || Array.isArray(store)) {
    throw new Error('Agent status store must be an object.')
  }
  if (!store.servers || typeof store.servers !== 'object' || Array.isArray(store.servers)) {
    throw new Error('agentStatus.servers must be an object.')
  }
  for (const [serverKey, status] of Object.entries(store.servers)) {
    if (!status || typeof status !== 'object' || Array.isArray(status)) {
      throw new Error(`agentStatus.servers.${serverKey} must be an object.`)
    }
    const serverId = assertRelationalId(status.serverId, `agentStatus.servers.${serverKey}.serverId`)
    if (String(serverId) !== serverKey) {
      throw new Error(`agentStatus.servers.${serverKey}.serverId must match its object key.`)
    }
  }
}

function assertCanonicalPowerTopology(itemId, item, type, options) {
  if (options.allowLegacyIds || !canonicalPowerItemTypes.has(type)) return

  const expectedPorts = canonicalPowerPorts({ ...item, type })
  const expectedKeys = new Set(expectedPorts.map((port) => port.key))
  for (const port of item.ports ?? []) {
    const isPowerEndpoint = port.kind === 'power-port'
      || port.type === 'ac-input'
      || port.type === 'ac-outlet'
    if (isPowerEndpoint && !expectedKeys.has(port.key)) {
      throw new Error(`Inventory item ${itemId} has noncanonical power port ${port.key ?? port.id}.`)
    }
  }

  for (const expected of expectedPorts) {
    const actual = item.ports?.find((port) => port.key === expected.key)
    if (
      !actual
      || actual.kind !== expected.kind
      || actual.type !== expected.type
      || actual.slotNumber !== expected.slotNumber
    ) {
      throw new Error(`Inventory item ${itemId} is missing canonical power port ${expected.key}.`)
    }
  }
}

function assertInventoryItem(itemId, item, expectedType, options = {}) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error(`Inventory item ${itemId} must be an object.`)
  }

  if (options.allowLegacyIds) {
    if (!isLegacyRelationalId(item.id)) {
      throw new Error(`Inventory item ${itemId} is missing a valid legacy id.`)
    }
  } else {
    assertRelationalId(item.id, `Inventory item ${itemId}.id`)
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
    !options.allowLegacyIds
    && type === 'nas'
    && !isNasPowerConfiguration(item.specs?.powerConfiguration)
  ) {
    throw new Error(`Inventory item ${itemId} must declare a valid NAS power configuration.`)
  }

  if (item.smart !== undefined) {
    if (type !== 'powerStrip') {
      throw new Error(`Inventory item ${itemId} smart configuration is supported only for power strips.`)
    }
    if (!item.smart || typeof item.smart !== 'object' || Array.isArray(item.smart)) {
      throw new Error(`Inventory item ${itemId}.smart must be an object.`)
    }
    if (item.smart.enabled !== true) {
      throw new Error(`Inventory item ${itemId}.smart.enabled must be true.`)
    }
    for (const field of ['displayName', 'managementIp', 'macAddress']) {
      if (item.smart[field] !== undefined && (
        typeof item.smart[field] !== 'string' || item.smart[field].trim() === ''
      )) {
        throw new Error(`Inventory item ${itemId}.smart.${field} must be a non-empty string.`)
      }
    }
    if (!Array.isArray(item.smart.outlets)) {
      throw new Error(`Inventory item ${itemId}.smart.outlets must be an array.`)
    }
    const outletPortIds = new Set(
      (item.ports ?? []).filter((port) => port.type === 'ac-outlet').map((port) => port.id),
    )
    const smartOutletIds = new Set()
    item.smart.outlets.forEach((outlet, index) => {
      if (!outlet || typeof outlet !== 'object' || Array.isArray(outlet)) {
        throw new Error(`Inventory item ${itemId}.smart.outlets[${index}] must be an object.`)
      }
      assertRelationalId(outlet.portId, `Inventory item ${itemId}.smart.outlets[${index}].portId`)
      if (!outletPortIds.has(outlet.portId)) {
        throw new Error(`Inventory item ${itemId}.smart.outlets[${index}].portId must reference an AC outlet.`)
      }
      if (smartOutletIds.has(outlet.portId)) {
        throw new Error(`Inventory item ${itemId}.smart.outlets[${index}].portId must be unique.`)
      }
      smartOutletIds.add(outlet.portId)
      if (typeof outlet.name !== 'string' || outlet.name.trim() === '') {
        throw new Error(`Inventory item ${itemId}.smart.outlets[${index}].name must be a non-empty string.`)
      }
    })
  }

  if (
    item.archivedAt !== undefined &&
    (typeof item.archivedAt !== 'string' || !Number.isFinite(Date.parse(item.archivedAt)))
  ) {
    throw new Error(`Inventory item ${itemId} has an invalid archivedAt timestamp.`)
  }

  assertInventoryCompatibility(itemId, item.compatibility, options)

  if (item.ports !== undefined && !Array.isArray(item.ports)) {
    throw new Error(`Inventory item ${itemId} ports must be an array.`)
  }

  const portIds = new Set()
  const portKeys = new Set()
  for (const port of item.ports ?? []) {
    if (
      !port ||
      !(options.allowLegacyIds
        ? isLegacyRelationalId(port.id)
        : isRelationalId(port.id)) ||
      !portKinds.has(port.kind) ||
      !portTypes.has(port.type) ||
      typeof port.slotNumber !== 'number'
    ) {
      throw new Error(`Inventory item ${itemId} has an invalid port.`)
    }

    if (portIds.has(port.id)) {
      throw new Error(`Inventory item ${itemId} port ${port.id} must be unique.`)
    }
    portIds.add(port.id)

    if (!options.allowLegacyIds && typeof port.key === 'string' && port.key !== '') {
      if (portKeys.has(port.key)) {
        throw new Error(`Inventory item ${itemId} port key ${port.key} must be unique.`)
      }
      portKeys.add(port.key)
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

    const endpointIds = new Set()
    for (const endpoint of port.endpoints) {
      if (
        !endpoint ||
        !(options.allowLegacyIds
          ? isLegacyRelationalId(endpoint.id)
          : isRelationalId(endpoint.id)) ||
        !portSides.has(endpoint.side)
      ) {
        throw new Error(`Inventory item ${itemId} port ${port.id} has an invalid endpoint.`)
      }
      if (endpointIds.has(endpoint.id)) {
        throw new Error(
          `Inventory item ${itemId} port ${port.id} endpoint ${endpoint.id} must be unique.`,
        )
      }
      endpointIds.add(endpoint.id)
    }
  }

  assertCanonicalPowerTopology(itemId, item, type, options)
}

export function assertProjectStoreShape(store, options = {}) {
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
    if (options.allowLegacyIds) {
      assertUniqueStringArray(
        store.compatibilityPolicy.disabledHostIds ?? [],
        'compatibilityPolicy.disabledHostIds',
      )
    } else {
      const disabledHosts = store.compatibilityPolicy.disabledHosts ?? []
      if (!Array.isArray(disabledHosts)) {
        throw new Error('compatibilityPolicy.disabledHosts must be an array.')
      }
      const seenHosts = new Set()
      disabledHosts.forEach((host, index) => {
        const path = `compatibilityPolicy.disabledHosts[${index}]`
        if (!host || !inventoryTypes.has(host.hostType)) {
          throw new Error(`${path}.hostType has an unsupported value.`)
        }
        assertRelationalId(host.hostId, `${path}.hostId`)
        const key = `${host.hostType}:${host.hostId}`
        if (seenHosts.has(key)) throw new Error(`${path} duplicates host ${key}.`)
        seenHosts.add(key)
      })
    }
    assertUniqueStringArray(
      store.compatibilityPolicy.ignoredWarningIds,
      'compatibilityPolicy.ignoredWarningIds',
    )
  }

  if (!options.allowLegacyIds) {
    assertUniqueCanonicalIds(store.assignments, 'Project assignments')
    assertUniqueCanonicalIds(store.connections ?? [], 'Project connections')
  }

  for (const placement of store.placements) {
    if (
      !placement ||
      !(options.allowLegacyIds
        ? typeof placement.serverId === 'string' ||
          (inventoryTypes.has(placement.itemType) && isLegacyRelationalId(placement.itemId))
        : options.runtimeReferences
          ? isRuntimeOrTypedReference(
              placement.serverId,
              placement.itemType,
              placement.itemId,
            )
        : inventoryTypes.has(placement.itemType) && isRelationalId(placement.itemId)) ||
      typeof placement.x !== 'number' ||
      typeof placement.y !== 'number'
    ) {
      throw new Error('Each placement must include serverId, x, and y.')
    }
  }

  for (const assignment of store.assignments) {
    if (
      !assignment ||
      !(options.allowLegacyIds ? isLegacyRelationalId(assignment.id) : isRelationalId(assignment.id)) ||
      !(options.allowLegacyIds
        ? typeof assignment.serverId === 'string' ||
          (inventoryTypes.has(assignment.hostType) && isLegacyRelationalId(assignment.hostId))
        : options.runtimeReferences
          ? isRuntimeOrTypedReference(
              assignment.serverId,
              assignment.hostType,
              assignment.hostId,
            )
        : inventoryTypes.has(assignment.hostType) && isRelationalId(assignment.hostId)) ||
      !(options.allowLegacyIds
        ? typeof assignment.itemId === 'string' ||
          (inventoryTypes.has(assignment.itemType) && isLegacyRelationalId(assignment.itemId))
        : options.runtimeReferences
          ? isRuntimeOrTypedReference(
              assignment.itemId,
              assignment.itemType,
              assignment.itemId,
            )
        : inventoryTypes.has(assignment.itemType) && isRelationalId(assignment.itemId)) ||
      !componentTypes.has(assignment.type)
    ) {
      throw new Error('Each assignment must include id, serverId, itemId, and component type.')
    }

    assertAssignmentAllocation(assignment, options)
  }

  for (const connection of store.connections ?? []) {
    if (
      !connection ||
      !(options.allowLegacyIds
        ? typeof connection.id === 'string' || isLegacyRelationalId(connection.id)
        : isRelationalId(connection.id)) ||
      typeof connection.createdAt !== 'string' ||
      typeof connection.type !== 'string' ||
      !connection.from ||
      !isValidEndpoint(connection.from, options) ||
      !connection.to ||
      !isValidEndpoint(connection.to, options)
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

function isValidEndpoint(endpoint, options = {}) {
  const runtimeItem = options.runtimeReferences
    ? isRuntimeOrTypedReference(endpoint?.itemId, endpoint?.itemType, endpoint?.itemId)
    : false
  const runtimeHostedItem = options.runtimeReferences
    ? endpoint?.hostedItemId === undefined || isRuntimeOrTypedReference(
        endpoint.hostedItemId,
        endpoint.hostedItemType,
        endpoint.hostedItemId,
      )
    : false

  return Boolean(
    endpoint &&
    (options.allowLegacyIds
      ? typeof endpoint.itemId === 'string' ||
        (inventoryTypes.has(endpoint.itemType) && isLegacyRelationalId(endpoint.itemId))
      : options.runtimeReferences
        ? runtimeItem
      : inventoryTypes.has(endpoint.itemType) && isRelationalId(endpoint.itemId)) &&
    (options.allowLegacyIds ? isLegacyRelationalId(endpoint.portId) : isRelationalId(endpoint.portId)) &&
    (endpoint.endpointId === undefined ||
      (options.allowLegacyIds
        ? isLegacyRelationalId(endpoint.endpointId)
        : isRelationalId(endpoint.endpointId))) &&
    (endpoint.hostedItemId === undefined ||
      (options.allowLegacyIds
        ? typeof endpoint.hostedItemId === 'string' ||
          (inventoryTypes.has(endpoint.hostedItemType) && isLegacyRelationalId(endpoint.hostedItemId))
        : options.runtimeReferences
          ? runtimeHostedItem
        : inventoryTypes.has(endpoint.hostedItemType) && isRelationalId(endpoint.hostedItemId)))
  )
}

export function assertProjectShape(project) {
  if (!project || typeof project !== 'object' || Array.isArray(project)) {
    throw new Error('Project payload must be an object.')
  }

  assertInventoryStoreShape({ items: project.items })
  assertProjectStoreShape(project, { runtimeReferences: true })
  assertProjectPlacementReferences(project)
  assertProjectAssignmentReferences(project)
  assertProjectConnectionReferences(project)
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
      { allowLegacyMissingSwitchSpeed: true, allowLegacyIds: true },
    )
  }

  assertProjectStoreShape(project, { allowLegacyIds: true })
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
    const hostReference = projectReference(
      assignment.serverId,
      assignment.hostType,
      assignment.hostId,
    )
    const host = projectItem(project, assignment.serverId, assignment.hostType, assignment.hostId)
    const itemReference = projectReference(
      assignment.itemId,
      assignment.itemType,
      assignment.itemId,
    )
    const item = projectItem(project, assignment.itemId, assignment.itemType, assignment.itemId)

    if (!host) {
      throw new Error(
        `Project assignments[${index}] references missing host ${hostReference}.`,
      )
    }

    if (!item) {
      throw new Error(
        `Project assignments[${index}] references missing component ${itemReference}.`,
      )
    }

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

function assertProjectPlacementReferences(project) {
  for (const [index, placement] of (project.placements ?? []).entries()) {
    const reference = projectReference(
      placement.serverId,
      placement.itemType,
      placement.itemId,
    )
    if (!projectItem(project, placement.serverId, placement.itemType, placement.itemId)) {
      throw new Error(`Project placements[${index}] references missing item ${reference}.`)
    }
  }

  for (const [index, host] of (project.compatibilityPolicy?.disabledHosts ?? []).entries()) {
    const reference = `${host.hostType}:${host.hostId}`
    if (!project.items?.[reference]) {
      throw new Error(
        `Project compatibilityPolicy.disabledHosts[${index}] references missing host ${reference}.`,
      )
    }
  }
}

function assertProjectConnectionReferences(project) {
  for (const [connectionIndex, connection] of (project.connections ?? []).entries()) {
    assertProjectEndpointReference(project, connection.from, `Project connections[${connectionIndex}].from`)
    assertProjectEndpointReference(project, connection.to, `Project connections[${connectionIndex}].to`)
  }
}

function assertProjectEndpointReference(project, endpoint, path) {
  const hostReference = projectReference(endpoint.itemId, endpoint.itemType, endpoint.itemId)
  const host = projectItem(project, endpoint.itemId, endpoint.itemType, endpoint.itemId)
  if (!host) {
    throw new Error(`${path} references missing item ${hostReference}.`)
  }

  const hostedReference = endpoint.hostedItemId === undefined
    ? undefined
    : projectReference(
        endpoint.hostedItemId,
        endpoint.hostedItemType,
        endpoint.hostedItemId,
      )
  const owner = hostedReference
    ? projectItem(
        project,
        endpoint.hostedItemId,
        endpoint.hostedItemType,
        endpoint.hostedItemId,
      )
    : host

  if (!owner) {
    throw new Error(`${path} references missing hosted item ${hostedReference}.`)
  }

  if (hostedReference) {
    const assignedToHost = (project.assignments ?? []).some((assignment) => (
      projectReference(assignment.serverId, assignment.hostType, assignment.hostId) === hostReference
      && projectReference(assignment.itemId, assignment.itemType, assignment.itemId) === hostedReference
    ))
    if (!assignedToHost) {
      throw new Error(
        `${path} hosted item ${hostedReference} is not assigned to host ${hostReference}.`,
      )
    }
  }

  const port = owner.ports?.find((candidate) => candidate.id === endpoint.portId)
  if (!port) {
    throw new Error(`${path}.portId references missing port ${endpoint.portId} on ${hostedReference ?? hostReference}.`)
  }

  const portEndpoints = port.endpoints ?? []
  if (endpoint.endpointId !== undefined) {
    if (!portEndpoints.some((candidate) => candidate.id === endpoint.endpointId)) {
      throw new Error(
        `${path}.endpointId references missing endpoint ${endpoint.endpointId} on port ${endpoint.portId}.`,
      )
    }
  } else if (portEndpoints.length > 0) {
    throw new Error(`${path}.endpointId is required for multi-sided port ${endpoint.portId}.`)
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
      const configuredCount = capabilitySource?.specs?.cpuSocketCount
        ?? capabilitySource?.specs?.cpuSockets
        ?? 1
      capacity = hostCompatibility.cpu?.sockets?.length > 0 && Number.isInteger(configuredCount)
        ? configuredCount
        : undefined
    } else if (allocation.resourceType === 'memory') {
      groupPath = 'compatibility.host.memory'
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
    const groupId = ['cpu', 'cooling', 'memory'].includes(allocation.resourceType)
      ? ''
      : allocation.groupId

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
