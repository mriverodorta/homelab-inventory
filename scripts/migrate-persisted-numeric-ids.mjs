import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const STORE_DIR = path.join(ROOT, 'data', 'stores')
const BACKUP_DIR = process.argv[2]

const ITEM_TYPE_ORDER = [
  'server',
  'cpu',
  'ram',
  'storage',
  'network',
  'gpu',
  'nas',
  'switch',
  'patchPanel',
]

function readJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(STORE_DIR, fileName), 'utf8'))
}

function writeJson(fileName, data) {
  fs.writeFileSync(path.join(STORE_DIR, fileName), `${JSON.stringify(data, null, 2)}\n`)
}

function fail(message) {
  throw new Error(message)
}

function scopedItemId(type, index) {
  return `${type}:${index}`
}

function mapRequired(map, key, label) {
  const value = map.get(key)

  if (!value) {
    fail(`Missing ${label} mapping for ${key}`)
  }

  return value
}

function portMapKey(itemId, portId) {
  return `${itemId}\u0000${portId}`
}

function endpointMapKey(itemId, portId, endpointId) {
  return `${itemId}\u0000${portId}\u0000${endpointId}`
}

function orderedInventoryEntries(items) {
  const entries = Object.entries(items)

  return entries.sort(([, a], [, b]) => {
    const typeDelta = ITEM_TYPE_ORDER.indexOf(a.type) - ITEM_TYPE_ORDER.indexOf(b.type)

    if (typeDelta !== 0) {
      return typeDelta
    }

    return String(a.name).localeCompare(String(b.name), undefined, {
      numeric: true,
      sensitivity: 'base',
    })
  })
}

function migratePort(itemId, port, portIndex, maps) {
  const newPortId = String(portIndex + 1)
  maps.portId.set(portMapKey(itemId, port.id), newPortId)

  const endpoints = Array.isArray(port.endpoints)
    ? port.endpoints.map((endpoint, endpointIndex) => {
        const newEndpointId = String(endpointIndex + 1)
        maps.endpointId.set(endpointMapKey(itemId, port.id, endpoint.id), newEndpointId)

        return {
          ...endpoint,
          id: newEndpointId,
        }
      })
    : undefined

  return {
    ...port,
    id: newPortId,
    ...(endpoints ? { endpoints } : {}),
  }
}

function migrateInventory(inventory) {
  const maps = {
    itemId: new Map(),
    portId: new Map(),
    endpointId: new Map(),
  }
  const counters = Object.fromEntries(ITEM_TYPE_ORDER.map((type) => [type, 0]))
  const orderedEntries = orderedInventoryEntries(inventory.items)

  for (const [oldId, item] of orderedEntries) {
    counters[item.type] = (counters[item.type] ?? 0) + 1
    maps.itemId.set(oldId, scopedItemId(item.type, counters[item.type]))
  }

  const newItems = {}

  for (const [oldId, item] of orderedEntries) {
    const newItemId = mapRequired(maps.itemId, oldId, 'item id')
    const ports = Array.isArray(item.ports)
      ? item.ports.map((port, portIndex) => migratePort(oldId, port, portIndex, maps))
      : undefined

    newItems[newItemId] = {
      ...item,
      id: newItemId,
      ...(ports ? { ports } : {}),
    }
  }

  return {
    inventory: { ...inventory, items: newItems },
    maps,
    counters,
  }
}

function migrateEndpoint(endpoint, maps) {
  const newItemId = mapRequired(maps.itemId, endpoint.itemId, 'endpoint item id')
  let newPortId

  if (typeof endpoint.portId === 'string' && endpoint.portId.includes('::')) {
    const [componentItemId, componentPortId] = endpoint.portId.split('::')
    const newComponentItemId = mapRequired(maps.itemId, componentItemId, 'hosted component item id')
    const newComponentPortId = mapRequired(
      maps.portId,
      portMapKey(componentItemId, componentPortId),
      'hosted component port id',
    )
    newPortId = `${newComponentItemId}::${newComponentPortId}`
  } else {
    newPortId = mapRequired(maps.portId, portMapKey(endpoint.itemId, endpoint.portId), 'endpoint port id')
  }

  const newEndpointId = endpoint.endpointId
    ? mapRequired(
        maps.endpointId,
        endpointMapKey(endpoint.itemId, endpoint.portId, endpoint.endpointId),
        'keystone endpoint id',
      )
    : undefined

  return {
    ...endpoint,
    itemId: newItemId,
    portId: newPortId,
    ...(newEndpointId ? { endpointId: newEndpointId } : {}),
  }
}

function migrateProject(project, maps) {
  if (project.id !== 'default') {
    fail(`Expected top-level project id "default", found "${project.id}"`)
  }

  return {
    ...project,
    id: 'default',
    placements: project.placements.map((placement) => ({
      ...placement,
      serverId: mapRequired(maps.itemId, placement.serverId, 'placement item id'),
    })),
    assignments: project.assignments.map((assignment, index) => ({
      ...assignment,
      id: String(index + 1),
      serverId: mapRequired(maps.itemId, assignment.serverId, 'assignment host item id'),
      itemId: mapRequired(maps.itemId, assignment.itemId, 'assignment component item id'),
    })),
    connections: (project.connections ?? []).map((connection, index) => ({
      ...connection,
      id: String(index + 1),
      from: migrateEndpoint(connection.from, maps),
      to: migrateEndpoint(connection.to, maps),
    })),
  }
}

