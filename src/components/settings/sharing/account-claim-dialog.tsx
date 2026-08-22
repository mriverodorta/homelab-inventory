import { ExternalLink, GitFork } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export function AccountClaimDialog({ open, origin, pending, result, error, onOpenChange, onBegin }: {
  open: boolean
  origin: string
  pending: boolean
  result: { installationId: number; status: 'pending'; code?: string; claimUrl?: string } | null
  error: string | null
  onOpenChange(open: boolean): void
  onBegin(): void
}) {
  const claimUrl = result?.claimUrl ?? (result?.code ? `${origin}/account/claims?code=${encodeURIComponent(result.code)}` : null)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Connect a lab.gd account</DialogTitle><DialogDescription>Claim this installation with GitHub to manage its shares from lab.gd. Publishing does not require an account.</DialogDescription></DialogHeader>
        {result && claimUrl ? <div className="grid gap-3"><p className="text-sm leading-5 text-[#554b40]">The claim is valid for ten minutes and binds only this installation.</p><Button asChild><a href={claimUrl} target="_blank" rel="noreferrer"><GitFork />Continue with GitHub<ExternalLink /></a></Button></div> : null}
        {result && !claimUrl ? <p role="status" className="rounded-md border border-[#e0bd86] bg-[#fff8e8] p-3 text-sm leading-5 text-[#6f4d16]">lab.gd accepted the claim request but did not return a claim code. Account linking cannot continue until that response contract is completed.</p> : null}
        {error ? <p role="alert" className="rounded-md border border-[#dfb3a5] bg-[#fff4ee] p-3 text-sm font-semibold text-[#7a2c1d]">{error}</p> : null}
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>{!result ? <Button onClick={onBegin} disabled={pending}><GitFork />{pending ? 'Requesting…' : 'Start account claim'}</Button> : null}</DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
