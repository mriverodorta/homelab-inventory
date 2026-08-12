import { Database, LoaderCircle } from 'lucide-react'
import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { CatalogCategoryPicker } from '@/components/inventory/catalog-category-picker'
import { CatalogFilterPanel } from '@/components/inventory/catalog-filter-panel'
import {
  buildCatalogSearchFilters,
  countActiveCatalogFilters,
  createRangeFilterState,
  type CatalogRangeFilterState,
  type CatalogTermFilterState,
} from '@/components/inventory/catalog-browser-model'
import { CatalogItemDetail } from '@/components/inventory/catalog-item-detail'
import { CatalogResultList } from '@/components/inventory/catalog-result-list'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useCatalogFacets, useInfiniteCatalogSearch } from '@/hooks/use-registry'
import type { CatalogFacetCategory, RegistrySnapshot } from '@/types/registry'

export function CatalogBrowser({
  onCreate,
  snapshot,
}: {
  onCreate: (templateKey: string, quantity: number, usageRole?: 'server' | 'desktop' | 'workstation' | 'other') => Promise<void>
  snapshot: Pick<RegistrySnapshot, 'revision' | 'digest'>
}) {
  const [category, setCategory] = useState<CatalogFacetCategory | null>(null)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [termFilters, setTermFilters] = useState<CatalogTermFilterState>({})
  const [rangeFilters, setRangeFilters] = useState<CatalogRangeFilterState>({})
  const [filterSheetOpen, setFilterSheetOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const facets = useCatalogFacets(snapshot)
  const categories = useMemo(
    () => (facets.data?.categories ?? []).filter((candidate) => candidate.count > 0),
    [facets.data?.categories],
  )
  const searchFilters = useMemo(
    () => category ? buildCatalogSearchFilters(category, termFilters, rangeFilters) : {},
    [category, rangeFilters, termFilters],
  )
  const search = useInfiniteCatalogSearch({
    query: deferredQuery,
    type: category?.type,
    filters: searchFilters,
  }, Boolean(category))
  const items = useMemo(() => search.data?.pages.flatMap((page) => page.items) ?? [], [search.data?.pages])
  const total = search.data?.pages[0]?.total ?? 0
  const selected = items.find((item) => item.templateKey === selectedKey) ?? null
  const activeFilterCount = category
    ? countActiveCatalogFilters(category, termFilters, rangeFilters)
    : 0

  useEffect(() => {
    if (!selectedKey && items[0]) setSelectedKey(items[0].templateKey)
    if (selectedKey && items.length > 0 && !items.some((item) => item.templateKey === selectedKey)) {
      setSelectedKey(items[0]?.templateKey ?? null)
    }
  }, [items, selectedKey])

  function selectCategory(nextCategory: CatalogFacetCategory) {
    setCategory(nextCategory)
    setQuery('')
    setSelectedKey(null)
    setTermFilters({})
    setRangeFilters(createRangeFilterState(nextCategory))
    setFilterSheetOpen(false)
  }

  function clearFilters() {
    if (!category) return
    setTermFilters({})
    setRangeFilters(createRangeFilterState(category))
    setSelectedKey(null)
  }

  function changeCategory() {
    setCategory(null)
    setQuery('')
    setSelectedKey(null)
    setTermFilters({})
    setRangeFilters({})
    setFilterSheetOpen(false)
  }

  async function create(templateKey: string, quantity: number, usageRole?: 'server' | 'desktop' | 'workstation' | 'other') {
    setPending(true)
    try {
      await onCreate(templateKey, quantity, usageRole)
    } finally {
      setPending(false)
    }
  }

  if (facets.isLoading) {
    return (
      <div className="flex min-h-72 flex-1 items-center justify-center gap-2 text-sm text-[#746b60]">
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />Loading catalog categories…
      </div>
    )
  }

  if (facets.isError || !facets.data?.available) {
    return (
      <div className="flex min-h-72 flex-1 items-center justify-center p-6">
        <div className="max-w-md text-center">
          <span className="mx-auto flex size-11 items-center justify-center rounded-md bg-[#20242c] text-white">
            <Database className="size-5" aria-hidden="true" />
          </span>
          <h3 className="mt-4 text-lg font-black text-[#20242c]">Catalog filters are not available</h3>
          <p className="mt-2 text-sm leading-6 text-[#6f665c]">
            This catalog revision does not include signed filter metadata yet. Refresh after the registry publishes its facet index.
          </p>
        </div>
      </div>
    )
  }

  if (!category) return <CatalogCategoryPicker categories={categories} onSelect={selectCategory} />

  const filterPanelProps = {
    category,
    terms: termFilters,
    ranges: rangeFilters,
    activeFilterCount,
    onTermsChange: setTermFilters,
    onRangesChange: setRangeFilters,
    onClear: clearFilters,
    onChangeCategory: changeCategory,
  }

  return (
    <div
      data-testid="catalog-browser"
      className="flex min-h-0 flex-1 flex-col overflow-visible lg:grid lg:h-full lg:grid-cols-[240px_minmax(260px,0.8fr)_minmax(380px,1.2fr)] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden"
    >
      <aside
        data-testid="catalog-filter-pane"
        className="hidden min-h-0 overflow-hidden border-r border-[#ded8ce] lg:flex"
        aria-label="Catalog filters"
      >
        <CatalogFilterPanel {...filterPanelProps} idPrefix="desktop-catalog-filter" />
      </aside>
      <CatalogResultList
        categoryLabel={category.label}
        query={query}
        items={items}
        total={total}
        selectedKey={selected?.templateKey ?? null}
        loading={search.isLoading}
        loadingMore={search.isFetchingNextPage}
        error={search.isError ? (search.error instanceof Error ? search.error.message : 'Catalog search failed.') : null}
        hasMore={Boolean(search.hasNextPage)}
        activeFilterCount={activeFilterCount}
        onQueryChange={(nextQuery) => {
          setQuery(nextQuery)
          setSelectedKey(null)
        }}
        onSelect={setSelectedKey}
        onLoadMore={() => void search.fetchNextPage()}
        onOpenFilters={() => setFilterSheetOpen(true)}
      />
      <div data-testid="catalog-detail-pane" className="min-h-0 overflow-y-auto overscroll-contain">
        {selected ? (
          <CatalogItemDetail template={selected} pending={pending} onCreate={create} />
        ) : (
          <div className="hidden h-full min-h-64 items-center justify-center p-8 text-center text-sm text-[#746b60] lg:flex">
            Select a verified item to inspect its catalog definition.
          </div>
        )}
      </div>
      <Sheet open={filterSheetOpen} onOpenChange={setFilterSheetOpen}>
        <SheetContent side="left" className="w-[min(90vw,22rem)] gap-0 bg-[#f7f2e9] p-0 sm:max-w-sm">
          <SheetHeader className="sr-only">
            <SheetTitle>Filter {category.label}</SheetTitle>
            <SheetDescription>Choose one or more catalog filters.</SheetDescription>
          </SheetHeader>
          <CatalogFilterPanel {...filterPanelProps} idPrefix="mobile-catalog-filter" />
          <SheetFooter className="border-t border-[#ded8ce] bg-[#fffdf8]">
            <Button type="button" onClick={() => setFilterSheetOpen(false)}>Show {total.toLocaleString()} items</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  )
}
