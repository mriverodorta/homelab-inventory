import { resolveJedecManufacturer } from './jep106-manufacturers.mjs'
import { resolveStorageManufacturer } from './storage-manufacturers.mjs'

const TABLE_BY_TYPE = Object.freeze({
  server: 'servers', nas: 'nas', pcBuild: 'pcBuilds', cpu: 'cpus', ram: 'ram', storage: 'storage',
  network: 'networkCards', gpu: 'gpus', motherboard: 'motherboards', powerSupply: 'powerSupplies',
})

const COMPONENT_ITEM_TYPES = Object.freeze({
  cpu: 'cpu', memory: 'ram', storage: 'storage', 'network-interface': 'network', gpu: 'gpu',
  motherboard: 'motherboard', 'power-supply': 'powerSupply',
})

const FIELD_MAP = Object.freeze({
  system: { manufacturer: 'manufacturer', productName: 'model' },
  motherboard: { manufacturer: 'manufacturer', productName: 'model', version: 'version' },
  cpu: { manufacturer: 'manufacturer', version: 'name' },
  memory: {
    manufacturer: 'manufacturer',
    partNumber: 'number',
    size: 'specs.capacityGb',
    type: 'specs.generation',
    speed: 'specs.speedMt',
    formFactor: 'specs.formFactor',
    rank: 'specs.rank',
    configuredVoltage: 'specs.voltageVolts',
  },
  storage: {
    vendor: 'manufacturer', model: 'model', size: 'specs.capacityBytes', serial: 'specs.serialNumber',
    tran: 'specs.interface', pttype: 'specs.partitionTable',
  },
  'network-interface': { name: 'name' },
  'power-supply': { manufacturer: 'manufacturer', name: 'model', maxPowerCapacity: 'specs.wattageWatts' },
})

function atPath(record, fieldPath) {
  return fieldPath.split('.').reduce((value, key) => value?.[key], record)
}

function hostItem(inventory, host) {
  const table = TABLE_BY_TYPE[host.hostType]
  return inventory?.[table]?.find((item) => item.id === host.hostId) ?? null
}

function assignedTargets(inventory, project, host, itemType) {
  const table = TABLE_BY_TYPE[itemType]
  return (project?.assignments ?? [])
    .filter((assignment) => assignment.hostType === host.hostType && assignment.hostId === host.hostId && assignment.itemType === itemType)
    .map((assignment) => ({
      assignment,
      item: inventory?.[table]?.find((candidate) => candidate.id === assignment.itemId) ?? null,
    }))
    .filter(({ item }) => item)
    .sort((first, second) => {
      const firstPosition = first.assignment.allocation?.positions?.[0] ?? Number.MAX_SAFE_INTEGER
      const secondPosition = second.assignment.allocation?.positions?.[0] ?? Number.MAX_SAFE_INTEGER
      return firstPosition - secondPosition || first.assignment.id - second.assignment.id
    })
}

function componentIdentity(component) {
  return typeof component.values?.opaqueFingerprint === 'string' ? component.values.opaqueFingerprint : null
}

const LOCATOR_COLLATOR = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

function compareComponentLocators(first, second) {
  return LOCATOR_COLLATOR.compare(first.locator.trim(), second.locator.trim())
}

function isOpaqueManufacturer(value) {
  if (typeof value !== 'string') return false
  const normalized = value.trim()
  return /^(?:0x)?[0-9a-f]{4,}$/i.test(normalized)
    || /^(?:unknown|not specified|not provided|none)$/i.test(normalized)
}

function firstNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const match = value.match(/\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : null
}

function memoryCapacityGb(value) {
  const amount = firstNumber(value)
  if (!amount || typeof value !== 'string') return null
  if (/\bTB\b/i.test(value)) return amount * 1024
  if (/\bMB\b/i.test(value)) return amount / 1024
  return amount
}

function memoryModuleType(values) {
  const detail = String(values?.typeDetail ?? '').toLowerCase()
  if (detail.includes('load-reduced') || detail.includes('lrdimm')) return 'LRDIMM'
  if (detail.includes('registered') && !detail.includes('unregistered')) return 'RDIMM'
  if (detail.includes('unbuffered') || detail.includes('unregistered') || detail.includes('udimm')) return 'UDIMM'
  return null
}

function memoryEcc(values, moduleType) {
  if (moduleType === 'RDIMM' || moduleType === 'LRDIMM') return true
  const totalWidth = firstNumber(values?.totalWidth)
  const dataWidth = firstNumber(values?.dataWidth)
  if (totalWidth && dataWidth) return totalWidth > dataWidth
  const detail = String(values?.typeDetail ?? '')
  if (/\becc\b/i.test(detail)) return true
  return null
}

function memoryRank(value) {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toUpperCase()
  return /^(?:1RX8|1RX16|2RX8|2RX16|4RX4)$/.test(normalized)
    ? normalized.replace('RX', 'Rx')
    : null
}

function normalizeMemoryValue(component, detectedField, fieldPath, value) {
  if (fieldPath === 'specs.capacityGb') return memoryCapacityGb(value)
  if (fieldPath === 'specs.speedMt') return firstNumber(value)
  if (fieldPath === 'specs.generation') {
    const generation = String(value ?? '').trim().toUpperCase()
    return /^DDR\d$/.test(generation) ? generation : null
  }
  if (fieldPath === 'specs.formFactor') {
    const normalized = String(value ?? '').trim().toUpperCase().replaceAll('_', '-').replaceAll(' ', '-')
    if (normalized === 'SODIMM' || normalized === 'SO-DIMM') return 'SO-DIMM'
    return normalized === 'DIMM' ? 'DIMM' : null
  }
  if (fieldPath === 'specs.rank') return memoryRank(value)
  if (fieldPath === 'specs.voltageVolts') return firstNumber(value)
  return value
}

