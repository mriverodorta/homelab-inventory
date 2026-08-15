import { Layers3 } from 'lucide-react'
import { FixedComponentCard } from '@/components/fixed-component-card'
import { InspectorSection } from '@/components/inspector/inspector-section'
import { StatusBadge } from '@/components/inspector/inspector-status'
import { slotTone } from '@/components/inspector/slots/equipment-slot-model'
import { getSlotStatus, SLOT_LABELS, sortAssignmentsForDisplay } from '@/lib/constraints'
import { formatCapacity, formatPortSummary } from '@/lib/format'
import { runtimeItemKey } from '@/lib/item-keys'
import { cn } from '@/lib/utils'
import type { ComponentType, InventoryItem, ProjectState } from '@/types/inventory'

const labelClass = 'text-[11px] font-black uppercase tracking-[0.12em] text-[#75695d]'

function getSlotItemParts(item: InventoryItem): string[] {
  const specs = item.specs ?? {}

  if (item.type === 'cpu') {
    return [
      item.manufacturer,
      item.family,
      item.number,
      typeof specs.cores === 'number' && typeof specs.threads === 'number'
        ? `${specs.cores}C/${specs.threads}T`
        : null,
    ].filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
  }

  if (item.type === 'ram') {
    const capacity = typeof specs.capacityGb === 'number' ? `${specs.capacityGb}GB` : null
    const module = typeof specs.formFactor === 'string' ? specs.formFactor : null
    const speed = typeof specs.speedMt === 'number' ? `${specs.speedMt}MT/s` : null

    return [
      capacity,
      typeof specs.generation === 'string' ? specs.generation : null,
      module,
      speed,
    ].filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
  }

  if (item.type === 'storage') {
    return [
      formatCapacity(specs),
      typeof specs.interface === 'string' ? specs.interface : null,
      typeof specs.formFactor === 'string' ? specs.formFactor : null,
    ].filter((part): part is string => typeof part === 'string' && part.trim().length > 0 && part !== 'Unknown')
  }

  if (item.type === 'gpu' || item.type === 'network') {
    return [
      item.manufacturer,
      item.model,
      formatPortSummary(item),
    ].filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
  }

  return []
}

export function SlotItemCard({ item }: { item: InventoryItem }) {
  const parts = getSlotItemParts(item)

  return (
    <div className="rounded-md border border-white/70 bg-white/75 p-2 shadow-[0_4px_12px_rgba(60,52,43,0.05)]">
      <div className="truncate text-sm font-black text-[#20242c]">{item.name}</div>
      {parts.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {parts.map((part) => (
            <span
              key={part}
              className="rounded-md bg-[#fffdf8] px-1.5 py-0.5 text-[10px] font-black text-[#3c342b]"
            >
              {part}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function EquipmentSlotsTab({
  project,
  host,
  title,
  allowedTypes,
}: {
  project: ProjectState
  host: InventoryItem
  title: string
  allowedTypes?: ComponentType[]
}) {
  const hostRuntimeKey = runtimeItemKey(host)
  const assignments = sortAssignmentsForDisplay(project, hostRuntimeKey)
  const slotStatus = getSlotStatus(project, hostRuntimeKey)
    .filter((slot) => !allowedTypes || allowedTypes.includes(slot.type))

  return (
    <InspectorSection
      title={title}
      icon={Layers3}
      badge={<StatusBadge>{slotStatus.length}</StatusBadge>}
    >
      <div className="grid gap-2">
        {host.fixedComponents?.length ? (
          <div className="grid gap-2 rounded-lg border border-[#d6ccbd] bg-[#f8f3eb] p-3">
            <div className="flex items-center justify-between gap-2">
              <div className={cn(labelClass, 'text-[10px]')}>Fixed hardware</div>
              <StatusBadge tone="neutral">{host.fixedComponents.length} locked</StatusBadge>
            </div>
            <div className="grid gap-2">
              {host.fixedComponents.map((component) => (
                <FixedComponentCard key={component.id} component={component} />
              ))}
            </div>
          </div>
        ) : null}
        {slotStatus.map((slot) => {
          const matches = assignments.filter((assignment) => assignment.type === slot.type)

          return (
            <div
              key={slot.type}
              className={cn('grid gap-2 rounded-lg border p-3', slotTone(slot.type))}
            >
              <div className="flex items-center justify-between gap-2">
                <div className={cn(labelClass, 'text-[10px]')}>
                  {SLOT_LABELS[slot.type]}
                </div>
                <StatusBadge tone={matches.length > 0 ? 'success' : 'neutral'}>
                  {slot.limit === null
                    ? `${matches.length} added`
                    : matches.length > 0 ? 'Filled' : 'Open'}
                </StatusBadge>
              </div>
              {matches.length > 0 ? (
                <div className="grid gap-2">
                  {matches.map((assignment) => {
                    const item = project.items[assignment.itemId]

                    return item ? <SlotItemCard key={assignment.id} item={item} /> : null
                  })}
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-white/80 bg-white/35 p-3 text-sm font-semibold text-[#75695d]">
                  No {SLOT_LABELS[slot.type].toLowerCase()} assigned.
                </div>
              )}
            </div>
          )
        })}
      </div>
    </InspectorSection>
  )
}
