import { Search, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { CatalogItemDetail } from '@/components/inventory/catalog-item-detail'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useCatalogSearch } from '@/hooks/use-registry'
import { cn } from '@/lib/utils'

export function CatalogBrowser({
  onCreate,
}: {
  onCreate: (templateKey: string, quantity: number, usageRole?: 'server' | 'desktop' | 'workstation') => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const search = useCatalogSearch({ query, limit: 100 })
  const items = useMemo(() => search.data?.items ?? [], [search.data?.items])
  const selected = items.find((item) => item.templateKey === selectedKey) ?? items[0] ?? null

  useEffect(() => {
    if (selected && selectedKey !== selected.templateKey) setSelectedKey(selected.templateKey)
  }, [selected, selectedKey])

  async function create(templateKey: string, quantity: number, usageRole?: 'server' | 'desktop' | 'workstation') {
    setPending(true)
    try {
      await onCreate(templateKey, quantity, usageRole)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(220px,0.8fr)_minmax(320px,1.2fr)]">
      <div className="flex min-h-0 flex-col border-b border-[#ded8ce] lg:border-r lg:border-b-0">
        <div className="relative shrink-0 p-4">
          <Search className="pointer-events-none absolute top-1/2 left-7 size-4 -translate-y-1/2 text-[#81786e]" aria-hidden="true" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} className="bg-white pl-9" placeholder="Search model, manufacturer, or part number" aria-label="Search official catalog" />
        </div>
        <ScrollArea className="min-h-48 flex-1 lg:min-h-0">
          <div className="space-y-1 px-3 pb-4">
            {search.isLoading ? <p className="p-3 text-sm text-[#746b60]">Searching local catalog…</p> : null}
            {search.isError ? <p className="p-3 text-sm font-semibold text-[#a33d31]">{search.error instanceof Error ? search.error.message : 'Catalog search failed.'}</p> : null}
            {!search.isLoading && items.length === 0 ? <p className="p-3 text-sm text-[#746b60]">No verified catalog items match this search.</p> : null}
            {items.map((item) => (
              <button
                key={item.templateKey}
                type="button"
                onClick={() => setSelectedKey(item.templateKey)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-md border px-3 py-3 text-left transition-colors',
                  selected?.templateKey === item.templateKey
                    ? 'border-[#74968e] bg-[#e7f1ed]'
                    : 'border-transparent hover:border-[#ded8ce] hover:bg-[#f7f2e9]',
                )}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[#20242c] text-white"><ShieldCheck className="size-4" /></span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-black text-[#20242c]">{item.name}</span>
                  <span className="block truncate text-xs text-[#746b60]">{[item.manufacturer, item.type].filter(Boolean).join(' · ')}</span>
                </span>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>
      {selected ? <CatalogItemDetail template={selected} pending={pending} onCreate={create} /> : (
        <div className="hidden items-center justify-center p-8 text-sm text-[#746b60] lg:flex">Select a verified item to inspect its catalog definition.</div>
      )}
    </div>
  )
}
