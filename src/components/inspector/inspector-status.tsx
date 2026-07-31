import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export type InspectorStatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

const toneClasses: Record<InspectorStatusTone, string> = {
  danger: 'border-[#dfb3a5] bg-[#fff4ee] text-[#7a2c1d]',
  info: 'border-[#b8d4dc] bg-[#d7eef2] text-[#102f36]',
  neutral: 'border-[#e5dccf] bg-[#f3f0ea] text-[#75695d]',
  success: 'border-[#a7d8cd] bg-[#d3eee7] text-[#143733]',
  warning: 'border-[#e8d392] bg-[#fff2c7] text-[#3d2a08]',
}

export function StatusBadge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode
  tone?: InspectorStatusTone
  className?: string
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'h-6 rounded-md px-2 text-[10px] font-black uppercase tracking-[0.08em]',
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </Badge>
  )
}
