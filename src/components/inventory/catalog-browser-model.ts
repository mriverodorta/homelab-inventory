import type { CatalogFacetCategory, CatalogSearchFilters } from '@/types/registry'

export type CatalogTermFilterState = Record<string, string[]>
export type CatalogRangeFilterState = Record<string, [number, number]>

function scaled(value: number, divisor: number, suffix: string) {
  return `${(value / divisor).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${suffix}`
}

export function formatCatalogRangeValue(value: number, unit?: string | null): string {
  switch (unit) {
    case 'MHz': return value >= 1_000 ? scaled(value, 1_000, 'GHz') : `${value.toLocaleString()} MHz`
    case 'MiB': return value >= 1_024 ? scaled(value, 1_024, 'GiB') : `${value.toLocaleString()} MiB`
    case 'bytes':
      if (value >= 1_000_000_000_000) return scaled(value, 1_000_000_000_000, 'TB')
      if (value >= 1_000_000_000) return scaled(value, 1_000_000_000, 'GB')
      return `${value.toLocaleString()} bytes`
    case 'bps':
      if (value >= 1_000_000_000) return scaled(value, 1_000_000_000, 'Gbps')
      if (value >= 1_000_000) return scaled(value, 1_000_000, 'Mbps')
      return `${value.toLocaleString()} bps`
    case 'mW': return scaled(value, 1_000, 'W')
    case 'mV': return scaled(value, 1_000, 'V')
    case 'mA': return scaled(value, 1_000, 'A')
    case 'mC': return scaled(value, 1_000, 'deg C')
    case 'mHz': return scaled(value, 1_000, 'Hz')
    case 'mVA': return scaled(value, 1_000, 'VA')
    case 'basis-points': return scaled(value, 100, '%')
    default: return `${value.toLocaleString()}${unit ? ` ${unit}` : ''}`
  }
}

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
