import { COLOR_STYLES } from '@/components/inventory-metadata/metadata-presentation'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { InventoryMetadataProjectionTag } from '@/types/inventory-metadata'

export function InventoryTagPreview({ tags, compact = false }: { tags: readonly InventoryMetadataProjectionTag[]; compact?: boolean }) {
  if (tags.length === 0) return null
  const visible = tags.slice(0, 2)
  const remaining = tags.length - visible.length
  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-1', compact && 'mt-1')} aria-label={`${tags.length} inventory ${tags.length === 1 ? 'tag' : 'tags'}`}>
      {visible.map((tag) => (
        <span key={tag.id} className="inline-flex max-w-28 items-center gap-1 rounded border border-current/15 bg-current/5 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-inherit">
          <span className={cn('size-1.5 shrink-0 rounded-full', COLOR_STYLES[tag.colorToken])} />
          <span className="truncate">{tag.name}</span>
        </span>
      ))}
      {remaining > 0 ? (
        <Tooltip>
          <TooltipTrigger asChild><span className="text-[10px] font-semibold text-current/70">+{remaining}</span></TooltipTrigger>
          <TooltipContent>{tags.slice(2).map((tag) => tag.name).join(', ')}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  )
}
