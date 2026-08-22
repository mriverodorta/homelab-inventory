import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Cloud, CloudOff, LoaderCircle, Plus, RotateCw, ShieldAlert, UserRoundPlus } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { SettingsSection, SettingRow } from '@/components/settings/settings-primitives'
import { usePermission } from '@/hooks/use-permission'
import { useSharing } from '@/hooks/use-sharing'
import { loadInventoryMetadataCatalog } from '@/lib/inventory-metadata-api'
import type { ShareConfiguration, ShareInput, SharePreview, ShareRecord } from '@/lib/sharing-api'
import { loadProjectWorkbooks } from '@/lib/workbook-api'
import { AccountClaimDialog } from './account-claim-dialog'
import { ShareAnalytics } from './share-analytics'
import { ShareDialog } from './share-dialog'
import { ShareList } from './share-list'
import { SharePrivacySummary } from './share-privacy-summary'

function enrollmentLabel(state: string) {
  if (state === 'connected') return 'Connected'
  if (state === 'pending') return 'Connecting'
  if (state === 'retrying') return 'Retry scheduled'
  if (state === 'recovery-pending') return 'Owner approval required'
  if (state === 'unsupported') return 'Contract unsupported'
  return 'Disconnected'
}

function EnrollmentIcon({ state }: { state: string }) {
  if (state === 'connected') return <CheckCircle2 className="size-4 text-[#2f7658]" />
  if (state === 'pending' || state === 'retrying') return <LoaderCircle className="size-4 animate-spin text-[#9a671c]" />
  if (state === 'recovery-pending' || state === 'unsupported') return <ShieldAlert className="size-4 text-[#ad4637]" />
  return <CloudOff className="size-4 text-[#756d62]" />
}

