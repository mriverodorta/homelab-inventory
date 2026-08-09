const MODEL_PREFIXES = Object.freeze([
  [/^spcc\b/i, 'Silicon Power'],
  [/^(?:samsung|mzvl|mzv|mzal)\b/i, 'Samsung'],
  [/^(?:micron|mtfd)\b/i, 'Micron'],
  [/^(?:crucial|ct\d)\b/i, 'Crucial'],
  [/^(?:wdc|western digital|wd[_-])\b/i, 'Western Digital'],
  [/^(?:seagate|st\d)\b/i, 'Seagate'],
  [/^(?:toshiba|kioxia|thns)\b/i, 'Kioxia'],
  [/^(?:sk hynix|hynix|hfs|hfm)\b/i, 'SK hynix'],
  [/^(?:intel|ssdpe|ssdsck)\b/i, 'Intel'],
  [/^(?:kingston|sa\d|snv\d)\b/i, 'Kingston'],
  [/^(?:sandisk|sdss|sd\d)\b/i, 'SanDisk'],
])

const VENDOR_ALIASES = new Map([
  ['spcc', 'Silicon Power'],
  ['silicon power', 'Silicon Power'],
  ['ata', null],
  ['nvme', null],
])

function text(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
}

export function resolveStorageManufacturer(values = {}) {
  const vendor = text(values.vendor)
  if (vendor) {
    const alias = VENDOR_ALIASES.get(vendor.toLowerCase())
    if (alias !== undefined) return alias
    return vendor
  }
  const model = text(values.model)
  for (const [pattern, manufacturer] of MODEL_PREFIXES) {
    if (pattern.test(model)) return manufacturer
  }
  return null
}
