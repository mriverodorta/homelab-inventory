import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export type DemoSessionDialogState = 'closed' | 'extend' | 'expired'

export function DemoSessionDialog({
  state,
  secondsRemaining,
  onExtend,
  onExpire,
}: {
  state: DemoSessionDialogState
  secondsRemaining: number
  onExtend: () => void
  onExpire: () => void
}) {
  return (
    <Dialog open={state !== 'closed'}>
      <DialogContent className="max-w-md" onPointerDownOutside={(event) => event.preventDefault()}>
        {state === 'extend' ? (
          <>
            <DialogHeader>
              <DialogTitle>Demo session expired</DialogTitle>
              <DialogDescription>
                Extend this private demo sandbox for another 30 minutes. This prompt will expire in{' '}
                {secondsRemaining} seconds.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onExpire}>
                End demo
              </Button>
              <Button type="button" onClick={onExtend}>
                Extend session
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Demo expired</DialogTitle>
              <DialogDescription>Refresh to start a new demo sandbox.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" onClick={() => window.location.reload()}>
                Refresh
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
