import { INVENTORY_TYPES, type InventoryType } from '../core/inventory/field-contract.ts'

const TABLE_BY_TYPE: Readonly<Record<InventoryType, string>> = {
  server: 'servers',
  nas: 'nas',
  pcBuild: 'pcBuilds',
  cpu: 'cpus',
  ram: 'ram',
  storage: 'storage',
  gpu: 'gpus',
  network: 'networkCards',
  motherboard: 'motherboards',
  cpuCooler: 'cpuCoolers',
  case: 'cases',
  powerSupply: 'powerSupplies',
  soundCard: 'soundCards',
  wireless: 'wirelessCards',
  powerAdapter: 'powerAdapters',
  switch: 'switches',
  patchPanel: 'patchPanels',
  monitor: 'monitors',
  ups: 'upsSystems',
  powerStrip: 'powerStrips',
}

type LegacyRecord = Record<string, unknown>
type LegacySnapshot = Record<string, any>

export type CanonicalIdentityPlan = Readonly<{
  items: ReadonlyMap<string, number>
  ports: ReadonlyMap<string, number>
  endpointFaces: ReadonlyMap<string, number>
  resourceGroups: ReadonlyMap<string, number>
  resourceSlots: ReadonlyMap<string, number>
  agents: ReadonlyMap<string, number>
  registrySources: ReadonlyMap<string, number>
  registryLinks: ReadonlyMap<string, number>
  assignments: ReadonlyMap<string, number>
  connections: ReadonlyMap<string, number>
}>

function positiveId(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new Error(`${label} must be a positive safe integer.`)
  return Number(value)
}

function sortedRecords(value: unknown, label: string): LegacyRecord[] {
  if (value === undefined || value === null) return []
  const records = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>)
  return records.map((record, index) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error(`${label}[${index}] must be an object.`)
    return record as LegacyRecord
  }).sort((left, right) => positiveId(left.id, `${label}.id`) - positiveId(right.id, `${label}.id`))
}

function allocate(records: LegacyRecord[], keyOf: (record: LegacyRecord) => string, label: string): ReadonlyMap<string, number> {
  const result = new Map<string, number>()
  for (const record of records) {
    const key = keyOf(record)
    if (result.has(key)) throw new Error(`Duplicate ${label} identity ${key}.`)
    result.set(key, result.size + 1)
  }
  return result
}

function resourceDefinitions(item: LegacyRecord): Array<{ key: string, count: number }> {
  const host = (item.compatibility as any)?.host ?? {}
  const definitions: Array<{ key: string, count: number }> = []
  const scalar = [
    ['cpu', host.cpu?.socketCount ?? host.cpu?.socketsCount ?? 0],
    ['memory', host.memory?.slots ?? 0],
    ['power-adapter', host.powerAdapterSlots ?? 0],
    ['psu', host.power?.psuBays ?? host.power?.bayCount ?? 0],
  ] as const
  for (const [key, count] of scalar) {
    if (Number.isSafeInteger(count) && count > 0) definitions.push({ key, count })
  }
  const collections = [
    ['storage', host.storageSlots],
    ['expansion', host.expansionSlots],
    ['optional', host.optionalModuleSlots],
    ['controller', host.controllerSlots],
    ['boot', host.bootDeviceSlots],
  ] as const
  for (const [prefix, value] of collections) {
    if (!Array.isArray(value)) continue
    value.forEach((entry, index) => {
      const key = typeof entry?.key === 'string' && entry.key ? entry.key : `${prefix}-${index + 1}`
      const count = Number.isSafeInteger(entry?.count) && entry.count > 0 ? entry.count : 1
      definitions.push({ key, count })
    })
  }
  return definitions
}

function itemReference(record: LegacyRecord, prefix: string): string {
  const type = record[`${prefix}Type`] ?? record.type
  const id = record[`${prefix}Id`]
  if (typeof type !== 'string') throw new Error(`${prefix} reference type is missing.`)
  return `${type}:${positiveId(id, `${prefix} reference ID`)}`
}

