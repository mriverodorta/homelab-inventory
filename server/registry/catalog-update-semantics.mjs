import {
  CANONICAL_UNITS_FINGERPRINT_VERSION,
  NAS_FINGERPRINT_VERSION,
  NETWORK_FINGERPRINT_VERSION,
  canonicalJson,
  canonicalizeCatalogItemV10,
  canonicalizeCatalogItemV11,
  canonicalizeCatalogItemV9,
  parseLegacySpeedBps,
  sanitizeCatalogItem,
} from '../../packages/catalog-protocol/src/index.ts'
import { removeSupersededWlanResource } from './wlan-resource-migration.mjs'

const IDENTITY_FIELDS = ['type', 'manufacturer', 'secondaryManufacturer', 'family', 'model', 'number']
const LOCAL_TOP_LEVEL_FIELDS = new Set([
  'id', 'key', 'name', 'scope', 'ownerProjectId', 'archivedAt', 'serialNumber',
  'smart', 'properties', 'notes', 'hardwareClass', 'usageRole',
])
const LOCAL_PORT_FIELDS = ['label', 'notes', 'ipAddress', 'macAddress', 'role', 'adminState']
const NETWORK_CONNECTORS = new Set([
  'rj45', 'sfp', 'sfp-plus', 'sfp28', 'qsfp', 'qsfp-plus', 'qsfp28',
  'qsfp56', 'qsfp-dd', 'osfp', 'fc', 'infiniband',
])

function sanitizeForFingerprint(value, fingerprintVersion) {
  if (fingerprintVersion === NETWORK_FINGERPRINT_VERSION) return canonicalizeCatalogItemV11(value)
  if (fingerprintVersion === NAS_FINGERPRINT_VERSION) return canonicalizeCatalogItemV10(value)
  if (fingerprintVersion === CANONICAL_UNITS_FINGERPRINT_VERSION) return canonicalizeCatalogItemV9(value)
  return sanitizeCatalogItem(value)
}

function sanitizeCurrentForFingerprint(value, fingerprintVersion) {
  if (fingerprintVersion === NETWORK_FINGERPRINT_VERSION) return canonicalizeCatalogItemV9(value)
  if (fingerprintVersion !== NAS_FINGERPRINT_VERSION) return sanitizeForFingerprint(value, fingerprintVersion)
  return canonicalizeCatalogItemV10(canonicalizeCatalogItemV9(value))
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizedText(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : value
}

function normalizedFormFactor(value) {
  if (typeof value !== 'string') return value
  return value
    .trim()
    .toLowerCase()
    .replace(/\s*[- ]\s*inch(?:es)?$/i, '-inch')
    .replace(/\s+/g, ' ')
}

function normalizedPortKind(port) {
  if (NETWORK_CONNECTORS.has(port.type) && ['network', 'server-port'].includes(port.kind)) return 'network'
  return port.kind
}

function normalizedPortSpeed(port) {
  if (Number.isSafeInteger(port.speedBps) && port.speedBps >= 0) return port.speedBps
  if (typeof port.speed !== 'string' || port.speed.trim() === '') return undefined
  try {
    return parseLegacySpeedBps(port.speed)
  } catch {
    return port.speed.trim().toLowerCase()
  }
}

function compareValues(left, right) {
  return canonicalJson(left).localeCompare(canonicalJson(right), 'en-US')
}

function normalizeValue(value, key = '') {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeValue(entry, key)).sort((left, right) => {
      if (plainObject(left) && plainObject(right)) {
        const leftIdentity = left.id ?? left.key
        const rightIdentity = right.id ?? right.key
        if (leftIdentity !== undefined && rightIdentity !== undefined) {
          return String(leftIdentity).localeCompare(String(rightIdentity), 'en-US', { numeric: true })
        }
      }
      return compareValues(left, right)
    })
  }
  if (!plainObject(value)) {
    if (key === 'formFactor' || key === 'formFactors') return normalizedFormFactor(value)
    return value
  }
  return Object.fromEntries(Object.keys(value).sort().map((entryKey) => [
    entryKey,
    normalizeValue(value[entryKey], entryKey),
  ]))
}

function normalizePort(port) {
  const normalized = normalizeValue({
    ...port,
    kind: normalizedPortKind(port),
    origin: port.origin === 'module' ? 'module' : 'fixed',
  })
  const speedBps = normalizedPortSpeed(port)
  delete normalized.speed
  if (speedBps !== undefined) normalized.speedBps = speedBps
  return normalized
}