export function SharingSettings() {
  const canConfigure = usePermission('sharing.configure')
  const canPublish = usePermission('sharing.publish')
  const sharing = useSharing(canConfigure)
  const workbooks = useQuery({ queryKey: ['sharing', 'workbooks'], queryFn: loadProjectWorkbooks, enabled: sharing.settings.data?.available === true, staleTime: Infinity })
  const metadata = useQuery({ queryKey: ['inventory-metadata', 'catalog'], queryFn: () => loadInventoryMetadataCatalog(false), enabled: sharing.settings.data?.available === true, staleTime: Infinity })
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<ShareConfiguration | null>(null)
  const [previewConfiguration, setPreviewConfiguration] = useState<ShareConfiguration | null>(null)
  const [preview, setPreview] = useState<SharePreview | null>(null)
  const [pendingShareId, setPendingShareId] = useState<number | null>(null)
  const [claimOpen, setClaimOpen] = useState(false)
  const [claimResult, setClaimResult] = useState<Awaited<ReturnType<typeof sharing.claim.mutateAsync>> | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const status = sharing.settings.data
  const settings = status?.settings

  useEffect(() => {
    if (!editorOpen) setEditing(null)
  }, [editorOpen])

  if (!canConfigure || sharing.settings.isLoading) return <div className="grid min-h-52 place-items-center text-sm font-bold text-[#756d62]">Loading sharing…</div>
  if (!status?.available || !settings) return null

  async function openEditor(share?: ShareRecord) {
    setActionError(null)
    if (share) setEditing(await sharing.loadShare(share.id))
    setEditorOpen(true)
  }

  async function saveShare(input: ShareInput) {
    if (editing) await sharing.update.mutateAsync({ id: editing.share.id, expectedRevision: editing.share.localRevision, input })
    else await sharing.create.mutateAsync(input)
    setEditorOpen(false)
  }

  async function reviewShare(share: ShareRecord) {
    setActionError(null)
    try {
      const [configuration, nextPreview] = await Promise.all([sharing.loadShare(share.id), sharing.preview.mutateAsync(share.id)])
      setPreviewConfiguration(configuration)
      setPreview(nextPreview)
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'The privacy preview could not be generated.')
    }
  }

  async function approvePreview() {
    if (!preview || !previewConfiguration) return
    await sharing.approve.mutateAsync({ id: previewConfiguration.share.id, manifestHash: preview.manifestHash })
    setPreview((current) => current ? { ...current, approved: true } : current)
  }

  async function publish(share: ShareRecord) {
    setPendingShareId(share.id)
    setActionError(null)
    try {
      await sharing.publish.mutateAsync({ id: share.id, update: share.remoteRevision !== null })
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'The share could not be queued for publication.')
    } finally {
      setPendingShareId(null)
    }
  }

  async function updateSnapshot(share: ShareRecord) {
    setPendingShareId(share.id)
    try { await sharing.snapshot.mutateAsync(share.id) } finally { setPendingShareId(null) }
  }

  return (
    <div className="grid gap-6">
      <SettingsSection title="Sharing" description="Publish selected read-only project views to lab.gd without exposing the rest of this installation.">
        <SettingRow label="lab.gd connection" description="Production installations enroll automatically after startup. Publication always requires an explicit privacy review.">
          <div className="flex items-center gap-3"><span className="flex items-center gap-2 text-sm font-bold text-[#403a33]"><EnrollmentIcon state={settings.enrollmentState} />{enrollmentLabel(settings.enrollmentState)}</span><Switch aria-label="Enable lab.gd sharing" checked={settings.connectionEnabled} disabled={sharing.updateConnection.isPending} onCheckedChange={(enabled) => sharing.updateConnection.mutate({ expectedRevision: settings.revision, enabled })} /></div>
        </SettingRow>
        {settings.enrollmentState === 'retrying' ? <div className="flex items-start gap-3 border-b border-[#e8e1d6] bg-[#fff8e8] p-4 text-sm text-[#6f4d16]"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><p>lab.gd is unavailable. This app remains healthy and will retry with bounded backoff{settings.nextAttemptAtMs ? ` after ${new Date(settings.nextAttemptAtMs).toLocaleString()}` : ''}.</p></div> : null}
        {settings.enrollmentState === 'recovery-pending' ? <div className="flex items-center justify-between gap-4 border-b border-[#e8e1d6] bg-[#fff4ee] p-4"><p className="text-sm leading-5 text-[#7a2c1d]">A replacement key is waiting for owner approval. Publication is stopped and no additional replacement key will be created.</p>{canPublish ? <Button variant="outline" onClick={() => sharing.resumeRecovery.mutate()} disabled={sharing.resumeRecovery.isPending}><RotateCw />Resume recovery</Button> : null}</div> : null}
        {!settings.connectionEnabled ? <div className="flex items-start gap-3 bg-[#fff8e8] p-4 text-sm leading-5 text-[#6f4d16]"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><p>The stable local identity is retained. Unclaimed remote shares enter a 30-day grace period; lifecycle completion remains unavailable until lab.gd exposes its signed installation endpoint.</p></div> : null}
      </SettingsSection>

      {settings.connectionEnabled ? <SettingsSection title="Shares" description="Each share has its own views, privacy selections, visibility, expiration, and update policy.">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e8e1d6] p-4"><div className="flex items-center gap-2 text-sm text-[#554b40]"><Cloud className="size-4" />{sharing.shares.data?.length ?? 0} configured</div>{canPublish ? <div className="flex gap-2">{status.capabilities.accountClaiming ? <Button variant="outline" onClick={() => setClaimOpen(true)}><UserRoundPlus />Connect account</Button> : null}<Button onClick={() => void openEditor()} disabled={!workbooks.data?.length}><Plus />New share</Button></div> : null}</div>
        {actionError ? <p role="alert" className="border-b border-[#dfb3a5] bg-[#fff4ee] p-3 text-sm font-semibold text-[#7a2c1d]">{actionError}</p> : null}
        <ShareList shares={sharing.shares.data ?? []} origin={status.origin} pendingShareId={pendingShareId} onEdit={(share) => void openEditor(share)} onReview={(share) => void reviewShare(share)} onPublish={(share) => void publish(share)} onSnapshot={(share) => void updateSnapshot(share)} />
      </SettingsSection> : null}

      {settings.connectionEnabled && status.capabilities.ownerAnalytics && (sharing.shares.data?.length ?? 0) > 0 ? <SettingsSection title="Audience" description="Owner analytics are aggregated and never expose raw request records."><ShareAnalytics /></SettingsSection> : null}

      <ShareDialog open={editorOpen} configuration={editing} workbooks={workbooks.data ?? []} metadata={metadata.data ?? null} capabilities={status.capabilities} busy={sharing.create.isPending || sharing.update.isPending} onOpenChange={setEditorOpen} onSave={saveShare} />
      <Dialog open={Boolean(preview && previewConfiguration)} onOpenChange={(open) => { if (!open) { setPreview(null); setPreviewConfiguration(null) } }}>
        <DialogContent className="max-w-3xl"><DialogHeader><DialogTitle>Review share</DialogTitle><DialogDescription>Approve only after checking the exact data summary and opening the read-only preview.</DialogDescription></DialogHeader>{preview && previewConfiguration ? <SharePrivacySummary preview={preview} configuration={previewConfiguration} /> : null}<DialogFooter className="flex-wrap"><Button variant="outline" onClick={() => previewConfiguration && window.open(`/sharing/preview/${previewConfiguration.share.id}`, '_blank', 'noopener,noreferrer')}>Open preview</Button>{preview?.approved ? <Button onClick={() => { if (previewConfiguration) void publish(previewConfiguration.share) }} disabled={previewConfiguration?.share.visibility === 'protected' || pendingShareId !== null}>{previewConfiguration?.share.remoteRevision ? 'Update share' : 'Publish share'}</Button> : <Button onClick={() => void approvePreview()} disabled={sharing.approve.isPending}>Approve exact preview</Button>}</DialogFooter></DialogContent>
      </Dialog>
      {status.capabilities.accountClaiming ? <AccountClaimDialog open={claimOpen} pending={sharing.claim.isPending} result={claimResult} error={sharing.claim.error instanceof Error ? sharing.claim.error.message : null} onOpenChange={(open) => { setClaimOpen(open); if (!open) setClaimResult(null) }} onBegin={() => { void sharing.claim.mutateAsync().then(setClaimResult).catch(() => undefined) }} /> : null}
    </div>
  )
}
