import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, CloudDownload, LoaderCircle, Search, ShieldAlert, XCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { usePermission } from '@/hooks/use-permission'
import { decideCatalogUpdateGroups, loadCatalogUpdates, retryCatalogUpdates } from '@/lib/registry-api'
import type { CatalogUpdateGroup } from '@/types/registry'

const EMPTY_GROUPS: CatalogUpdateGroup[] = []
const REASON_LABELS: Record<string, string> = {
  'verified-compatible': 'Verified compatible',
  'identity-change': 'Product identity changed',
  'assignment-conflict': 'Assigned hardware conflicts',
  'connected-port-change': 'Connected port changed',
  'structural-validation-failed': 'Topology validation failed',
  'new-compatibility-findings': 'New compatibility findings',
}

function formatChangeValue(value: unknown) {
  if (value === undefined) return 'Not recorded'
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}

function UpdateGroupCard({ group, busy, canManage, selected, onSelectedChange, onDecision }: {
  group: CatalogUpdateGroup
  busy: boolean
  canManage: boolean
  selected: boolean
  onSelectedChange: (selected: boolean) => void
  onDecision: (decision: 'applied' | 'declined' | 'reconsider') => void
}) {
  return (
    <section className="rounded-md border border-[#ded8ce] bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {group.status === 'review' && canManage ? (
            <Checkbox
              className="mt-0.5"
              checked={selected}
              disabled={busy}
              onCheckedChange={(checked) => onSelectedChange(checked === true)}
              aria-label={`Select ${group.items[0]?.itemName ?? group.templateKey}`}
            />
          ) : null}
          <div className="min-w-0">
            <h3 className="text-sm font-black text-[#28231f]">{group.items[0]?.itemName ?? group.templateKey}</h3>
            <p className="mt-1 text-xs text-[#746b60]">Revision {group.fromRevision} to {group.toRevision} · {group.items.length} linked {group.items.length === 1 ? 'item' : 'items'}</p>
          </div>
        </div>
        <Badge variant={group.classification === 'blocked' ? 'destructive' : 'secondary'}>{group.classification}</Badge>
      </div>
      {group.reasons.length > 0 ? <p className="mt-3 text-xs leading-5 text-[#675f56]">{group.reasons.map((reason) => REASON_LABELS[reason] ?? reason).join(' · ')}</p> : null}
      {group.changes.length > 0 ? (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer font-bold text-[#3c655d]">Review {group.changes.length} catalog changes</summary>
          <div className="mt-2 grid gap-2">
            {group.changes.map((change) => (
              <div key={change.field} className="rounded border border-[#e5ddd1] bg-[#f7f2e9] p-2">
                <strong>{change.field}</strong>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div><span className="font-bold text-[#81786e]">Current</span><pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px]">{formatChangeValue(change.current)}</pre></div>
                  <div><span className="font-bold text-[#3c655d]">Proposed</span><pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px]">{formatChangeValue(change.next)}</pre></div>
                </div>
              </div>
            ))}
          </div>
        </details>
      ) : null}
      <details className="mt-3 text-xs">
        <summary className="cursor-pointer font-bold text-[#3c655d]">Affected inventory and projects</summary>
        <div className="mt-2 grid gap-1 rounded border border-[#e5ddd1] bg-[#faf7f1] p-2">
          {group.items.map((item) => (
            <div key={item.linkId} className="flex flex-wrap justify-between gap-2">
              <span>{item.itemName}</span>
              <span className="text-[#81786e]">{item.projects.map((project) => project.name).join(', ') || 'No active project'}</span>
            </div>
          ))}
        </div>
      </details>
      {canManage ? <div className="mt-4 flex flex-wrap justify-end gap-2">
        {group.status === 'review' ? (
          <>
            <Button type="button" variant="outline" disabled={busy} onClick={() => onDecision('declined')}><XCircle className="size-4" />Decline revision</Button>
            <Button type="button" disabled={busy || group.classification === 'blocked'} onClick={() => onDecision('applied')}><CheckCircle2 className="size-4" />Approve group</Button>
          </>
        ) : group.status === 'declined' ? (
          <Button type="button" variant="outline" disabled={busy} onClick={() => onDecision('reconsider')}>Reconsider</Button>
        ) : null}
      </div> : null}
    </section>
  )
}

