import type { CatalogFacetCategory, CatalogSearchFilters } from '@/types/registry'

export type CatalogTermFilterState = Record<string, string[]>
export type CatalogRangeFilterState = Record<string, [number, number]>

export function createRangeFilterState(category: CatalogFacetCategory): CatalogRangeFilterState {
  return Object.fromEntries(
    category.facets
      .filter((facet) => facet.kind === 'range')
      .map((facet) => [facet.key, [facet.minimum, facet.maximum]]),
  )
}

export function buildCatalogSearchFilters(
  category: CatalogFacetCategory,
  terms: CatalogTermFilterState,
  ranges: CatalogRangeFilterState,
): CatalogSearchFilters {
  const activeTerms = Object.fromEntries(
    Object.entries(terms).filter(([, values]) => values.length > 0),
  )
  const activeRanges = Object.fromEntries(
    category.facets.flatMap((facet) => {
      if (facet.kind !== 'range') return []
      const value = ranges[facet.key]
      if (!value || (value[0] === facet.minimum && value[1] === facet.maximum)) return []
      return [[facet.key, { minimum: value[0], maximum: value[1] }]]
    }),
  )

  return {
    terms: activeTerms,
    ranges: activeRanges,
  }
}

export function countActiveCatalogFilters(
  category: CatalogFacetCategory,
  terms: CatalogTermFilterState,
  ranges: CatalogRangeFilterState,
): number {
  const termCount = Object.values(terms).reduce((total, values) => total + values.length, 0)
  const rangeCount = category.facets.reduce((total, facet) => {
    if (facet.kind !== 'range') return total
    const value = ranges[facet.key]
    return total + (value && (value[0] !== facet.minimum || value[1] !== facet.maximum) ? 1 : 0)
  }, 0)
  return termCount + rangeCount
}

export function toggleCatalogTerm(values: string[], value: string): string[] {
  return values.includes(value)
    ? values.filter((candidate) => candidate !== value)
    : [...values, value]
}
