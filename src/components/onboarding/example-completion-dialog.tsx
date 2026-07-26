import { CheckCircle2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import type { OnboardingRemovalImpact } from '@/lib/onboarding-api'

export function ExampleCompletionDialog({
  open, impact, loadingImpact, busy, error, onRemove, onKeep,
}: {
  open: boolean
  impact: OnboardingRemovalImpact | null
  loadingImpact: boolean
  busy: boolean
  error: string | null
  onRemove: () => void
  onKeep: () => void
}) {
  return (
    <Dialog open={open}>
      <DialogContent showCloseButton={false} className="max-h-[calc(100dvh-2rem)] max-w-2xl gap-0 overflow-hidden bg-[#fffdf8] p-0 text-[#20242c]" onEscapeKeyDown={(event) => event.preventDefault()} onPointerDownOutside={(event) => event.preventDefault()}>
        <DialogHeader className="border-b border-[#e2dbcf] px-5 py-5 text-left">
          <span className="mb-3 flex size-10 items-center justify-center rounded-md bg-[#dce8d4] text-[#395533]"><CheckCircle2 className="size-5" /></span>
          <DialogTitle className="text-xl font-black">Ready to document your lab?</DialogTitle>
          <DialogDescription className="mt-2 text-sm font-semibold leading-6 text-[#756d62]">Start clean to remove the fictional example, or keep it as normal editable inventory.</DialogDescription>
        </DialogHeader>
        <div className="px-5 py-4 text-sm font-semibold text-[#5f574e]">
          {loadingImpact ? <p>Checking example relationships…</p> : impact ? (
            <p>{impact.inventoryRecords} items, {impact.assignments} assignments, {impact.connections} cables, and {impact.placements} placements will be removed.</p>
          ) : null}
          {impact && impact.additionalRelationships > 0 ? <p className="mt-2 border-l-4 border-[#c95850] bg-[#faece8] p-3 text-[#8d332c]">{impact.additionalRelationships} relationship{impact.additionalRelationships === 1 ? '' : 's'} created during exploration also depend on sample equipment and will be removed. Your own inventory records remain.</p> : null}
          {error ? <p role="alert" className="mt-3 font-bold text-[#a33f35]">{error}</p> : null}
        </div>
        <DialogFooter className="!m-0 !grid grid-cols-1 gap-2 border-t border-[#e2dbcf] bg-[#f5f0e8] px-5 py-4 sm:!grid sm:grid-cols-2">
          <Button className="w-full" type="button" variant="outline" disabled={busy} onClick={onKeep}>Keep this workspace</Button>
          <Button className="w-full" type="button" disabled={busy || loadingImpact} onClick={onRemove}><Trash2 className="size-4" />{busy ? 'Updating…' : 'Start with my inventory'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
