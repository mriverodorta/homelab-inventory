import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, CirclePause, Cloud, CloudOff, Link2Off, LoaderCircle, Plus, RotateCw, ShieldAlert, UserRoundPlus } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { SettingsSection, SettingRow } from '@/components/settings/settings-primitives'
import { usePermission } from '@/hooks/use-permission'
import { useSharing } from '@/hooks/use-sharing'
import { loadInventoryMetadataCatalog } from '@/lib/inventory-metadata-api'
import type { ShareConfiguration, ShareDisposition, ShareInput, SharePreview, ShareRecord, SharingSettingsResponse } from '@/lib/sharing-api'
import { loadProjectWorkbooks } from '@/lib/workbook-api'
import { AccountClaimDialog } from './account-claim-dialog'
import { AccountUnlinkDialog } from './account-unlink-dialog'
import { ShareAnalytics } from './share-analytics'
import { ShareDialog } from './share-dialog'
import { ShareList } from './share-list'
import { SharePrivacySummary } from './share-privacy-summary'

function enrollmentLabel(state: string, dormant = false) {
  if (state === 'connected') return dormant ? 'Connected, idle' : 'Connected'
  if (state === 'pending') return 'Connecting'
  if (state === 'retrying') return 'Retry scheduled'
  if (state === 'recovery-pending') return 'Owner approval required'
  if (state === 'unsupported') return 'Contract unsupported'
  return 'Disconnected'
}

