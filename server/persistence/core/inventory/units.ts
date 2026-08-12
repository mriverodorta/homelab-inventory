type UnitValue<Unit extends string> = Readonly<{
  value: number
  unit: Unit
}>

function exactNonNegativeInteger(value: number, factor: number, unit: string) {
  if (!Number.isFinite(value)) {
    throw new Error(`Canonical conversion from ${unit} requires a finite value.`)
  }
  if (value < 0) {
    throw new Error(`Canonical conversion from ${unit} requires a non-negative value.`)
  }

  const converted = value * factor
  if (!Number.isSafeInteger(converted)) {
    if (Number.isFinite(converted) && Math.abs(converted) <= Number.MAX_SAFE_INTEGER) {
      throw new Error(`Canonical conversion from ${unit} would lose precision.`)
    }
    throw new Error(`Canonical conversion from ${unit} exceeds the safe integer range.`)
  }
  return converted
}

function convert<Unit extends string>(
  input: UnitValue<Unit>,
  factors: Readonly<Record<Unit, number>>,
  canonicalUnit: string,
) {
  const factor = factors[input.unit]
  if (factor === undefined) {
    throw new Error(`Unsupported ${canonicalUnit} source unit ${String(input.unit)}.`)
  }
  return exactNonNegativeInteger(input.value, factor, input.unit)
}

export function toMhz(input: UnitValue<'MHz' | 'GHz'>) {
  return convert(input, { MHz: 1, GHz: 1000 }, 'MHz')
}

export function toMib(input: UnitValue<'MiB' | 'GiB'>) {
  return convert(input, { MiB: 1, GiB: 1024 }, 'MiB')
}

export function toBytes(input: UnitValue<
  'bytes' | 'KB' | 'MB' | 'GB' | 'TB' | 'KiB' | 'MiB' | 'GiB' | 'TiB'
>) {
  return convert(input, {
    bytes: 1,
    KB: 1000,
    MB: 1_000_000,
    GB: 1_000_000_000,
    TB: 1_000_000_000_000,
    KiB: 1024,
    MiB: 1024 ** 2,
    GiB: 1024 ** 3,
    TiB: 1024 ** 4,
  }, 'bytes')
}

export function toBitsPerSecond(input: UnitValue<'bps' | 'Mbps' | 'Gbps'>) {
  return convert(input, { bps: 1, Mbps: 1_000_000, Gbps: 1_000_000_000 }, 'bits per second')
}

export function toMilliwatts(input: UnitValue<'mW' | 'W'>) {
  return convert(input, { mW: 1, W: 1000 }, 'milliwatts')
}

export function toMillivolts(input: UnitValue<'mV' | 'V'>) {
  return convert(input, { mV: 1, V: 1000 }, 'millivolts')
}

export function toMilliamps(input: UnitValue<'mA' | 'A'>) {
  return convert(input, { mA: 1, A: 1000 }, 'milliamps')
}

export function toMillimeters(input: UnitValue<'mm' | 'cm' | 'm' | 'in'>) {
  return convert(input, { mm: 1, cm: 10, m: 1000, in: 25.4 }, 'millimeters')
}

export function toMilliCelsius(input: UnitValue<'mC' | 'C'>) {
  return convert(input, { mC: 1, C: 1000 }, 'milli-degrees Celsius')
}

export function toBasisPoints(input: UnitValue<'basis-points' | 'percent'>) {
  return convert(input, { 'basis-points': 1, percent: 100 }, 'basis points')
}

export function toMillihertz(input: UnitValue<'mHz' | 'Hz'>) {
  return convert(input, { mHz: 1, Hz: 1000 }, 'millihertz')
}

export function toMillivoltAmps(input: UnitValue<'mVA' | 'VA'>) {
  return convert(input, { mVA: 1, VA: 1000 }, 'millivolt-amperes')
}