function migrateAgents(agents, maps) {
  const enrollments = {}
  const devices = {}

  Object.values(agents.enrollments ?? {}).forEach((enrollment, index) => {
    const id = String(index + 1)
    enrollments[id] = {
      ...enrollment,
      id,
      serverId: mapRequired(maps.itemId, enrollment.serverId, 'agent enrollment server id'),
    }
  })

  Object.values(agents.devices ?? {}).forEach((device, index) => {
    const id = String(index + 1)
    devices[id] = {
      ...device,
      id,
      serverId: mapRequired(maps.itemId, device.serverId, 'agent device server id'),
    }
  })

  return {
    ...agents,
    enrollments,
    devices,
  }
}

function migrateAgentStatus(agentStatus, maps) {
  const servers = {}

  Object.entries(agentStatus.servers ?? {}).forEach(([serverId, status]) => {
    const newServerId = mapRequired(maps.itemId, serverId, 'agent status server id')
    servers[newServerId] = {
      ...status,
      ...(typeof status.serverId === 'string' ? { serverId: newServerId } : {}),
    }
  })

  return {
    ...agentStatus,
    servers,
  }
}

function findItem(inventory, itemId) {
  return inventory.items[itemId]
}

function findPort(inventory, endpoint) {
  const item = findItem(inventory, endpoint.itemId)

  if (!item) {
    return null
  }

  if (endpoint.portId.includes('::')) {
    const [componentItemId, componentPortId] = endpoint.portId.split('::')
    const component = findItem(inventory, componentItemId)

    return component?.ports?.find((port) => port.id === componentPortId) ?? null
  }

  return item.ports?.find((port) => port.id === endpoint.portId) ?? null
}

function validateMigratedState({ inventory, project, agents, agentStatus }) {
  const itemIds = new Set(Object.keys(inventory.items))

  for (const [itemId, item] of Object.entries(inventory.items)) {
    if (item.id !== itemId) {
      fail(`Inventory key/id mismatch for ${itemId}`)
    }
  }

  for (const placement of project.placements) {
    if (!itemIds.has(placement.serverId)) {
      fail(`Placement references missing item ${placement.serverId}`)
    }
  }

  for (const assignment of project.assignments) {
    if (!itemIds.has(assignment.serverId)) {
      fail(`Assignment ${assignment.id} references missing host ${assignment.serverId}`)
    }

    if (!itemIds.has(assignment.itemId)) {
      fail(`Assignment ${assignment.id} references missing item ${assignment.itemId}`)
    }
  }

  for (const connection of project.connections ?? []) {
    if (!findPort(inventory, connection.from)) {
      fail(`Connection ${connection.id} has an invalid source port`)
    }

    if (!findPort(inventory, connection.to)) {
      fail(`Connection ${connection.id} has an invalid destination port`)
    }
  }

  for (const enrollment of Object.values(agents.enrollments ?? {})) {
    if (!itemIds.has(enrollment.serverId)) {
      fail(`Agent enrollment ${enrollment.id} references missing server ${enrollment.serverId}`)
    }
  }

  for (const device of Object.values(agents.devices ?? {})) {
    if (!itemIds.has(device.serverId)) {
      fail(`Agent device ${device.id} references missing server ${device.serverId}`)
    }
  }

  for (const serverId of Object.keys(agentStatus.servers ?? {})) {
    if (!itemIds.has(serverId)) {
      fail(`Agent status references missing server ${serverId}`)
    }
  }
}

function writeMapping(maps) {
  if (!BACKUP_DIR) {
    return
  }

  const mappingPath = path.join(BACKUP_DIR, 'id-map.json')
  fs.writeFileSync(
    mappingPath,
    `${JSON.stringify({
      items: Object.fromEntries(maps.itemId),
      ports: Object.fromEntries(maps.portId),
      endpoints: Object.fromEntries(maps.endpointId),
    }, null, 2)}\n`,
  )
}

const originalInventory = readJson('inventory.json')
const originalProject = readJson('project.json')
const originalAgents = readJson('agents.json')
const originalAgentStatus = readJson('agent-status.json')

const { inventory, maps, counters } = migrateInventory(originalInventory)
const project = migrateProject(originalProject, maps)
const agents = migrateAgents(originalAgents, maps)
const agentStatus = migrateAgentStatus(originalAgentStatus, maps)

validateMigratedState({ inventory, project, agents, agentStatus })
writeMapping(maps)

writeJson('inventory.json', inventory)
writeJson('project.json', project)
writeJson('agents.json', agents)
writeJson('agent-status.json', agentStatus)

console.log(JSON.stringify({
  itemCounts: counters,
  placements: project.placements.length,
  assignments: project.assignments.length,
  connections: project.connections.length,
  enrollments: Object.keys(agents.enrollments ?? {}).length,
  devices: Object.keys(agents.devices ?? {}).length,
}, null, 2))