export function RegistryUpdatesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient()
  const canManageRegistry = usePermission('registry.manage')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [project, setProject] = useState('all')
  const [reason, setReason] = useState('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const query = useQuery({ queryKey: ['registry', 'updates'], queryFn: loadCatalogUpdates, enabled: open })
  const decision = useMutation({
    mutationFn: decideCatalogUpdateGroups,
    onSuccess: async () => {
      setSelectedIds(new Set())
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['registry', 'updates'] }),
        queryClient.invalidateQueries({ queryKey: ['registry'] }),
        queryClient.invalidateQueries({ queryKey: ['project'] }),
      ])
    },
  })
  const retry = useMutation({
    mutationFn: retryCatalogUpdates,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['registry', 'updates'] })
    },
  })
  const groups = query.data?.groups ?? EMPTY_GROUPS
  const categories = useMemo(() => [...new Set(groups.flatMap((group) => group.items.map((item) => item.itemType)))].sort(), [groups])
  const projects = useMemo(() => [...new Map(groups.flatMap((group) => group.projects).map((entry) => [entry.id, entry])).values()].sort((left, right) => left.name.localeCompare(right.name)), [groups])
  const reasons = useMemo(() => [...new Set(groups.flatMap((group) => group.reasons))].sort(), [groups])
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return groups.filter((group) => (
      (!needle || `${group.templateKey} ${group.items.map((item) => item.itemName).join(' ')}`.toLowerCase().includes(needle))
      && (category === 'all' || group.items.some((item) => item.itemType === category))
      && (project === 'all' || group.projects.some((entry) => String(entry.id) === project))
      && (reason === 'all' || group.reasons.includes(reason))
    ))
  }, [category, groups, project, reason, search])
  const counts = Object.fromEntries(['review', 'applied', 'declined'].map((status) => [status, groups.filter((group) => group.status === status).length]))
  const reviewGroups = filtered.filter((group) => group.status === 'review')
  const selectedGroups = reviewGroups.filter((group) => selectedIds.has(group.id))
  const selectedHasBlocked = selectedGroups.some((group) => group.classification === 'blocked')
  const decide = (selected: CatalogUpdateGroup[], nextDecision: 'applied' | 'declined' | 'reconsider') => {
    decision.mutate({
      groups: selected.map((group) => ({ templateKey: group.templateKey, toRevision: group.toRevision })),
      decision: nextDecision,
    })
  }
  const selectGroup = (id: string, selected: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (selected) next.add(id)
      else next.delete(id)
      return next
    })
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(860px,calc(100dvh-2rem))] flex-col overflow-hidden bg-[#fffdf8] sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CloudDownload className="size-5" />Registry updates</DialogTitle>
          <DialogDescription>Safe signed updates apply automatically. Review only changes that can affect identity, compatibility, or topology.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative sm:col-span-2 lg:col-span-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#81786e]" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search linked hardware" className="pl-9" /></div>
          <Select value={category} onValueChange={setCategory}><SelectTrigger aria-label="Filter by category"><SelectValue placeholder="All categories" /></SelectTrigger><SelectContent><SelectItem value="all">All categories</SelectItem>{categories.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select>
          <Select value={project} onValueChange={setProject}><SelectTrigger aria-label="Filter by project"><SelectValue placeholder="All projects" /></SelectTrigger><SelectContent><SelectItem value="all">All projects</SelectItem>{projects.map((value) => <SelectItem key={value.id} value={String(value.id)}>{value.name}</SelectItem>)}</SelectContent></Select>
          <Select value={reason} onValueChange={setReason}><SelectTrigger aria-label="Filter by reason"><SelectValue placeholder="All reasons" /></SelectTrigger><SelectContent><SelectItem value="all">All reasons</SelectItem>{reasons.map((value) => <SelectItem key={value} value={value}>{REASON_LABELS[value] ?? value}</SelectItem>)}</SelectContent></Select>
        </div>
        {decision.error ? <p role="alert" className="text-sm font-semibold text-[#a33d31]">{decision.error instanceof Error ? decision.error.message : 'Update decision failed.'}</p> : null}
        {query.error ? <p role="alert" className="text-sm font-semibold text-[#a33d31]">{query.error instanceof Error ? query.error.message : 'Registry updates could not be loaded.'}</p> : null}
        {retry.error ? <p role="alert" className="text-sm font-semibold text-[#a33d31]">{retry.error instanceof Error ? retry.error.message : 'Registry update retry failed.'}</p> : null}
        {query.data?.run?.state === 'failed' ? (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-[#e1b8ae] bg-[#fff4f1] px-3 py-2 text-sm text-[#7e3027]">
            <ShieldAlert className="size-4 shrink-0" />
            <span className="mr-auto"><strong>Catalog revision {query.data.run.catalogRevision} could not be evaluated.</strong> {query.data.run.error}</span>
            {canManageRegistry ? <Button type="button" size="sm" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate()}>{retry.isPending ? <LoaderCircle className="size-4 animate-spin" /> : null}Retry evaluation</Button> : null}
          </div>
        ) : null}
        {canManageRegistry && selectedGroups.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-[#d8d1c6] bg-[#f7f2e9] px-3 py-2">
            <span className="mr-auto text-xs font-bold text-[#554d45]">{selectedGroups.length} selected</span>
            <Button type="button" size="sm" variant="outline" disabled={decision.isPending} onClick={() => decide(selectedGroups, 'declined')}>
              <XCircle className="size-4" />Decline selected
            </Button>
            <Button type="button" size="sm" disabled={decision.isPending || selectedHasBlocked} onClick={() => decide(selectedGroups, 'applied')}>
              {decision.isPending ? <LoaderCircle className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}Approve selected
            </Button>
          </div>
        ) : null}
        <Tabs defaultValue="review" className="flex min-h-0 flex-1 flex-col">
          <TabsList className="w-fit">
            <TabsTrigger value="review">Review {counts.review}</TabsTrigger>
            <TabsTrigger value="applied">Applied {counts.applied}</TabsTrigger>
            <TabsTrigger value="declined">Declined {counts.declined}</TabsTrigger>
          </TabsList>
          {(['review', 'applied', 'declined'] as const).map((status) => (
            <TabsContent key={status} value={status} className="min-h-0 flex-1 overflow-y-auto pr-1">
              <div className="grid gap-3 py-2">
                {status === 'review' && canManageRegistry && reviewGroups.length > 0 ? (
                  <label className="flex w-fit items-center gap-2 px-1 text-xs font-bold text-[#554d45]">
                    <Checkbox
                      checked={reviewGroups.every((group) => selectedIds.has(group.id))}
                      disabled={decision.isPending}
                      onCheckedChange={(checked) => {
                        const selected = checked === true
                        setSelectedIds((current) => {
                          const next = new Set(current)
                          for (const group of reviewGroups) {
                            if (selected) next.add(group.id)
                            else next.delete(group.id)
                          }
                          return next
                        })
                      }}
                    />
                    Select all visible review groups
                  </label>
                ) : null}
                {query.isLoading ? <p className="py-8 text-center text-sm text-[#746b60]">Loading registry updates…</p> : null}
                {!query.isLoading && filtered.filter((group) => group.status === status).length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-[#746b60]">{status === 'review' ? <CheckCircle2 className="size-6 text-[#3c746a]" /> : <ShieldAlert className="size-6" />}No {status} updates.</div>
                ) : null}
                {filtered.filter((group) => group.status === status).map((group) => (
                  <UpdateGroupCard
                    key={group.id}
                    group={group}
                    busy={decision.isPending}
                    canManage={canManageRegistry}
                    selected={selectedIds.has(group.id)}
                    onSelectedChange={(selected) => selectGroup(group.id, selected)}
                    onDecision={(nextDecision) => decide([group], nextDecision)}
                  />
                ))}
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
