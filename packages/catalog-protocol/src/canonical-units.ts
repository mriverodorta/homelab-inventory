import { sanitizeCatalogItemV9 } from './sanitize'
import type { CatalogNetworkTechnology, CatalogPort, CatalogTemplateItem, JsonValue } from './types'

export const CANONICAL_MEASUREMENT_CONFLICT = 'canonical-measurement-conflict'
export const CANONICAL_MEASUREMENT_INVALID = 'canonical-measurement-invalid'
export const CANONICAL_MEASUREMENT_NOT_EXACT = 'canonical-measurement-not-exact'

export class CanonicalMeasurementError extends Error {
  constructor(
    readonly code: typeof CANONICAL_MEASUREMENT_CONFLICT
      | typeof CANONICAL_MEASUREMENT_INVALID
      | typeof CANONICAL_MEASUREMENT_NOT_EXACT,
    readonly path: string,
    message: string,
  ) {
    super(message)
    this.name = 'CanonicalMeasurementError'
  }
}

type JsonObject = Record<string, JsonValue>

const LEGACY_MEASUREMENT_KEYS = new Set([
  'baseClockGhz', 'boostClockGhz', 'cacheMb', 'capacityGB', 'capacityGb', 'capacityTb', 'capacityVa',
  'coolingCapacityWatts',
  'currentAmps',
  'configurableTdpMaxWatts', 'configurableTdpMinWatts', 'maxCapacityGb', 'maxExpansionPowerWatts',
  'maxGraphicsPowerWatts', 'maxModuleCapacityGb', 'maxPowerWatts', 'maxTdpWatts', 'maxTemperatureC',
  'efficiencyPercent', 'memoryGb', 'powerWatts', 'ratedWatts', 'refreshRateHz', 'sizeInches', 'speedMbps', 'switchingCapacityGbps',
  'supportedWattagesWatts', 'tdpWatts', 'voltageVolts', 'vramGb', 'wattageWatts',
])

function object(value: unknown): JsonObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined
}

function exactNonNegativeInteger(value: unknown, factor: number, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new CanonicalMeasurementError(
      CANONICAL_MEASUREMENT_INVALID,
      path,
      `${path} must be a finite non-negative number.`,
    )
  }
  const converted = value * factor
  if (!Number.isSafeInteger(converted)) {
    throw new CanonicalMeasurementError(
      Number.isFinite(converted) && Math.abs(converted) <= Number.MAX_SAFE_INTEGER
        ? CANONICAL_MEASUREMENT_NOT_EXACT
        : CANONICAL_MEASUREMENT_INVALID,
      path,
      `${path} cannot be represented exactly as a non-negative safe integer.`,
    )
  }
  return converted
}

type UnitValue<Unit extends string> = Readonly<{ value: number; unit: Unit }>

function convertUnit<Unit extends string>(
  input: UnitValue<Unit>,
  factors: Readonly<Record<Unit, number>>,
  canonicalUnit: string,
) {
  const factor = factors[input.unit]
  if (factor === undefined) {
    throw new CanonicalMeasurementError(
      CANONICAL_MEASUREMENT_INVALID,
      canonicalUnit,
      `Unsupported ${canonicalUnit} source unit ${String(input.unit)}.`,
    )
  }
  return exactNonNegativeInteger(input.value, factor, `${input.unit}->${canonicalUnit}`)
}

export function toMhz(input: UnitValue<'MHz' | 'GHz'>) {
  return convertUnit(input, { MHz: 1, GHz: 1_000 }, 'MHz')
}

export function toMib(input: UnitValue<'MiB' | 'GiB'>) {
  return convertUnit(input, { MiB: 1, GiB: 1_024 }, 'MiB')
}

export function toBytes(input: UnitValue<'bytes' | 'KB' | 'MB' | 'GB' | 'TB' | 'KiB' | 'MiB' | 'GiB' | 'TiB'>) {
  return convertUnit(input, {
    bytes: 1, KB: 1_000, MB: 1_000_000, GB: 1_000_000_000, TB: 1_000_000_000_000,
    KiB: 1_024, MiB: 1_048_576, GiB: 1_073_741_824, TiB: 1_099_511_627_776,
  }, 'bytes')
}

export function toBitsPerSecond(input: UnitValue<'bps' | 'Mbps' | 'Gbps'>) {
  return convertUnit(input, { bps: 1, Mbps: 1_000_000, Gbps: 1_000_000_000 }, 'bits-per-second')
}

export function toMilliwatts(input: UnitValue<'mW' | 'W'>) {
  return convertUnit(input, { mW: 1, W: 1_000 }, 'milliwatts')
}

export function toMillivolts(input: UnitValue<'mV' | 'V'>) {
  return convertUnit(input, { mV: 1, V: 1_000 }, 'millivolts')
}

export function toMilliamps(input: UnitValue<'mA' | 'A'>) {
  return convertUnit(input, { mA: 1, A: 1_000 }, 'milliamps')
}

export function toMillimeters(input: UnitValue<'mm' | 'cm' | 'm' | 'in'>) {
  return convertUnit(input, { mm: 1, cm: 10, m: 1_000, in: 25.4 }, 'millimeters')
}

