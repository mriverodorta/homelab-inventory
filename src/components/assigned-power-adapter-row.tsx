import { useDraggable } from '@dnd-kit/core'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { formatInventoryCompactSpec } from '@/lib/format'
import { runtimeItemKey } from '@/lib/item-keys'
import { useTapSelection } from '@/lib/tap-selection'
import type { ComponentAssignment, InventoryItem } from '@/types/inventory'

type AssignedPowerAdapterRowProps = {
  adapter: InventoryItem
  assignment: ComponentAssignment
  className?: string
  onRemoveAssignment: (assignmentId: string | number) => void
  onSelect: (itemId: string) => void
  portChip?: ReactNode
  selected: boolean
}

export function AssignedPowerAdapterRow({
  adapter,
  assignment,
  className = '',
  onRemoveAssignment,
  onSelect,
  portChip,
  selected,
}: AssignedPowerAdapterRowProps) {
  const adapterKey = runtimeItemKey(adapter)
  const draggable = useDraggable({
    id: `assignment:${assignment.id}`,
    data: {
      kind: 'assigned-component',
      assignmentId: assignment.id,
      itemId: assignment.itemId,
      sourceServerId: assignment.serverId,
    },
  })
  const {
    role: _dragRole,
    tabIndex: _dragTabIndex,
    ...dragAttributes
  } = draggable.attributes
  const tapSelection = useTapSelection<HTMLDivElement>((event) => {
    event.stopPropagation()
    onSelect(adapterKey)
  })

  return (
    <div
      ref={draggable.setNodeRef}
      role="button"
      tabIndex={0}
      data-testid="assigned-power-adapter-row"
      className={`nodrag cursor-grab rounded-md bg-[#4a3928] p-2 text-[#fff8ec] active:cursor-grabbing ${
        selected ? 'ring-2 ring-white/80' : ''
      } ${draggable.isDragging ? 'opacity-45' : ''} ${className}`}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          event.stopPropagation()
          onSelect(adapterKey)
        }
      }}
      {...draggable.listeners}
      {...tapSelection}
      {...dragAttributes}
    >
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[9px] font-black uppercase tracking-[0.16em] opacity-75">
            Power Adapter
          </div>
          <div className="mt-1 truncate text-[11px] font-bold">{adapter.name}</div>
          <div className="truncate text-[9px] font-semibold opacity-75">
            {formatInventoryCompactSpec(adapter)}
          </div>
        </div>
        {portChip}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-5 shrink-0 text-[#fff8ec] opacity-70 hover:opacity-100"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            onRemoveAssignment(assignment.id)
          }}
          aria-label={`Remove ${adapter.name}`}
        >
          <X className="size-3" />
        </Button>
      </div>
    </div>
  )
}
