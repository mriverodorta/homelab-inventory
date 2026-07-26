import { Boxes, Compass, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

export function FirstRunOnboardingDialog({
  open, busy, error, onExplore, onStartEmpty,
}: {
  open: boolean
  busy: boolean
  error: string | null
  onExplore: () => void
  onStartEmpty: () => void
}) {
  return (
    <Dialog open={open}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100dvh-2rem)] max-w-2xl overflow-y-auto border-[#d8d0c3] bg-[#fffdf8] p-0 text-[#20242c]"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <div className="border-b border-[#e2dbcf] px-5 py-5 sm:px-6">
          <span className="mb-4 flex size-11 items-center justify-center rounded-md bg-[#20242c] text-[#fff8e9]">
            <Compass className="size-5" aria-hidden="true" />
          </span>
          <DialogHeader className="text-left">
            <DialogTitle className="text-2xl font-black tracking-normal">See a working homelab in under a minute</DialogTitle>
            <DialogDescription className="mt-2 max-w-lg text-sm font-semibold leading-6 text-[#756d62]">
              Explore fictional equipment, component assignments, network cabling, and power delivery in the real workspace. Remove everything when you finish.
            </DialogDescription>
          </DialogHeader>
        </div>
        <div className="grid gap-3 px-5 py-5 sm:grid-cols-2 sm:px-6">
          <div className="border-l-4 border-[#cf7a2f] bg-[#f7f2e9] p-4">
            <Sparkles className="size-5 text-[#a95520]" aria-hidden="true" />
            <p className="mt-3 text-sm font-black">Explore an example</p>
            <p className="mt-1 text-xs font-semibold leading-5 text-[#756d62]">Follow one network path and one power path using removable sample records.</p>
          </div>
          <div className="border-l-4 border-[#7e9c92] bg-[#f7f2e9] p-4">
            <Boxes className="size-5 text-[#496a62]" aria-hidden="true" />
            <p className="mt-3 text-sm font-black">Start with your inventory</p>
            <p className="mt-1 text-xs font-semibold leading-5 text-[#756d62]">Keep the workspace empty and use a short checklist while adding real equipment.</p>
          </div>
          {error ? <p role="alert" className="sm:col-span-2 text-sm font-bold text-[#a33f35]">{error}</p> : null}
        </div>
        <DialogFooter className="!m-0 border-t border-[#e2dbcf] bg-[#f5f0e8] px-5 py-4 sm:px-6">
          <Button type="button" variant="outline" disabled={busy} onClick={onStartEmpty}>Start empty</Button>
          <Button type="button" disabled={busy} onClick={onExplore}>{busy ? 'Preparing example…' : 'Explore example'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
