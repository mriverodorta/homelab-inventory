import { X } from 'lucide-react'
import { RegistryLinkIndicator } from '@/components/registry-link-indicator'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function AssignedItemCornerActions({
  itemName,
  linked,
  onRemove,
  removeClassName,
  selected,
}: {
  itemName: string
  linked: boolean
  onRemove: () => void
  removeClassName?: string
  selected: boolean
}) {
  return (
    <>
      <RegistryLinkIndicator visible={linked} />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`Remove ${itemName}`}
        className={cn(
          'pointer-events-none absolute top-1 right-1 z-20 size-6 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100',
          selected && 'pointer-events-auto opacity-100',
          removeClassName,
        )}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          onRemove()
        }}
      >
        <X className="size-3" />
      </Button>
    </>
  )
}