function EnrollmentIcon({ state, dormant = false }: { state: string; dormant?: boolean }) {
  if (state === 'connected' && dormant) return <CirclePause className="size-4 text-[#756d62]" />
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
  const [unlinkOpen, setUnlinkOpen] = useState(false)
  const [unlinkAttemptId, setUnlinkAttemptId] = useState<string | null>(null)
  const [claimMessage,setClaimMessage]=useState<string|null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [passwordShare, setPasswordShare] = useState<ShareRecord | null>(null)
  const [passwordValue, setPasswordValue] = useState('')
  const status = sharing.settings.data
  const settings = status?.settings
  const account=settings?.account??{claimed:false,githubUsername:null,claimedAtMs:null,bindingRevision:0}
  const connection=settings?.connection
  const publicationReconciliation=settings?.publicationReconciliation??{blockedCount:0,errorCode:null}

  useEffect(() => {
    if (!editorOpen) setEditing(null)
  }, [editorOpen])

  useEffect(()=>{
    if(claimResult?.state!=='pending'||!account.claimed)return
    setClaimOpen(false)
    setClaimResult(null)
    setClaimMessage(account.githubUsername?`Connected to @${account.githubUsername}.`:'GitHub account connected.')
  },[claimResult,account.claimed,account.githubUsername])

  useEffect(()=>{
    if(!claimOpen||claimResult?.state!=='pending')return
    const reconcile=()=>{if(document.visibilityState==='visible')void sharing.reconcileAccount.mutateAsync().catch(()=>undefined)}
    document.addEventListener('visibilitychange',reconcile)
    return()=>document.removeEventListener('visibilitychange',reconcile)
  },[claimOpen,claimResult,sharing.reconcileAccount])

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

  async function lifecycle(share: ShareRecord, action: 'unpublish' | 'delete' | 'republish') {
    if (action === 'delete' && !window.confirm(`Delete “${share.title}” from lab.gd? This leaves a tombstone and cannot be undone from this screen.`)) return
    setPendingShareId(share.id)
    setActionError(null)
    try {
      if (action === 'unpublish') await sharing.unpublish.mutateAsync(share.id)
      else if (action === 'delete') await sharing.remove.mutateAsync(share.id)
      else await sharing.republish.mutateAsync(share.id)
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'The remote lifecycle action failed.')
    } finally { setPendingShareId(null) }
  }

  async function savePassword() {
    if (!passwordShare) return
    setPendingShareId(passwordShare.id)
    try {
      await sharing.password.mutateAsync({ id: passwordShare.id, password: passwordValue })
      setPasswordValue('')
      setPasswordShare(null)
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'The password could not be handed to lab.gd.')
    } finally { setPendingShareId(null) }
  }

  function openUnlink() {
    setActionError(null)
    setUnlinkAttemptId(crypto.randomUUID())
    setUnlinkOpen(true)
  }

  async function unlinkAccount(shareDisposition: ShareDisposition, confirmation: string | null) {
    if (!unlinkAttemptId) return
    try {
      const response = await sharing.unlinkAccount.mutateAsync({ clientAttemptId: unlinkAttemptId, shareDisposition, confirmation })
      setUnlinkOpen(false)
      setUnlinkAttemptId(null)
      setClaimMessage(`Account unlinked. ${response.unlink.result.affected.shares} remote share${response.unlink.result.affected.shares === 1 ? '' : 's'} handled with “${shareDisposition}”.`)
    } catch {
      // The mutation error remains in the dialog so a retry keeps the same attempt ID.
    }
  }

  return (
    <div className="grid gap-6">
      <SettingsSection title="Sharing" description="Publish selected read-only project views to lab.gd without exposing the rest of this installation.">
        <SettingRow label="lab.gd connection" description="Production installations enroll automatically after startup. Publication always requires an explicit privacy review.">
          <div className="flex items-center gap-3"><span className="flex items-center gap-2 text-sm font-bold text-[#403a33]"><EnrollmentIcon state={settings.enrollmentState} dormant={connection?.dormant} />{enrollmentLabel(settings.enrollmentState, connection?.dormant)}</span><Switch aria-label="Enable lab.gd sharing" checked={settings.connectionEnabled} disabled={sharing.updateConnection.isPending} onCheckedChange={(enabled) => sharing.updateConnection.mutate({ expectedRevision: settings.revision, enabled })} /></div>
        </SettingRow>
        {settings.connectionEnabled && connection?.dormant ? <div className="border-b border-[#e8e1d6] bg-[#f7f5f1] px-4 py-3 text-sm text-[#665e54]">No active remote work. The event connection and credential renewal are paused.</div> : null}
        {settings.connectionEnabled && connection ? <SettingRow label="Event runtime" description={connection.interest.reasons.length ? `Active: ${connection.interest.reasons.map(formatInterestReason).join(', ')}` : 'No current remote event interest.'}>
          <dl className="grid grid-cols-2 gap-x-5 gap-y-1 text-right text-xs tabular-nums text-[#665e54] sm:grid-cols-4">
            <div><dt className="font-medium">Streams</dt><dd>{connection.metrics.streamOpenCount}</dd></div>
            <div><dt className="font-medium">Reconnects</dt><dd>{connection.metrics.reconnectCount}</dd></div>
            <div><dt className="font-medium">Renewals</dt><dd>{connection.metrics.credentialRefreshCount}</dd></div>
            <div><dt className="font-medium">Idle transitions</dt><dd>{connection.metrics.dormantTransitionCount}</dd></div>
          </dl>
        </SettingRow> : null}
        {settings.enrollmentState === 'retrying' ? <div className="flex items-start gap-3 border-b border-[#e8e1d6] bg-[#fff8e8] p-4 text-sm text-[#6f4d16]"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><p>lab.gd is unavailable. This app remains healthy and will retry with bounded backoff{settings.nextAttemptAtMs ? ` after ${new Date(settings.nextAttemptAtMs).toLocaleString()}` : ''}.</p></div> : null}
        {publicationReconciliation.blockedCount > 0 ? <div className="flex items-start gap-3 border-b border-[#e8e1d6] bg-[#fff4ee] p-4 text-sm text-[#7a2c1d]"><ShieldAlert className="mt-0.5 size-4 shrink-0" /><p>{publicationReconciliation.blockedCount} legacy publication operation{publicationReconciliation.blockedCount === 1 ? '' : 's'} paused before replay because the intended remote revision cannot be proven. Inventory remains available; run the publication migration preflight before controlled reconciliation.</p></div> : null}
        {settings.enrollmentState === 'recovery-pending' ? <div className="flex items-center justify-between gap-4 border-b border-[#e8e1d6] bg-[#fff4ee] p-4"><p className="text-sm leading-5 text-[#7a2c1d]">A replacement key is waiting for owner approval. Publication is stopped and no additional replacement key will be created.</p>{canPublish ? <Button variant="outline" onClick={() => sharing.resumeRecovery.mutate()} disabled={sharing.resumeRecovery.isPending}><RotateCw />Resume recovery</Button> : null}</div> : null}
        {!settings.connectionEnabled ? <div className="flex items-start gap-3 bg-[#fff8e8] p-4 text-sm leading-5 text-[#6f4d16]"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><p>The stable local identity is retained. Existing public content follows lab.gd lifecycle policy until this installation reconnects and receives resumable events.</p></div> : null}
      </SettingsSection>

      {settings.connectionEnabled ? <SettingsSection title="Shares" description="Each share has its own views, privacy selections, visibility, expiration, and update policy.">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e8e1d6] p-4"><div className="flex items-center gap-2 text-sm text-[#554b40]"><Cloud className="size-4" />{sharing.shares.data?.length ?? 0} configured</div>{canPublish ? <div className="flex flex-wrap items-center gap-2">{status.capabilities.accountClaiming&&account.claimed?<><span className="text-sm font-bold text-[#2f7658]">{account.githubUsername?`Connected to @${account.githubUsername}`:'GitHub account connected'}</span>{status.capabilities.accountUnlink?<Button variant="outline" onClick={openUnlink}><Link2Off />Unlink account</Button>:null}</>:status.capabilities.accountClaiming?<Button variant="outline" onClick={() => {setClaimMessage(null);setClaimOpen(true)}}><UserRoundPlus />Connect account</Button>:null}<Button onClick={() => void openEditor()} disabled={!workbooks.data?.length}><Plus />New share</Button></div> : null}</div>
        {claimMessage?<p role="status" className="border-b border-[#b9d5c6] bg-[#f0f8f3] p-3 text-sm font-semibold text-[#2f7658]">{claimMessage}</p>:null}
        {actionError ? <p role="alert" className="border-b border-[#dfb3a5] bg-[#fff4ee] p-3 text-sm font-semibold text-[#7a2c1d]">{actionError}</p> : null}
        <ShareList shares={sharing.shares.data ?? []} origin={status.origin} pendingShareId={pendingShareId} remoteControls={status.capabilities.remoteLifecycle} protectedPassword={status.capabilities.protectedShares} onEdit={(share) => void openEditor(share)} onReview={(share) => void reviewShare(share)} onPublish={(share) => void publish(share)} onSnapshot={(share) => void updateSnapshot(share)} onUnpublish={(share) => void lifecycle(share, 'unpublish')} onDelete={(share) => void lifecycle(share, 'delete')} onRepublish={(share) => void lifecycle(share, 'republish')} onPassword={(share) => { setPasswordValue(''); setPasswordShare(share) }} />
      </SettingsSection> : null}

      {settings.connectionEnabled && status.capabilities.ownerAnalytics && (sharing.shares.data?.length ?? 0) > 0 ? <SettingsSection title="Audience" description="Owner analytics are aggregated and never expose raw request records."><ShareAnalytics shares={sharing.shares.data ?? []} /></SettingsSection> : null}

      <ShareDialog open={editorOpen} configuration={editing} workbooks={workbooks.data ?? []} metadata={metadata.data ?? null} capabilities={status.capabilities} busy={sharing.create.isPending || sharing.update.isPending} onOpenChange={setEditorOpen} onSave={saveShare} />
      <Dialog open={Boolean(preview && previewConfiguration)} onOpenChange={(open) => { if (!open) { setPreview(null); setPreviewConfiguration(null) } }}>
        <DialogContent className="max-w-3xl"><DialogHeader><DialogTitle>Review share</DialogTitle><DialogDescription>Approve only after checking the exact data summary and opening the read-only preview.</DialogDescription></DialogHeader>{preview && previewConfiguration ? <SharePrivacySummary preview={preview} configuration={previewConfiguration} /> : null}<DialogFooter className="flex-wrap"><Button variant="outline" onClick={() => previewConfiguration && window.open(`/sharing/preview/${previewConfiguration.share.id}`, '_blank', 'noopener,noreferrer')}>Open preview</Button>{preview?.approved ? <Button onClick={() => { if (previewConfiguration) void publish(previewConfiguration.share) }} disabled={pendingShareId !== null}>{previewConfiguration?.share.remoteRevision ? 'Update share' : 'Publish share'}</Button> : <Button onClick={() => void approvePreview()} disabled={sharing.approve.isPending}>Approve exact preview</Button>}</DialogFooter></DialogContent>
      </Dialog>
      <Dialog open={Boolean(passwordShare)} onOpenChange={(open) => { if (!open) { setPasswordValue(''); setPasswordShare(null) } }}><DialogContent><DialogHeader><DialogTitle>Set share password</DialogTitle><DialogDescription>The plaintext exists only in this dialog and the active signed request. It is never saved by Homelab Inventory.</DialogDescription></DialogHeader><Input type="password" autoComplete="new-password" minLength={12} maxLength={1024} value={passwordValue} onChange={(event) => setPasswordValue(event.target.value)} aria-label="Share password" /><DialogFooter><Button variant="outline" onClick={() => { setPasswordValue(''); setPasswordShare(null) }}>Cancel</Button><Button disabled={passwordValue.length < 12 || sharing.password.isPending} onClick={() => void savePassword()}>{sharing.password.isPending ? 'Sending…' : 'Set password'}</Button></DialogFooter></DialogContent></Dialog>
      {status.capabilities.accountClaiming ? <AccountClaimDialog open={claimOpen} pending={sharing.claim.isPending} result={claimResult?.state==='pending'?claimResult:null} error={sharing.claim.error instanceof Error ? sharing.claim.error.message : null} onOpenChange={(open) => { setClaimOpen(open); if (!open) setClaimResult(null) }} onBegin={() => { void sharing.claim.mutateAsync().then(setClaimResult).catch(() => undefined) }} /> : null}
      {status.capabilities.accountUnlink ? <AccountUnlinkDialog open={unlinkOpen} username={account.githubUsername} pending={sharing.unlinkAccount.isPending} error={sharing.unlinkAccount.error instanceof Error ? sharing.unlinkAccount.error.message : null} onOpenChange={(open) => { setUnlinkOpen(open); if (!open) setUnlinkAttemptId(null) }} onConfirm={(disposition, confirmation) => void unlinkAccount(disposition, confirmation)} /> : null}
    </div>
  )
}

function formatInterestReason(reason: NonNullable<SharingSettingsResponse['settings']['connection']>['interest']['reasons'][number]) {
  return ({
    'active-shares': 'shares',
    'publication-operations': 'publication',
    'account-operations': 'account operation',
    recovery: 'recovery',
    'account-claim': 'account claim',
  } as const)[reason]
}
