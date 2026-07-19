import { AlertTriangle, Archive, LoaderCircle, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { InventoryDependencyReport } from '@/lib/inventory-lifecycle'

export type InventoryLifecycleAction = 'archive' | 'delete'

export type InventoryLifecycleDialogProps = {
  open: boolean
  action: InventoryLifecycleAction
  itemNames: string[]
  dependencyReport?: InventoryDependencyReport | null
  loading?: boolean
  error?: string | null
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

function actionCopy(action: InventoryLifecycleAction, count: number) {
  const batch = count > 1

  if (action === 'archive') {
    return {
      title: batch ? `Archive ${count} items?` : 'Archive this item?',
      description: batch
        ? 'The selected items will remain in inventory but cannot be placed, assigned, or connected until restored.'
        : 'It will remain in inventory but cannot be placed, assigned, or connected until restored.',
      confirm: batch ? `Archive ${count} items` : 'Archive item',
      loading: batch ? `Archiving ${count} items` : 'Archiving item',
      blockedTitle: batch ? 'These items cannot be archived' : 'This item cannot be archived',
    }
  }

  return {
    title: batch ? `Delete ${count} items permanently?` : 'Delete this item permanently?',
    description: batch
      ? 'The selected inventory records will be permanently removed. This cannot be undone or recovered with canvas Undo.'
      : 'This inventory record will be permanently removed. This cannot be undone or recovered with canvas Undo.',
    confirm: batch ? `Delete ${count} items` : 'Delete item',
    loading: batch ? `Deleting ${count} items` : 'Deleting item',
    blockedTitle: batch ? 'These items cannot be deleted' : 'This item cannot be deleted',
  }
}

export function InventoryLifecycleDialog({
  open,
  action,
  itemNames,
  dependencyReport = null,
  loading = false,
  error = null,
  onOpenChange,
  onConfirm,
}: InventoryLifecycleDialogProps) {
  const count = itemNames.length
  const copy = actionCopy(action, count)
  const blocked = Boolean(dependencyReport?.blocked && dependencyReport.reasons.length)
  const Icon = action === 'delete' ? Trash2 : Archive

  const setOpen = (nextOpen: boolean) => {
    if (!loading) onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100dvh-1rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-lg"
      >
        <DialogHeader className="border-b px-5 py-4 pr-14">
          <div className="flex items-start gap-3">
            <span
              className={action === 'delete'
                ? 'flex size-10 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive'
                : 'flex size-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-800'}
            >
              {blocked ? <AlertTriangle aria-hidden="true" /> : <Icon aria-hidden="true" />}
            </span>
            <div className="min-w-0 space-y-1">
              <DialogTitle className="text-lg font-bold leading-6">
                {blocked ? copy.blockedTitle : copy.title}
              </DialogTitle>
              <DialogDescription>
                {blocked
                  ? 'Resolve every dependency below before trying this action again.'
                  : copy.description}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto px-5 py-4">
          <div className="grid gap-4">
            <section aria-label={count > 1 ? 'Selected inventory items' : 'Selected inventory item'}>
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  {count > 1 ? 'Selection' : 'Item'}
                </p>
                {count > 1 && <Badge variant="secondary">{count} selected items</Badge>}
              </div>
              <ul className="grid max-h-36 gap-1.5 overflow-y-auto rounded-lg border bg-muted/35 p-2.5">
                {itemNames.map((name, index) => (
                  <li key={`${name}-${index}`} className="min-w-0 truncate text-sm font-semibold" title={name}>
                    {name}
                  </li>
                ))}
              </ul>
            </section>

            {blocked && dependencyReport && (
              <section aria-labelledby="inventory-dependency-heading" className="grid gap-2">
                <h3 id="inventory-dependency-heading" className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  Required cleanup
                </h3>
                <ul className="grid gap-2">
                  {dependencyReport.reasons.map((reason, index) => (
                    <li
                      key={`${reason.kind}-${index}`}
                      className="flex gap-3 rounded-lg border border-amber-300/70 bg-amber-50 p-3 text-amber-950"
                    >
                      <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-amber-700" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold leading-5">{reason.message}</p>
                        <p className="mt-0.5 text-xs font-medium text-amber-800">
                          {reason.count} {reason.count === 1 ? 'dependency' : 'dependencies'}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {error && (
              <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm font-semibold text-destructive">
                {error}
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="m-0 rounded-none px-5 py-4">
          {blocked ? (
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" disabled={loading} onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant={action === 'delete' ? 'destructive' : 'default'}
                disabled={loading || count === 0 || Boolean(error)}
                onClick={onConfirm}
              >
                {loading && <LoaderCircle aria-hidden="true" className="animate-spin" />}
                {loading ? copy.loading : copy.confirm}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
