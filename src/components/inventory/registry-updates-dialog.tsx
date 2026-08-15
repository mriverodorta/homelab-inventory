import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, CloudDownload, LoaderCircle, ShieldAlert, XCircle } from 'lucide-react'
import { useDeferredValue, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { usePermission } from '@/hooks/use-permission'
import {
  decideCatalogUpdateGroups,
  loadCatalogUpdateGroups,
  loadCatalogUpdateSummary,
  resolveAndApplyCatalogUpdateGroup,
  retryCatalogUpdates,
} from '@/lib/registry-api'
import type { CatalogUpdateDecisionResult, CatalogUpdateGroup, CatalogUpdateGroupDetail, CatalogUpdateSummaryResponse } from '@/types/registry'
import { RegistryUpdateFilters, type RegistryUpdateFiltersValue } from './registry-update-filters'
import { RegistryUpdateGroupCard } from './registry-update-group-card'
import { RegistryUpdateResolutionDialog } from './registry-update-resolution-dialog'

const REASON_LABELS: Record<string, string> = {
  'verified-compatible': 'Verified compatible',
  'identity-change': 'Product identity changed',
  'assignment-conflict': 'Assigned hardware conflicts',
  'connected-port-change': 'Connected port changed',
  'structural-validation-failed': 'Topology validation failed',
  'new-compatibility-findings': 'New compatibility findings',
}
const EMPTY_FILTERS: RegistryUpdateFiltersValue = { search: '', category: 'all', project: 'all', reason: 'all' }
const STATUSES = ['review', 'blocked', 'applied', 'declined'] as const
type UpdateStatus = typeof STATUSES[number]

export function RegistryUpdatesDialog({ open, onOpenChange, onApplied }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onApplied?: (result: CatalogUpdateDecisionResult) => Promise<void>
}) {
  const queryClient = useQueryClient()
  const canManageRegistry = usePermission('registry.manage')
  const [status, setStatus] = useState<UpdateStatus>('review')
  const [filters, setFilters] = useState<RegistryUpdateFiltersValue>(EMPTY_FILTERS)
  const deferredSearch = useDeferredValue(filters.search.trim())
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [pendingDecisions, setPendingDecisions] = useState<Map<string, 'applied' | 'declined' | 'reconsider'>>(new Map())
  const [groupErrors, setGroupErrors] = useState<Map<string, string>>(new Map())
  const [resolution, setResolution] = useState<{ detail: CatalogUpdateGroupDetail; linkId: number } | null>(null)
  const queryFilters = useMemo(() => ({
    status,
    query: deferredSearch || undefined,
    category: filters.category === 'all' ? undefined : filters.category,
    projectId: filters.project === 'all' ? undefined : Number(filters.project),
    reason: filters.reason === 'all' ? undefined : filters.reason,
    limit: 20,
  }), [deferredSearch, filters.category, filters.project, filters.reason, status])
  const summary = useQuery({ queryKey: ['registry', 'update-summary'], queryFn: loadCatalogUpdateSummary, enabled: open })
  const groupsQuery = useInfiniteQuery({
    queryKey: ['registry', 'update-groups', queryFilters],
    queryFn: ({ pageParam }) => loadCatalogUpdateGroups({ ...queryFilters, cursor: pageParam || undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: open,
  })
  const decision = useMutation({ mutationFn: decideCatalogUpdateGroups })
  const resolutionMutation = useMutation({ mutationFn: resolveAndApplyCatalogUpdateGroup })
  const retry = useMutation({
    mutationFn: retryCatalogUpdates,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['registry', 'update-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['registry', 'update-groups'] }),
      ])
    },
  })
  const groups = useMemo(() => groupsQuery.data?.pages.flatMap((page) => page.groups) ?? [], [groupsQuery.data])
  const categories = useMemo(() => [...new Set(groups.flatMap((group) => group.items.map((item) => item.itemType)))].sort(), [groups])
  const projects = useMemo(() => [...new Map(groups.flatMap((group) => group.projects).map((project) => [project.id, project])).values()].sort((left, right) => left.name.localeCompare(right.name)), [groups])
  const reasons = useMemo(() => [...new Set(groups.flatMap((group) => group.reasons))].sort(), [groups])
  const selectedGroups = groups.filter((group) => selectedIds.has(group.id))
  const reconcileResult = async (result: CatalogUpdateDecisionResult) => {
    queryClient.setQueryData<CatalogUpdateSummaryResponse>(['registry', 'update-summary'], result.summary)
    await queryClient.invalidateQueries({ queryKey: ['registry', 'update-groups'] })
    if (result.affectedProjectIds.length > 0) await onApplied?.(result)
  }
  const decide = async (selected: CatalogUpdateGroup[], nextDecision: 'applied' | 'declined' | 'reconsider') => {
    const ids = selected.map((group) => group.id)
    if (ids.length === 0 || ids.some((id) => pendingDecisions.has(id))) return
    setPendingDecisions((current) => new Map([...current, ...ids.map((id) => [id, nextDecision] as const)]))
    setGroupErrors((current) => {
      const next = new Map(current)
      ids.forEach((id) => next.delete(id))
      return next
    })
    try {
      const result = await decision.mutateAsync({
        groups: selected.map((group) => ({ groupId: group.id, concurrencyToken: group.concurrencyToken })),
        decision: nextDecision,
      })
      await reconcileResult(result)
      setSelectedIds((current) => {
        const next = new Set(current)
        ids.forEach((id) => next.delete(id))
        return next
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Update decision failed.'
      setGroupErrors((current) => new Map([...current, ...ids.map((id) => [id, message] as const)]))
    } finally {
      setPendingDecisions((current) => {
        const next = new Map(current)
        ids.forEach((id) => next.delete(id))
        return next
      })
    }
  }
  const resolve = async () => {
    if (!resolution) return
    setGroupErrors((current) => {
      const next = new Map(current)
      next.delete(resolution.detail.id)
      return next
    })
    try {
      const result = await resolutionMutation.mutateAsync({
        groupId: resolution.detail.id,
        concurrencyToken: resolution.detail.concurrencyToken,
        linkId: resolution.linkId,
      })
      await reconcileResult(result)
      setResolution(null)
    } catch (error) {
      setGroupErrors((current) => new Map(current).set(resolution.detail.id, error instanceof Error ? error.message : 'Topology resolution failed.'))
    }
  }
  const counts = summary.data?.counts ?? { review: 0, blocked: 0, applied: 0, declined: 0 }
  const actionable = status === 'review' || status === 'blocked'
  const selectGroup = (id: string, selected: boolean) => setSelectedIds((current) => {
    const next = new Set(current)
    if (selected) next.add(id)
    else next.delete(id)
    return next
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(900px,calc(100dvh-2rem))] flex-col overflow-hidden bg-[#fffdf8] sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CloudDownload className="size-5" />Registry updates</DialogTitle>
          <DialogDescription>Safe signed updates apply automatically. Review identity, compatibility, and topology changes that need a decision.</DialogDescription>
        </DialogHeader>
        <RegistryUpdateFilters value={filters} categories={categories} projects={projects} reasons={reasons} reasonLabels={REASON_LABELS} onChange={setFilters} />
        {summary.error || groupsQuery.error ? <p role="alert" className="text-sm font-semibold text-[#a33d31]">{(summary.error ?? groupsQuery.error) instanceof Error ? (summary.error ?? groupsQuery.error)?.message : 'Registry updates could not be loaded.'}</p> : null}
        {retry.error ? <p role="alert" className="text-sm font-semibold text-[#a33d31]">{retry.error instanceof Error ? retry.error.message : 'Registry update retry failed.'}</p> : null}
        {summary.data?.run?.state === 'failed' ? <div className="flex flex-wrap items-center gap-3 rounded-md border border-[#e1b8ae] bg-[#fff4f1] px-3 py-2 text-sm text-[#7e3027]"><ShieldAlert className="size-4 shrink-0" /><span className="mr-auto"><strong>Catalog revision {summary.data.run.catalogRevision} could not be evaluated.</strong> {summary.data.run.error}</span>{canManageRegistry ? <Button type="button" size="sm" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate()}>{retry.isPending ? <LoaderCircle className="size-4 animate-spin" /> : null}Retry evaluation</Button> : null}</div> : null}
        {canManageRegistry && selectedGroups.length > 0 ? <div className="flex flex-wrap items-center gap-2 rounded-md border border-[#d8d1c6] bg-[#f7f2e9] px-3 py-2"><span className="mr-auto text-xs font-bold text-[#554d45]">{selectedGroups.length} selected</span><Button type="button" size="sm" variant="outline" disabled={selectedGroups.some((group) => pendingDecisions.has(group.id))} onClick={() => void decide(selectedGroups, 'declined')}><XCircle className="size-4" />Decline selected</Button>{status === 'review' ? <Button type="button" size="sm" disabled={selectedGroups.some((group) => pendingDecisions.has(group.id))} onClick={() => void decide(selectedGroups, 'applied')}><CheckCircle2 className="size-4" />Approve selected</Button> : null}</div> : null}
        <Tabs value={status} onValueChange={(value) => { setStatus(value as UpdateStatus); setSelectedIds(new Set()) }} className="flex min-h-0 flex-1 flex-col">
          <TabsList className="w-fit"><TabsTrigger value="review">Review {counts.review}</TabsTrigger><TabsTrigger value="blocked">Blocked {counts.blocked}</TabsTrigger><TabsTrigger value="applied">Applied {counts.applied}</TabsTrigger><TabsTrigger value="declined">Declined {counts.declined}</TabsTrigger></TabsList>
          {STATUSES.map((tabStatus) => <TabsContent key={tabStatus} value={tabStatus} className="min-h-0 flex-1 overflow-y-auto pr-1"><div className="grid gap-3 py-2">
            {actionable && canManageRegistry && groups.length > 0 ? <label className="flex w-fit items-center gap-2 px-1 text-xs font-bold text-[#554d45]"><Checkbox checked={groups.every((group) => selectedIds.has(group.id))} disabled={groups.some((group) => pendingDecisions.has(group.id))} onCheckedChange={(checked) => setSelectedIds(checked === true ? new Set(groups.map((group) => group.id)) : new Set())} />Select all loaded {status} groups</label> : null}
            {groupsQuery.isLoading ? <div className="flex items-center justify-center gap-2 py-8 text-sm text-[#746b60]"><LoaderCircle className="size-4 animate-spin" />Loading registry updates...</div> : null}
            {!groupsQuery.isLoading && groups.length === 0 ? <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-[#746b60]">{tabStatus === 'review' ? <CheckCircle2 className="size-6 text-[#3c746a]" /> : <ShieldAlert className="size-6" />}No {tabStatus} updates.</div> : null}
            {groups.map((group) => <RegistryUpdateGroupCard key={group.id} group={group} pendingDecision={pendingDecisions.get(group.id) ?? null} error={groupErrors.get(group.id) ?? null} canManage={canManageRegistry} selected={selectedIds.has(group.id)} reasonLabels={REASON_LABELS} onSelectedChange={(selected) => selectGroup(group.id, selected)} onDecision={(nextDecision) => void decide([group], nextDecision)} onResolve={(detail, linkId) => setResolution({ detail, linkId })} />)}
            {groupsQuery.hasNextPage ? <Button type="button" variant="outline" className="justify-self-center" disabled={groupsQuery.isFetchingNextPage} onClick={() => void groupsQuery.fetchNextPage()}>{groupsQuery.isFetchingNextPage ? <LoaderCircle className="size-4 animate-spin" /> : null}Load more</Button> : null}
          </div></TabsContent>)}
        </Tabs>
        <RegistryUpdateResolutionDialog detail={resolution?.detail ?? null} linkId={resolution?.linkId ?? null} pending={resolutionMutation.isPending} error={resolution ? groupErrors.get(resolution.detail.id) ?? null : null} onOpenChange={(nextOpen) => { if (!nextOpen && !resolutionMutation.isPending) setResolution(null) }} onConfirm={() => void resolve()} />
      </DialogContent>
    </Dialog>
  )
}
