export function nextNumericId(existingIds: Array<string | number | null | undefined>): number {
  const usedIds = new Set(existingIds.map((id) => String(id)).filter(Boolean))
  let nextId = 1

  while (usedIds.has(String(nextId))) {
    nextId += 1
  }

  return nextId
}

export function isRelationalId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

export function assertRelationalId(value: unknown, field: string): number {
  if (!isRelationalId(value)) {
    throw new Error(`${field} must be a positive safe-integer relational ID.`)
  }

  return value
}
