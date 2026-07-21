import { isCanvasEquipmentType, isInventoryType } from '@/lib/inventory-capabilities'
import { runtimeItemKey } from '@/lib/item-keys'
import { createEmptyProject } from '@/lib/project'
import type {
  InventoryItem,
  InventoryPort,
  InventoryPortEndpoint,
  InventoryPortKind,
  InventoryPortRole,
  InventoryPortSide,
  InventoryPortType,
  InventoryType,
  ProjectState,
} from '@/types/inventory'

export const INVENTORY_CATEGORY_ORDER = [
  'server',
  'pcBuild',
  'cpu',
  'cpuCooler',
  'motherboard',
  'ram',
  'storage',
  'gpu',
  'network',
  'wireless',
  'soundCard',
  'case',
  'powerSupply',
  'powerAdapter',
  'nas',
  'switch',
  'patchPanel',
  'monitor',
  'ups',
  'powerStrip',
] as const satisfies readonly InventoryType[]

export const INVENTORY_TYPE_LABELS: Record<InventoryType, string> = {
  server: 'Server',
  pcBuild: 'PC Build',
  cpu: 'CPU',
  cpuCooler: 'CPU Cooler',
  motherboard: 'Motherboard',
  ram: 'RAM',
  storage: 'Storage',
  gpu: 'GPU',
  network: 'Network',
  wireless: 'Wireless',
  soundCard: 'Sound Card',
  case: 'Case',
  powerSupply: 'Power Supply',
  powerAdapter: 'Power Adapter',
  nas: 'NAS',
  switch: 'Switch',
  patchPanel: 'Patch Panel',
  monitor: 'Monitor',
  ups: 'UPS',
  powerStrip: 'Power Strip',
}

export const INVENTORY_TYPE_RANK: Readonly<Record<InventoryType, number>> =
  Object.fromEntries(INVENTORY_CATEGORY_ORDER.map((type, index) => [type, index])) as Record<
    InventoryType,
    number
  >

const INVENTORY_TABLES = [
  ['servers', 'server'],
  ['pcBuilds', 'pcBuild'],
  ['cpus', 'cpu'],
  ['cpuCoolers', 'cpuCooler'],
  ['motherboards', 'motherboard'],
  ['ram', 'ram'],
  ['storage', 'storage'],
  ['gpus', 'gpu'],
  ['networkCards', 'network'],
  ['wirelessCards', 'wireless'],
  ['soundCards', 'soundCard'],
  ['cases', 'case'],
  ['powerSupplies', 'powerSupply'],
  ['powerAdapters', 'powerAdapter'],
  ['nas', 'nas'],
  ['switches', 'switch'],
  ['patchPanels', 'patchPanel'],
  ['monitors', 'monitor'],
  ['upsSystems', 'ups'],
  ['powerStrips', 'powerStrip'],
] as const satisfies readonly (readonly [string, InventoryType])[]
const PORT_KINDS: InventoryPortKind[] = ['switch-port', 'keystone', 'server-port']
const PORT_TYPES: InventoryPortType[] = [
  'rj45',
  'sfp',
  'sfp-plus',
  'hdmi',
  'displayport',
  'mini-displayport',
  'barrel',
]
const PORT_SIDES: InventoryPortSide[] = ['front', 'back']
const PORT_ROLES: InventoryPortRole[] = ['access', 'trunk', 'uplink', 'management', 'disabled']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeNumericId(value: unknown, label: string): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return value
  }

  throw new Error(`${label} must have a positive numeric id.`)
}

function normalizeProperties(value: unknown): InventoryItem['properties'] {
  if (!isRecord(value)) {
    return undefined
  }

  const properties = Object.fromEntries(
    Object.entries(value).filter(([, propertyValue]) => typeof propertyValue === 'string'),
  ) as InventoryItem['properties']

  return properties && Object.keys(properties).length > 0 ? properties : undefined
}

function normalizePorts(value: unknown, itemId: string): InventoryPort[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const ports: InventoryPort[] = value.map((raw, index) => {
    if (!isRecord(raw)) {
      throw new Error(`Port at index ${index} on ${itemId} must be an object.`)
    }

    const id = normalizeNumericId(raw.id, `Port at index ${index} on ${itemId}`)

    if (!PORT_KINDS.includes(raw.kind as InventoryPortKind)) {
      throw new Error(`Port ${id} on ${itemId} has an unsupported kind.`)
    }

    if (!PORT_TYPES.includes(raw.type as InventoryPortType)) {
      throw new Error(`Port ${id} on ${itemId} has an unsupported type.`)
    }

    if (typeof raw.slotNumber !== 'number') {
      throw new Error(`Port ${id} on ${itemId} is missing a slot number.`)
    }

    const kind = raw.kind as InventoryPortKind
    const type = raw.type as InventoryPortType

    let endpoints: InventoryPortEndpoint[] | undefined

    if (Array.isArray(raw.endpoints)) {
      endpoints = raw.endpoints.map((endpoint, endpointIndex) => {
        if (!isRecord(endpoint)) {
          throw new Error(`Endpoint at index ${endpointIndex} on port ${raw.id} must be an object.`)
        }

        const endpointId = normalizeNumericId(
          endpoint.id,
          `Endpoint at index ${endpointIndex} on port ${id}`,
        )

        if (!PORT_SIDES.includes(endpoint.side as InventoryPortSide)) {
          throw new Error(`Endpoint ${endpointId} on port ${id} has an unsupported side.`)
        }

        return {
          id: endpointId,
          side: endpoint.side as InventoryPortSide,
        }
      })
    }

    return {
      id,
      kind,
      type,
      slotNumber: raw.slotNumber,
      label: typeof raw.label === 'string' ? raw.label : undefined,
      notes: typeof raw.notes === 'string' ? raw.notes : undefined,
      role: PORT_ROLES.includes(raw.role as InventoryPortRole)
        ? raw.role as InventoryPortRole
        : undefined,
      speed: typeof raw.speed === 'string' ? raw.speed : undefined,
      poe: typeof raw.poe === 'boolean' ? raw.poe : undefined,
      endpoints,
    }
  })

  return ports.length > 0 ? ports : undefined
}

