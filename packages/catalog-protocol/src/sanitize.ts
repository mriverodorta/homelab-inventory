import type {
  CatalogPort,
  CatalogPortEndpoint,
  CatalogTemplateItem,
  JsonPrimitive,
  JsonValue,
} from './types'

const IDENTITY_FIELDS = [
  'type',
  'name',
  'subtype',
  'manufacturer',
  'secondaryManufacturer',
  'family',
  'model',
  'number',
] as const

const MAX_TEXT_LENGTH = 256
const MAX_PORTS = 256
const MAX_ALIASES = 64
const MAX_OBJECT_KEYS = 256
const MAX_ARRAY_LENGTH = 256
const MAX_JSON_DEPTH = 8
const SAFE_SPEC_FIELDS = new Set([
  'baseClockGhz', 'batteryBackupOutlets', 'bluetooth', 'boostClockGhz', 'capacityGB', 'capacityGb',
  'capacityTb', 'capacityVa', 'channels', 'chipset', 'connector', 'coolerHeightMm', 'coolerType',
  'coolingCapacityWatts', 'cores', 'cpuCoolerHeightMm', 'cpuSocketCount', 'cpuSockets', 'driveBays',
  'efficiency', 'fanless', 'formFactor', 'formFactors', 'generation', 'heightMm', 'interface', 'lengthMm',
  'm2Slots', 'management', 'maxCoolerHeightMm', 'maxExpansionHeightMm', 'maxExpansionLengthMm',
  'maxExpansionSlotWidth', 'maxGpuHeightMm', 'maxGpuLengthMm', 'maxGpuSlotWidth', 'maxTdpWatts',
  'media', 'memoryGb', 'motherboardFormFactors', 'mount', 'motherboardPartNumber', 'motherboardRevision', 'boardVariant',
  'networkSlot', 'outlets', 'pcie', 'ports', 'powerConfiguration', 'powerWatts', 'psuFormFactors',
  'rackUnits', 'radiatorSizeMm', 'radiatorSizesMm', 'ratedWatts', 'refreshRateHz', 'resolution',
  'sizeInches', 'slot', 'slotWidth', 'socket', 'sockets', 'speed', 'speedMbps',
  'speedMt', 'supportedMotherboardFormFactors', 'supportedPsuFormFactors', 'supportedRadiatorSizesMm',
  'supportedSockets', 'surgeProtected', 'surgeProtectedOutlets', 'switchingCapacityGbps', 'tdpWatts',
  'threads', 'vramGb', 'wattage', 'wattageWatts', 'wifiGeneration', 'wireless', 'allowOutletFanOut',
  'ecc', 'rank', 'moduleType', 'voltageVolts', 'hardwareRevision', 'boardRevision', 'partNumber', 'region',
  'topologyCompleteness', 'topologyComplete', 'variantKey',
  'oemGeneration',
  'cacheMb', 'memoryTypes', 'memorySpeedsMt', 'eccSupport', 'integratedGraphics',
  'pcieGeneration', 'pcieLanes', 'maxTemperatureC', 'launchDate', 'discontinued',
  'performanceCores', 'efficiencyCores', 'configurableTdpMinWatts', 'configurableTdpMaxWatts',
])
const PRIVATE_FIELD_NAMES = new Set([
  'agent', 'agentData', 'assignments', 'credentials', 'customLabel', 'customName', 'displayName',
  'hostname', 'ip', 'ipAddress', 'lanIp', 'location', 'mac', 'macAddress', 'notes', 'password',
  'placement', 'placements', 'room', 'serial', 'serialNumber', 'serviceData', 'services', 'tailscaleIp',
  'token', 'topologyPlacement',
])
const SAFE_COMPATIBILITY_FIELDS = new Set([
  'host', 'requirements', 'cpu', 'memory', 'storageSlots', 'expansionSlots', 'motherboard', 'cooling',
  'power', 'case', 'sockets', 'generations', 'maxTdpWatts', 'slots', 'maxCapacityGb',
  'maxModuleCapacityGb', 'maxSpeedMt', 'maxExpansionPowerWatts', 'id', 'key', 'label', 'count',
  'interfaces', 'formFactors', 'pcieGeneration', 'interfaceFamily', 'mechanicalLanes', 'electricalLanes',
  'acceptedHeights', 'maxSlotWidth', 'maxPowerWatts', 'socket', 'generation', 'tdpWatts', 'expansion',
  'connectorLanes', 'minimumElectricalLanes', 'height', 'slotWidth', 'powerWatts', 'formFactor',
  'supportedSockets', 'supportedMotherboardFormFactors', 'supportedPsuFormFactors',
  'supportedRadiatorSizesMm', 'maxCoolerHeightMm', 'maxGpuLengthMm', 'maxGpuHeightMm',
  'maxGpuSlotWidth', 'radiatorSizesMm', 'psuFormFactors', 'motherboardFormFactors', 'ratedWatts',
  'topologyCompleteness', 'topologyComplete', 'proprietaryRiser', 'riserCapability', 'variantKey',
  'optionalModuleSlots', 'acceptedModuleKinds', 'configuration', 'supportedWattagesWatts',
  'connector', 'eccSupport', 'adapterRequired', 'adapterType', 'fixedPorts', 'origin',
  'socketCount', 'moduleTypes', 'location', 'hotSwap', 'backplane', 'redundancy',
  'maxGraphicsPowerWatts', 'constraintGroups', 'kind', 'members', 'resourceType', 'resourceId',
  'populationModes', 'slotsPerCpu', 'controllerSlotIds', 'directConnect', 'requiredCpuSockets',
  'riserGroup', 'controllerSlots', 'acceptedControllerKinds', 'dedicated', 'bootDeviceSlots',
  'acceptedDeviceKinds', 'controllerSlotId', 'psuBayCount', 'psuType', 'mixedPsuAllowed',
  'redundancyModes', 'coolingProfiles', 'fanCount', 'redundant', 'conditions', 'management',
  'controllerFamily', 'controllerGeneration', 'dedicatedPort', 'sharedNic', 'portType',
  'speed', 'capacityGb', 'speedMt', 'moduleType', 'ecc', 'rank', 'voltageVolts', 'formFactors',
  'powerConnectors', 'required',
])

