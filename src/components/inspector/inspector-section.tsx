import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { cn } from '@/lib/utils'

const inspectorPanelClass = 'border-[#e5dccf] bg-white/88 shadow-[0_10px_28px_rgba(60,52,43,0.06)]'

export function InspectorSection({
  title,
  icon: Icon,
  badge,
  children,
  className,
}: {
  title: string
  icon?: LucideIcon
  badge?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Card className={cn(inspectorPanelClass, 'gap-3 overflow-visible rounded-lg py-3', className)} size="sm">
      <CardHeader className="grid-cols-[1fr_auto] items-center gap-3 px-3">
        <CardTitle className="flex min-w-0 items-center gap-2 text-[11px] font-black uppercase tracking-[0.15em] text-[#75695d]">
          {Icon ? <Icon className="size-3.5 shrink-0" /> : null}
          <span className="truncate">{title}</span>
        </CardTitle>
        {badge ? <CardAction>{badge}</CardAction> : null}
      </CardHeader>
      <CardContent className="px-3">{children}</CardContent>
    </Card>
  )
}
