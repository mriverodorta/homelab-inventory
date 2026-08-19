import { cn } from '@/lib/utils'
import { useAnimatedUtilization } from './use-animated-utilization'

export function SystemsUtilizationBar({
  value,
  kind,
}: {
  value: number
  kind: 'cpu' | 'memory' | 'storage'
}) {
  const { displayed, target, reducedMotion } = useAnimatedUtilization(value)
  const rounded = Math.round(displayed)
  const label = rounded < 10 ? `0${rounded}%` : `${rounded}%`
  const tone = kind === 'storage'
    ? displayed >= 90 ? 'bg-[#b34f43]' : displayed >= 80 ? 'bg-[#c1841a]' : 'bg-[#3f8f6f]'
    : kind === 'memory' ? 'bg-[#3f8f6f]' : 'bg-[#3f7f9f]'
  return (
    <div className="grid min-w-[125px] grid-cols-[3.5ch_minmax(0,1fr)] items-center" role="img" aria-label={`${kind} utilization ${rounded} percent`}>
      <span className="w-[3.5ch] shrink-0 text-left text-[10px] font-semibold leading-none tabular-nums text-[#665f57]">{label}</span>
      <div className="relative h-1.5 min-w-0 overflow-hidden rounded-[2px] bg-[#ded8cf]">
        <div className="absolute inset-0 flex">
          <div
            data-utilization-fill
            data-memory-segment={kind === 'memory' ? 'used' : undefined}
            className={cn(
              'h-full',
              tone,
              !reducedMotion && 'transition-[width] duration-[600ms] [transition-timing-function:cubic-bezier(0.33,1,0.68,1)]',
            )}
            style={{ width: `${target}%` }}
          />
        </div>
        {[25, 50, 75].map((position) => (
          <span key={position} className="absolute inset-y-0 w-px bg-[#fffdf8]/80" style={{ left: `${position}%` }} aria-hidden="true" />
        ))}
      </div>
    </div>
  )
}
