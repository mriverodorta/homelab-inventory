const POWER_ITEM_TYPES = new Set(['ups', 'powerStrip', 'monitor', 'powerAdapter', 'powerSupply', 'nas'])

export const NAS_POWER_CONFIGURATIONS = Object.freeze([
  'internal-psu',
  'external-adapter',
])

export function isNasPowerConfiguration(value) {
  return NAS_POWER_CONFIGURATIONS.includes(value)
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : 0
}

function powerPort(id, key, type, slotNumber, label) {
  return {
    id,
    key,
    kind: 'power-port',
    type,
    slotNumber,
    ...(label ? { label } : {}),
  }
}

function canonicalPowerPortTemplates(item) {
  if (!POWER_ITEM_TYPES.has(item?.type)) return item?.ports ?? []

  if (item.type === 'nas') {
    return item.specs?.powerConfiguration === 'internal-psu'
      ? [powerPort(1, 'ac-input', 'ac-input', 1, 'AC input')]
      : []
  }

  if (item.type === 'monitor' || item.type === 'powerAdapter' || item.type === 'powerSupply') {
    return [powerPort(1, 'ac-input', 'ac-input', 1, 'AC input')]
  }

  if (item.type === 'powerStrip') {
    const count = positiveInteger(item.specs?.outlets)
    return [
      powerPort(1, 'ac-input', 'ac-input', 0, 'AC input'),
      ...Array.from({ length: count }, (_, index) => (
        powerPort(index + 2, `outlet-${index + 1}`, 'ac-outlet', index + 1, `Outlet ${index + 1}`)
      )),
    ]
  }

  const declaredTotal = positiveInteger(item.specs?.outlets)
  const batteryCount = positiveInteger(item.specs?.batteryBackupOutlets)
  const declaredSurgeCount = positiveInteger(item.specs?.surgeProtectedOutlets)
  const total = Math.max(declaredTotal, batteryCount + declaredSurgeCount)
  const surgeCount = Math.max(declaredSurgeCount, total - batteryCount)
  return [
    ...Array.from({ length: batteryCount }, (_, index) => (
      powerPort(index + 1, `battery-outlet-${index + 1}`, 'ac-outlet', index + 1, `Battery outlet ${index + 1}`)
    )),
    ...Array.from({ length: surgeCount }, (_, index) => {
      const slotNumber = batteryCount + index + 1
      return powerPort(slotNumber, `surge-outlet-${index + 1}`, 'ac-outlet', slotNumber, `Surge outlet ${index + 1}`)
    }),
  ]
}

function nextFreePositiveId(usedIds, preferredId) {
  let id = preferredId
  while (usedIds.has(id)) id += 1
  usedIds.add(id)
  return id
}

export function canonicalPowerPorts(item) {
  const templates = canonicalPowerPortTemplates(item)
  const existing = Array.isArray(item?.ports) ? item.ports : []
  const usedIds = new Set(
    existing
      .map((port) => port?.id)
      .filter((id) => Number.isSafeInteger(id) && id > 0),
  )

  return templates.map((template) => {
    const persisted = existing.find((port) => port?.key === template.key)
    const id = persisted && Number.isSafeInteger(persisted.id) && persisted.id > 0
      ? persisted.id
      : nextFreePositiveId(usedIds, template.id)
    return { ...persisted, ...template, id }
  })
}

export function withCanonicalPowerPorts(item) {
  if (!POWER_ITEM_TYPES.has(item?.type)) return item

  const templates = canonicalPowerPortTemplates(item)
  const claimedKeys = new Set(
    (item.ports ?? [])
      .map((port) => port?.key)
      .filter((key) => typeof key === 'string' && key !== ''),
  )
  const normalizedPorts = (item.ports ?? []).map((port) => {
    if (port.key) return port
    const match = templates.find((template) => (
      !claimedKeys.has(template.key)
      && port.kind === template.kind
      && port.type === template.type
      && port.slotNumber === template.slotNumber
    ))
    if (!match) return port
    claimedKeys.add(match.key)
    return { ...port, key: match.key }
  })
  const canonical = canonicalPowerPorts({ ...item, ports: normalizedPorts })
  const retained = normalizedPorts.filter((port) => (
    port.kind !== 'power-port'
    && port.type !== 'ac-input'
    && port.type !== 'ac-outlet'
  ))
  const merged = [...retained, ...canonical]
  const next = { ...item }

  if (merged.length > 0) next.ports = merged
  else delete next.ports

  return next
}

export function legacyPowerPortKey(item, legacyPortId) {
  if (typeof legacyPortId === 'string' && legacyPortId === 'ac-input') return 'ac-input'
  const match = typeof legacyPortId === 'string' ? legacyPortId.match(/^outlet-(\d+)$/) : null
  if (!match) return undefined

  const outletNumber = Number(match[1])
  if (item?.type === 'powerStrip') return `outlet-${outletNumber}`
  if (item?.type === 'ups') {
    const batteryCount = positiveInteger(item.specs?.batteryBackupOutlets)
    return outletNumber <= batteryCount
      ? `battery-outlet-${outletNumber}`
      : `surge-outlet-${outletNumber - batteryCount}`
  }
  return undefined
}
