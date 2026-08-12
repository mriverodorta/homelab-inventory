import { useMemo, useState } from 'react'
import {
  DndContext,
  MouseSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { MoreHorizontal, Plus, Settings2 } from 'lucide-react'
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
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { WorkspaceDialog } from '@/components/workbook/workspace-dialog'
import { WorkspaceIcon } from '@/components/workbook/workspace-icon'
import { workspaceColor } from '@/components/workbook/workspace-style'
import type { WorkspaceInput, WorkspaceSummary } from '@/lib/workbook-api'
import { cn } from '@/lib/utils'

type WorkbookTabStripProps = {
  workspaces: WorkspaceSummary[]
  activeWorkspaceId: number
  busy?: boolean
  error?: string | null
  onSelect(workspaceId: number): void
  onCreate(input: WorkspaceInput): Promise<void>
  onUpdate(workspaceId: number, input: Omit<WorkspaceInput, 'type'>): Promise<void>
  onArchive(workspaceId: number): Promise<void>
  onReorder(workspaceIds: number[]): Promise<void>
  onOpenProjectSettings?(): void
}

function WorkbookTab({
  workspace,
  active,
  onSelect,
  onEdit,
  onArchive,
}: {
  workspace: WorkspaceSummary
  active: boolean
  onSelect(): void
  onEdit(): void
  onArchive(): void
}) {
  const fixed = workspace.type === 'systems'
  const draggable = useDraggable({ id: workspace.id, disabled: fixed })
  const droppable = useDroppable({ id: workspace.id, disabled: fixed })
  const color = workspace.type === 'systems'
    ? { edge: '#737373', active: '#f0f0ee' }
    : workspaceColor(workspace.colorKey)
  const transform = draggable.transform ? CSS.Translate.toString(draggable.transform) : undefined

  return (
    <div
      ref={(node) => {
        draggable.setNodeRef(node)
        droppable.setNodeRef(node)
      }}
      style={{ transform, zIndex: draggable.isDragging ? 10 : undefined }}
      className={cn(
        'group/tab relative flex h-9 min-w-[112px] max-w-[220px] shrink-0 items-center border-r border-[#c9c1b6] border-t bg-[#ebe7df] text-[#4d4b47]',
        active && 'bg-[#fffdf8] text-[#20242c]',
        droppable.isOver && !draggable.isDragging && 'bg-[#e3ded4]',
      )}
      role="presentation"
    >
      <button
        ref={fixed ? undefined : draggable.setActivatorNodeRef}
        type="button"
        {...(fixed ? {} : draggable.listeners)}
        {...(fixed ? {} : draggable.attributes)}
        role="tab"
        aria-selected={active}
        title={workspace.name}
        className="flex h-full min-w-0 flex-1 items-center gap-2 px-3 text-left text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#6d655d]"
        style={{ backgroundColor: active ? color.active : undefined }}
        onClick={onSelect}
      >
        <WorkspaceIcon iconKey={workspace.iconKey} className="size-3.5 shrink-0" />
        <span className="truncate">{workspace.name}</span>
      </button>
      {!fixed ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="mr-1 size-6 shrink-0 opacity-0 group-hover/tab:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
              aria-label={`${workspace.name} actions`}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>Rename and style</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onArchive}>Archive workspace</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <span className="absolute inset-x-0 bottom-0 h-[3px]" style={{ backgroundColor: active ? color.edge : 'transparent' }} />
    </div>
  )
}

export function WorkbookTabStrip({
  workspaces,
  activeWorkspaceId,
  busy = false,
  error = null,
  onSelect,
  onCreate,
  onUpdate,
  onArchive,
  onReorder,
  onOpenProjectSettings,
}: WorkbookTabStripProps) {
  const [dialog, setDialog] = useState<{ mode: 'create' | 'edit'; workspace?: WorkspaceSummary } | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<WorkspaceSummary | null>(null)
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }))
  const ordered = useMemo(
    () => [...workspaces].sort((left, right) => left.sortOrder - right.sortOrder),
    [workspaces],
  )

  function handleDragEnd(event: DragEndEvent) {
    const from = Number(event.active.id)
    const to = Number(event.over?.id)
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from === to) return
    const movable = ordered.filter((workspace) => workspace.type !== 'systems').map((workspace) => workspace.id)
    const fromIndex = movable.indexOf(from)
    const toIndex = movable.indexOf(to)
    if (fromIndex < 0 || toIndex < 0) return
    movable.splice(toIndex, 0, movable.splice(fromIndex, 1)[0])
    void onReorder(movable)
  }

  return (
    <>
      <div className="flex h-[var(--workbook-tab-strip-height)] shrink-0 items-end border-t border-[#bdb4a8] bg-[#ded9d0]" role="tablist" aria-label="Project workspaces">
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div className="flex min-w-0 flex-1 items-end overflow-x-auto overflow-y-hidden [scrollbar-width:thin]">
            {ordered.map((workspace) => (
              <WorkbookTab
                key={workspace.id}
                workspace={workspace}
                active={workspace.id === activeWorkspaceId}
                onSelect={() => onSelect(workspace.id)}
                onEdit={() => setDialog({ mode: 'edit', workspace })}
                onArchive={() => setArchiveTarget(workspace)}
              />
            ))}
          </div>
        </DndContext>
        <div className="flex h-full shrink-0 items-center gap-0.5 border-l border-[#c4bbb0] px-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon-sm" variant="ghost" aria-label="New Canvas workspace" disabled={busy} onClick={() => setDialog({ mode: 'create' })}>
                <Plus />
              </Button>
            </TooltipTrigger>
            <TooltipContent>New Canvas workspace</TooltipContent>
          </Tooltip>
          {onOpenProjectSettings ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon-sm" variant="ghost" aria-label="Project settings" onClick={onOpenProjectSettings}>
                  <Settings2 />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Project settings</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </div>

      <WorkspaceDialog
        open={dialog !== null}
        workspace={dialog?.workspace ?? null}
        busy={busy}
        error={error}
        onOpenChange={(open) => { if (!open) setDialog(null) }}
        onSubmit={async (input) => {
          if (dialog?.mode === 'edit' && dialog.workspace) {
            await onUpdate(dialog.workspace.id, input)
          } else {
            await onCreate(input)
          }
          setDialog(null)
        }}
      />

      <AlertDialog open={archiveTarget !== null} onOpenChange={(open) => { if (!open) setArchiveTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {archiveTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the Canvas tab and its workspace layout from the active project. Inventory records remain available.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              variant="destructive"
              onClick={(event) => {
                event.preventDefault()
                if (!archiveTarget) return
                void onArchive(archiveTarget.id)
                  .then(() => setArchiveTarget(null))
                  .catch(() => {})
              }}
            >
              Archive workspace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