export function toMilliCelsius(input: UnitValue<'mC' | 'C'>) {
  return convertUnit(input, { mC: 1, C: 1_000 }, 'milli-Celsius')
}

export function toBasisPoints(input: UnitValue<'basis-points' | 'percent'>) {
  return convertUnit(input, { 'basis-points': 1, percent: 100 }, 'basis-points')
}

export function toMillihertz(input: UnitValue<'mHz' | 'Hz'>) {
  return convertUnit(input, { mHz: 1, Hz: 1_000 }, 'millihertz')
}

export function toMillivoltAmps(input: UnitValue<'mVA' | 'VA'>) {
  return convertUnit(input, { mVA: 1, VA: 1_000 }, 'millivolt-amps')
}

function canonicalInteger(value: unknown, path: string): number {
  return exactNonNegativeInteger(value, 1, path)
}

function convertField(
  target: JsonObject,
  legacyKey: string,
  canonicalKey: string,
  factor: number,
  path: string,
) {
  const legacy = target[legacyKey]
  const canonical = target[canonicalKey]
  if (legacy === undefined && canonical === undefined) return
  const converted = legacy === undefined ? undefined : exactNonNegativeInteger(legacy, factor, `${path}.${legacyKey}`)
  const validated = canonical === undefined ? undefined : canonicalInteger(canonical, `${path}.${canonicalKey}`)
  if (converted !== undefined && validated !== undefined && converted !== validated) {
    throw new CanonicalMeasurementError(
      CANONICAL_MEASUREMENT_CONFLICT,
      `${path}.${canonicalKey}`,
      `${path}.${legacyKey} conflicts with ${path}.${canonicalKey}.`,
    )
  }
  target[canonicalKey] = validated ?? converted!
  delete target[legacyKey]
}

function convertArrayField(
  target: JsonObject,
  legacyKey: string,
  canonicalKey: string,
  factor: number,
  path: string,
) {
  const legacy = target[legacyKey]
  const canonical = target[canonicalKey]
  if (legacy === undefined && canonical === undefined) return
  if (legacy !== undefined && !Array.isArray(legacy)) {
    throw new CanonicalMeasurementError(CANONICAL_MEASUREMENT_INVALID, `${path}.${legacyKey}`, `${path}.${legacyKey} must be an array.`)
  }
  if (canonical !== undefined && !Array.isArray(canonical)) {
    throw new CanonicalMeasurementError(CANONICAL_MEASUREMENT_INVALID, `${path}.${canonicalKey}`, `${path}.${canonicalKey} must be an array.`)
  }
  const converted = legacy === undefined ? undefined : legacy.map((entry, index) => (
    exactNonNegativeInteger(entry, factor, `${path}.${legacyKey}[${index}]`)
  ))
  const validated = canonical === undefined ? undefined : canonical.map((entry, index) => (
    canonicalInteger(entry, `${path}.${canonicalKey}[${index}]`)
  ))
  if (converted && validated && JSON.stringify(converted) !== JSON.stringify(validated)) {
    throw new CanonicalMeasurementError(
      CANONICAL_MEASUREMENT_CONFLICT,
      `${path}.${canonicalKey}`,
      `${path}.${legacyKey} conflicts with ${path}.${canonicalKey}.`,
    )
  }
  target[canonicalKey] = (validated ?? converted) as JsonValue
  delete target[legacyKey]
}

const SPEED_FACTORS: Readonly<Record<string, number>> = {
  bps: 1,
  k: 1_000,
  kbps: 1_000,
  m: 1_000_000,
  mbps: 1_000_000,
  g: 1_000_000_000,
  gbps: 1_000_000_000,
  t: 1_000_000_000_000,
  tbps: 1_000_000_000_000,
}

export function parseLegacySpeedBps(value: unknown, path = 'speed'): number {
  if (typeof value === 'number') return canonicalInteger(value, path)
  if (typeof value !== 'string') {
    throw new CanonicalMeasurementError(CANONICAL_MEASUREMENT_INVALID, path, `${path} must be an explicit network speed.`)
  }
  const match = value.trim().toLowerCase().replace(/\s+/g, '').match(/^(\d+(?:\.\d+)?)(bps|[kmgt](?:bps)?)$/)
  const factor = match?.[2] ? SPEED_FACTORS[match[2]] : undefined
  if (!match || factor === undefined) {
    throw new CanonicalMeasurementError(CANONICAL_MEASUREMENT_INVALID, path, `${path} has an unsupported network speed.`)
  }
  return exactNonNegativeInteger(Number(match[1]), factor, path)
}

export function legacyMeasurementPathsV9(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => legacyMeasurementPathsV9(entry, `${path}[${index}]`))
  }
  if (!value || typeof value !== 'object') return []
  const output: string[] = []
  for (const [key, entry] of Object.entries(value)) {
    const nextPath = path ? `${path}.${key}` : key
    if (LEGACY_MEASUREMENT_KEYS.has(key) || (key === 'speed' && /(?:^|\.)ports\[|management/.test(path))) {
      output.push(nextPath)
    }
    output.push(...legacyMeasurementPathsV9(entry, nextPath))
  }
  return output
}

