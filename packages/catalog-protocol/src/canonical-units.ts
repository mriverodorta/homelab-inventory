import { sanitizeCatalogItemV9 } from './sanitize'
import type { CatalogTemplateItem, JsonValue } from './types'

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