function looksSensitive(value: string): boolean {
  return /(?:^|\b)(?:\d{1,3}\.){3}\d{1,3}(?:\b|$)|\b(?:[0-9a-f]{2}:){5}[0-9a-f]{2}\b|\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])(?:\.\d{1,3}){2}\b/i.test(value)
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.normalize('NFKC').trim().replace(/\s+/g, ' ')
  if (trimmed.length > MAX_TEXT_LENGTH || looksSensitive(trimmed)) return undefined
  return trimmed === '' ? undefined : trimmed
}

function sanitizePrimitiveRecord(value: unknown): Record<string, JsonPrimitive> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const output: Record<string, JsonPrimitive> = {}
  for (const [key, entry] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
    if (!SAFE_SPEC_FIELDS.has(key)) continue
    if (entry === null || typeof entry === 'boolean') output[key] = entry
    if (typeof entry === 'number' && Number.isFinite(entry)) output[key] = entry
    if (typeof entry === 'string' && nonEmptyString(entry)) output[key] = nonEmptyString(entry)!
  }
  return Object.keys(output).length > 0 ? output : undefined
}

function sanitizeJson(value: unknown, depth = 0): JsonValue | undefined {
  if (depth > MAX_JSON_DEPTH) return undefined
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string') return nonEmptyString(value)
  if (Array.isArray(value)) {
    const output = value.slice(0, MAX_ARRAY_LENGTH).map((entry) => sanitizeJson(entry, depth + 1)).filter((entry): entry is JsonValue => entry !== undefined)
    return output
  }
  if (value && typeof value === 'object') {
    const output: Record<string, JsonValue> = {}
    for (const [key, entry] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
      if (!SAFE_COMPATIBILITY_FIELDS.has(key)) continue
      const sanitized = sanitizeJson(entry, depth + 1)
      if (sanitized !== undefined) output[key] = sanitized
    }
    return Object.keys(output).length > 0 ? output : undefined
  }
  return undefined
}

