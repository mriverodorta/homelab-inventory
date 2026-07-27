import { Copy, Search, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { InventoryItemInput } from '@/lib/db'
import type { PrivateTemplate } from '@/types/registry'

export function PrivateTemplatePanel({
  templates,
  pending,
  onCreate,
  onDuplicate,
  onDelete,
}: {
  templates: PrivateTemplate[]
  pending: boolean
  onCreate: (item: InventoryItemInput, quantity: number) => Promise<void>
  onDuplicate?: (id: number) => Promise<void>
  onDelete?: (id: number) => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(templates[0]?.id ?? null)
  const [quantity, setQuantity] = useState('1')
  const [error, setError] = useState<string | null>(null)
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) return templates
    return templates.filter((template) => [
      template.name,
      template.description,
      template.item.name,
      template.item.manufacturer,
      template.item.model,
      template.item.type,
    ].some((value) => String(value ?? '').toLocaleLowerCase().includes(needle)))
  }, [query, templates])
  const selected = templates.find((template) => template.id === selectedId) ?? filtered[0] ?? null

  async function handleUseTemplate() {
    if (!selected) return
    const parsed = Number(quantity)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      setError('Quantity must be between 1 and 100.')
      return
    }
    setError(null)
    try {
      await onCreate(selected.item, parsed)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Template could not be added.')
    }
  }

  if (templates.length === 0) {
    return (
      <div className="flex min-h-72 items-center justify-center p-6 text-center">
        <div className="max-w-sm">
          <h3 className="text-lg font-black text-[#20242c]">No private templates yet</h3>
          <p className="mt-2 text-sm leading-6 text-[#6f665c]">
            Create an inventory item manually, then use its action menu to save a reusable local template.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(220px,0.9fr)_minmax(280px,1.1fr)]">
      <div className="min-h-0 border-b border-[#ded8ce] p-4 md:border-b-0 md:border-r">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-[#8d857b]" />
          <Input aria-label="Search private templates" value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" placeholder="Search templates" />
        </div>
        <div className="mt-3 grid max-h-64 gap-2 overflow-y-auto pr-1 md:max-h-[410px]">
          {filtered.map((template) => (
            <button
              key={template.id}
              type="button"
              onClick={() => setSelectedId(template.id)}
              className={cn(
                'rounded-md border px-3 py-2 text-left transition-colors',
                selected?.id === template.id
                  ? 'border-[#20242c] bg-[#20242c] text-white'
                  : 'border-[#ded8ce] bg-white hover:border-[#9d9489]',
              )}
            >
              <span className="block text-sm font-black">{template.name}</span>
              <span className={cn('mt-0.5 block text-xs', selected?.id === template.id ? 'text-[#d8d1c7]' : 'text-[#756d62]')}>
                {template.item.name} · {template.item.type}
              </span>
            </button>
          ))}
          {filtered.length === 0 ? <p className="p-3 text-sm text-[#756d62]">No templates match this search.</p> : null}
        </div>
      </div>
      <div className="min-h-0 overflow-y-auto p-5">
        {selected ? (
          <div>
            <p className="text-xs font-black uppercase tracking-[0.12em] text-[#81776c]">Private template</p>
            <h3 className="mt-1 text-xl font-black text-[#20242c]">{selected.name}</h3>
            <p className="mt-1 text-sm text-[#6f665c]">{selected.description ?? 'Reusable only in this Homelab Inventory installation.'}</p>
            <dl className="mt-5 grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-md border border-[#ded8ce] bg-[#f8f4ed] p-4 text-sm">
              <dt className="font-bold text-[#756d62]">Hardware</dt><dd className="font-black">{selected.item.name}</dd>
              <dt className="font-bold text-[#756d62]">Type</dt><dd>{selected.item.type}</dd>
              <dt className="font-bold text-[#756d62]">Manufacturer</dt><dd>{selected.item.manufacturer ?? 'Not specified'}</dd>
              <dt className="font-bold text-[#756d62]">Model</dt><dd>{selected.item.model ?? 'Not specified'}</dd>
            </dl>
            <label className="mt-5 block text-sm font-bold text-[#403a33]">
              Quantity
              <Input aria-label="Template quantity" min={1} max={100} type="number" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="mt-1.5 w-28" />
            </label>
            {error ? <p className="mt-2 text-sm font-semibold text-[#8b3322]">{error}</p> : null}
            <div className="mt-5 flex flex-wrap gap-2">
              <Button type="button" disabled={pending} onClick={() => void handleUseTemplate()}>{pending ? 'Adding…' : 'Add to inventory'}</Button>
              {onDuplicate ? <Button type="button" variant="outline" disabled={pending} onClick={() => void onDuplicate(selected.id)}><Copy className="size-4" />Duplicate</Button> : null}
              {onDelete ? <Button type="button" variant="ghost" disabled={pending} onClick={() => void onDelete(selected.id)}><Trash2 className="size-4" />Delete</Button> : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
