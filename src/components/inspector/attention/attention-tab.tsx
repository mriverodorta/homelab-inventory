import { ArrowUpRight, BellRing, CircleAlert, CloudDownload, ShieldAlert, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSystemAttention } from '@/hooks/use-systems'
import { cn } from '@/lib/utils'
import type { SystemsAttentionFinding, SystemsHostType } from '@/types/systems'

const CATEGORY = {
  registry: { label: 'Registry', action: 'Review update', icon: CloudDownload },
  audit: { label: 'Audit and compatibility', action: 'Open audit', icon: ShieldAlert },
  notification: { label: 'Notification incident', action: 'Open notifications', icon: BellRing },
} as const

export type AttentionActions = Readonly<{
  onOpenAudit?: () => void
  onOpenNotifications?: () => void
  onOpenRegistryUpdates?: () => void
}>

function Finding({ finding, actions }: { finding: SystemsAttentionFinding; actions: AttentionActions }) {
  const category = CATEGORY[finding.category]
  const Icon = category.icon
  const openDestination = finding.category === 'registry'
    ? actions.onOpenRegistryUpdates
    : finding.category === 'audit'
      ? actions.onOpenAudit
      : actions.onOpenNotifications
  return (
    <article className="border-b border-[#e5dccf] py-3 last:border-b-0">
      <div className="flex items-start gap-3">
        <span className={cn('mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-[#f1ece4] text-[#6f6559]', finding.severity === 'error' || finding.severity === 'critical' ? 'bg-[#f8e3df] text-[#9a4137]' : finding.severity === 'warning' && 'bg-[#f8edcf] text-[#8a6217]')}>
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-sm font-semibold text-[#20242c]">{finding.title}</h3>
            <span className="text-[11px] font-medium text-[#81786e]">{category.label}</span>
          </div>
          <p className="mt-1 text-xs leading-5 text-[#625b53]">{finding.description}</p>
          {openDestination ? (
            <Button type="button" variant="ghost" size="sm" className="mt-2 h-7 px-2 text-xs" onClick={openDestination}>
              {category.action}
              <ArrowUpRight className="size-3.5" />
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  )
}

export function AttentionTab({ projectId, hostType, hostId, actions }: { projectId: number; hostType: SystemsHostType; hostId: number; actions: AttentionActions }) {
  const attention = useSystemAttention(projectId, hostType, hostId, true)
  if (attention.isPending) return <div className="space-y-3" aria-label="Loading attention items">{[0, 1, 2].map((index) => <div key={index} className="h-16 animate-pulse rounded-md bg-[#eee9e1]" />)}</div>
  if (attention.isError) return <div role="alert" className="flex gap-2 rounded-md border border-[#dfb3a5] bg-[#fff4ee] p-3 text-sm text-[#613126]"><CircleAlert className="mt-0.5 size-4 shrink-0" /><span>{attention.error instanceof Error ? attention.error.message : 'Attention items could not be loaded.'}</span></div>
  const findings = attention.data?.findings ?? []
  if (!findings.length) return <div className="grid min-h-40 place-items-center text-center"><div><TriangleAlert className="mx-auto size-6 text-[#9a8f81]" /><p className="mt-3 text-sm font-semibold text-[#20242c]">No attention items</p><p className="mt-1 text-xs text-[#756d62]">This system has no registry, audit, or notification findings.</p></div></div>
  return <div>{findings.map((finding) => <Finding key={finding.id} finding={finding} actions={actions} />)}</div>
}
