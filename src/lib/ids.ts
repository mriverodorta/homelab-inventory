export function nextNumericId(existingIds: Array<string | number | null | undefined>): number {
  const usedIds = new Set(existingIds.map((id) => String(id)).filter(Boolean))
  let nextId = 1

  while (usedIds.has(String(nextId))) {
    nextId += 1
  }

  return nextId
}
