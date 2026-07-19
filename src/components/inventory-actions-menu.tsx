import { Archive, Copy, EllipsisVertical, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

type InventoryActionsMenuBaseProps = {
  itemName: string
  busy?: boolean
  className?: string
  align?: 'start' | 'center' | 'end'
  showEdit?: boolean
}

export type ActiveInventoryActionsMenuProps = InventoryActionsMenuBaseProps & {
  archived?: false
  onEdit: () => void
  onDuplicate: () => void
  onArchive: () => void
  onDelete?: never
  onRestore?: never
}

export type ArchivedInventoryActionsMenuProps = InventoryActionsMenuBaseProps & {
  archived: true
  onRestore: () => void
  onDelete: () => void
  onEdit?: never
  onDuplicate?: never
  onArchive?: never
}

export type InventoryActionsMenuProps =
  | ActiveInventoryActionsMenuProps
  | ArchivedInventoryActionsMenuProps

function stopInteraction(event: { stopPropagation: () => void }) {
  event.stopPropagation()
}

function invokeAction(
  event: Event,
  callback: () => void,
) {
  event.stopPropagation()
  callback()
}

export function InventoryActionsMenu(props: InventoryActionsMenuProps) {
  const {
    itemName,
    busy = false,
    className,
    align = 'end',
    showEdit = true,
  } = props

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
            <DropdownMenuItem onSelect={(event) => invokeAction(event, props.onRestore)}>
              <RotateCcw aria-hidden="true" />
              Restore
            </DropdownMenuItem>
          ) : (
            <>
              {showEdit ? (
                <DropdownMenuItem onSelect={(event) => invokeAction(event, props.onEdit)}>
                  <Pencil aria-hidden="true" />
                  Edit
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onSelect={(event) => invokeAction(event, props.onDuplicate)}>
                <Copy aria-hidden="true" />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={(event) => invokeAction(event, props.onArchive)}>
                <Archive aria-hidden="true" />
                Archive
              </DropdownMenuItem>
            </>
          )}
          {props.archived === true ? (
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
