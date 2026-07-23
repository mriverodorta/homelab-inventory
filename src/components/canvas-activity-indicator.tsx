import { AlertTriangle, LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

export type CanvasActivity = {
  kind: 'progress' | 'error'
  label: string
}

export function CanvasActivityIndicator({
  activity,
  delayMs = 150,
  className,
}: {
  activity: CanvasActivity | null
  delayMs?: number
  className?: string
}) {
  const [showProgress, setShowProgress] = useState(false)

  useEffect(() => {
    if (activity?.kind !== 'progress') {
      setShowProgress(false)
      return
    }

    const timer = window.setTimeout(() => setShowProgress(true), delayMs)
    return () => window.clearTimeout(timer)
  }, [activity?.kind, activity?.label, delayMs])

  if (!activity || (activity.kind === 'progress' && !showProgress)) return null
  const failed = activity.kind === 'error'

  return (
    <div
      role={failed ? 'alert' : 'status'}
      className={cn(
        'pointer-events-none flex min-h-9 items-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold shadow-sm backdrop-blur-sm',
        failed
          ? 'border-[#dfb3a5] bg-[#fff4ee]/95 text-[#613126]'
          : 'border-[#d6ccbd] bg-[#fffdf8]/95 text-[#5d554c]',
        className,
      )}
    >
      {failed ? (
        <AlertTriangle aria-hidden="true" className="size-4 shrink-0" />
      ) : (
        <LoaderCircle aria-hidden="true" className="size-4 shrink-0 animate-spin" />
      )}
      <span>{activity.label}</span>
    </div>
  )
}
