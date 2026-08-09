import manufacturerData from './reference/jep106-manufacturers.json' with { type: 'json' }

const MANUFACTURERS_PER_BANK = 256
const MODULE_MANUFACTURER_PATTERN = /^Bank\s+(\d+),\s*Hex\s+0x([0-9a-f]{2})$/i

function hasOddParity(value) {
  let bits = value
  let count = 0
  while (bits > 0) {
    count += bits & 1
    bits >>= 1
  }
  return count % 2 === 1
}

export function resolveJedecManufacturer(moduleManufacturerId) {
  if (typeof moduleManufacturerId !== 'string') return null
  const match = moduleManufacturerId.trim().match(MODULE_MANUFACTURER_PATTERN)
  if (!match) return null

  const bank = Number.parseInt(match[1], 10)
  const parityCode = Number.parseInt(match[2], 16)
  const manufacturerCode = parityCode & 0x7f
  if (!Number.isSafeInteger(bank) || bank < 1 || !hasOddParity(parityCode) || manufacturerCode === 0) return null

  const tableIndex = (bank - 1) * MANUFACTURERS_PER_BANK + manufacturerCode
  const manufacturer = manufacturerData.manufacturers[tableIndex]
  return typeof manufacturer === 'string' && manufacturer.trim() ? manufacturer : null
}
