function normalizedText(value: unknown): string {
  return String(value ?? '').trim().toLocaleLowerCase()
}

export function compareViewerText(left: unknown, right: unknown): number {
  return normalizedText(left).localeCompare(normalizedText(right), undefined, {
    numeric: true,
    sensitivity: 'base',
  })
}

export function createViewerIdSet(values: readonly (string | number)[]): ReadonlySet<string> {
  return new Set(values.map(String))
}

export function sortViewerEntries<T extends { sortOrder: number }>(entries: readonly T[]): T[] {
  return [...entries].sort((left, right) => left.sortOrder - right.sortOrder)
}