function sanitizePublicJson(value: unknown, depth = 0): JsonValue | undefined {
  if (depth > MAX_JSON_DEPTH) return undefined
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string') return nonEmptyString(value)
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_LENGTH)
      .map((entry) => sanitizePublicJson(entry, depth + 1))
      .filter((entry): entry is JsonValue => entry !== undefined)
  }
  if (value && typeof value === 'object') {
    const output: Record<string, JsonValue> = {}
    for (const [key, entry] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
      if (PRIVATE_FIELD_NAMES.has(key)) continue
      const sanitized = sanitizePublicJson(entry, depth + 1)
      if (sanitized !== undefined) output[key] = sanitized
    }
    return Object.keys(output).length > 0 ? output : undefined
  }
  return undefined
}

function sanitizeEndpoint(value: unknown): CatalogPortEndpoint | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const endpoint = value as Record<string, unknown>
  if (!Number.isSafeInteger(endpoint.id) || Number(endpoint.id) < 1) return undefined
  if (endpoint.side !== 'front' && endpoint.side !== 'back') return undefined
  return { id: Number(endpoint.id), side: endpoint.side }
}

function sanitizePort(value: unknown): CatalogPort | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const port = value as Record<string, unknown>
  const id = Number(port.id)
  const slotNumber = Number(port.slotNumber)
  const kind = nonEmptyString(port.kind)
  const type = nonEmptyString(port.type)
  if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(slotNumber) || slotNumber < 0 || !kind || !type) {
    return undefined
  }

  const sanitized: CatalogPort = { id, kind, type, slotNumber }
  for (const key of ['key', 'role', 'speed'] as const) {
    const entry = nonEmptyString(port[key])
    if (entry) sanitized[key] = entry
  }
  if (Number.isSafeInteger(port.speedBps) && Number(port.speedBps) >= 0) sanitized.speedBps = Number(port.speedBps)
  if (Array.isArray(port.supportedSpeedsBps)) {
    const speeds = port.supportedSpeedsBps
      .filter((entry): entry is number => Number.isSafeInteger(entry) && Number(entry) >= 0)
      .map(Number)
    if (speeds.length > 0) sanitized.supportedSpeedsBps = speeds
  }
  const networkTechnology = nonEmptyString(port.networkTechnology)
  if (networkTechnology) sanitized.networkTechnology = networkTechnology as CatalogPort['networkTechnology']
  for (const key of ['operatingModes', 'media'] as const) {
    if (!Array.isArray(port[key])) continue
    const values = port[key]
      .map(nonEmptyString)
      .filter((entry): entry is string => entry !== undefined)
    if (values.length > 0) sanitized[key] = values
  }
  if (typeof port.vendorLock === 'boolean') sanitized.vendorLock = port.vendorLock
  if (typeof port.poe === 'boolean') sanitized.poe = port.poe
  if (port.origin === 'fixed' || port.origin === 'module') sanitized.origin = port.origin
  if (Array.isArray(port.endpoints)) {
    const endpoints = port.endpoints
      .map(sanitizeEndpoint)
      .filter((entry): entry is CatalogPortEndpoint => entry !== undefined)
    if (endpoints.length > 0) sanitized.endpoints = endpoints
  }

  const knownFields = new Set([
    'id', 'kind', 'type', 'slotNumber', 'key', 'role', 'speed', 'speedBps',
    'supportedSpeedsBps', 'networkTechnology', 'operatingModes', 'media',
    'vendorLock', 'poe', 'origin', 'endpoints',
  ])
  for (const [key, entry] of Object.entries(port).slice(0, MAX_OBJECT_KEYS)) {
    if (key === 'label' || knownFields.has(key) || PRIVATE_FIELD_NAMES.has(key)) continue
    const publicValue = sanitizePublicJson(entry)
    if (publicValue !== undefined) (sanitized as Record<string, unknown>)[key] = publicValue
  }
  return sanitized
}

