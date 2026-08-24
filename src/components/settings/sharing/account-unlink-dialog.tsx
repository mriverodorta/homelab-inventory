import { useEffect, useState } from 'react'
import { Link2Off, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { ShareDisposition } from '@/lib/sharing-api'

const OPTIONS: readonly { value: ShareDisposition; title: string; description: string }[] = [
  { value: 'keep', title: 'Keep shares online', description: 'Remove account ownership while leaving published shares available.' },
  { value: 'unpublish', title: 'Unpublish all shares', description: 'Take every published share offline while retaining its ID and history.' },
  { value: 'delete', title: 'Permanently delete all shares', description: 'Delete remote content and permanently reserve every generated share ID.' },
]

export function AccountUnlinkDialog({
  open,
  username,
  pending,
  error,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  username: string | null
  pending: boolean
  error: string | null
  onOpenChange: (open: boolean) => void
  onConfirm: (disposition: ShareDisposition, confirmation: string | null) => void
}) {
  const [disposition, setDisposition] = useState<ShareDisposition>('keep')
  const [confirmation, setConfirmation] = useState('')

  useEffect(() => {
    if (!open) {
      setDisposition('keep')
      setConfirmation('')
    }
  }, [open])

  const deletionConfirmed = disposition !== 'delete' || confirmation === 'DELETE'

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next) }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Unlink lab.gd account</DialogTitle>
          <DialogDescription>
            Remove {username ? `@${username}` : 'the GitHub account'} from this installation. The lab.gd connection and signing identity remain active.
          </DialogDescription>
        </DialogHeader>

        <fieldset className="grid gap-2" disabled={pending}>
          <legend className="mb-2 text-sm font-bold text-[#403a33]">Published share handling</legend>
          {OPTIONS.map((option) => (
            <label key={option.value} className="flex cursor-pointer items-start gap-3 border border-[#d8d0c5] bg-white p-3 transition-colors hover:bg-[#faf8f4] has-[:checked]:border-[#1f6f55] has-[:checked]:bg-[#f0f8f3]">
              <input className="mt-1 size-4 accent-[#1f6f55]" type="radio" name="share-disposition" value={option.value} checked={disposition === option.value} onChange={() => setDisposition(option.value)} />
              <span className="grid gap-1">
                <span className="text-sm font-bold text-[#29251f]">{option.title}</span>
                <span className="text-sm leading-5 text-[#675f55]">{option.description}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {disposition === 'delete' ? (
          <div className="grid gap-2 border border-[#dfb3a5] bg-[#fff4ee] p-3">
            <label htmlFor="unlink-delete-confirmation" className="text-sm font-bold text-[#7a2c1d]">Type DELETE to confirm</label>
            <Input id="unlink-delete-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" disabled={pending} />
          </div>
        ) : null}

        {error ? <p role="alert" className="text-sm font-semibold text-[#9a3326]">{error}</p> : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button variant={disposition === 'delete' ? 'destructive' : 'default'} disabled={pending || !deletionConfirmed} onClick={() => onConfirm(disposition, disposition === 'delete' ? confirmation : null)}>
            {pending ? <LoaderCircle className="animate-spin" /> : <Link2Off />}
            {pending ? 'Unlinking…' : 'Unlink account'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
