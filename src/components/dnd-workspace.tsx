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
  children: ReactNode
  overlay: ReactNode
  onDragStart: (event: DragStartEvent) => void
  onDragOver: (event: DragOverEvent) => void
  onDragCancel: (event: DragCancelEvent) => void
  onDragEnd: (event: DragEndEvent) => void
}

export function DndWorkspace({
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
      sensors={sensors}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragCancel={onDragCancel}
      onDragEnd={onDragEnd}
    >
      {children}
      <DragOverlay dropAnimation={null} zIndex={80}>
        {overlay}
      </DragOverlay>
    </DndContext>
  )
}
