import { Camera, Copy, ExternalLink, KeyRound, Pencil, Power, RefreshCw, RotateCw, ShieldCheck, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { ShareRecord } from '@/lib/sharing-api'

const stateLabels: Record<ShareRecord['state'], string> = {
  unpublished: 'Not published',
  'preview-ready': 'Ready to publish',
  publishing: 'Publishing',
  synced: 'Published',
  'changes-pending': 'Sync scheduled',
  'manual-update-available': 'Update available',
  failed: 'Publication failed',
  expired: 'Expired',
  'grace-period': 'Grace period',
  deleted: 'Deleted',
}

function IconAction({ label, children, onClick, disabled = false }: { label: string; children: React.ReactNode; onClick(): void; disabled?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild><Button type="button" variant="ghost" size="icon" aria-label={label} disabled={disabled} onClick={onClick}>{children}</Button></TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function ShareList({
  shares,
  origin,
  pendingShareId,
  onEdit,
  onReview,
  onPublish,
  onSnapshot,
  onUnpublish,
  onDelete,
  onRepublish,
  onPassword,
  remoteControls,
  protectedPassword,
}: {
  shares: readonly ShareRecord[]
  origin: string
  pendingShareId: number | null
  onEdit(share: ShareRecord): void
  onReview(share: ShareRecord): void
  onPublish(share: ShareRecord): void
  onSnapshot(share: ShareRecord): void
  onUnpublish(share: ShareRecord): void
  onDelete(share: ShareRecord): void
  onRepublish(share: ShareRecord): void
  onPassword(share: ShareRecord): void
  remoteControls: boolean
  protectedPassword: boolean
}) {
  if (!shares.length) {
    return <div className="px-4 py-8 text-center text-sm text-[#756d62]">No shares are configured. Create one to choose exactly what can leave this installation.</div>
  }
  return (
    <div className="divide-y divide-[#e8e1d6]">
      {shares.map((share) => {
        const publicUrl = share.remotePublicId ? `${origin}/s/${share.remotePublicId}` : null
        const pending = pendingShareId === share.id
        return (
          <div key={share.id} className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <span className={`size-2 shrink-0 rounded-full ${share.state === 'synced' ? 'bg-[#2f7658]' : share.state === 'failed' ? 'bg-[#ad4637]' : 'bg-[#b77a20]'}`} aria-hidden="true" />
                <p className="truncate text-sm font-black text-[#20242c]">{share.title}</p>
              </div>
              <p className="mt-1 text-xs text-[#756d62]">{stateLabels[share.state]} · {share.visibility} · {share.mutability}{share.mutability === 'replaceable' ? ` / ${share.syncMode}` : ''}</p>
            </div>
            <div className="flex items-center justify-end gap-1">
              <IconAction label="Edit share" onClick={() => onEdit(share)}><Pencil /></IconAction>
              <IconAction label="Review privacy preview" onClick={() => onReview(share)}><ShieldCheck /></IconAction>
              {share.resourceSnapshotIncluded ? <IconAction label="Update resource snapshot" disabled={pending} onClick={() => onSnapshot(share)}><Camera /></IconAction> : null}
              {(share.state === 'preview-ready' || share.state === 'manual-update-available') ? <IconAction label={share.remoteRevision ? 'Update share' : 'Publish share'} disabled={pending} onClick={() => onPublish(share)}><RefreshCw className={pending ? 'animate-spin' : ''} /></IconAction> : null}
              {protectedPassword && share.remotePublicId && share.visibility === 'protected' ? <IconAction label="Set share password" disabled={pending} onClick={() => onPassword(share)}><KeyRound /></IconAction> : null}
              {remoteControls && share.remotePublicId && share.state === 'synced' ? <IconAction label="Unpublish share" disabled={pending} onClick={() => onUnpublish(share)}><Power /></IconAction> : null}
              {remoteControls && share.remotePublicId && (share.state === 'unpublished' || share.state === 'expired' || share.state === 'grace-period') ? <IconAction label="Republish share" disabled={pending} onClick={() => onRepublish(share)}><RotateCw /></IconAction> : null}
              {remoteControls && share.remotePublicId ? <IconAction label="Delete share" disabled={pending} onClick={() => onDelete(share)}><Trash2 /></IconAction> : null}
              {publicUrl ? <><IconAction label="Copy share link" onClick={() => void navigator.clipboard.writeText(publicUrl)}><Copy /></IconAction><Tooltip><TooltipTrigger asChild><Button asChild variant="ghost" size="icon" aria-label="Open published share"><a href={publicUrl} target="_blank" rel="noreferrer"><ExternalLink /></a></Button></TooltipTrigger><TooltipContent>Open published share</TooltipContent></Tooltip></> : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}
