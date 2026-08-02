import { BadgeCheck, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { catalogVariantLabel } from '@/components/inventory/catalog-variant'
import type { EquipmentUsageRole } from '@/types/inventory'
import type { CatalogSearchItem } from '@/types/registry'

export function CatalogItemDetail({
  template,
  pending,
  onCreate,
}: {
  template: CatalogSearchItem
  pending: boolean
  onCreate: (templateKey: string, quantity: number, usageRole?: EquipmentUsageRole) => Promise<void>
}) {
  const [quantity, setQuantity] = useState('1')
  const [usageRole, setUsageRole] = useState<EquipmentUsageRole>('server')
  const [error, setError] = useState<string | null>(null)
  const specs = Object.entries(template.item.specs ?? {})
  const variantLabel = catalogVariantLabel(template.variantEvidence)

  useEffect(() => {
    setUsageRole('server')
    setQuantity('1')
    setError(null)
  }, [template.templateKey])

  async function create() {
    const parsed = Number(quantity)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      setError('Quantity must be between 1 and 100.')
      return
    }
    setError(null)
    try {
      await onCreate(template.templateKey, parsed, usageRole)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Catalog item could not be added.')
    }
  }

  return (
    <section className="min-w-0 p-5" aria-label={`${template.name} catalog details`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="gap-1 border-[#8daaa3] bg-[#e7f1ed] text-[#254f48]">
          <BadgeCheck className="size-3.5" aria-hidden="true" />Verified
        </Badge>
        <Badge variant="outline">Revision {template.revision}</Badge>
        <Badge variant="outline">{template.type}</Badge>
      </div>
      <h3 className="mt-4 text-xl font-black text-[#20242c]">{template.name}</h3>
      <p className="mt-1 text-sm text-[#746b60]">
        {[template.manufacturer, template.item.model, template.item.number].filter(Boolean).join(' · ') || 'Official catalog definition'}
      </p>
      {variantLabel ? (
        <div className="mt-4 border-l-2 border-[#74968e] pl-3">
          <div className="text-[10px] font-black uppercase text-[#6f665c]">Hardware variant</div>
          <div className="mt-0.5 text-sm font-bold text-[#302b26]">{variantLabel}</div>
          <div className="mt-1 text-xs text-[#746b60]">
            Verified from {template.variantEvidence?.source === 'motherboard' ? 'motherboard identity' : 'material hardware topology'}.
          </div>
        </div>
      ) : null}

      <div className="mt-5 grid gap-px overflow-hidden rounded-md border border-[#ded8ce] bg-[#ded8ce] sm:grid-cols-2">
        {specs.length > 0 ? specs.slice(0, 12).map(([label, value]) => (
          <div key={label} className="bg-[#fffdf8] px-3 py-2.5">
            <div className="text-[10px] font-black uppercase text-[#8a8177]">{label}</div>
            <div className="mt-0.5 break-words text-sm font-bold text-[#302b26]">{String(value)}</div>
          </div>
        )) : (
          <div className="bg-[#fffdf8] px-3 py-4 text-sm text-[#746b60] sm:col-span-2">No additional specifications are published for this item.</div>
        )}
      </div>

      <div className="mt-5 rounded-md border border-[#ded8ce] bg-[#f7f2e9] p-3 text-sm text-[#5e554b]">
        This creates independent local inventory records linked to this verified revision. It does not place or assign anything on the canvas.
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-2">
        {template.type === 'desktop' || template.type === 'server' ? (
          <label className="min-w-40 flex-1 text-xs font-black uppercase text-[#6f665c]">
            Used as
            <Select value={usageRole} onValueChange={(value) => setUsageRole(value as EquipmentUsageRole)}>
              <SelectTrigger className="mt-1 bg-white" aria-label="Use imported equipment as">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="server">Server</SelectItem>
                <SelectItem value="desktop">Desktop</SelectItem>
                <SelectItem value="workstation">Workstation</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </label>
        ) : null}
        <label className="w-24 text-xs font-black uppercase text-[#6f665c]">
          Quantity
          <Input className="mt-1 bg-white" type="number" min={1} max={100} value={quantity} onChange={(event) => setQuantity(event.target.value)} />
        </label>
        <Button type="button" className="flex-1" disabled={pending} onClick={() => void create()}>
          <Plus className="size-4" aria-hidden="true" />{pending ? 'Adding…' : 'Add to inventory'}
        </Button>
      </div>
      {error ? <p className="mt-2 text-sm font-semibold text-[#a33d31]" role="alert">{error}</p> : null}
    </section>
  )
}