export function normalizeInventory(input: unknown): InventoryItem[] {
  const records = inventoryRecords(input)

  const ids = new Set<string>()

  return records.map(({ raw, type: tableType }, index) => {
    if (!isRecord(raw)) {
      throw new Error(`Inventory item at index ${index} must be an object.`)
    }

    const id = normalizeNumericId(raw.id, `Inventory item at index ${index}`)

    const type = tableType ?? raw.type

    if (!isInventoryType(type)) {
      throw new Error(`Inventory item ${id} has an unsupported type.`)
    }

    const key = runtimeItemKey({ id, type, name: String(raw.name ?? '') })

    if (ids.has(key)) {
      throw new Error(`Inventory contains a duplicate id: ${key}.`)
    }

    if (typeof raw.name !== 'string' || raw.name.trim() === '') {
      throw new Error(`Inventory item ${key} is missing a name.`)
    }

    ids.add(key)

    return {
      id,
      key,
      name: raw.name,
      type,
      subtype: typeof raw.subtype === 'string' ? raw.subtype : undefined,
      manufacturer: typeof raw.manufacturer === 'string' ? raw.manufacturer : undefined,
      secondaryManufacturer:
        typeof raw.secondaryManufacturer === 'string' ? raw.secondaryManufacturer : undefined,
      family: typeof raw.family === 'string' ? raw.family : undefined,
      model: typeof raw.model === 'string' ? raw.model : undefined,
      number: typeof raw.number === 'string' ? raw.number : undefined,
      specs: isRecord(raw.specs) ? (raw.specs as InventoryItem['specs']) : undefined,
      compatibility: isRecord(raw.compatibility)
        ? structuredClone(raw.compatibility) as InventoryItem['compatibility']
        : undefined,
      properties: normalizeProperties(raw.properties),
      ports: normalizePorts(raw.ports, key),
      notes: typeof raw.notes === 'string' ? raw.notes : undefined,
      archivedAt:
        typeof raw.archivedAt === 'string' && raw.archivedAt.trim() !== ''
          ? raw.archivedAt
          : undefined,
    }
  })
}

function inventoryRecords(input: unknown): Array<{ raw: unknown; type?: InventoryType }> {
  if (Array.isArray(input)) {
    return input.map((raw) => ({ raw }))
  }

  if (!isRecord(input)) {
    throw new Error('Inventory JSON must be an array or category object.')
  }

  if (isRecord(input.items)) {
    return Object.values(input.items).map((raw) => ({ raw }))
  }

  const records: Array<{ raw: unknown; type?: InventoryType }> = []

  for (const [tableKey, type] of INVENTORY_TABLES) {
    const table = input[tableKey]

    if (table === undefined) {
      continue
    }

    if (!Array.isArray(table)) {
      throw new Error(`Inventory table ${tableKey} must be an array.`)
    }

    records.push(...table.map((raw) => ({ raw, type })))
  }

  if (records.length === 0) {
    throw new Error('Inventory JSON does not contain any inventory tables.')
  }

  return records
}

export function mergeInventoryWithProject(
  items: InventoryItem[],
  saved: ProjectState | null,
): ProjectState {
  const starterItems = Object.fromEntries(items.map((item) => [runtimeItemKey(item), item]))

  if (!saved) {
    return createEmptyProject(items)
  }

  const referencedSavedItemIds = new Set<string>([
    ...saved.placements.map((placement) => placement.serverId),
    ...saved.assignments.flatMap((assignment) => [assignment.serverId, assignment.itemId]),
    ...(saved.connections ?? []).flatMap((connection) => [
      connection.from.itemId,
      connection.to.itemId,
    ]),
  ])
  const referencedSavedItems = Object.fromEntries(
    Object.entries(saved.items).filter(
      ([itemId]) => referencedSavedItemIds.has(itemId) && !starterItems[itemId],
    ),
  )

  return {
    ...saved,
    connections: saved.connections ?? [],
    items: {
      ...starterItems,
      ...referencedSavedItems,
      ...starterItems,
    },
  }
}

export function getUnassignedItems(project: ProjectState): InventoryItem[] {
  const placedServers = new Set(project.placements.map((placement) => placement.serverId))
  const assignedComponents = new Set(project.assignments.map((assignment) => assignment.itemId))

  return Object.values(project.items).filter((item) => {
    if (isCanvasEquipmentType(item.type)) {
      return !placedServers.has(runtimeItemKey(item))
    }

    return !assignedComponents.has(runtimeItemKey(item))
  })
}

export function getItem(project: ProjectState, itemId: string): InventoryItem | null {
  return project.items[itemId] ?? null
}
