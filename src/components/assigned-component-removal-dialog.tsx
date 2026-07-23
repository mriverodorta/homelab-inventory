import { Cable, Unplug } from 'lucide-react'
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

export function AssignedComponentRemovalDialog({
  open,
  itemName,
  connectionCount,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  itemName: string
  connectionCount: number
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  const cableLabel = `${connectionCount} connected ${connectionCount === 1 ? 'cable' : 'cables'}`

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive">
            <Unplug aria-hidden="true" />
          </AlertDialogMedia>
          <AlertDialogTitle>Remove {itemName}?</AlertDialogTitle>
          <AlertDialogDescription>
            This component has {cableLabel}. Removing it returns the component to inventory and
            permanently removes those cable connections from the canvas.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex items-center gap-3 rounded-lg border bg-muted/35 p-3 text-sm">
          <Cable className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="font-semibold">Remove {cableLabel}</span>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button type="button" variant="destructive" onClick={onConfirm}>
            Remove component and cables
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