export function assertCanonicalCatalogItemV9(value: unknown): void {
  const legacyPaths = legacyMeasurementPathsV9(value)
  if (legacyPaths.length > 0) {
    throw new CanonicalMeasurementError(
      CANONICAL_MEASUREMENT_INVALID,
      legacyPaths[0],
      `Fingerprint-v9 item contains legacy measurement field ${legacyPaths[0]}.`,
    )
  }
  canonicalizeCatalogItemV9(value)
}

function assertFixedComponentsV10(item: CatalogTemplateItem): void {
  if (item.fixedComponents === undefined) return
  if (!Array.isArray(item.fixedComponents)) {
    throw new CanonicalMeasurementError(
      CANONICAL_MEASUREMENT_INVALID,
      'fixedComponents',
      'fixedComponents must be an array.',
    )
  }

  const ids = new Set<number>()
  item.fixedComponents.forEach((component, index) => {
    const path = `fixedComponents[${index}]`
    if (!component || typeof component !== 'object' || Array.isArray(component)) {
      throw new CanonicalMeasurementError(CANONICAL_MEASUREMENT_INVALID, path, `${path} must be an object.`)
    }
    if (!Number.isSafeInteger(component.id) || component.id < 1 || ids.has(component.id)) {
      throw new CanonicalMeasurementError(
        CANONICAL_MEASUREMENT_INVALID,
        `${path}.id`,
        `${path}.id must be a unique positive safe integer.`,
      )
    }
    ids.add(component.id)
    if (typeof component.componentType !== 'string' || component.componentType.trim() === '') {
      throw new CanonicalMeasurementError(
        CANONICAL_MEASUREMENT_INVALID,
        `${path}.componentType`,
        `${path}.componentType is required.`,
      )
    }
    if (component.disposition !== 'fixed' && component.disposition !== 'soldered') {
      throw new CanonicalMeasurementError(
        CANONICAL_MEASUREMENT_INVALID,
        `${path}.disposition`,
        `${path}.disposition must be fixed or soldered.`,
      )
    }
    if (typeof component.label !== 'string' || component.label.trim() === '') {
      throw new CanonicalMeasurementError(CANONICAL_MEASUREMENT_INVALID, `${path}.label`, `${path}.label is required.`)
    }
    if (!component.item || component.item.type !== component.componentType) {
      throw new CanonicalMeasurementError(
        CANONICAL_MEASUREMENT_INVALID,
        `${path}.item.type`,
        `${path}.item.type must match componentType.`,
      )
    }
    if (typeof component.item.name !== 'string' || component.item.name.trim() === '') {
      throw new CanonicalMeasurementError(CANONICAL_MEASUREMENT_INVALID, `${path}.item.name`, `${path}.item.name is required.`)
    }
    if (component.templateKey !== undefined && (typeof component.templateKey !== 'string' || component.templateKey.trim() === '')) {
      throw new CanonicalMeasurementError(
        CANONICAL_MEASUREMENT_INVALID,
        `${path}.templateKey`,
        `${path}.templateKey must be non-empty.`,
      )
    }
    if (component.templateRevision !== undefined && (!Number.isSafeInteger(component.templateRevision) || component.templateRevision < 1)) {
      throw new CanonicalMeasurementError(
        CANONICAL_MEASUREMENT_INVALID,
        `${path}.templateRevision`,
        `${path}.templateRevision must be a positive safe integer.`,
      )
    }
    if (component.templateRevision !== undefined && component.templateKey === undefined) {
      throw new CanonicalMeasurementError(
        CANONICAL_MEASUREMENT_INVALID,
        `${path}.templateRevision`,
        `${path}.templateRevision requires templateKey.`,
      )
    }
  })
}

function assertPowerOwnershipV10(item: CatalogTemplateItem): void {
  const compatibility = object(item.compatibility)
  const host = object(compatibility?.host)
  const power = object(host?.power)
  if (!power) return

  const path = 'compatibility.host.power'
  const configuration = power.configuration
  const adapterDisposition = power.adapterDisposition
  if (configuration !== 'external-adapter' && configuration !== 'internal-psu') {
    throw new CanonicalMeasurementError(
      CANONICAL_MEASUREMENT_INVALID,
      `${path}.configuration`,
      `${path}.configuration must be external-adapter or internal-psu.`,
    )
  }
  if (configuration === 'external-adapter') {
    if (adapterDisposition !== 'fixed' && adapterDisposition !== 'replaceable') {
      throw new CanonicalMeasurementError(
        CANONICAL_MEASUREMENT_INVALID,
        `${path}.adapterDisposition`,
        `${path}.adapterDisposition must be fixed or replaceable for an external adapter.`,
      )
    }
  } else if (adapterDisposition !== undefined) {
    throw new CanonicalMeasurementError(
      CANONICAL_MEASUREMENT_INVALID,
      `${path}.adapterDisposition`,
      `${path}.adapterDisposition must be omitted for an internal PSU.`,
    )
  }
}

