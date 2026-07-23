import { Cable, LoaderCircle, PlugZap, Undo2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import type { NasPowerConfigurationImpact } from '@/types/inventory'

export function NasPowerConfigurationDialog({
  open,
  nasName,
  impact,
  busy,
  error,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  nasName: string
  impact: NasPowerConfigurationImpact | null
  busy: boolean
  error: string | null
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  const targetLabel = impact?.to === 'internal-psu' ? 'Internal PSU' : 'External power adapter'

  return (
    <AlertDialog open={open} onOpenChange={(nextOpen) => {
      if (!busy) onOpenChange(nextOpen)
    }}>
      <AlertDialogContent aria-busy={busy || undefined}>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-amber-100 text-amber-800">
            <PlugZap aria-hidden="true" />
          </AlertDialogMedia>
          <AlertDialogTitle>Change power configuration for {nasName}?</AlertDialogTitle>
          <AlertDialogDescription>
            Switching to {targetLabel} changes the active power endpoint. The affected items below will be safely disconnected first.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="grid gap-2 rounded-lg border bg-muted/35 p-3 text-sm">
          {impact?.connections.map((connection) => (
            <div key={connection.id} className="flex items-center gap-2">
              <Cable className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 truncate font-semibold">Remove {connection.label}</span>
            </div>
          ))}
          {impact?.releasedAdapter ? (
            <div className="flex items-center gap-2">
              <Undo2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 truncate font-semibold">
                Return {impact.releasedAdapter.name} to inventory
              </span>
            </div>
          ) : null}
          {error ? <p role="alert" className="text-sm font-semibold text-destructive">{error}</p> : null}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button type="button" disabled={busy} onClick={onConfirm}>
            {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
            {busy ? 'Changing configuration' : 'Confirm change'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
