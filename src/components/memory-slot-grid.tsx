import { useDroppable } from '@dnd-kit/core'
import type { ReactNode } from 'react'
import { assignmentMemoryPosition } from '@/components/memory-slot-model'
import type { ComponentAssignment } from '@/types/inventory'

function MemorySlot({
  children,
  hostId,
  position,
}: {
  children: ReactNode
  hostId: string
  position: number
}) {
  const droppable = useDroppable({
    id: `memory-slot:${hostId}:${String(position)}`,
    data: { kind: 'memory-slot', serverId: hostId, position },
  })
  return (
    <div
      ref={droppable.setNodeRef}
      data-memory-slot={position + 1}
      className={`min-w-0 rounded-md ${droppable.isOver ? 'ring-2 ring-[#ddb668]' : ''}`}
    >
      {children}
    </div>
  )
}

export function MemorySlotGrid({
  assignments,
  hostId,
  renderAssignment,
  slotCount,
}: {
  assignments: ComponentAssignment[]
  hostId: string
  renderAssignment: (assignment: ComponentAssignment, position: number | null) => ReactNode
  slotCount: number | null
}) {
  if (slotCount === null) {
    return (
      <div className="space-y-1.5 rounded-md border border-dashed border-[#766e63] bg-[#2a2f39] p-1.5">
        <div className="px-1 text-[9px] font-black uppercase tracking-[0.12em] text-[#cfc6b8]">
          RAM slots unknown
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {assignments.length > 0
            ? assignments.map((assignment) => <div key={assignment.id} className="min-w-0">{renderAssignment(assignment, null)}</div>)
            : <div className="col-span-2 px-1 py-1 text-xs text-[#cfc6b8]">RAM drop slot</div>}
        </div>
      </div>
    )
  }

  const byPosition = new Map<number, ComponentAssignment>()
  const unpositioned: ComponentAssignment[] = []
  for (const assignment of assignments) {
    const position = assignmentMemoryPosition(assignment)
    if (position === null || position >= slotCount || byPosition.has(position)) unpositioned.push(assignment)
    else byPosition.set(position, assignment)
  }
  for (let position = 0; position < slotCount && unpositioned.length > 0; position += 1) {
    if (!byPosition.has(position)) byPosition.set(position, unpositioned.shift()!)
  }

  return (
    <div
      className={`grid gap-1.5 ${slotCount === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}
      data-memory-slot-count={slotCount}
    >
      {Array.from({ length: slotCount }, (_, position) => {
        const assignment = byPosition.get(position)
        return (
          <MemorySlot key={position} hostId={hostId} position={position}>
            {assignment
              ? renderAssignment(assignment, position)
              : (
                <div className="flex h-11 items-center justify-center rounded-md border border-dashed border-[#766e63] bg-[#2a2f39] px-2 text-[10px] font-bold text-[#9f988c]">
                  Slot {position + 1}
                </div>
              )}
          </MemorySlot>
        )
      })}
    </div>
  )
}
