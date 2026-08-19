import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { loadCustomFieldImpact, loadInventoryTagImpact } from '@/lib/inventory-metadata-api'

type DeleteTarget = Readonly<{
  kind: 'field' | 'tag'
  id: number
  name: string
}> | null

export function MetadataDeleteDialog({
  target,
  pending,
  error,
  onOpenChange,
  onConfirm,
}: {
  target: DeleteTarget
  pending: boolean
  error: string | null
  onOpenChange: (open: boolean) => void
  onConfirm: (confirmationName: string) => void
}) {
  const [confirmation, setConfirmation] = useState('')
  useEffect(() => setConfirmation(''), [target])
  const impact = useQuery({
    queryKey: ['inventory-metadata', 'impact', target?.kind, target?.id],
    queryFn: () => {
      if (!target) throw new Error('A metadata delete target is required.')
      return target.kind === 'field' ? loadCustomFieldImpact(target.id) : loadInventoryTagImpact(target.id)
    },
    enabled: target !== null,
  })

  return (
    <AlertDialog open={target !== null} onOpenChange={(open) => !pending && onOpenChange(open)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {target?.name} permanently?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the {target?.kind === 'tag' ? 'tag' : 'field'} and unlinks it from {impact.data?.itemCount ?? '…'} inventory item{impact.data?.itemCount === 1 ? '' : 's'}
            {impact.data?.savedViewCount ? ` and ${impact.data.savedViewCount} saved ${impact.data.savedViewCount === 1 ? 'view' : 'views'}` : ''}. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <label className="grid gap-1.5 text-sm font-bold">
          Type <span className="select-all">{target?.name}</span> to confirm
          <Input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" />
        </label>
        {impact.error ? <p role="alert" className="text-sm font-semibold text-destructive">{impact.error.message}</p> : null}
        {error ? <p role="alert" className="text-sm font-semibold text-destructive">{error}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending || impact.isPending || confirmation !== target?.name}
            onClick={(event) => {
              event.preventDefault()
              onConfirm(confirmation)
            }}
          >
            {pending ? 'Deleting…' : 'Delete permanently'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
