import { assignedExpansionInterfaceLabel } from '@/components/assigned-expansion-heading-model'
import type { InventoryItem } from '@/types/inventory'

export function AssignedExpansionHeading({ item }: { item: InventoryItem }) {
  const interfaceLabel = assignedExpansionInterfaceLabel(item)

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
      <span className="min-w-0 break-words text-[11px] font-bold leading-tight" title={item.name}>
        {item.name}
      </span>
      {interfaceLabel ? (
        <span className="shrink-0 rounded-full border border-current/20 bg-black/10 px-1.5 py-0.5 text-[8px] font-black leading-none">
          {interfaceLabel}
        </span>
      ) : null}
    </div>
  )
}