function convertSpeedField(target: JsonObject, legacyKey: string, canonicalKey: string, path: string) {
  const legacy = target[legacyKey]
  const canonical = target[canonicalKey]
  if (legacy === undefined && canonical === undefined) return
  const converted = legacy === undefined ? undefined : parseLegacySpeedBps(legacy, `${path}.${legacyKey}`)
  const validated = canonical === undefined ? undefined : canonicalInteger(canonical, `${path}.${canonicalKey}`)
  if (converted !== undefined && validated !== undefined && converted !== validated) {
    throw new CanonicalMeasurementError(
      CANONICAL_MEASUREMENT_CONFLICT,
      `${path}.${canonicalKey}`,
      `${path}.${legacyKey} conflicts with ${path}.${canonicalKey}.`,
    )
  }
  target[canonicalKey] = validated ?? converted!
  delete target[legacyKey]
}

function convertSpecs(item: CatalogTemplateItem) {
  const specs = object(item.specs)
  if (!specs) return
  const path = 'specs'
  switch (item.type) {
    case 'cpu':
      convertField(specs, 'baseClockGhz', 'baseClockMhz', 1_000, path)
      convertField(specs, 'boostClockGhz', 'boostClockMhz', 1_000, path)
      convertField(specs, 'tdpWatts', 'tdpMw', 1_000, path)
      convertField(specs, 'configurableTdpMinWatts', 'configurableTdpMinMw', 1_000, path)
      convertField(specs, 'configurableTdpMaxWatts', 'configurableTdpMaxMw', 1_000, path)
      convertField(specs, 'maxTemperatureC', 'maxTemperatureMilliCelsius', 1_000, path)
      if (specs.cacheMb !== undefined && specs.cacheMib === undefined) {
        throw new CanonicalMeasurementError(
          CANONICAL_MEASUREMENT_NOT_EXACT,
          'specs.cacheMb',
          'specs.cacheMb requires evidence that the source value is binary MiB.',
        )
      }
      convertField(specs, 'cacheMb', 'cacheMib', 1, path)
      break
    case 'ram':
      convertField(specs, 'capacityGb', 'capacityMib', 1_024, path)
      convertField(specs, 'capacityGB', 'capacityMib', 1_024, path)
      convertField(specs, 'voltageVolts', 'voltageMv', 1_000, path)
      break
    case 'gpu':
      convertField(specs, 'vramGb', 'vramMib', 1_024, path)
      convertField(specs, 'powerWatts', 'powerMw', 1_000, path)
      break
    case 'storage':
      convertField(specs, 'capacityGb', 'capacityBytes', 1_000_000_000, path)
      convertField(specs, 'capacityGB', 'capacityBytes', 1_000_000_000, path)
      convertField(specs, 'capacityTb', 'capacityBytes', 1_000_000_000_000, path)
      break
    case 'network':
      convertField(specs, 'speedMbps', 'maxSpeedBps', 1_000_000, path)
      break
    case 'switch':
      convertField(specs, 'switchingCapacityGbps', 'switchingCapacityBps', 1_000_000_000, path)
      break
    case 'powerSupply':
    case 'powerAdapter':
      convertField(specs, 'wattageWatts', 'ratedPowerMw', 1_000, path)
      convertField(specs, 'ratedWatts', 'ratedPowerMw', 1_000, path)
      convertField(specs, 'powerWatts', 'ratedPowerMw', 1_000, path)
      break
    case 'ups':
      convertField(specs, 'wattageWatts', 'ratedPowerMw', 1_000, path)
      convertField(specs, 'ratedWatts', 'ratedPowerMw', 1_000, path)
      convertField(specs, 'powerWatts', 'ratedPowerMw', 1_000, path)
      convertField(specs, 'capacityVa', 'capacityMillivoltAmps', 1_000, path)
      break
    case 'cpuCooler':
      convertField(specs, 'coolingCapacityWatts', 'coolingCapacityMw', 1_000, path)
      break
    case 'monitor': {
      convertField(specs, 'refreshRateHz', 'refreshRateMillihz', 1_000, path)
      const inches = specs.sizeInches
      if (inches !== undefined) {
        try {
          convertField(specs, 'sizeInches', 'diagonalMm', 25.4, path)
        } catch (error) {
          if (!(error instanceof CanonicalMeasurementError) || error.code !== CANONICAL_MEASUREMENT_NOT_EXACT) throw error
          if (specs.diagonalMm !== undefined) throw error
          specs.diagonalSourceText = `${String(inches)} in`
          delete specs.sizeInches
        }
      } else if (specs.diagonalMm !== undefined) {
        specs.diagonalMm = canonicalInteger(specs.diagonalMm, 'specs.diagonalMm')
      }
      break
    }
  }

  convertField(specs, 'memoryGb', 'memoryMib', 1_024, path)
  convertField(specs, 'maxPowerWatts', 'maxPowerMw', 1_000, path)
  convertField(specs, 'powerWatts', 'powerMw', 1_000, path)
  convertField(specs, 'voltageVolts', 'voltageMv', 1_000, path)
  convertField(specs, 'currentAmps', 'currentMa', 1_000, path)
  convertField(specs, 'efficiencyPercent', 'efficiencyBasisPoints', 100, path)

  for (const [key, value] of Object.entries(specs)) {
    if (/(?:Mhz|Mib|Bytes|Bps|Mw|Mv|Ma|Mm|MilliCelsius|BasisPoints|Millihz|MillivoltAmps)$/.test(key)) {
      specs[key] = canonicalInteger(value, `specs.${key}`)
    }
  }
}