function normalizeSanitizedCatalogUpdateItem(item) {
  const normalized = normalizeValue(item)
  if (Array.isArray(item.ports)) normalized.ports = item.ports.map(normalizePort).sort((left, right) => left.id - right.id)
  return normalized
}

export function normalizeCatalogUpdateItem(value, fingerprintVersion) {
  return normalizeSanitizedCatalogUpdateItem(sanitizeForFingerprint(value, fingerprintVersion))
}

function catalogUpdateVersions(input) {
  if (typeof input === 'number') {
    return { sourceFingerprintVersion: input, runtimeCanonicalVersion: input }
  }
  if (plainObject(input)) {
    return {
      sourceFingerprintVersion: input.sourceFingerprintVersion,
      runtimeCanonicalVersion: input.runtimeCanonicalVersion ?? input.sourceFingerprintVersion,
    }
  }
  return { sourceFingerprintVersion: undefined, runtimeCanonicalVersion: undefined }
}

function deepMerge(current, incoming) {
  if (incoming === undefined) return structuredClone(current)
  if (!plainObject(current) || !plainObject(incoming)) return structuredClone(incoming)
  const result = structuredClone(current)
  for (const [key, value] of Object.entries(incoming)) result[key] = deepMerge(current[key], value)
  return result
}

function mergePorts(currentPorts = [], incomingPorts = []) {
  const currentById = new Map(currentPorts.map((port) => [port.id, port]))
  return incomingPorts.map((incoming) => {
    const current = currentById.get(incoming.id)
    const merged = current ? { ...structuredClone(current), ...structuredClone(incoming) } : structuredClone(incoming)
    if (merged.origin !== 'module') merged.origin = 'fixed'
    for (const field of LOCAL_PORT_FIELDS) {
      if (current?.[field] !== undefined) merged[field] = structuredClone(current[field])
    }
    return merged
  })
}

function mergeCatalogItem(currentValue, incomingValue, fingerprintVersion) {
  const current = structuredClone(currentValue)
  const incoming = sanitizeForFingerprint(incomingValue, fingerprintVersion)
  let result = deepMerge(current, incoming)
  for (const field of LOCAL_TOP_LEVEL_FIELDS) {
    if (current[field] !== undefined) result[field] = structuredClone(current[field])
  }
  if (Array.isArray(incoming.ports)) result.ports = mergePorts(current.ports, incoming.ports)
  result = removeSupersededWlanResource(current, incoming, result)
  if (fingerprintVersion === NETWORK_FINGERPRINT_VERSION) {
    const incomingMinimum = incoming.specs?.hostInterface?.minimumElectricalLanes
    if (incomingMinimum === undefined) {
      delete result.specs?.hostInterface?.minimumElectricalLanes
      delete result.compatibility?.requirements?.expansion?.minimumElectricalLanes
    }
  }
  return result
}

function semanticEqual(left, right) {
  return canonicalJson(left) === canonicalJson(right)
}

function changeKind(current, next) {
  if (current === undefined) return 'added'
  if (next === undefined) return 'removed'
  return 'changed'
}

function collectObjectChanges(current, next, path, impact, changes) {
  if (semanticEqual(normalizeValue(current), normalizeValue(next))) return
  if (plainObject(current) && plainObject(next)) {
    const keys = [...new Set([...Object.keys(current), ...Object.keys(next)])].sort()
    for (const key of keys) collectObjectChanges(current[key], next[key], path ? `${path}.${key}` : key, impact, changes)
    return
  }
  changes.push({ path, kind: changeKind(current, next), current, next, impact })
}

function identityImpact(current, incoming) {
  let impact = 'none'
  for (const field of IDENTITY_FIELDS) {
    const before = current[field]
    const after = incoming[field]
    if (after === undefined || normalizedText(before) === normalizedText(after)) continue
    if (before === undefined || before === null || before === '') {
      if (impact === 'none') impact = 'enrichment'
      continue
    }
    if (field === 'type') return 'replacement'
    impact = 'conflict'
  }
  return impact
}

function portChange(path, current, next, impact) {
  return { path, kind: changeKind(current, next), current, next, impact }
}

