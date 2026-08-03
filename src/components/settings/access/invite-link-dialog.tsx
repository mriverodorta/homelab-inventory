import { useState } from 'react'
import { Check, Copy, Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export function InviteLinkDialog({ link, open, onOpenChange }: { link: string | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    if (!link) return
    await navigator.clipboard.writeText(link)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <span className="mb-1 flex size-10 items-center justify-center rounded-md bg-[#20242c] text-white"><Link2 className="size-5" /></span>
          <DialogTitle>Invitation link ready</DialogTitle>
          <DialogDescription>This link is shown only once. Share it privately with the invited person before closing this dialog.</DialogDescription>
        </DialogHeader>
        <div className="break-all rounded-md border border-[#ded8ce] bg-[#f7f2e9] p-3 font-mono text-xs leading-5 text-[#403a33]">{link}</div>
        <DialogFooter>
          <Button variant="outline" onClick={() => void copy()}>{copied ? <Check /> : <Copy />}{copied ? 'Copied' : 'Copy link'}</Button>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