function convertCompatibility(item: CatalogTemplateItem) {
  const compatibility = object(item.compatibility)
  const host = object(compatibility?.host)
  const requirements = object(compatibility?.requirements)
  if (!compatibility) return

  if (host) {
    convertField(host, 'maxExpansionPowerWatts', 'maxExpansionPowerMw', 1_000, 'compatibility.host')
    const cpu = object(host.cpu)
    if (cpu) convertField(cpu, 'maxTdpWatts', 'maxTdpMw', 1_000, 'compatibility.host.cpu')
    const memory = object(host.memory)
    if (memory) {
      convertField(memory, 'maxCapacityGb', 'maxCapacityMib', 1_024, 'compatibility.host.memory')
      convertField(memory, 'maxModuleCapacityGb', 'maxModuleCapacityMib', 1_024, 'compatibility.host.memory')
    }
    if (Array.isArray(host.expansionSlots)) {
      host.expansionSlots.forEach((entry, index) => {
        const slot = object(entry)
        if (slot) convertField(slot, 'maxPowerWatts', 'maxPowerMw', 1_000, `compatibility.host.expansionSlots[${index}]`)
      })
    }
    const power = object(host.power)
    if (power) {
      convertField(power, 'maxGraphicsPowerWatts', 'maxGraphicsPowerMw', 1_000, 'compatibility.host.power')
      convertArrayField(power, 'supportedWattagesWatts', 'supportedPowerMw', 1_000, 'compatibility.host.power')
    }
    const management = object(host.management)
    if (management) convertSpeedField(management, 'speed', 'speedBps', 'compatibility.host.management')
  }

  const requiredCpu = object(requirements?.cpu)
  if (requiredCpu) convertField(requiredCpu, 'tdpWatts', 'tdpMw', 1_000, 'compatibility.requirements.cpu')
  const requiredMemory = object(requirements?.memory)
  if (requiredMemory) {
    convertField(requiredMemory, 'capacityGb', 'capacityMib', 1_024, 'compatibility.requirements.memory')
    convertField(requiredMemory, 'voltageVolts', 'voltageMv', 1_000, 'compatibility.requirements.memory')
  }
  const requiredExpansion = object(requirements?.expansion)
  if (requiredExpansion) convertField(requiredExpansion, 'powerWatts', 'powerMw', 1_000, 'compatibility.requirements.expansion')
}

function convertPorts(item: CatalogTemplateItem) {
  item.ports?.forEach((port, index) => {
    const source = port as unknown as JsonObject
    convertSpeedField(source, 'speed', 'speedBps', `ports[${index}]`)
  })
}

const CANONICAL_MEASUREMENT_SUFFIX = /(?:Mhz|Mib|Bytes|Bps|Mw|Mv|Ma|Mm|MilliCelsius|BasisPoints|Millihz|MillivoltAmps)$/

function validateCanonicalMeasurements(value: unknown, path = ''): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateCanonicalMeasurements(entry, `${path}[${index}]`))
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, entry] of Object.entries(value)) {
    const nextPath = path ? `${path}.${key}` : key
    if (CANONICAL_MEASUREMENT_SUFFIX.test(key)) {
      if (Array.isArray(entry)) {
        entry.forEach((item, index) => canonicalInteger(item, `${nextPath}[${index}]`))
      } else {
        canonicalInteger(entry, nextPath)
      }
    }
    validateCanonicalMeasurements(entry, nextPath)
  }
}

export function canonicalizeCatalogItemV9(value: unknown): CatalogTemplateItem {
  const item = sanitizeCatalogItemV9(value)
  convertSpecs(item)
  convertCompatibility(item)
  convertPorts(item)
  const canonical = sanitizeCatalogItemV9(item)
  const remainingLegacy = legacyMeasurementPathsV9(canonical)
  if (remainingLegacy.length > 0) {
    throw new CanonicalMeasurementError(
      CANONICAL_MEASUREMENT_INVALID,
      remainingLegacy[0],
      `No canonical v9 mapping is defined for legacy measurement field ${remainingLegacy[0]}.`,
    )
  }
  validateCanonicalMeasurements(canonical)
  return canonical
}

export function canonicalizeCatalogItemV10(value: unknown): CatalogTemplateItem {
  const item = sanitizeCatalogItemV9(value)
  const remainingLegacy = legacyMeasurementPathsV9(item)
  if (remainingLegacy.length > 0) {
    throw new CanonicalMeasurementError(
      CANONICAL_MEASUREMENT_INVALID,
      remainingLegacy[0],
      `Fingerprint-v10 item contains legacy measurement field ${remainingLegacy[0]}.`,
    )
  }
  assertFixedComponentsV10(item)
  assertPowerOwnershipV10(item)
  validateCanonicalMeasurements(item)
  return item
}

