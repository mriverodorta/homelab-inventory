import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragCancelEvent,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import type { ReactNode } from 'react'

export type DndWorkspaceProps = {
  active: boolean
  children: ReactNode
  overlay?: ReactNode
  onDragStart?: (event: DragStartEvent) => void
  onDragOver?: (event: DragOverEvent) => void
  onDragCancel?: (event: DragCancelEvent) => void
  onDragEnd?: (event: DragEndEvent) => void
}

export function DndWorkspace({
  active,
  children,
  overlay,
  onDragStart,
  onDragOver,
  onDragCancel,
  onDragEnd,
}: DndWorkspaceProps) {
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 350,
        tolerance: 8,
      },
    }),
  )

  return (
    <DndContext
      sensors={active ? sensors : []}
      onDragStart={active ? onDragStart : undefined}
      onDragOver={active ? onDragOver : undefined}
      onDragCancel={active ? onDragCancel : undefined}
      onDragEnd={active ? onDragEnd : undefined}
    >
      {children}
      <DragOverlay dropAnimation={null} zIndex={80}>
        {active ? overlay : null}
      </DragOverlay>
    </DndContext>
  )
}
