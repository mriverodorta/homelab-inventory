import { Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { runtimeItemKey } from '@/lib/item-keys'
import { cn } from '@/lib/utils'
import type { InventoryItem, ProjectState } from '@/types/inventory'

type SearchResult = {
  item: InventoryItem
  haystack: string
  score: number
  status: string
}

function itemSearchText(item: InventoryItem): string {
  const specs = item.specs
    ? Object.entries(item.specs).map(([key, value]) => `${key} ${String(value)}`)
    : []
  const properties = item.properties
    ? Object.entries(item.properties).map(([key, value]) => `${key} ${value}`)
    : []
  const ports = (item.ports ?? []).map((port) =>
    [port.label, port.type, port.speed, port.slotNumber].filter(Boolean).join(' '),
  )

  return [
    item.name,
    item.type,
    item.subtype,
    item.manufacturer,
    item.secondaryManufacturer,
    item.family,
    item.model,
    item.number,
    item.notes,
    ...specs,
    ...properties,
    ...ports,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function fuzzyScore(query: string, haystack: string): number {
  const normalizedQuery = query.trim().toLowerCase()

  if (normalizedQuery.length === 0) {
    return 1
  }

  const directIndex = haystack.indexOf(normalizedQuery)

  if (directIndex >= 0) {
    return 1000 - directIndex
  }

  let score = 0
  let queryIndex = 0
  let streak = 0

  for (let haystackIndex = 0; haystackIndex < haystack.length; haystackIndex += 1) {
    if (haystack[haystackIndex] !== normalizedQuery[queryIndex]) {
      streak = 0
      continue
    }

    score += 10 + streak * 4
    streak += 1
    queryIndex += 1

    if (queryIndex === normalizedQuery.length) {
      return score
    }
  }

  return 0
}

function getItemStatus(project: ProjectState, item: InventoryItem): string {
  const key = runtimeItemKey(item)

  if (project.placements.some((placement) => placement.serverId === key)) {
    return 'On canvas'
  }

  const assignment = project.assignments.find((candidate) => candidate.itemId === key)

  if (assignment) {
    return `Assigned to ${project.items[assignment.serverId]?.name ?? 'server'}`
  }

  return 'Inventory'
}

function getItemSubtitle(item: InventoryItem): string {
  if (item.type === 'server') {
    return item.properties?.displayName?.trim() || item.model || item.subtype || 'Server'
  }

  return [item.manufacturer, item.family, item.model, item.number, item.subtype]
    .filter(Boolean)
    .join(' ')
}

export function GlobalItemSearch({
  project,
  open,
  onOpenChange,
  onSelectItem,
}: {
  project: ProjectState
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelectItem: (itemId: string) => void
}) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const indexedItems = useMemo(
    () =>
      Object.values(project.items).map((item) => ({
        item,
        haystack: itemSearchText(item),
        status: getItemStatus(project, item),
      })),
    [project],
  )
  const results = useMemo<SearchResult[]>(() => {
    return indexedItems
      .map((entry) => ({
        ...entry,
        score: fuzzyScore(query, entry.haystack),
      }))
      .filter((entry) => entry.score > 0)
      .sort((first, second) => {
        if (second.score !== first.score) {
          return second.score - first.score
        }

        return first.item.name.localeCompare(second.item.name)
      })
      .slice(0, 12)
  }, [indexedItems, query])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        onOpenChange(true)
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onOpenChange])

  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIndex(0)
    }
  }, [open])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  function selectResult(result: SearchResult | undefined) {
    if (!result) {
      return
    }

    onSelectItem(runtimeItemKey(result.item))
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-w-2xl gap-0 overflow-hidden rounded-lg border border-[#6f604f] bg-[#14171d] p-0 text-[#f8f1e8] shadow-[0_28px_80px_rgba(0,0,0,0.42)]"
      >
        <DialogTitle className="sr-only">Global item search</DialogTitle>
        <DialogDescription className="sr-only">
          Search the inventory and canvas items.
        </DialogDescription>
        <div className="flex items-center gap-3 border-b border-[#37322d] bg-[#1d2027] px-4 py-3">
          <Search className="size-5 shrink-0 text-[#ddb668]" />
          <Input
            autoFocus
            value={query}
            placeholder="Search servers, ports, cables, specs..."
            className="h-11 border-0 bg-transparent px-0 text-lg font-semibold text-[#f8f1e8] shadow-none placeholder:text-[#8b8277] focus-visible:ring-0"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActiveIndex((current) => (results.length === 0 ? 0 : Math.min(current + 1, results.length - 1)))
              }

              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActiveIndex((current) => Math.max(current - 1, 0))
              }

              if (event.key === 'Enter') {
                event.preventDefault()
                selectResult(results[activeIndex])
              }
            }}
          />
          <kbd className="rounded border border-[#4e463e] bg-[#262a32] px-2 py-1 text-[11px] font-bold text-[#b9aa98]">
            esc
          </kbd>
        </div>

        <div className="max-h-[440px] overflow-auto p-2">
          {results.length > 0 ? (
            <div className="space-y-1">
              {results.map((result, index) => (
                <button
                  key={runtimeItemKey(result.item)}
                  type="button"
                  className={cn(
                    'grid w-full grid-cols-[1fr_auto] gap-3 rounded-md px-3 py-2 text-left transition',
                    index === activeIndex
                      ? 'bg-[#ddb668] text-[#20170b]'
                      : 'text-[#f8f1e8] hover:bg-[#262a32]',
                  )}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectResult(result)}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-black">{result.item.name}</span>
                    <span
                      className={cn(
                        'mt-0.5 block truncate text-xs font-semibold',
                        index === activeIndex ? 'text-[#4b3715]' : 'text-[#b9aa98]',
                      )}
                    >
                      {getItemSubtitle(result.item) || result.item.type}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'self-center rounded px-2 py-1 text-[10px] font-black uppercase tracking-[0.08em]',
                      index === activeIndex
                        ? 'bg-[#fff2c7] text-[#3d2a08]'
                        : 'bg-[#262a32] text-[#d6ccbd]',
                    )}
                  >
                    {result.status}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-[#4e463e] p-8 text-center text-sm font-semibold text-[#b9aa98]">
              No matching inventory items.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
