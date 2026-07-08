import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const STORE_DIR = path.join(ROOT, 'data', 'stores')
const BACKUP_DIR = process.argv[2]

const TABLE_BY_TYPE = {
  server: 'servers',
  cpu: 'cpus',
  ram: 'ram',
  storage: 'storage',
  network: 'networkCards',
  gpu: 'gpus',
  nas: 'nas',
  switch: 'switches',
  patchPanel: 'patchPanels',
}
const TYPE_BY_TABLE = Object.fromEntries(Object.entries(TABLE_BY_TYPE).map(([type, table]) => [table, type]))
const TABLES = ['servers', 'cpus', 'ram', 'storage', 'networkCards', 'gpus', 'nas', 'switches', 'patchPanels']

function readJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(STORE_DIR, fileName), 'utf8'))
}

function writeJson(fileName, data) {
  fs.writeFileSync(path.join(STORE_DIR, fileName), `${JSON.stringify(data, null, 2)}\n`)
}

function fail(message) {
  throw new Error(message)
}

function parseItemKey(key) {
  if (typeof key !== 'string') {
    return null
  }

  const [type, rawId] = key.split(':')
  const id = Number(rawId)

  if (!TABLE_BY_TYPE[type] || !Number.isInteger(id)) {
    return null
  }

  return { type, id }
}

function itemKey(type, id) {
  return `${type}:${id}`
}

function normalizeId(value, label) {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number(value)

    if (Number.isInteger(parsed)) {
      return parsed
    }

    const key = parseItemKey(value)

    if (key) {
      return key.id
    }
  }

  fail(`Cannot convert ${label} "${value}" to a numeric id.`)
}

function migrateInventory(inventory) {
  const tables = Object.fromEntries(TABLES.map((table) => [table, []]))
  const records = inventory.items
    ? Object.values(inventory.items)
    : TABLES.flatMap((table) => (inventory[table] ?? []).map((record) => ({
        ...record,
        type: TYPE_BY_TABLE[table],
      })))
  const itemMap = {}

  for (const item of records) {
    const parsed = typeof item.id === 'string' ? parseItemKey(item.id) : null
    const type = parsed?.type ?? item.type
    const id = parsed?.id ?? normalizeId(item.id, `${type} item`)
    const table = TABLE_BY_TYPE[type]

    if (!table) {
      fail(`Unsupported inventory type ${type}.`)
    }

    const migrated = {
      ...item,
      id,
      ports: item.ports?.map((port) => ({
        ...port,
        id: normalizeId(port.id, `${type}:${id} port`),
        endpoints: port.endpoints?.map((endpoint) => ({
          ...endpoint,
          id: normalizeId(endpoint.id, `${type}:${id} endpoint`),
        })),
      })),
    }

    delete migrated.type
    delete migrated.key
    tables[table].push(migrated)
    itemMap[item.id] = { type, id, key: itemKey(type, id) }
    itemMap[itemKey(type, id)] = { type, id, key: itemKey(type, id) }
  }

  for (const table of TABLES) {
    tables[table].sort((first, second) => first.id - second.id)
  }

  return { inventory: tables, itemMap }
}

function mapItem(itemMap, value, label) {
  const mapped = itemMap[value]

  if (!mapped) {
    fail(`Missing item mapping for ${label}: ${value}`)
  }

  return mapped
}

function migrateEndpoint(endpoint, itemMap) {
  const item = mapItem(itemMap, endpoint.itemId, 'endpoint item')
  const rawPortId = String(endpoint.portId)
  let hostedItem
  let portId = endpoint.portId

  if (endpoint.hostedItemId) {
    hostedItem = mapItem(itemMap, endpoint.hostedItemId, 'hosted endpoint item')
  } else if (rawPortId.includes('::')) {
    const [hostedItemKey, hostedPortId] = rawPortId.split('::')
    hostedItem = mapItem(itemMap, hostedItemKey, 'legacy hosted endpoint item')
    portId = hostedPortId
  }

  return {
    itemType: item.type,
    itemId: item.id,
    ...(hostedItem ? { hostedItemType: hostedItem.type, hostedItemId: hostedItem.id } : {}),
    portId: normalizeId(portId, 'endpoint port'),
    ...(endpoint.endpointId !== undefined
      ? { endpointId: normalizeId(endpoint.endpointId, 'endpoint side') }
      : {}),
  }
}

function migrateProject(project, itemMap) {
  return {
    ...project,
    id: 'default',
    placements: project.placements.map((placement) => {
      if (placement.itemType && placement.itemId !== undefined) {
        return {
          itemType: placement.itemType,
          itemId: normalizeId(placement.itemId, 'placement item'),
          x: placement.x,
          y: placement.y,
        }
      }

      const item = mapItem(itemMap, placement.serverId, 'placement item')

      return {
        itemType: item.type,
        itemId: item.id,
        x: placement.x,
        y: placement.y,
      }
    }),
    assignments: project.assignments.map((assignment) => {
      const host = assignment.hostType
        ? { type: assignment.hostType, id: normalizeId(assignment.hostId, 'assignment host') }
        : mapItem(itemMap, assignment.serverId, 'assignment host')
      const item = assignment.itemType
        ? { type: assignment.itemType, id: normalizeId(assignment.itemId, 'assignment item') }
        : mapItem(itemMap, assignment.itemId, 'assignment item')

      return {
        id: normalizeId(assignment.id, 'assignment'),
        hostType: host.type,
        hostId: host.id,
        itemType: item.type,
        itemId: item.id,
        type: assignment.type,
        assignedAt: assignment.assignedAt,
      }
    }),
    connections: (project.connections ?? []).map((connection) => ({
      ...connection,
      id: normalizeId(connection.id, 'connection'),
      from: migrateEndpoint(connection.from, itemMap),
      to: migrateEndpoint(connection.to, itemMap),
    })),
  }
}