function detectedFieldValue(component, detectedField, fieldPath) {
  const value = component.values?.[detectedField]
  if (component.kind === 'storage' && detectedField === 'vendor') {
    return resolveStorageManufacturer(component.values)
  }
  if (component.kind !== 'memory') return value
  if (detectedField !== 'manufacturer') return normalizeMemoryValue(component, detectedField, fieldPath, value)
  const resolved = resolveJedecManufacturer(component.values?.moduleManufacturerId)
  if (resolved) return resolved
  return isOpaqueManufacturer(value) ? null : value
}

function mappedFields(component) {
  const fields = Object.entries(FIELD_MAP[component.kind] ?? {})
  if (component.kind !== 'memory') return fields
  const moduleType = memoryModuleType(component.values)
  const ecc = memoryEcc(component.values, moduleType)
  if (moduleType) fields.push(['typeDetail', 'specs.moduleType'])
  if (ecc !== null) fields.push(['totalWidth', 'specs.ecc'])
  return fields
}

function matchComponents(snapshot, inventory, project) {
  const host = { hostType: snapshot.host.type, hostId: snapshot.host.id }
  const matches = []
  const grouped = snapshot.components.reduce((result, component) => {
    const collection = result.get(component.kind) ?? []
    collection.push(component)
    result.set(component.kind, collection)
    return result
  }, new Map())
  for (const [kind, groupedComponents] of grouped) {
    const components = kind === 'memory'
      ? [...groupedComponents].sort(compareComponentLocators)
      : groupedComponents
    if (['system', 'chassis', 'bios'].includes(kind)) {
      const item = hostItem(inventory, host)
      for (const component of components) matches.push({ component, itemType: host.hostType, item, method: 'host', confidence: 'high' })
      continue
    }
    const itemType = COMPONENT_ITEM_TYPES[kind]
    if (!itemType) continue
    const targets = assignedTargets(inventory, project, host, itemType)
    const availableTargets = [...targets]
    const positionalMatchIsSafe = targets.length === components.length
    for (const component of components) {
      const fingerprint = componentIdentity(component)
      let targetIndex = availableTargets.findIndex(({ item }) => item.agentHardwareFingerprint && item.agentHardwareFingerprint === fingerprint)
      let method = 'opaque-fingerprint'
      if (targetIndex < 0) {
        const locator = component.locator.trim().toLowerCase()
        targetIndex = availableTargets.findIndex(({ assignment }) => {
          const label = assignment.slotLabel ?? assignment.locator ?? assignment.allocation?.locator
          return typeof label === 'string' && label.trim().toLowerCase() === locator
        })
        method = 'physical-locator'
      }
      if (targetIndex < 0 && positionalMatchIsSafe) {
        targetIndex = 0
        method = 'one-to-one-position'
      }
      if (targetIndex < 0) {
        matches.push({ component, itemType, item: null, method: 'ambiguous', confidence: 'none' })
        continue
      }
      const [target] = availableTargets.splice(targetIndex, 1)
      matches.push({ component, itemType, item: target.item, method, confidence: method === 'one-to-one-position' ? 'medium' : 'high' })
    }
  }
  return matches
}

export function buildHardwareSuggestions({ snapshot, inventory, project, now = Date.now() }) {
  if (!snapshot) return { snapshot: null, stale: false, matches: [], suggestions: [] }
  const ageMs = Math.max(0, now - Date.parse(snapshot.receivedAt))
  const matches = matchComponents(snapshot, inventory, project)
  const suggestions = []
  for (const match of matches) {
    if (!match.item || match.confidence === 'none') continue
    for (const [detectedField, fieldPath] of mappedFields(match.component)) {
      let detectedValue = detectedFieldValue(match.component, detectedField, fieldPath)
      if (match.component.kind === 'memory' && fieldPath === 'specs.moduleType') {
        detectedValue = memoryModuleType(match.component.values)
      }
      if (match.component.kind === 'memory' && fieldPath === 'specs.ecc') {
        detectedValue = memoryEcc(match.component.values, memoryModuleType(match.component.values))
      }
      if (detectedValue === undefined || detectedValue === null || detectedValue === '') continue
      suggestions.push({
        id: `${snapshot.id}:${match.itemType}:${match.item.id}:${fieldPath}`,
        snapshotId: snapshot.id,
        target: { itemType: match.itemType, itemId: match.item.id },
        fieldPath,
        currentValue: atPath(match.item, fieldPath) ?? null,
        detectedValue,
        source: {
          kind: match.component.kind,
          locator: match.component.locator,
          opaqueFingerprint: componentIdentity(match.component),
          collectedAt: snapshot.collectedAt,
        },
        match: { method: match.method, confidence: match.confidence },
      })
    }
  }
  return {
    snapshot,
    stale: ageMs > 30 * 24 * 60 * 60 * 1000,
    ageMs,
    matches: matches.map((match) => ({
      component: { kind: match.component.kind, locator: match.component.locator },
      target: match.item ? { itemType: match.itemType, itemId: match.item.id } : null,
      method: match.method,
      confidence: match.confidence,
    })),
    suggestions,
  }
}
