import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Columns3, GripVertical, LockKeyhole } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { DEFAULT_SYSTEMS_COLUMNS } from '@/lib/systems-preferences'
import type { CustomFieldDefinition } from '@/types/inventory-metadata'
import type { SystemsColumnKey, SystemsViewColumn } from '@/types/systems'
import { systemsColumnLabel } from './systems-columns'

function SortableColumn({ column, definitions, onVisibility }: { column: SystemsViewColumn; definitions: ReadonlyMap<number, CustomFieldDefinition>; onVisibility(key: SystemsColumnKey, visible: boolean): void }) {
  const locked = column.key === 'type' || column.key === 'name'
  const label = systemsColumnLabel(column.key, definitions)
  const sortable = useSortable({ id: column.key, disabled: locked })
  return (
    <div ref={sortable.setNodeRef} style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }} className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-accent">
      <button type="button" aria-label={`Move ${label}`} className="grid size-7 place-items-center text-muted-foreground disabled:cursor-not-allowed disabled:opacity-40" disabled={locked} {...sortable.attributes} {...sortable.listeners}>
        {locked ? <LockKeyhole className="size-3.5" /> : <GripVertical className="size-4" />}
      </button>
      <Checkbox disabled={locked} checked={column.visible} onCheckedChange={(checked) => onVisibility(column.key, checked === true)} />
      <span className="min-w-0 truncate text-sm" title={label}>{label}</span>
    </div>
  )
}

export function SystemsColumnMenu({ columns, definitions, onChange }: { columns: readonly SystemsViewColumn[]; definitions: readonly CustomFieldDefinition[]; onChange(columns: SystemsViewColumn[]): void }) {
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const ordered = [...columns].sort((left, right) => left.order - right.order)
  const definitionMap = new Map(definitions.map((definition) => [definition.id, definition]))
  const dragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id || active.id === 'type' || active.id === 'name') return
    const oldIndex = ordered.findIndex((column) => column.key === active.id)
    const targetIndex = Math.max(2, ordered.findIndex((column) => column.key === over.id))
    onChange(arrayMove(ordered, oldIndex, targetIndex).map((column, order) => ({ ...column, order })))
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button type="button" variant="outline" size="icon-sm" className="size-9 bg-white" aria-label="Configure columns"><Columns3 /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 p-2" onCloseAutoFocus={(event) => event.preventDefault()}>
        <DropdownMenuLabel>Columns</DropdownMenuLabel><DropdownMenuSeparator />
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}>
          <SortableContext items={ordered.map((column) => column.key)} strategy={verticalListSortingStrategy}>
            {ordered.map((column) => <SortableColumn key={column.key} column={column} definitions={definitionMap} onVisibility={(key, visible) => onChange(ordered.map((entry) => entry.key === key ? { ...entry, visible } : entry))} />)}
          </SortableContext>
        </DndContext>
        <DropdownMenuSeparator />
        <Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={() => onChange([
          ...DEFAULT_SYSTEMS_COLUMNS,
          ...definitions.filter((definition) => !definition.archivedAt && definition.applicableItemTypes.some((type) => ['server', 'nas', 'pcBuild'].includes(type))).map((definition, index) => ({
            key: `custom-field:${definition.id}` as const,
            visible: false,
            order: DEFAULT_SYSTEMS_COLUMNS.length + index,
          })),
        ])}>Reset columns</Button>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
