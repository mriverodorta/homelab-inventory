import { LoaderCircle, PackageOpen } from 'lucide-react'
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

export type ReturnToInventoryImpact = {
  placementsRemoved: number
  assignmentsReleased: number
  connectionsRemoved: number
}

export type ReturnToInventoryDialogProps = {
  open: boolean
  itemName: string
  itemType: string
  impact: ReturnToInventoryImpact
  busy?: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

const impactRows: Array<{
  key: keyof ReturnToInventoryImpact
  label: string
}> = [
  { key: 'placementsRemoved', label: 'Canvas placements removed' },
  { key: 'assignmentsReleased', label: 'Hosted components released' },
  { key: 'connectionsRemoved', label: 'Cable connections removed' },
]

export function ReturnToInventoryDialog({
  open,
  itemName,
  itemType,
  impact,
  busy = false,
  onOpenChange,
  onConfirm,
}: ReturnToInventoryDialogProps) {
  const setOpen = (nextOpen: boolean) => {
    if (!busy) onOpenChange(nextOpen)
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent aria-busy={busy || undefined}>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive">
            <PackageOpen aria-hidden="true" />
          </AlertDialogMedia>
          <AlertDialogTitle>Return {itemName} to inventory?</AlertDialogTitle>
          <AlertDialogDescription>
            This {itemType} remains in inventory, but its canvas placement and attached cables will be removed.
            If it is a container, hosted components are released back to inventory.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <dl aria-label="Return impact" className="grid gap-2 rounded-lg border bg-muted/35 p-3">
          {impactRows.map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between gap-4 text-sm">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-semibold tabular-nums">{impact[key]}</dd>
            </div>
          ))}
        </dl>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : null}
            {busy ? 'Returning to inventory' : 'Return to inventory'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
