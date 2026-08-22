import { ExternalLink, GitFork } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export function AccountClaimDialog({ open, pending, result, error, onOpenChange, onBegin }: {
  open: boolean
  pending: boolean
  result: { claimId: string; userCode: string; verificationUrl: string; expiresAt: string; state: 'pending' } | null
  error: string | null
  onOpenChange(open: boolean): void
  onBegin(): void
}) {
  const claimUrl = result?.verificationUrl ?? null
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Connect a lab.gd account</DialogTitle><DialogDescription>Claim this installation with GitHub to manage its shares from lab.gd. Publishing does not require an account.</DialogDescription></DialogHeader>
        {result && claimUrl ? <div className="grid gap-4"><p className="text-sm leading-5 text-[#554b40]">Open lab.gd, sign in with GitHub, and enter this single-use code before {new Date(result.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.</p><code className="select-all rounded-md border border-[#d8d1c6] bg-[#f5f2ec] px-4 py-3 text-center text-lg font-black text-[#20242c]">{result.userCode}</code><Button asChild><a href={claimUrl} target="_blank" rel="noreferrer"><GitFork />Continue with GitHub<ExternalLink /></a></Button></div> : null}
        {error ? <p role="alert" className="rounded-md border border-[#dfb3a5] bg-[#fff4ee] p-3 text-sm font-semibold text-[#7a2c1d]">{error}</p> : null}
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>{!result ? <Button onClick={onBegin} disabled={pending}><GitFork />{pending ? 'Requesting…' : 'Start account claim'}</Button> : null}</DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
