import { cn } from '@/lib/utils'

export function SystemsUtilizationBar({ value, kind }: { value: number; kind: 'cpu' | 'memory' | 'storage' }) {
  const normalized = Math.min(Math.max(value, 0), 100)
  const rounded = Math.round(normalized)
  const label = rounded < 10 ? `0${rounded}%` : `${rounded}%`
  const tone = kind === 'storage'
    ? normalized >= 90 ? 'bg-[#b34f43]' : normalized >= 80 ? 'bg-[#c1841a]' : 'bg-[#3f8f6f]'
    : 'bg-[#3f7f9f]'
  return (
    <div className="grid min-w-0 grid-cols-[4ch_minmax(4rem,1fr)] items-center gap-1.5" role="img" aria-label={`${kind} utilization ${rounded} percent`}>
      <span className="w-[4ch] shrink-0 text-left text-[10px] font-semibold leading-none tabular-nums text-[#665f57]">{label}</span>
      <div className="relative h-1.5 min-w-16 flex-1 overflow-hidden rounded-[2px] bg-[#ded8cf]">
        <div className={cn('absolute inset-y-0 left-0', tone)} style={{ width: `${normalized}%` }} />
        {[25, 50, 75].map((position) => (
          <span key={position} className="absolute inset-y-0 w-px bg-[#fffdf8]/80" style={{ left: `${position}%` }} aria-hidden="true" />
        ))}
      </div>
    </div>
  )
}
