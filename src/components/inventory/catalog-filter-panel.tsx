import { ChevronLeft, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import type { CatalogRangeFilterState, CatalogTermFilterState } from '@/components/inventory/catalog-browser-model'
import { toggleCatalogTerm } from '@/components/inventory/catalog-browser-model'
import type { CatalogFacetCategory } from '@/types/registry'

const COLLAPSED_TERM_COUNT = 6

function formatRangeValue(value: number, unit?: string | null): string {
  return `${value.toLocaleString()}${unit ? ` ${unit}` : ''}`
}

export function CatalogFilterPanel({
  category,
  terms,
  ranges,
  activeFilterCount,
  onTermsChange,
  onRangesChange,
  onClear,
  onChangeCategory,
  idPrefix = 'catalog-filter',
}: {
  category: CatalogFacetCategory
  terms: CatalogTermFilterState
  ranges: CatalogRangeFilterState
  activeFilterCount: number
  onTermsChange: (terms: CatalogTermFilterState) => void
  onRangesChange: (ranges: CatalogRangeFilterState) => void
  onClear: () => void
  onChangeCategory: () => void
  idPrefix?: string
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#f7f2e9]">
      <div className="shrink-0 border-b border-[#ded8ce] p-4">
        <Button type="button" variant="ghost" size="sm" className="-ml-2" onClick={onChangeCategory}>
          <ChevronLeft aria-hidden="true" />Categories
        </Button>
        <div className="mt-2 flex items-end justify-between gap-2">
          <div>
            <p className="text-xs font-black uppercase text-[#746b60]">Filters</p>
            <h3 className="mt-1 text-lg font-black text-[#20242c]">{category.label}</h3>
          </div>
          {activeFilterCount > 0 ? (
            <Button type="button" variant="ghost" size="sm" onClick={onClear}>
              <RotateCcw aria-hidden="true" />Clear {activeFilterCount}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        {category.facets.map((facet, index) => (
          <div key={facet.key}>
            {index > 0 ? <Separator /> : null}
            <section className="py-5" aria-labelledby={`${idPrefix}-${facet.key}`}>
              <h4 id={`${idPrefix}-${facet.key}`} className="text-xs font-black uppercase text-[#514940]">{facet.label}</h4>
              {facet.kind === 'terms' ? (
                <div className="mt-3 space-y-2.5">
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-[#302b26]">
                    <Checkbox
                      checked={(terms[facet.key] ?? []).length === 0}
                      onCheckedChange={() => onTermsChange({ ...terms, [facet.key]: [] })}
                    />
                    <span>All</span>
                  </label>
                  {facet.values
                    .slice(0, expanded[facet.key] ? undefined : COLLAPSED_TERM_COUNT)
                    .map((option) => (
                      <label key={option.value} className="flex cursor-pointer items-center gap-2 text-sm text-[#302b26]">
                        <Checkbox
                          checked={(terms[facet.key] ?? []).includes(option.value)}
                          onCheckedChange={() => onTermsChange({
                            ...terms,
                            [facet.key]: toggleCatalogTerm(terms[facet.key] ?? [], option.value),
                          })}
                        />
                        <span className="min-w-0 flex-1 break-words">{option.label}</span>
                        <span className="text-xs tabular-nums text-[#81786e]">{option.count.toLocaleString()}</span>
                      </label>
                    ))}
                  {facet.values.length > COLLAPSED_TERM_COUNT ? (
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto px-0"
                      onClick={() => setExpanded((current) => ({ ...current, [facet.key]: !current[facet.key] }))}
                    >
                      {expanded[facet.key] ? 'Show less' : `Show ${facet.values.length - COLLAPSED_TERM_COUNT} more`}
                    </Button>
                  ) : null}
                </div>
              ) : (
                <div className="mt-4">
                  <div className="flex items-center justify-between gap-3 text-xs font-bold tabular-nums text-[#514940]">
                    <span>{formatRangeValue(ranges[facet.key]?.[0] ?? facet.minimum, facet.unit)}</span>
                    <span>{formatRangeValue(ranges[facet.key]?.[1] ?? facet.maximum, facet.unit)}</span>
                  </div>
                  <Slider
                    className="mt-4"
                    aria-label={facet.label}
                    min={facet.minimum}
                    max={facet.maximum}
                    step={facet.step}
                    value={ranges[facet.key] ?? [facet.minimum, facet.maximum]}
                    onValueChange={(value) => onRangesChange({
                      ...ranges,
                      [facet.key]: [value[0] ?? facet.minimum, value[1] ?? facet.maximum],
                    })}
                  />
                </div>
              )}
            </section>
          </div>
        ))}
        {category.facets.length === 0 ? (
          <p className="py-5 text-sm leading-6 text-[#746b60]">Search by name, manufacturer, model, or part number.</p>
        ) : null}
      </div>
    </div>
  )
}
