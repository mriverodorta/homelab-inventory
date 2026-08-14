import { useQuery } from '@tanstack/react-query'
import { Bell, Check, CloudDownload, RefreshCw, TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useNotificationIncidents, useNotificationMutations } from '@/hooks/use-notifications'
import { usePermission } from '@/hooks/use-permission'
import { loadCatalogUpdates } from '@/lib/registry-api'
import type { NotificationIncidentPage } from '@/types/notifications'

function relativeTime(value: string) {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86_400)}d ago`
}

function IncidentList({ data, active, canManage }: { data: NotificationIncidentPage; active: boolean; canManage: boolean }) {
  const mutations = useNotificationMutations()
  const incidents = data.incidents.filter((incident) => active ? incident.state === 'open' : incident.state !== 'open')
  if (incidents.length === 0) return <div className="grid min-h-56 place-items-center p-8 text-center"><div><Bell className="mx-auto size-6 text-[#9a8f81]" /><p className="mt-3 text-sm font-black text-[#20242c]">{active ? 'No active incidents' : 'No incident history'}</p><p className="mt-1 text-xs leading-5 text-[#756d62]">{active ? 'Agent state changes that need attention will appear here.' : 'Resolved incidents remain available according to your retention policy.'}</p></div></div>
  return <div>{incidents.map((incident) => {
    const deliveries = data.deliveries.filter((delivery) => delivery.incidentId === incident.id)
    const exhausted = deliveries.filter((delivery) => delivery.state === 'exhausted')
    return <article key={incident.id} className="border-b border-[#e8e1d6] p-4 last:border-b-0">
      <div className="flex items-start gap-3"><span className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md ${incident.severity === 'critical' ? 'bg-[#fff0eb] text-[#9b3f32]' : incident.severity === 'warning' ? 'bg-[#fff2c7] text-[#7a5518]' : 'bg-[#e6f1ef] text-[#315f55]'}`}><TriangleAlert className="size-4" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-black text-[#20242c]">{incident.title}</h3><Badge variant="outline">{incident.severity}</Badge>{incident.state !== 'open' ? <Badge variant="secondary">{incident.state === 'cancelled' ? 'Cancelled' : 'Resolved'}</Badge> : null}{incident.acknowledgedAt ? <Badge variant="secondary">Acknowledged</Badge> : null}</div><p className="mt-1 text-xs leading-5 text-[#756d62]">{incident.summary}</p><p className="mt-2 text-[11px] font-semibold text-[#8a8175]">{incident.hostType} {incident.hostId} · {relativeTime(incident.openedAt)}</p></div></div>
      {active && canManage && !incident.acknowledgedAt ? <div className="mt-3 flex justify-end"><Button size="sm" variant="outline" disabled={mutations.acknowledge.isPending} onClick={() => mutations.acknowledge.mutate(incident.id)}><Check />Acknowledge</Button></div> : null}
      {canManage && exhausted.map((delivery) => <div key={delivery.id} className="mt-3 flex items-center justify-between gap-3 rounded-md border border-[#dfb3a5] bg-[#fff4ee] p-3"><p className="min-w-0 text-xs font-semibold text-[#7a2c1d]">Delivery failed after {delivery.attempts} attempts.</p><Button size="sm" variant="outline" disabled={mutations.retry.isPending} onClick={() => mutations.retry.mutate(delivery.id)}><RefreshCw />Retry</Button></div>)}
    </article>
  })}</div>
}

function IncidentQueryResult({
  query,
  active,
  canManage,
}: {
  query: ReturnType<typeof useNotificationIncidents>
  active: boolean
  canManage: boolean
}) {
  if (query.isLoading) return <div className="grid min-h-56 place-items-center"><RefreshCw className="size-5 animate-spin text-[#756d62]" /></div>
  if (query.isError || !query.data) return <p role="alert" className="m-4 rounded-md border border-[#dfb3a5] bg-[#fff4ee] p-3 text-sm font-semibold text-[#7a2c1d]">{query.error instanceof Error ? query.error.message : 'Incidents could not be loaded.'}</p>
  const data = {
    incidents: [...new Map(query.data.pages.flatMap((page) => page.incidents).map((incident) => [incident.id, incident])).values()],
    deliveries: [...new Map(query.data.pages.flatMap((page) => page.deliveries).map((delivery) => [delivery.id, delivery])).values()],
    total: query.data.pages.at(-1)?.total ?? 0,
  }
  return <div><IncidentList data={data} active={active} canManage={canManage} />{query.hasNextPage ? <div className="border-t border-[#e8e1d6] p-4"><Button className="w-full" variant="outline" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{query.isFetchingNextPage ? <RefreshCw className="animate-spin" /> : null}{query.isFetchingNextPage ? 'Loading incidents' : 'Load more'}</Button></div> : null}</div>
}

function RegistryUpdateSummary({ enabled }: { enabled: boolean }) {
  const query = useQuery({ queryKey: ['registry', 'updates'], queryFn: loadCatalogUpdates, enabled })
  const run = query.data?.run
  if (!run || (run.state === 'completed' && run.appliedCount + run.reviewCount + run.blockedCount + run.skippedCount === 0)) return null
  const summary = run.state === 'failed'
    ? `Catalog revision ${run.catalogRevision} could not be evaluated. Review the Registry updates dialog to retry.`
    : `Applied ${run.appliedCount} verified ${run.appliedCount === 1 ? 'update' : 'updates'}. ${run.reviewCount + run.blockedCount} ${run.reviewCount + run.blockedCount === 1 ? 'update group requires' : 'update groups require'} review.`
  return <div className="border-b border-[#e2dbcf] bg-[#f3f8f7] px-4 py-3">
    <div className="flex items-start gap-3"><span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[#dcece8] text-[#315f55]"><CloudDownload className="size-4" /></span><div className="min-w-0"><p className="text-xs font-black text-[#20242c]">Registry catalog revision {run.catalogRevision}</p><p className="mt-1 text-xs leading-5 text-[#66716e]">{summary}</p></div></div>
  </div>
}

export function NotificationCenter({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const canManage = usePermission('notifications.manage')
  const activeQuery = useNotificationIncidents(open, 'open')
  const historyQuery = useNotificationIncidents(open, 'history')
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent side="right" className="w-full gap-0 sm:max-w-[480px]"><SheetHeader className="border-b border-[#e2dbcf] pr-14"><SheetTitle className="text-lg font-black text-[#20242c]">Notification Center</SheetTitle><SheetDescription>Agent incidents and the latest registry update run.</SheetDescription></SheetHeader>
    <RegistryUpdateSummary enabled={open} />
    <Tabs defaultValue="active" className="min-h-0 flex-1 gap-0"><TabsList variant="line" className="mx-4 mt-2"><TabsTrigger value="active">Active</TabsTrigger><TabsTrigger value="history">History</TabsTrigger></TabsList><TabsContent value="active" className="min-h-0"><ScrollArea className="h-[calc(100dvh-6.75rem)]"><IncidentQueryResult query={activeQuery} active canManage={canManage} /></ScrollArea></TabsContent><TabsContent value="history" className="min-h-0"><ScrollArea className="h-[calc(100dvh-6.75rem)]"><IncidentQueryResult query={historyQuery} active={false} canManage={canManage} /></ScrollArea></TabsContent></Tabs>
  </SheetContent></Sheet>
}