function migrateAgents(agents, itemMap) {
  const enrollments = {}
  const devices = {}

  for (const enrollment of Object.values(agents.enrollments ?? {})) {
    const server = mapItem(itemMap, enrollment.serverId, 'agent enrollment server')
    const id = normalizeId(enrollment.id, 'agent enrollment')
    enrollments[id] = {
      ...enrollment,
      id,
      serverId: server.id,
    }
  }

  for (const device of Object.values(agents.devices ?? {})) {
    const server = mapItem(itemMap, device.serverId, 'agent device server')
    const id = normalizeId(device.id, 'agent device')
    devices[id] = {
      ...device,
      id,
      serverId: server.id,
    }
  }

  return { ...agents, enrollments, devices }
}

function migrateAgentStatus(agentStatus, itemMap) {
  const servers = {}

  for (const [serverId, status] of Object.entries(agentStatus.servers ?? {})) {
    const server = mapItem(itemMap, serverId, 'agent status server')
    servers[server.id] = {
      ...status,
      ...(status.serverId !== undefined ? { serverId: server.id } : {}),
    }
  }

  return { ...agentStatus, servers }
}

function validate({ inventory, project, agents }) {
  const tables = new Map()

  for (const [table, type] of Object.entries(TYPE_BY_TABLE)) {
    for (const item of inventory[table] ?? []) {
      tables.set(itemKey(type, item.id), item)
    }
  }

  const hasItem = (type, id) => tables.has(itemKey(type, id))

  for (const placement of project.placements) {
    if (!hasItem(placement.itemType, placement.itemId)) {
      fail(`Invalid placement ${placement.itemType}:${placement.itemId}`)
    }
  }

  for (const assignment of project.assignments) {
    if (!hasItem(assignment.hostType, assignment.hostId)) {
      fail(`Invalid assignment host ${assignment.hostType}:${assignment.hostId}`)
    }

    if (!hasItem(assignment.itemType, assignment.itemId)) {
      fail(`Invalid assignment item ${assignment.itemType}:${assignment.itemId}`)
    }
  }

  for (const connection of project.connections) {
    for (const endpoint of [connection.from, connection.to]) {
      const item = tables.get(itemKey(endpoint.itemType, endpoint.itemId))

      if (!item) {
        fail(`Invalid connection endpoint item ${endpoint.itemType}:${endpoint.itemId}`)
      }

      const portOwner = endpoint.hostedItemType
        ? tables.get(itemKey(endpoint.hostedItemType, endpoint.hostedItemId))
        : item
      const port = portOwner?.ports?.find((candidate) => candidate.id === endpoint.portId)

      if (!port) {
        fail(`Invalid connection endpoint port ${JSON.stringify(endpoint)}`)
      }
    }
  }

  for (const enrollment of Object.values(agents.enrollments ?? {})) {
    if (!hasItem('server', enrollment.serverId)) {
      fail(`Invalid agent enrollment server ${enrollment.serverId}`)
    }
  }
}

const originalInventory = readJson('inventory.json')
const originalProject = readJson('project.json')
const originalAgents = readJson('agents.json')
const originalAgentStatus = readJson('agent-status.json')
const metaPath = path.join(ROOT, 'data', 'meta.json')
const originalMeta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : {}

const { inventory, itemMap } = migrateInventory(originalInventory)
const project = migrateProject(originalProject, itemMap)
const agents = migrateAgents(originalAgents, itemMap)
const agentStatus = migrateAgentStatus(originalAgentStatus, itemMap)

validate({ inventory, project, agents })

if (BACKUP_DIR) {
  fs.writeFileSync(path.join(BACKUP_DIR, 'category-array-id-map.json'), `${JSON.stringify(itemMap, null, 2)}\n`)
}

writeJson('inventory.json', inventory)
writeJson('project.json', project)
writeJson('agents.json', agents)
writeJson('agent-status.json', agentStatus)
fs.writeFileSync(metaPath, `${JSON.stringify({
  ...originalMeta,
  schemaVersion: 3,
  updatedAt: new Date().toISOString(),
}, null, 2)}\n`)

console.log(JSON.stringify({
  inventory: Object.fromEntries(TABLES.map((table) => [table, inventory[table].length])),
  placements: project.placements.length,
  assignments: project.assignments.length,
  connections: project.connections.length,
  enrollments: Object.keys(agents.enrollments ?? {}).length,
}, null, 2))
