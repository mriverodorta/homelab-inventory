import { LoaderCircle, Search, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { catalogVariantDescription } from '@/components/inventory/catalog-variant'
import { cn } from '@/lib/utils'
import type { CatalogSearchItem } from '@/types/registry'

export function CatalogResultList({
  categoryLabel,
  query,
  items,
  total,
  selectedKey,
  loading,
  loadingMore,
  error,
  hasMore,
  activeFilterCount,
  onQueryChange,
  onSelect,
  onLoadMore,
  onOpenFilters,
}: {
  categoryLabel: string
  query: string
  items: CatalogSearchItem[]
  total: number
  selectedKey: string | null
  loading: boolean
  loadingMore: boolean
  error: string | null
  hasMore: boolean
  activeFilterCount: number
  onQueryChange: (query: string) => void
  onSelect: (templateKey: string) => void
  onLoadMore: () => void
  onOpenFilters: () => void
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col border-b border-[#ded8ce] lg:border-r lg:border-b-0">
      <div className="shrink-0 border-b border-[#ded8ce] bg-[#fffdf8] p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-xs font-black uppercase text-[#746b60]">{categoryLabel}</p>
            <p className="text-xs text-[#81786e]">{total.toLocaleString()} verified {total === 1 ? 'item' : 'items'}</p>
          </div>
          <Button type="button" variant="outline" size="sm" className="lg:hidden" onClick={onOpenFilters}>
            <SlidersHorizontal aria-hidden="true" />Filters{activeFilterCount ? ` (${activeFilterCount})` : ''}
          </Button>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[#81786e]" aria-hidden="true" />
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            className="bg-white pl-9"
            placeholder="Search this category"
            aria-label={`Search ${categoryLabel}`}
          />
        </div>
      </div>
      <div className="min-h-48 flex-1 overflow-y-auto px-3 py-3 lg:min-h-0">
        <div className="space-y-1">
          {loading ? (
            <div className="flex items-center gap-2 p-3 text-sm text-[#746b60]">
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />Loading verified hardware…
            </div>
          ) : null}
          {error ? <p className="p-3 text-sm font-semibold text-[#a33d31]" role="alert">{error}</p> : null}
          {!loading && !error && items.length === 0 ? (
            <div className="p-4 text-sm leading-6 text-[#746b60]">
              <p className="font-bold text-[#302b26]">No verified items match.</p>
              <p className="mt-1">Clear a filter or use a broader search.</p>
            </div>
          ) : null}
          {items.map((item) => (
            <button
              key={item.templateKey}
              type="button"
              onClick={() => onSelect(item.templateKey)}
              className={cn(
                'flex w-full items-center gap-3 rounded-md border px-3 py-3 text-left transition-colors',
                selectedKey === item.templateKey
                  ? 'border-[#74968e] bg-[#e7f1ed]'
                  : 'border-transparent hover:border-[#ded8ce] hover:bg-[#f7f2e9]',
              )}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[#20242c] text-white"><ShieldCheck className="size-4" aria-hidden="true" /></span>
              <span className="min-w-0">
                <span className="block break-words text-sm font-black text-[#20242c]">{item.name}</span>
                <span className="mt-0.5 block break-words text-xs text-[#746b60]">{catalogVariantDescription(item)}</span>
              </span>
            </button>
          ))}
          {hasMore ? (
            <Button type="button" variant="outline" className="mt-3 w-full" disabled={loadingMore} onClick={onLoadMore}>
              {loadingMore ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
              {loadingMore ? 'Loading more…' : `Load more (${items.length.toLocaleString()} of ${total.toLocaleString()})`}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
