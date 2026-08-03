import type { ReactNode } from 'react'
import { assignmentCpuPosition } from '@/components/cpu-slot-model'
import type { ComponentAssignment } from '@/types/inventory'

export function CpuSlotGrid({
  assignments,
  renderAssignment,
  socketCount,
}: {
  assignments: ComponentAssignment[]
  renderAssignment: (assignment: ComponentAssignment, position: number) => ReactNode
  socketCount: number
}) {
  const byPosition = new Map<number, ComponentAssignment>()
  const unpositioned: ComponentAssignment[] = []
  for (const assignment of assignments) {
    const position = assignmentCpuPosition(assignment)
    if (position === null || position >= socketCount || byPosition.has(position)) unpositioned.push(assignment)
    else byPosition.set(position, assignment)
  }
  for (let position = 0; position < socketCount && unpositioned.length > 0; position += 1) {
    if (!byPosition.has(position)) byPosition.set(position, unpositioned.shift()!)
  }

  return (
    <div className="grid grid-cols-2 gap-1.5" data-cpu-socket-count={socketCount}>
      {Array.from({ length: socketCount }, (_, position) => {
        const assignment = byPosition.get(position)
        return assignment
          ? <div key={position} className="min-w-0">{renderAssignment(assignment, position)}</div>
          : (
            <div
              key={position}
              className="flex h-11 items-center justify-center rounded-md border border-dashed border-[#766e63] bg-[#2a2f39] px-2 text-[10px] font-bold text-[#9f988c]"
            >
              CPU {position + 1}
            </div>
          )
      })}
    </div>
  )
}