export function assertCanonicalCatalogItemV10(value: unknown): void {
  canonicalizeCatalogItemV10(value)
}
const NETWORK_TECHNOLOGIES = new Set<CatalogNetworkTechnology>([
  'ethernet', 'wifi', 'fibre-channel', 'infiniband', 'converged', 'cellular', 'other',
])
const NETWORK_HOST_INTERFACE_FAMILIES = new Set([
  'pcie', 'm2-ae', 'm2-bm', 'mini-pcie', 'usb', 'ocp', 'mezzanine', 'onboard', 'proprietary',
])
const NETWORK_CONNECTORS = new Set([
  'rj45', 'sfp', 'sfp-plus', 'sfp28', 'qsfp-plus', 'qsfp28', 'qsfp56', 'osfp',
  'bnc', 'usb-a', 'usb-c', 'proprietary',
])
const NETWORK_MEDIA = new Set([
  'dac', 'aoc', 'optical-transceiver', 'copper-transceiver', 'active-copper', 'passive-copper',
])
const HOST_INTERFACE_FIELDS = new Set([
  'family', 'pcieGeneration', 'connectorLanes', 'minimumElectricalLanes', 'key', 'moduleSize',
  'usbGeneration', 'connector', 'ocpVersion', 'interfaceKey',
])
const HOST_INTERFACE_ALLOWED_FIELDS: Record<string, Set<string>> = {
  pcie: new Set(['family', 'pcieGeneration', 'connectorLanes', 'minimumElectricalLanes']),
  'm2-ae': new Set(['family', 'key', 'moduleSize']),
  'm2-bm': new Set(['family', 'key', 'moduleSize']),
  'mini-pcie': new Set(['family']),
  usb: new Set(['family', 'usbGeneration', 'connector']),
  ocp: new Set(['family', 'ocpVersion']),
  mezzanine: new Set(['family', 'interfaceKey']),
  onboard: new Set(['family']),
  proprietary: new Set(['family', 'interfaceKey']),
}

function networkError(path: string, message: string): never {
  throw new CanonicalMeasurementError(CANONICAL_MEASUREMENT_INVALID, path, message)
}

function requiredText(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') networkError(path, `${path} is required.`)
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ')
}

function positiveInteger(value: unknown, path: string): number {
  const result = canonicalInteger(value, path)
  if (result < 1) networkError(path, `${path} must be a positive safe integer.`)
  return result
}

function sortedStrings(value: unknown, path: string, allowed?: Set<string>): string[] {
  if (!Array.isArray(value) || value.length === 0) networkError(path, `${path} must be a non-empty array.`)
  const values = value.map((entry, index) => requiredText(entry, `${path}[${index}]`))
  if (allowed) values.forEach((entry, index) => {
    if (!allowed.has(entry)) networkError(`${path}[${index}]`, `${path}[${index}] has unsupported value ${entry}.`)
  })
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, 'en-US'))
}

function sortedNumbers(value: unknown, path: string): number[] {
  if (!Array.isArray(value) || value.length === 0) networkError(path, `${path} must be a non-empty array.`)
  return [...new Set(value.map((entry, index) => positiveInteger(entry, `${path}[${index}]`)))]
    .sort((left, right) => left - right)
}

function sortedPositiveNumbers(value: unknown, path: string): number[] {
  if (!Array.isArray(value) || value.length === 0) networkError(path, `${path} must be a non-empty array.`)
  const values = value.map((entry, index) => {
    if (typeof entry !== 'number' || !Number.isFinite(entry) || entry <= 0) {
      networkError(`${path}[${index}]`, `${path}[${index}] must be a positive finite number.`)
    }
    return entry
  })
  return [...new Set(values)].sort((left, right) => left - right)
}

function optionalSortedStrings(target: JsonObject, key: string, path: string, allowed?: Set<string>) {
  if (target[key] === undefined) return
  const value = target[key]
  if (!Array.isArray(value)) networkError(`${path}.${key}`, `${path}.${key} must be an array.`)
  const values = value.map((entry, index) => requiredText(entry, `${path}.${key}[${index}]`))
  if (allowed) values.forEach((entry, index) => {
    if (!allowed.has(entry)) networkError(`${path}.${key}[${index}]`, `${path}.${key}[${index}] has unsupported value ${entry}.`)
  })
  target[key] = [...new Set(values)].sort((left, right) => left.localeCompare(right, 'en-US'))
}

