import type {
  InventoryConnection,
  InventoryPort,
  InventoryPortRole,
  InventoryPortType,
} from '@/types/inventory'

export type SwitchPortGroup = {
  key: string
  type: InventoryPortType
  speed?: string
  role?: InventoryPortRole
  ports: InventoryPort[]
}

export type SwitchPortGroupUpdate =
  | { ok: true; ports: InventoryPort[] }
  | { ok: false; message: string }

function groupKey(
  type: InventoryPortType,
  speed?: string,
  role?: InventoryPortRole,
): string {
  return [type, speed ?? '', role ?? ''].join('|')
}

export function groupSwitchPorts(ports: InventoryPort[]): SwitchPortGroup[] {
  const groups = new Map<string, SwitchPortGroup>()

  for (const port of ports.slice().sort((first, second) => first.slotNumber - second.slotNumber)) {
    const key = groupKey(port.type, port.speed, port.role)
    const group = groups.get(key)

    if (group) {
      group.ports.push(port)
      continue
    }

    groups.set(key, {
      key,
      type: port.type,
      speed: port.speed,
      role: port.role,
      ports: [port],
    })
  }

  return [...groups.values()]
}

function endpointUsesPort(
  endpoint: InventoryConnection['from'],
  itemId: string,
  portId: InventoryPort['id'],
): boolean {
  return endpoint.itemId === itemId && String(endpoint.portId) === String(portId)
}

function portHasConnection(
  connections: InventoryConnection[],
  itemId: string,
  portId: InventoryPort['id'],
): boolean {
  return connections.some(
    (connection) =>
      endpointUsesPort(connection.from, itemId, portId) ||
      endpointUsesPort(connection.to, itemId, portId),
  )
}

function portHasUserMetadata(port: InventoryPort): boolean {
  return Boolean(port.label?.trim() || port.notes?.trim() || port.ipAddress?.trim())
}

function createPortId(ports: InventoryPort[]): InventoryPort['id'] {
  if (ports.every((port) => typeof port.id === 'number')) {
    return ports.reduce((highest, port) => Math.max(highest, Number(port.id)), 0) + 1
  }

  const usedIds = new Set(ports.map((port) => String(port.id)))
  let nextId = 1

  while (usedIds.has(`switch-port-${nextId}`)) {
    nextId += 1
  }

  return `switch-port-${nextId}`
}

function flattenAndRenumber(groups: SwitchPortGroup[]): InventoryPort[] {
  return groups.flatMap((group) => group.ports).map((port, index) => ({
    ...port,
    slotNumber: index + 1,
  }))
}

export function resizeSwitchPortGroup({
  ports,
  connections,
  itemId,
  groupKey: targetGroupKey,
  count,
}: {
  ports: InventoryPort[]
  connections: InventoryConnection[]
  itemId: string
  groupKey: string
  count: number
}): SwitchPortGroupUpdate {
  const nextCount = Math.max(0, Math.min(128, Math.trunc(count)))
  const groups = groupSwitchPorts(ports)
  const group = groups.find((candidate) => candidate.key === targetGroupKey)

  if (!group) {
    return { ok: false, message: 'That port group no longer exists.' }
  }

  if (nextCount < group.ports.length) {
    const removedPorts = group.ports.slice(nextCount)
    const protectedPort = removedPorts.find(
      (port) => portHasConnection(connections, itemId, port.id) || portHasUserMetadata(port),
    )

    if (protectedPort) {
      return {
        ok: false,
        message: `Port ${String(protectedPort.slotNumber).padStart(2, '0')} has a connection or saved details. Clear it before reducing this group.`,
      }
    }

    group.ports = group.ports.slice(0, nextCount)
  } else {
    while (group.ports.length < nextCount) {
      const currentPorts = groups.flatMap((candidate) => candidate.ports)
      group.ports.push({
        id: createPortId(currentPorts),
        kind: 'switch-port',
        type: group.type,
        slotNumber: currentPorts.length + 1,
        ...(group.speed ? { speed: group.speed } : {}),
        ...(group.role ? { role: group.role } : {}),
      })
    }
  }

  return {
    ok: true,
    ports: flattenAndRenumber(groups.filter((candidate) => candidate.ports.length > 0)),
  }
}

export function updateSwitchPortGroupDefinition({
  ports,
  groupKey: targetGroupKey,
  definition,
}: {
  ports: InventoryPort[]
  groupKey: string
  definition: {
    type?: InventoryPortType
    speed?: string
    role?: InventoryPortRole
  }
}): InventoryPort[] {
  const groups = groupSwitchPorts(ports)
  const group = groups.find((candidate) => candidate.key === targetGroupKey)

  if (!group) {
    return ports
  }

  group.type = definition.type ?? group.type
  group.speed = definition.speed
  group.role = definition.role
  group.ports = group.ports.map((port) => ({
    ...port,
    type: group.type,
    speed: group.speed,
    role: group.role,
  }))

  return flattenAndRenumber(groups)
}

export function addSwitchPortGroup(ports: InventoryPort[]): InventoryPort[] {
  const existingKeys = new Set(groupSwitchPorts(ports).map((group) => group.key))
  const templates: Array<{
    type: InventoryPortType
    speed?: string
    role?: InventoryPortRole
  }> = [
    { type: 'rj45', speed: '1G', role: 'access' },
    { type: 'rj45', speed: '2.5G', role: 'access' },
    { type: 'rj45', speed: '5G', role: 'access' },
    { type: 'rj45', speed: '10G', role: 'access' },
    { type: 'sfp', speed: '1G', role: 'uplink' },
    { type: 'sfp-plus', speed: '10G', role: 'uplink' },
  ]
  const definition = templates.find(
    (template) => !existingKeys.has(groupKey(template.type, template.speed, template.role)),
  ) ?? { type: 'rj45' as const, role: 'access' as const }
  const nextPort: InventoryPort = {
    id: createPortId(ports),
    kind: 'switch-port',
    type: definition.type,
    slotNumber: ports.length + 1,
    ...(definition.speed ? { speed: definition.speed } : {}),
    ...(definition.role ? { role: definition.role } : {}),
  }

  return [...ports, nextPort]
}
