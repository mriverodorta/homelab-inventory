import { cn } from '@/lib/utils'

export function SystemsUtilizationBar({ value, kind }: { value: number; kind: 'cpu' | 'memory' | 'storage' }) {
  const normalized = Math.min(Math.max(value, 0), 100)
  const tone = kind === 'storage'
    ? normalized >= 90 ? 'bg-[#b34f43]' : normalized >= 80 ? 'bg-[#c1841a]' : 'bg-[#3f8f6f]'
    : 'bg-[#3f7f9f]'
  return (
    <div
      className="relative h-1.5 w-full min-w-16 overflow-hidden rounded-[2px] bg-[#ded8cf]"
      role="img"
      aria-label={`${kind} utilization ${Math.round(normalized)} percent`}
    >
      <div className={cn('absolute inset-y-0 left-0', tone)} style={{ width: `${normalized}%` }} />
      {[25, 50, 75].map((position) => (
        <span
          key={position}
          className="absolute inset-y-0 w-px bg-[#fffdf8]/80"
          style={{ left: `${position}%` }}
          aria-hidden="true"
        />
      ))}
    </div>
  )
}
