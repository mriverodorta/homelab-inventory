import { ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export function RegistryLinkIndicator({
  className,
  visible,
}: {
  className?: string
  visible: boolean
}) {
  if (!visible) return null

  return (
    <span
      data-testid="registry-link-indicator"
      aria-label="Linked to the official registry"
      className={cn(
        'pointer-events-none absolute top-1 right-1 z-10 inline-flex size-4 items-center justify-center opacity-50',
        className,
      )}
    >
      <ArrowUpRight aria-hidden="true" className="size-3" strokeWidth={2.25} />
    </span>
  )
}