function validateNetworkHostInterface(specs: JsonObject): JsonObject {
  const path = 'specs.hostInterface'
  const hostInterface = object(specs.hostInterface)
  if (!hostInterface) networkError(path, `${path} is required.`)
  const family = requiredText(hostInterface.family, `${path}.family`)
  if (!NETWORK_HOST_INTERFACE_FAMILIES.has(family)) networkError(`${path}.family`, `${path}.family is unsupported.`)
  const allowed = HOST_INTERFACE_ALLOWED_FIELDS[family]!
  for (const key of Object.keys(hostInterface)) {
    if (HOST_INTERFACE_FIELDS.has(key) && !allowed.has(key)) {
      networkError(`${path}.${key}`, `${path}.${key} contradicts host-interface family ${family}.`)
    }
  }
  if (family === 'pcie') {
    hostInterface.pcieGeneration = positiveInteger(hostInterface.pcieGeneration, `${path}.pcieGeneration`)
    hostInterface.connectorLanes = positiveInteger(hostInterface.connectorLanes, `${path}.connectorLanes`)
    if (hostInterface.minimumElectricalLanes !== undefined) {
      hostInterface.minimumElectricalLanes = positiveInteger(hostInterface.minimumElectricalLanes, `${path}.minimumElectricalLanes`)
      if (Number(hostInterface.minimumElectricalLanes) > Number(hostInterface.connectorLanes)) {
        networkError(`${path}.minimumElectricalLanes`, 'Minimum electrical lanes cannot exceed connector lanes.')
      }
    }
  }
  if (family === 'm2-ae' || family === 'm2-bm') {
    hostInterface.key = requiredText(hostInterface.key, `${path}.key`)
    hostInterface.moduleSize = requiredText(hostInterface.moduleSize, `${path}.moduleSize`)
  }
  if (family === 'usb') {
    hostInterface.usbGeneration = requiredText(hostInterface.usbGeneration, `${path}.usbGeneration`)
    hostInterface.connector = requiredText(hostInterface.connector, `${path}.connector`)
  }
  if (family === 'ocp') hostInterface.ocpVersion = requiredText(hostInterface.ocpVersion, `${path}.ocpVersion`)
  if (family === 'mezzanine' || family === 'proprietary') {
    hostInterface.interfaceKey = requiredText(hostInterface.interfaceKey, `${path}.interfaceKey`)
  }
  return hostInterface
}

function canonicalExpansionRequirement(item: CatalogTemplateItem, hostInterface: JsonObject) {
  const compatibility = object(item.compatibility) ?? {}
  const requirements = object(compatibility.requirements) ?? {}
  const existing = object(requirements.expansion) ?? {}
  const derived: JsonObject = {
    ...existing,
    interfaceFamily: hostInterface.family,
  }
  for (const key of [
    'pcieGeneration', 'connectorLanes', 'minimumElectricalLanes', 'key', 'moduleSize',
    'usbGeneration', 'connector', 'ocpVersion', 'interfaceKey',
  ]) {
    const source = hostInterface[key]
    if (key === 'minimumElectricalLanes' && source === undefined && existing[key] !== undefined) {
      networkError(
        'compatibility.requirements.expansion.minimumElectricalLanes',
        'Expansion minimumElectricalLanes requires the same value in specs.hostInterface.',
      )
    }
    if (source === undefined) continue
    if (existing[key] !== undefined && existing[key] !== source) {
      networkError(`compatibility.requirements.expansion.${key}`, `Expansion requirement ${key} conflicts with specs.hostInterface.${key}.`)
    }
    derived[key] = source
  }
  if (existing.interfaceFamily !== undefined && existing.interfaceFamily !== hostInterface.family) {
    networkError('compatibility.requirements.expansion.interfaceFamily', 'Expansion interface family conflicts with specs.hostInterface.family.')
  }
  requirements.expansion = derived
  compatibility.requirements = requirements
  item.compatibility = compatibility
}

function canonicalNetworkPorts(item: CatalogTemplateItem, technology: CatalogNetworkTechnology): CatalogPort[] | undefined {
  if (technology === 'wifi' || technology === 'cellular') {
    if (item.ports?.length) networkError('ports', 'A radio-only network adapter must not expose cable endpoints.')
    return undefined
  }
  if (!item.ports?.length && technology !== 'other') networkError('ports', 'A wired or fabric adapter requires physical ports.')
  if (!item.ports?.length) return undefined

  const ids = new Set<number>()
  const keys = new Set<string>()
  const slots = new Set<number>()
  for (const [index, port] of item.ports.entries()) {
    const path = `ports[${index}]`
    port.id = positiveInteger(port.id, `${path}.id`)
    if (ids.has(port.id)) networkError(`${path}.id`, `Duplicate port id ${port.id}.`)
    ids.add(port.id)
    port.key = requiredText(port.key, `${path}.key`)
    if (keys.has(port.key)) networkError(`${path}.key`, `Duplicate port key ${port.key}.`)
    keys.add(port.key)
    if (port.kind !== 'network') networkError(`${path}.kind`, `${path}.kind must be network.`)
    if (!NETWORK_CONNECTORS.has(port.type)) networkError(`${path}.type`, `${path}.type is not a supported connector.`)
    port.slotNumber = positiveInteger(port.slotNumber, `${path}.slotNumber`)
    if (slots.has(port.slotNumber)) networkError(`${path}.slotNumber`, `Duplicate port slotNumber ${port.slotNumber}.`)
    slots.add(port.slotNumber)
    port.speedBps = positiveInteger(port.speedBps, `${path}.speedBps`)
    port.supportedSpeedsBps = sortedNumbers(port.supportedSpeedsBps, `${path}.supportedSpeedsBps`)
    if (!port.supportedSpeedsBps.includes(port.speedBps)
      || port.supportedSpeedsBps.some((speed) => speed > port.speedBps!)) {
      networkError(`${path}.supportedSpeedsBps`, `${path}.supportedSpeedsBps must contain and not exceed speedBps.`)
    }
    if (!NETWORK_TECHNOLOGIES.has(port.networkTechnology!)) {
      networkError(`${path}.networkTechnology`, `${path}.networkTechnology is unsupported.`)
    }
    port.operatingModes = sortedStrings(port.operatingModes, `${path}.operatingModes`)
    if (port.media !== undefined) port.media = sortedStrings(port.media, `${path}.media`, NETWORK_MEDIA)
    if (port.origin !== 'module') networkError(`${path}.origin`, `${path}.origin must be module.`)
  }
  return item.ports
}