export function buildCanonicalIdentityPlan(snapshot: LegacySnapshot): CanonicalIdentityPlan {
  const itemRecords: Array<LegacyRecord & { __type: InventoryType }> = []
  for (const type of INVENTORY_TYPES) {
    for (const record of sortedRecords(snapshot.inventory?.[TABLE_BY_TYPE[type]], `inventory.${TABLE_BY_TYPE[type]}`)) {
      itemRecords.push({ ...record, __type: type })
    }
  }
  const items = allocate(
    itemRecords,
    (record) => `${record.__type}:${positiveId(record.id, `${record.__type}.id`)}`,
    'inventory',
  )

  const portRecords: Array<LegacyRecord & { __itemKey: string }> = []
  const endpointRecords: Array<LegacyRecord & { __portKey: string }> = []
  const groupRecords: Array<LegacyRecord & { __itemKey: string, __count: number }> = []
  for (const item of itemRecords) {
    const itemKey = `${item.__type}:${positiveId(item.id, `${item.__type}.id`)}`
    const ports = Array.isArray(item.ports) ? item.ports as LegacyRecord[] : []
    for (const port of ports.sort((left, right) => positiveId(left.id, 'port.id') - positiveId(right.id, 'port.id'))) {
      const portKey = `${itemKey}:port:${positiveId(port.id, 'port.id')}`
      portRecords.push({ ...port, __itemKey: itemKey })
      const endpoints = Array.isArray(port.endpoints) ? port.endpoints as LegacyRecord[] : []
      endpoints.forEach((endpoint, index) => endpointRecords.push({ ...endpoint, id: endpoint.id ?? index + 1, __portKey: portKey }))
    }
    for (const definition of resourceDefinitions(item)) {
      groupRecords.push({ id: groupRecords.length + 1, key: definition.key, __itemKey: itemKey, __count: definition.count })
    }
  }
  const ports = allocate(portRecords, (record) => `${record.__itemKey}:port:${positiveId(record.id, 'port.id')}`, 'port')
  const endpointFaces = allocate(endpointRecords, (record) => `${record.__portKey}:face:${positiveId(record.id, 'endpoint.id')}`, 'endpoint face')
  const resourceGroups = allocate(groupRecords, (record) => `${record.__itemKey}:resource:${String(record.key)}`, 'resource group')
  const slotRecords = groupRecords.flatMap((group) => Array.from({ length: group.__count }, (_, index) => ({
    id: index + 1,
    groupKey: `${group.__itemKey}:resource:${String(group.key)}`,
  })))
  const resourceSlots = allocate(slotRecords, (record) => `${record.groupKey}:slot:${record.id}`, 'resource slot')

  const assignmentsRecords = sortedRecords(snapshot.project?.assignments, 'project.assignments')
  for (const assignment of assignmentsRecords) {
    const hostKey = itemReference(assignment, 'host')
    const componentKey = itemReference(assignment, 'item')
    if (!items.has(hostKey)) throw new Error(`Assignment references missing host ${hostKey}.`)
    if (!items.has(componentKey)) throw new Error(`Assignment references missing component ${componentKey}.`)
  }
  const assignments = allocate(assignmentsRecords, (record) => String(positiveId(record.id, 'assignment.id')), 'assignment')

  const connectionRecords = sortedRecords(snapshot.project?.connections, 'project.connections')
  for (const connection of connectionRecords) {
    for (const endpointName of ['from', 'to']) {
      const endpoint = connection[endpointName] as LegacyRecord | undefined
      if (!endpoint) throw new Error(`Connection ${String(connection.id)} is missing ${endpointName}.`)
      const key = itemReference(endpoint, 'item')
      if (!items.has(key)) throw new Error(`Connection references missing endpoint item ${key}.`)
    }
  }
  const connections = allocate(connectionRecords, (record) => String(positiveId(record.id, 'connection.id')), 'connection')

  const agentRecords = sortedRecords(snapshot.agents?.devices, 'agents.devices')
  for (const agent of agentRecords) {
    const key = itemReference(agent, 'host')
    if (!items.has(key)) throw new Error(`Agent references missing host ${key}.`)
  }
  const agents = allocate(agentRecords, (record) => String(positiveId(record.id, 'agent.id')), 'agent')

  const sourceRecords = sortedRecords(snapshot.registry?.sources, 'registry.sources')
  const registrySources = allocate(sourceRecords, (record) => String(positiveId(record.id, 'registry source.id')), 'registry source')
  const linkRecords = sortedRecords(snapshot.registry?.links, 'registry.links')
  for (const link of linkRecords) {
    const itemKey = itemReference(link, 'item')
    if (!items.has(itemKey)) throw new Error(`Registry link references missing item ${itemKey}.`)
    if (!registrySources.has(String(positiveId(link.sourceId, 'registry link sourceId')))) {
      throw new Error(`Registry link references missing source ${String(link.sourceId)}.`)
    }
  }
  const registryLinks = allocate(linkRecords, (record) => String(positiveId(record.id, 'registry link.id')), 'registry link')

  return Object.freeze({
    items, ports, endpointFaces, resourceGroups, resourceSlots, agents,
    registrySources, registryLinks, assignments, connections,
  })
}
