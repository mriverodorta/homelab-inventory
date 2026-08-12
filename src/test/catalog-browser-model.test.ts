import { describe, expect, it } from 'vitest'
import {
  buildCatalogSearchFilters,
  countActiveCatalogFilters,
  createRangeFilterState,
  formatCatalogRangeValue,
  toggleCatalogTerm,
} from '@/components/inventory/catalog-browser-model'
import type { CatalogFacetCategory } from '@/types/registry'

const category: CatalogFacetCategory = {
  type: 'cpu',
  label: 'Processors',
  count: 120,
  facets: [
    {
      key: 'manufacturer',
      label: 'Manufacturer',
      kind: 'terms',
      values: [
        { value: 'AMD', label: 'AMD', count: 50 },
        { value: 'Intel', label: 'Intel', count: 70 },
      ],
    },
    { key: 'specs.cores', label: 'Core count', kind: 'range', minimum: 2, maximum: 64, step: 1 },
  ],
}

describe('catalog browser filters', () => {
  it('starts numeric filters at their complete ranges', () => {
    expect(createRangeFilterState(category)).toEqual({ 'specs.cores': [2, 64] })
  })

  it('sends only active term and range constraints', () => {
    expect(buildCatalogSearchFilters(category, { manufacturer: ['Intel'] }, { 'specs.cores': [4, 16] })).toEqual({
      terms: { manufacturer: ['Intel'] },
      ranges: { 'specs.cores': { minimum: 4, maximum: 16 } },
    })
    expect(countActiveCatalogFilters(category, { manufacturer: ['Intel'] }, { 'specs.cores': [4, 16] })).toBe(2)
    expect(buildCatalogSearchFilters(category, {}, createRangeFilterState(category))).toEqual({ terms: {}, ranges: {} })
  })

  it('toggles independent multi-select values without replacing siblings', () => {
    expect(toggleCatalogTerm(['AMD'], 'Intel')).toEqual(['AMD', 'Intel'])
    expect(toggleCatalogTerm(['AMD', 'Intel'], 'AMD')).toEqual(['Intel'])
  })

  it('formats canonical v9 facet integers into friendly display units', () => {
    expect(formatCatalogRangeValue(2_300, 'MHz')).toBe('2.3 GHz')
    expect(formatCatalogRangeValue(16_384, 'MiB')).toBe('16 GiB')
    expect(formatCatalogRangeValue(1_000_000_000_000, 'bytes')).toBe('1 TB')
    expect(formatCatalogRangeValue(10_000_000_000, 'bps')).toBe('10 Gbps')
    expect(formatCatalogRangeValue(130_000, 'mW')).toBe('130 W')
  })
})
