import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Boxes, LoaderCircle, Plus, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { loadAvailableGlobalInventory, type AvailableGlobalInventoryItem } from '@/lib/db'

type GlobalInventoryPanelProps = {
  projectId: number
  enabled: boolean
  pending?: boolean
  onAdd(item: AvailableGlobalInventoryItem): Promise<void>
}

function searchable(item: AvailableGlobalInventoryItem) {
  return [item.name, item.type, item.manufacturer, item.model, item.family, item.number, item.subtype]
    .filter(Boolean).join(' ').toLocaleLowerCase('en-US')
}

export function GlobalInventoryPanel({ projectId, enabled, pending = false, onAdd }: GlobalInventoryPanelProps) {
  const [query, setQuery] = useState('')
  const [addingKey, setAddingKey] = useState<string | null>(null)
  const available = useQuery({
    queryKey: ['global-inventory-available', projectId],
    queryFn: () => loadAvailableGlobalInventory(projectId),
    enabled,
  })
  const normalizedQuery = query.trim().toLocaleLowerCase('en-US')
  const items = useMemo(() => (available.data ?? []).filter((item) => (
    !normalizedQuery || searchable(item).includes(normalizedQuery)
  )), [available.data, normalizedQuery])

  if (!enabled) {
    return <div className="m-4 rounded-lg border bg-muted/35 p-5 text-sm text-muted-foreground">Enable global inventory in Project settings to share selected items with this project.</div>
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" placeholder="Search global inventory" />
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="grid gap-2 p-4">
          {available.isLoading ? <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><LoaderCircle className="animate-spin" />Loading global inventory</div> : null}
          {available.isError ? <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{available.error instanceof Error ? available.error.message : 'Global inventory could not be loaded.'}</p> : null}
          {!available.isLoading && !available.isError && items.map((item) => {
            const key = `${item.type}:${item.id}`
            const detail = [item.manufacturer, item.model || item.family, item.number].filter(Boolean).join(' · ')
            return (
              <article key={key} className="flex items-center gap-3 rounded-lg border bg-card p-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted"><Boxes className="size-4" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">{item.name}</h3>
                    <Badge variant="outline">{item.type}</Badge>
                  </div>
                  {detail ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</p> : null}
                </div>
                <Button
                  size="sm"
                  disabled={pending || addingKey !== null}
                  onClick={() => {
                    setAddingKey(key)
                    void onAdd(item).finally(() => setAddingKey(null))
                  }}
                >
                  {addingKey === key ? <LoaderCircle className="animate-spin" /> : <Plus />}
                  Add
                </Button>
              </article>
            )
          })}
          {!available.isLoading && !available.isError && items.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              {query ? 'No global inventory matches this search.' : 'Every available global item is already in this project.'}
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  )
}
