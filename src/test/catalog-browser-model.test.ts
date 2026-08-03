import { describe, expect, it } from 'vitest'
import {
  buildCatalogSearchFilters,
  countActiveCatalogFilters,
  createRangeFilterState,
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
})
