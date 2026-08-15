import { LoaderCircle, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { CatalogUpdateGroupDetail } from '@/types/registry'
import { RegistryUpdateResolutionPreview } from './registry-update-resolution-preview'

export function RegistryUpdateResolutionDialog({ detail, linkId, pending, error, onOpenChange, onConfirm }: {
  detail: CatalogUpdateGroupDetail | null
  linkId: number | null
  pending: boolean
  error: string | null
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  const member = detail?.members.find((candidate) => candidate.linkId === linkId)
  const resolution = member?.resolution
  return (
    <Dialog open={detail !== null && linkId !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Wrench className="size-5" />Resolve Registry topology update</DialogTitle>
          <DialogDescription>Review the exact relationship changes. They are committed atomically with the catalog definition.</DialogDescription>
        </DialogHeader>
        {resolution ? <RegistryUpdateResolutionPreview resolution={resolution} /> : null}
        {error ? <p role="alert" className="text-sm font-semibold text-[#a33d31]">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" disabled={pending || !resolution?.available} onClick={onConfirm}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <Wrench className="size-4" />}Resolve and apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
