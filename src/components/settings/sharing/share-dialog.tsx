import { useEffect, useMemo, useState } from 'react'
import { CalendarClock, Check, Eye, LockKeyhole, Radio, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import type { ShareConfiguration, ShareInput } from '@/lib/sharing-api'
import type { ProjectWorkbook } from '@/lib/workbook-api'
import type { InventoryMetadataCatalog } from '@/types/inventory-metadata'

type Draft = {
  projectId: number
  title: string
  description: string
  mutability: 'immutable' | 'replaceable'
  syncMode: 'manual' | 'synchronized'
  visibility: 'public' | 'unlisted' | 'protected'
  workspaceIds: number[]
  fieldDefinitionIds: number[]
  tagIds: number[]
  resourceSnapshotIncluded: boolean
  embedEnabled: boolean
  embedOrigins: string
  expirationType: 'indefinite' | 'duration' | 'at'
  expirationDays: number
  expiresAt: string
}

function newDraft(workbooks: readonly ProjectWorkbook[], configuration?: ShareConfiguration | null): Draft {
  const projectId = configuration?.share.projectId ?? workbooks[0]?.project.id ?? 1
  const workbook = workbooks.find(({ project }) => project.id === projectId)
  const defaultWorkspaceId = workbook?.defaultWorkspaceId ?? workbook?.workspaces[0]?.id
  return {
    projectId,
    title: configuration?.share.title ?? '',
    description: configuration?.share.description ?? '',
    mutability: configuration?.share.mutability ?? 'replaceable',
    syncMode: configuration?.share.syncMode ?? 'manual',
    visibility: configuration?.share.visibility ?? 'unlisted',
    workspaceIds: configuration?.views.map(({ workspaceId }) => workspaceId) ?? (defaultWorkspaceId ? [defaultWorkspaceId] : []),
    fieldDefinitionIds: [...(configuration?.fieldDefinitionIds ?? [])],
    tagIds: [...(configuration?.tagIds ?? [])],
    resourceSnapshotIncluded: configuration?.share.resourceSnapshotIncluded ?? false,
    embedEnabled: configuration?.share.embedEnabled ?? false,
    embedOrigins: configuration?.share.embedOrigins.join('\n') ?? '',
    expirationType: configuration?.share.expirationType ?? 'indefinite',
    expirationDays: configuration?.share.expirationDurationSeconds ? Math.max(1, Math.round(configuration.share.expirationDurationSeconds / 86_400)) : 7,
    expiresAt: configuration?.share.expiresAtMs ? new Date(configuration.share.expiresAtMs).toISOString().slice(0, 16) : '',
  }
}

function toggleId(values: number[], id: number, checked: boolean) {
  return checked ? [...new Set([...values, id])].sort((a, b) => a - b) : values.filter((value) => value !== id)
}

function toInput(draft: Draft, workbooks: readonly ProjectWorkbook[]): ShareInput {
  const workbook = workbooks.find(({ project }) => project.id === draft.projectId)
  if (!workbook) throw new Error('The selected project is unavailable.')
  const views = draft.workspaceIds.map((workspaceId) => {
    const workspace = workbook.workspaces.find(({ id }) => id === workspaceId)
    if (!workspace) throw new Error('A selected view is unavailable.')
    return { workspaceId, viewType: workspace.type }
  })
  const origins = draft.embedOrigins.split(/\s+/u).map((value) => value.trim()).filter(Boolean)
  return {
    projectId: draft.projectId,
    title: draft.title.trim(),
    description: draft.description.trim(),
    mutability: draft.mutability,
    syncMode: draft.mutability === 'immutable' ? 'manual' : draft.syncMode,
    visibility: draft.visibility,
    commentsEnabled: false,
    reactionsEnabled: false,
    embed: draft.embedEnabled ? { enabled: true, origins } : { enabled: false },
    resourceSnapshotIncluded: draft.resourceSnapshotIncluded,
    expiration: draft.expirationType === 'duration'
      ? { type: 'duration', durationSeconds: draft.expirationDays * 86_400 }
      : draft.expirationType === 'at'
        ? { type: 'at', expiresAtMs: new Date(draft.expiresAt).getTime() }
        : { type: 'indefinite' },
    views,
    fieldDefinitionIds: draft.fieldDefinitionIds,
    tagIds: draft.tagIds,
  }
}

function ChoiceButton({ selected, icon: Icon, title, description, onClick }: { selected: boolean; icon: typeof Eye; title: string; description: string; onClick(): void }) {
  return (
    <button type="button" onClick={onClick} className={`grid min-h-20 grid-cols-[20px_minmax(0,1fr)] gap-3 rounded-md border p-3 text-left transition-colors ${selected ? 'border-[#20242c] bg-[#f1eee8]' : 'border-[#ded8ce] bg-white hover:bg-[#fbf9f5]'}`}>
      <Icon className="mt-0.5 size-4" />
      <span><span className="block text-sm font-black text-[#20242c]">{title}</span><span className="mt-1 block text-xs leading-4 text-[#756d62]">{description}</span></span>
    </button>
  )
}

export function ShareDialog({ open, configuration, workbooks, metadata, busy, onOpenChange, onSave }: {
  open: boolean
  configuration?: ShareConfiguration | null
  workbooks: readonly ProjectWorkbook[]
  metadata: InventoryMetadataCatalog | null
  busy: boolean
  onOpenChange(open: boolean): void
  onSave(input: ShareInput): Promise<void>
}) {
  const [draft, setDraft] = useState(() => newDraft(workbooks, configuration))
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    setDraft(newDraft(workbooks, configuration))
    setError(null)
  }, [configuration, open, workbooks])
  const workbook = workbooks.find(({ project }) => project.id === draft.projectId)
  const selectedWorkspaces = useMemo(() => new Set(draft.workspaceIds), [draft.workspaceIds])
  const hasSystems = workbook?.workspaces.some(({ id, type }) => type === 'systems' && selectedWorkspaces.has(id)) ?? false
  const valid = draft.title.trim().length > 0
    && draft.workspaceIds.length > 0
    && (draft.expirationType !== 'duration' || draft.expirationDays > 0)
    && (draft.expirationType !== 'at' || Number.isFinite(new Date(draft.expiresAt).getTime()))
    && (!draft.embedEnabled || draft.visibility !== 'protected' || draft.embedOrigins.trim().length > 0)

  async function save() {
    setError(null)
    try {
      await onSave(toInput(draft, workbooks))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The share could not be saved.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid max-h-[min(860px,calc(100dvh-2rem))] max-w-3xl grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-[#e8e1d6] px-5 py-4 text-left">
          <DialogTitle>{configuration ? 'Edit share' : 'Create share'}</DialogTitle>
          <DialogDescription>Select the exact project views and optional metadata that may be published to lab.gd.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-6 overflow-y-auto p-5">
          <section className="grid gap-3">
            <h3 className="text-sm font-black text-[#20242c]">Post</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-xs font-bold text-[#554b40]">Project<Select value={String(draft.projectId)} disabled={Boolean(configuration)} onValueChange={(value) => setDraft(newDraft(workbooks.filter(({ project }) => project.id === Number(value)), null))}><SelectTrigger className="bg-white"><SelectValue /></SelectTrigger><SelectContent>{workbooks.map(({ project }) => <SelectItem key={project.id} value={String(project.id)}>{project.name}</SelectItem>)}</SelectContent></Select></label>
              <label className="grid gap-1.5 text-xs font-bold text-[#554b40]">Title<Input value={draft.title} maxLength={160} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} /></label>
            </div>
            <label className="grid gap-1.5 text-xs font-bold text-[#554b40]">Description<Textarea value={draft.description} maxLength={10_000} rows={4} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} /></label>
          </section>

          <section className="grid gap-3 border-t border-[#e8e1d6] pt-5">
            <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-black text-[#20242c]">Views</h3><Button type="button" variant="ghost" size="sm" onClick={() => setDraft((current) => ({ ...current, workspaceIds: workbook?.workspaces.map(({ id }) => id) ?? [] }))}>Select whole project</Button></div>
            <div className="grid gap-2 sm:grid-cols-2">
              {workbook?.workspaces.map((workspace) => <label key={workspace.id} className="flex items-start gap-3 rounded-md border border-[#ded8ce] p-3 text-sm font-bold text-[#403a33]"><Checkbox checked={selectedWorkspaces.has(workspace.id)} onCheckedChange={(checked) => setDraft((current) => ({ ...current, workspaceIds: toggleId(current.workspaceIds, workspace.id, checked === true) }))} /><span>{workspace.name}<span className="mt-0.5 block text-xs font-normal text-[#756d62]">{workspace.type === 'canvas' ? 'Diagram and saved cable routes' : 'Read-only systems table'}</span></span></label>)}
            </div>
          </section>

          <section className="grid gap-3 border-t border-[#e8e1d6] pt-5">
            <h3 className="text-sm font-black text-[#20242c]">Publication</h3>
            <div className="grid gap-2 sm:grid-cols-2"><ChoiceButton selected={draft.mutability === 'replaceable'} icon={RefreshCw} title="Replaceable" description="Keep one share link and replace its current revision." onClick={() => setDraft((current) => ({ ...current, mutability: 'replaceable' }))} /><ChoiceButton selected={draft.mutability === 'immutable'} icon={Check} title="Immutable" description="Publish one fixed snapshot that never changes." onClick={() => setDraft((current) => ({ ...current, mutability: 'immutable', syncMode: 'manual' }))} /></div>
            {draft.mutability === 'replaceable' ? <label className="grid gap-1.5 text-xs font-bold text-[#554b40]">Updates<Select value={draft.syncMode} onValueChange={(value) => setDraft((current) => ({ ...current, syncMode: value as Draft['syncMode'] }))}><SelectTrigger className="w-full bg-white sm:w-72"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="manual">Manual update</SelectItem><SelectItem value="synchronized">Synchronize after one minute</SelectItem></SelectContent></Select></label> : null}
          </section>

          <section className="grid gap-3 border-t border-[#e8e1d6] pt-5">
            <h3 className="text-sm font-black text-[#20242c]">Access</h3>
            <div className="grid gap-2 sm:grid-cols-3"><ChoiceButton selected={draft.visibility === 'public'} icon={Radio} title="Public" description="Discoverable and accessible without a password." onClick={() => setDraft((current) => ({ ...current, visibility: 'public' }))} /><ChoiceButton selected={draft.visibility === 'unlisted'} icon={Eye} title="Unlisted" description="Accessible only to people with the generated link." onClick={() => setDraft((current) => ({ ...current, visibility: 'unlisted' }))} /><ChoiceButton selected={draft.visibility === 'protected'} icon={LockKeyhole} title="Password" description="Requires a share password before any content is revealed." onClick={() => setDraft((current) => ({ ...current, visibility: 'protected' }))} /></div>
            {draft.visibility === 'protected' ? <p role="status" className="rounded-md border border-[#e0bd86] bg-[#fff8e8] p-3 text-xs leading-5 text-[#6f4d16]">Protected publication remains blocked until lab.gd exposes the installation-authenticated password handoff. The password will never be stored by this app.</p> : null}
            <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1.5 text-xs font-bold text-[#554b40]">Expiration<Select value={draft.expirationType} onValueChange={(value) => setDraft((current) => ({ ...current, expirationType: value as Draft['expirationType'] }))}><SelectTrigger className="bg-white"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="indefinite">No expiration</SelectItem><SelectItem value="duration">Duration</SelectItem><SelectItem value="at">Specific date</SelectItem></SelectContent></Select></label>{draft.expirationType === 'duration' ? <label className="grid gap-1.5 text-xs font-bold text-[#554b40]">Days<Input type="number" min={1} max={3650} value={draft.expirationDays} onChange={(event) => setDraft((current) => ({ ...current, expirationDays: Number(event.target.value) }))} /></label> : null}{draft.expirationType === 'at' ? <label className="grid gap-1.5 text-xs font-bold text-[#554b40]">Delete after<Input type="datetime-local" value={draft.expiresAt} onChange={(event) => setDraft((current) => ({ ...current, expiresAt: event.target.value }))} /></label> : null}</div>
          </section>

          <section className="grid gap-3 border-t border-[#e8e1d6] pt-5">
            <h3 className="text-sm font-black text-[#20242c]">Optional data</h3>
            <p className="text-xs leading-5 text-[#756d62]">Tags, custom fields, and current resource usage are excluded by default.</p>
            {metadata?.tags.length ? <fieldset className="grid gap-2"><legend className="text-xs font-bold text-[#554b40]">Tags</legend><div className="flex flex-wrap gap-x-5 gap-y-2">{metadata.tags.filter(({ archivedAt }) => !archivedAt).map((tag) => <label key={tag.id} className="flex items-center gap-2 text-sm text-[#403a33]"><Checkbox checked={draft.tagIds.includes(tag.id)} onCheckedChange={(checked) => setDraft((current) => ({ ...current, tagIds: toggleId(current.tagIds, tag.id, checked === true) }))} />{tag.name}</label>)}</div></fieldset> : null}
            {metadata?.definitions.length ? <fieldset className="grid gap-2"><legend className="text-xs font-bold text-[#554b40]">Custom fields</legend><div className="grid gap-2 sm:grid-cols-2">{metadata.definitions.filter(({ archivedAt }) => !archivedAt).map((field) => <label key={field.id} className="flex items-center gap-2 text-sm text-[#403a33]"><Checkbox checked={draft.fieldDefinitionIds.includes(field.id)} onCheckedChange={(checked) => setDraft((current) => ({ ...current, fieldDefinitionIds: toggleId(current.fieldDefinitionIds, field.id, checked === true) }))} />{field.name}</label>)}</div></fieldset> : null}
            <label className={`flex items-start justify-between gap-4 rounded-md border border-[#ded8ce] p-3 ${hasSystems ? '' : 'opacity-60'}`}><span><span className="block text-sm font-black text-[#20242c]">Current resource usage</span><span className="mt-1 block text-xs leading-4 text-[#756d62]">Capture CPU, memory, and storage once. Normal share updates do not refresh it.</span></span><Switch checked={draft.resourceSnapshotIncluded} disabled={!hasSystems} onCheckedChange={(checked) => setDraft((current) => ({ ...current, resourceSnapshotIncluded: checked }))} /></label>
          </section>

          <section className="grid gap-3 border-t border-[#e8e1d6] pt-5">
            <h3 className="text-sm font-black text-[#20242c]">Embed</h3>
            <label className="flex items-center justify-between gap-4"><span><span className="block text-sm font-black text-[#20242c]">Allow iframe embeds</span><span className="mt-1 block text-xs text-[#756d62]">Use the restricted lab.gd embed layout for documentation.</span></span><Switch checked={draft.embedEnabled} onCheckedChange={(checked) => setDraft((current) => ({ ...current, embedEnabled: checked }))} /></label>
            {draft.embedEnabled ? <label className="grid gap-1.5 text-xs font-bold text-[#554b40]">Allowed HTTPS origins <span className="font-normal text-[#756d62]">One exact origin per line. Leave empty only for non-protected shares that may embed anywhere.</span><Textarea value={draft.embedOrigins} rows={3} placeholder="https://wiki.example.com" onChange={(event) => setDraft((current) => ({ ...current, embedOrigins: event.target.value }))} /></label> : null}
          </section>

          <section className="grid gap-2 border-t border-[#e8e1d6] pt-5 text-sm text-[#756d62]"><p className="flex items-center gap-2"><CalendarClock className="size-4" />Comments and reactions are under development.</p><p>Abuse reporting, QR codes, deep links, and embed controls are provided by lab.gd after publication.</p></section>
          {error ? <p role="alert" className="rounded-md border border-[#dfb3a5] bg-[#fff4ee] p-3 text-sm font-semibold text-[#7a2c1d]">{error}</p> : null}
        </div>
        <DialogFooter className="border-t border-[#e8e1d6] bg-[#fbf9f5] px-5 py-4"><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button><Button type="button" onClick={() => void save()} disabled={!valid || busy}>{busy ? 'Saving…' : configuration ? 'Save changes' : 'Create share'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
