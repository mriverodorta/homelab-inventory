const componentTypes = new Set(['cpu', 'ram', 'storage', 'gpu', 'network'])
const inventoryTypes = new Set(['server', 'nas', 'switch', 'patchPanel', ...componentTypes])
const tableTypes = {
  servers: 'server',
  cpus: 'cpu',
  ram: 'ram',
  storage: 'storage',
  networkCards: 'network',
  gpus: 'gpu',
  nas: 'nas',
  switches: 'switch',
  patchPanels: 'patchPanel',
}
const portKinds = new Set(['switch-port', 'keystone', 'server-port'])
const portTypes = new Set(['rj45', 'sfp', 'sfp-plus', 'hdmi', 'displayport', 'mini-displayport', 'barrel'])
const portRoles = new Set(['access', 'trunk', 'uplink', 'management', 'disabled'])
const portSides = new Set(['front', 'back'])
const switchNetworkPortTypes = new Set(['rj45', 'sfp', 'sfp-plus'])
const switchNetworkPortSpeeds = new Set(['1G', '2.5G', '5G', '10G'])

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

function assertInventoryItem(itemId, item, expectedType) {
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
}