function canonicalNetworkCapabilities(specs: JsonObject) {
  const capabilities = object(specs.capabilities)
  if (!capabilities) return
  const allowed = new Set(['sriov', 'ptp', 'pxe', 'uefiBoot', 'wakeOnLan', 'rdmaModes', 'offloads'])
  for (const key of Object.keys(capabilities)) {
    if (!allowed.has(key)) networkError(`specs.capabilities.${key}`, `Unsupported network capability ${key}.`)
  }
  for (const key of ['sriov', 'ptp', 'pxe', 'uefiBoot', 'wakeOnLan']) {
    if (capabilities[key] !== undefined && typeof capabilities[key] !== 'boolean') {
      networkError(`specs.capabilities.${key}`, `specs.capabilities.${key} must be boolean.`)
    }
  }
  optionalSortedStrings(capabilities, 'rdmaModes', 'specs.capabilities')
  optionalSortedStrings(capabilities, 'offloads', 'specs.capabilities')
}

export function canonicalizeCatalogItemV11(value: unknown): CatalogTemplateItem {
  const rawMinimum = object(object(object(value)?.specs)?.hostInterface)?.minimumElectricalLanes
  if (rawMinimum !== undefined) {
    positiveInteger(rawMinimum, 'specs.hostInterface.minimumElectricalLanes')
  }
  const item = sanitizeCatalogItemV9(value)
  if (item.type !== 'network') networkError('type', 'Fingerprint-v11 is supported only for network templates.')
  const remainingLegacy = legacyMeasurementPathsV9(item)
  if (remainingLegacy.length > 0) {
    networkError(remainingLegacy[0], `Fingerprint-v11 item contains legacy measurement field ${remainingLegacy[0]}.`)
  }
  const specs = object(item.specs)
  if (!specs) networkError('specs', 'Network template specs are required.')
  const technology = requiredText(specs.networkTechnology, 'specs.networkTechnology') as CatalogNetworkTechnology
  if (!NETWORK_TECHNOLOGIES.has(technology)) networkError('specs.networkTechnology', 'Unsupported network technology.')
  specs.networkTechnology = technology
  specs.formFactor = requiredText(specs.formFactor, 'specs.formFactor')
  specs.operatingModes = sortedStrings(specs.operatingModes, 'specs.operatingModes')
  optionalSortedStrings(specs, 'wifiGenerations', 'specs')
  if (specs.frequencyBandsGhz !== undefined) {
    specs.frequencyBandsGhz = sortedPositiveNumbers(specs.frequencyBandsGhz, 'specs.frequencyBandsGhz')
  }
  const hostInterface = validateNetworkHostInterface(specs)
  canonicalExpansionRequirement(item, hostInterface)
  const ports = canonicalNetworkPorts(item, technology)
  if (ports) {
    const maximum = Math.max(...ports.map((port) => port.speedBps!))
    if (specs.maxSpeedBps !== undefined && positiveInteger(specs.maxSpeedBps, 'specs.maxSpeedBps') !== maximum) {
      networkError('specs.maxSpeedBps', 'specs.maxSpeedBps must equal the maximum physical port speed.')
    }
    specs.maxSpeedBps = maximum
  } else {
    if (specs.maxSpeedBps !== undefined) networkError('specs.maxSpeedBps', 'Radio-only adapters must omit maxSpeedBps.')
    if (specs.maxPhyRateBps !== undefined) specs.maxPhyRateBps = positiveInteger(specs.maxPhyRateBps, 'specs.maxPhyRateBps')
  }
  if (specs.spatialStreams !== undefined) specs.spatialStreams = positiveInteger(specs.spatialStreams, 'specs.spatialStreams')
  canonicalNetworkCapabilities(specs)
  item.specs = specs
  validateCanonicalMeasurements(item)
  return sanitizeCatalogItemV9(item)
}

export function assertCanonicalCatalogItemV11(value: unknown): void {
  canonicalizeCatalogItemV11(value)
}
