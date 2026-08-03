import { Archive, BookmarkPlus, Copy, EllipsisVertical, PackageOpen, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export type InventoryActionsMenuProps = {
  itemName: string
  busy?: boolean
  className?: string
  align?: 'start' | 'center' | 'end'
  archived?: boolean
  onEdit?: () => void
  onDuplicate?: () => void
  onSaveAsTemplate?: () => void
  onReturnToInventory?: () => void
  onArchive?: () => void
  onRestore?: () => void
  onDelete?: () => void
}

function stopInteraction(event: { stopPropagation: () => void }) {
  event.stopPropagation()
}

function invokeAction(
  event: Event,
  callback: (() => void) | undefined,
) {
  event.stopPropagation()
  callback?.()
}

export function InventoryActionsMenu(props: InventoryActionsMenuProps) {
  const {
    itemName,
    busy = false,
    className,
    align = 'end',
  } = props

  const hasActions = props.archived
    ? Boolean(props.onRestore || props.onDelete)
    : Boolean(props.onEdit || props.onDuplicate || props.onSaveAsTemplate || props.onReturnToInventory || props.onArchive)
  if (!hasActions) return null

  return (
    <span
      className={cn('inline-flex shrink-0', className)}
      onClick={stopInteraction}
      onPointerDown={stopInteraction}
      onKeyDown={stopInteraction}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={busy}
            aria-label={`Actions for ${itemName}`}
            aria-busy={busy || undefined}
            className="text-muted-foreground hover:text-foreground"
          >
            <EllipsisVertical aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align={align}
          className="w-44"
          onClick={stopInteraction}
          onPointerDown={stopInteraction}
        >
          {props.archived === true ? (
            props.onRestore ? <DropdownMenuItem onSelect={(event) => invokeAction(event, props.onRestore)}>
              <RotateCcw aria-hidden="true" />
              Restore
            </DropdownMenuItem> : null
          ) : (
            <>
              {props.onEdit ? (
                <DropdownMenuItem onSelect={(event) => invokeAction(event, props.onEdit)}>
                  <Pencil aria-hidden="true" />
                  Edit
                </DropdownMenuItem>
              ) : null}
              {props.onDuplicate ? <DropdownMenuItem onSelect={(event) => invokeAction(event, props.onDuplicate)}>
                <Copy aria-hidden="true" />Duplicate
              </DropdownMenuItem> : null}
              {props.onSaveAsTemplate ? (
                <DropdownMenuItem onSelect={(event) => invokeAction(event, props.onSaveAsTemplate)}>
                  <BookmarkPlus aria-hidden="true" />
                  Save as template
                </DropdownMenuItem>
              ) : null}
              {props.onReturnToInventory ? (
                <DropdownMenuItem onSelect={(event) => invokeAction(event, props.onReturnToInventory)}>
                  <PackageOpen aria-hidden="true" />
                  Return to inventory
                </DropdownMenuItem>
              ) : null}
              {props.onArchive ? <DropdownMenuSeparator /> : null}
              {props.onArchive ? <DropdownMenuItem onSelect={(event) => invokeAction(event, props.onArchive)}>
                <Archive aria-hidden="true" />
                Archive
              </DropdownMenuItem> : null}
            </>
          )}
          {props.archived === true && props.onDelete ? (
            <DropdownMenuItem
              variant="destructive"
              onSelect={(event) => invokeAction(event, props.onDelete)}
            >
              <Trash2 aria-hidden="true" />
              Delete
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  )
}