function planPorts(currentPorts = [], incomingPorts = []) {
  const currentById = new Map(currentPorts.map((port) => [port.id, port]))
  const incomingById = new Map(incomingPorts.map((port) => [port.id, port]))
  const changes = []
  const representationChanges = []
  const capabilityChanges = []
  const attachmentChanges = []

  for (const id of [...new Set([...currentById.keys(), ...incomingById.keys()])].sort((a, b) => a - b)) {
    const current = currentById.get(id)
    const incoming = incomingById.get(id)
    if (!current || !incoming) {
      const change = portChange(`ports[${id}]`, current, incoming, current ? 'attachment' : 'capability')
      changes.push(change)
      if (current) attachmentChanges.push(change)
      else capabilityChanges.push(change)
      continue
    }

    if (current.type !== incoming.type) {
      const change = portChange(`ports[${id}].type`, current.type, incoming.type, 'attachment')
      changes.push(change)
      attachmentChanges.push(change)
    }
    if (current.key && incoming.key && normalizedText(current.key) !== normalizedText(incoming.key)) {
      const change = portChange(`ports[${id}].key`, current.key, incoming.key, 'attachment')
      changes.push(change)
      attachmentChanges.push(change)
    } else if (!current.key && incoming.key) {
      const change = portChange(`ports[${id}].key`, current.key, incoming.key, 'representation')
      changes.push(change)
      representationChanges.push(change)
    }

    if (!semanticEqual(normalizeValue(current.endpoints ?? []), normalizeValue(incoming.endpoints ?? []))) {
      const change = portChange(`ports[${id}].endpoints`, current.endpoints, incoming.endpoints, 'attachment')
      changes.push(change)
      attachmentChanges.push(change)
    }

    const representationFields = [
      ['slotNumber', current.slotNumber, incoming.slotNumber],
      ['kind', normalizedPortKind(current), normalizedPortKind(incoming)],
      ['origin', current.origin === 'module' ? 'module' : 'fixed', incoming.origin === 'module' ? 'module' : 'fixed'],
    ]
    for (const [field, before, after] of representationFields) {
      if (semanticEqual(before, after)) continue
      const change = portChange(`ports[${id}].${field}`, current[field], incoming[field], 'representation')
      changes.push(change)
      representationChanges.push(change)
    }

    const capabilities = [
      ['speedBps', normalizedPortSpeed(current), normalizedPortSpeed(incoming)],
      ['poe', current.poe, incoming.poe],
    ]
    for (const [field, before, after] of capabilities) {
      if (semanticEqual(before, after)) continue
      const change = portChange(`ports[${id}].${field}`, before, after, 'capability')
      changes.push(change)
      capabilityChanges.push(change)
    }
  }
  return { changes, representationChanges, capabilityChanges, attachmentChanges }
}

export function planCatalogUpdate(currentValue, incomingValue, versionInput) {
  const { sourceFingerprintVersion, runtimeCanonicalVersion } = catalogUpdateVersions(versionInput)
  const current = sanitizeCurrentForFingerprint(currentValue, runtimeCanonicalVersion)
  const nextItem = mergeCatalogItem(currentValue, incomingValue, runtimeCanonicalVersion)
  const next = sanitizeCurrentForFingerprint(nextItem, runtimeCanonicalVersion)
  const normalizedCurrent = normalizeSanitizedCatalogUpdateItem(current)
  const normalizedNext = normalizeSanitizedCatalogUpdateItem(next)
  const identity = identityImpact(normalizedCurrent, normalizedNext)
  const changes = []

  for (const field of IDENTITY_FIELDS) {
    if (semanticEqual(normalizedCurrent[field], normalizedNext[field])) continue
    const impact = normalizedCurrent[field] === undefined
      ? 'identity-enrichment'
      : field === 'type' ? 'identity-replacement' : 'identity-conflict'
    changes.push({
      path: field,
      kind: changeKind(normalizedCurrent[field], normalizedNext[field]),
      current: current[field],
      next: next[field],
      impact,
    })
  }

  for (const field of ['subtype', 'aliases', 'specs', 'compatibility', 'fixedComponents']) {
    collectObjectChanges(normalizedCurrent[field], normalizedNext[field], field, 'product-definition', changes)
  }

  const portPlan = planPorts(current.ports, next.ports)
  changes.push(...portPlan.changes)

  const known = new Set([...IDENTITY_FIELDS, 'name', 'subtype', 'aliases', 'specs', 'ports', 'compatibility', 'fixedComponents'])
  const remainingFields = [...new Set([...Object.keys(normalizedCurrent), ...Object.keys(normalizedNext)])]
  for (const field of remainingFields.filter((key) => !known.has(key)).sort()) {
    collectObjectChanges(normalizedCurrent[field], normalizedNext[field], field, 'product-definition', changes)
  }

  return {
    nextItem,
    changes,
    portPlan,
    identityImpact: identity,
    sourceFingerprintVersion,
    runtimeCanonicalVersion,
  }
}
