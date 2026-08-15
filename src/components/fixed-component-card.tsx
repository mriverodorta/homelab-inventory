import { LockKeyhole } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { InventoryFixedComponent } from '@/types/inventory'

function tone(componentType: string): string {
  if (componentType === 'cpu') return 'border-[#87bdc9] bg-[#c7e7ed] text-[#18353b]'
  if (componentType === 'ram' || componentType === 'memory') {
    return 'border-[#d4ad52] bg-[#f3d990] text-[#3a2b0d]'
  }
  if (componentType === 'storage') return 'border-[#b9c7d0] bg-[#dfe7ec] text-[#24343d]'
  if (componentType === 'powerAdapter') return 'border-[#c6ad8b] bg-[#eee0cb] text-[#3d3022]'
  return 'border-[#c8c0b5] bg-[#eee9e2] text-[#342f29]'
}

function componentFacts(component: InventoryFixedComponent): string[] {
  const item = component.item
  const specs = item.specs ?? {}
  const facts = [item.manufacturer, item.model ?? item.number]

  if (item.type === 'cpu') {
    if (typeof specs.cores === 'number' && typeof specs.threads === 'number') {
      facts.push(`${specs.cores}C/${specs.threads}T`)
    }
  } else if (item.type === 'ram') {
    if (typeof specs.capacityMib === 'number') facts.push(`${specs.capacityMib / 1024}GB`)
    else if (typeof specs.capacityGb === 'number') facts.push(`${specs.capacityGb}GB`)
    if (typeof specs.generation === 'string') facts.push(specs.generation)
    if (typeof specs.speedMt === 'number') facts.push(`${specs.speedMt}MT/s`)
  } else if (item.type === 'storage') {
    if (typeof specs.capacityBytes === 'number') {
      facts.push(`${Math.round(specs.capacityBytes / 1_000_000_000)}GB`)
    }
    if (typeof specs.interface === 'string') facts.push(specs.interface)
  } else if (item.type === 'powerAdapter') {
    if (typeof specs.powerMw === 'number') facts.push(`${specs.powerMw / 1000}W`)
    if (typeof specs.connector === 'string') facts.push(specs.connector)
  }

  return [...new Set(facts.filter((fact): fact is string => (
    typeof fact === 'string' && fact.trim().length > 0
  )))]
}

export function FixedComponentCard({
  component,
  compact = false,
  className,
}: {
  component: InventoryFixedComponent
  compact?: boolean
  className?: string
}) {
  const facts = componentFacts(component)

  return (
    <div
      data-fixed-component-id={component.id}
      data-fixed-component-type={component.componentType}
      className={cn(
        'relative min-w-0 rounded-md border',
        compact ? 'px-2 py-1.5' : 'p-2.5',
        tone(component.componentType),
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-2 pr-5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[10px] font-black uppercase opacity-70">
            {component.label}
          </div>
          <div className={cn('truncate font-black', compact ? 'text-xs' : 'text-sm')}>
            {component.item.name}
          </div>
        </div>
        <LockKeyhole
          aria-label={`${component.disposition} component`}
          className="absolute top-2 right-2 size-3.5 opacity-55"
        />
      </div>
      {facts.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {facts.slice(0, compact ? 3 : 6).map((fact) => (
            <span key={fact} className="rounded bg-white/55 px-1 py-0.5 text-[9px] font-bold leading-none">
              {fact}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}
