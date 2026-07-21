export function isRelationalId(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

export function assertRelationalId(value, field) {
  if (!isRelationalId(value)) {
    throw new Error(`${field} must be a positive safe-integer relational ID.`)
  }

  return value
}

export function parseLegacyRelationalId(value, field) {
  if (isRelationalId(value)) return value
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) {
    const parsed = Number(value)
    if (Number.isSafeInteger(parsed)) return parsed
  }

  throw new Error(`${field} cannot be migrated to a positive safe-integer relational ID.`)
}

export function isLegacyRelationalId(value) {
  if (isRelationalId(value)) return true
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return false
  return Number.isSafeInteger(Number(value))
}