function sanitizePortV9(value: unknown): CatalogPort | undefined {
  const sanitized = sanitizePort(value)
  if (!sanitized || !value || typeof value !== 'object' || Array.isArray(value)) return sanitized
  const speedBps = (value as Record<string, unknown>).speedBps
  if (typeof speedBps === 'number' && Number.isFinite(speedBps)) sanitized.speedBps = speedBps
  return sanitized
}

export function sanitizeCatalogItem(value: unknown): CatalogTemplateItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Catalog item must be an object.')
  }

  const source = value as Record<string, unknown>
  const type = nonEmptyString(source.type)
  const name = nonEmptyString(source.name)
  if (!type || !name) throw new Error('Catalog item requires non-empty type and name fields.')

  const item = { type, name } as CatalogTemplateItem
  for (const field of IDENTITY_FIELDS) {
    if (field === 'type' || field === 'name') continue
    const entry = nonEmptyString(source[field])
    if (entry) item[field] = entry
  }

  if (Array.isArray(source.aliases)) {
    const aliases = source.aliases
      .slice(0, MAX_ALIASES)
      .map(nonEmptyString)
      .filter((entry): entry is string => entry !== undefined)
    if (aliases.length > 0) item.aliases = [...new Set(aliases)]
  }

  const specs = sanitizePrimitiveRecord(source.specs)
  if (specs) item.specs = specs

  if (Array.isArray(source.ports)) {
    const ports = source.ports.slice(0, MAX_PORTS).map(sanitizePort).filter((entry): entry is CatalogPort => entry !== undefined)
    if (ports.length > 0) item.ports = ports
  }

  const compatibility = sanitizeJson(source.compatibility)
  if (compatibility && !Array.isArray(compatibility) && typeof compatibility === 'object') {
    item.compatibility = compatibility
  }

  return item
}

export function sanitizeCatalogItemV9(value: unknown): CatalogTemplateItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Catalog item must be an object.')
  }

  const source = value as Record<string, unknown>
  const type = nonEmptyString(source.type)
  const name = nonEmptyString(source.name)
  if (!type || !name) throw new Error('Catalog item requires non-empty type and name fields.')

  const item = { type, name } as CatalogTemplateItem
  for (const field of IDENTITY_FIELDS) {
    if (field === 'type' || field === 'name') continue
    const entry = nonEmptyString(source[field])
    if (entry) item[field] = entry
  }

  if (Array.isArray(source.aliases)) {
    const aliases = source.aliases
      .slice(0, MAX_ALIASES)
      .map(nonEmptyString)
      .filter((entry): entry is string => entry !== undefined)
    if (aliases.length > 0) item.aliases = [...new Set(aliases)]
  }

  const specs = sanitizePublicJson(source.specs)
  if (specs && !Array.isArray(specs) && typeof specs === 'object') item.specs = specs

  if (Array.isArray(source.ports)) {
    const ports = source.ports.slice(0, MAX_PORTS).map(sanitizePortV9).filter((entry): entry is CatalogPort => entry !== undefined)
    if (ports.length > 0) item.ports = ports
  }

  const compatibility = sanitizePublicJson(source.compatibility)
  if (compatibility && !Array.isArray(compatibility) && typeof compatibility === 'object') {
    item.compatibility = compatibility
  }

  const knownTopLevel = new Set([
    ...IDENTITY_FIELDS,
    'aliases',
    'specs',
    'ports',
    'compatibility',
    'id',
    'key',
    'hardwareClass',
    'usageRole',
    'scope',
    'ownerProjectId',
    'archivedAt',
  ])
  for (const [key, raw] of Object.entries(source).slice(0, MAX_OBJECT_KEYS)) {
    if (knownTopLevel.has(key) || PRIVATE_FIELD_NAMES.has(key)) continue
    const sanitized = sanitizePublicJson(raw, 1)
    if (sanitized !== undefined) (item as unknown as Record<string, JsonValue>)[key] = sanitized
  }

  return item
}
