type JsonRecord = Record<string, any>

function speedLabel(value: number) {
  if (value % 1_000_000_000 === 0) return `${value / 1_000_000_000}G`
  if (value % 1_000_000 === 0) return `${value / 1_000_000}M`
  return `${value}bps`
}

function translateObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(translateObject)
  if (!value || typeof value !== 'object') return value

  const source = value as JsonRecord
  const translated: JsonRecord = {}
  for (const [key, entry] of Object.entries(source)) {
    const mapped = translateObject(entry)
    switch (key) {
      case 'baseClockMhz': translated.baseClockGhz = Number(entry) / 1_000; break
      case 'boostClockMhz': translated.boostClockGhz = Number(entry) / 1_000; break
      case 'tdpMw': translated.tdpWatts = Number(entry) / 1_000; break
      case 'configurableTdpMinMw': translated.configurableTdpMinWatts = Number(entry) / 1_000; break
      case 'configurableTdpMaxMw': translated.configurableTdpMaxWatts = Number(entry) / 1_000; break
      case 'maxTemperatureMilliCelsius': translated.maxTemperatureC = Number(entry) / 1_000; break
      case 'capacityMib': translated.capacityGb = Number(entry) / 1_024; break
      case 'vramMib': translated.vramGb = Number(entry) / 1_024; break
      case 'voltageMv': translated.voltageVolts = Number(entry) / 1_000; break
      case 'capacityBytes': translated.capacityGb = Number(entry) / 1_000_000_000; break
      case 'maxSpeedBps': translated.speedMbps = Number(entry) / 1_000_000; break
      case 'switchingCapacityBps': translated.switchingCapacityGbps = Number(entry) / 1_000_000_000; break
      case 'ratedPowerMw': translated.wattageWatts = Number(entry) / 1_000; break
      case 'capacityMillivoltAmps': translated.capacityVa = Number(entry) / 1_000; break
      case 'diagonalMm': translated.sizeInches = Number(entry) / 25.4; break
      case 'refreshRateMillihz': translated.refreshRateHz = Number(entry) / 1_000; break
      case 'maxExpansionPowerMw': translated.maxExpansionPowerWatts = Number(entry) / 1_000; break
      case 'maxTdpMw': translated.maxTdpWatts = Number(entry) / 1_000; break
      case 'maxCapacityMib': translated.maxCapacityGb = Number(entry) / 1_024; break
      case 'maxModuleCapacityMib': translated.maxModuleCapacityGb = Number(entry) / 1_024; break
      case 'maxPowerMw': translated.maxPowerWatts = Number(entry) / 1_000; break
      case 'maxGraphicsPowerMw': translated.maxGraphicsPowerWatts = Number(entry) / 1_000; break
      case 'supportedPowerMw': translated.supportedWattagesWatts = (entry as unknown[]).map((item) => Number(item) / 1_000); break
      case 'speedBps': translated.speed = speedLabel(Number(entry)); break
      default: translated[key] = mapped
    }
  }
  return translated
}

export function catalogItemForLegacyView(item: JsonRecord) {
  return translateObject(item) as JsonRecord
}
