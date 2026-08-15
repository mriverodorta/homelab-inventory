import { CheckCircle2, ChevronDown, ChevronUp, LoaderCircle, XCircle } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import type { CatalogUpdateGroup, CatalogUpdateGroupDetail } from '@/types/registry'
import { RegistryUpdateGroupDetail } from './registry-update-group-detail'

export function RegistryUpdateGroupCard({ group, pendingDecision, error, canManage, selected, reasonLabels, onSelectedChange, onDecision, onResolve }: {
  group: CatalogUpdateGroup
  pendingDecision: 'applied' | 'declined' | 'reconsider' | null
  error: string | null
  canManage: boolean
  selected: boolean
  reasonLabels: Record<string, string>
  onSelectedChange: (selected: boolean) => void
  onDecision: (decision: 'applied' | 'declined' | 'reconsider') => void
  onResolve: (detail: CatalogUpdateGroupDetail, linkId: number) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const actionable = group.status === 'review' || group.status === 'blocked'
  return (
    <section className="rounded-md border border-[#ded8ce] bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {actionable && canManage ? <Checkbox className="mt-0.5" checked={selected} disabled={pendingDecision !== null} onCheckedChange={(checked) => onSelectedChange(checked === true)} aria-label={`Select ${group.items[0]?.itemName ?? group.templateKey}`} /> : null}
          <div className="min-w-0">
            <h3 className="text-sm font-black text-[#28231f]">{group.items[0]?.itemName ?? group.templateKey}</h3>
            <p className="mt-1 text-xs text-[#746b60]">Revision {group.fromRevision} to {group.toRevision} · {group.items.length} linked {group.items.length === 1 ? 'item' : 'items'}</p>
          </div>
        </div>
        <Badge variant={group.classification === 'blocked' ? 'destructive' : 'secondary'}>{group.classification}</Badge>
      </div>
      {group.reasons.length > 0 ? <p className="mt-3 text-xs leading-5 text-[#675f56]">{group.reasons.map((reason) => reasonLabels[reason] ?? reason).join(' · ')}</p> : null}
      <Button type="button" size="sm" variant="ghost" className="mt-2 px-1 text-[#3c655d]" onClick={() => setExpanded((current) => !current)}>{expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}Review catalog changes</Button>
      {expanded ? <RegistryUpdateGroupDetail group={group} onResolve={onResolve} /> : null}
      <div className="mt-3 grid gap-1 rounded border border-[#e5ddd1] bg-[#faf7f1] p-2 text-xs">
        {group.items.map((item) => <div key={item.linkId} className="flex flex-wrap justify-between gap-2"><span>{item.itemName}</span><span className="text-[#81786e]">{item.projects.map((project) => project.name).join(', ') || 'No active project'}</span></div>)}
      </div>
      {error ? <p role="alert" className="mt-3 text-xs font-semibold text-[#a33d31]">{error}</p> : null}
      {canManage ? <div className="mt-4 flex flex-wrap justify-end gap-2">
        {actionable ? <Button type="button" variant="outline" disabled={pendingDecision !== null} onClick={() => onDecision('declined')}>{pendingDecision === 'declined' ? <LoaderCircle className="size-4 animate-spin" /> : <XCircle className="size-4" />}Decline revision</Button> : null}
        {group.status === 'review' ? <Button type="button" disabled={pendingDecision !== null} onClick={() => onDecision('applied')}>{pendingDecision === 'applied' ? <LoaderCircle className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}Approve group</Button> : null}
        {group.status === 'declined' && group.reconsiderable ? <Button type="button" variant="outline" disabled={pendingDecision !== null} onClick={() => onDecision('reconsider')}>{pendingDecision === 'reconsider' ? <LoaderCircle className="size-4 animate-spin" /> : null}Reconsider</Button> : null}
      </div> : null}
    </section>
  )
}
