import { cn } from '@/lib/utils'
import type { SystemsMemoryBreakdown } from '@/types/systems'

type MemorySegment = Readonly<{
  key: 'used' | 'buffers' | 'cache' | 'shared'
  label: string
  percent: number
  className: string
}>

function boundedMemorySegments(memory: SystemsMemoryBreakdown): { segments: MemorySegment[]; availablePercent: number } | null {
  const { totalBytes, availableBytes, buffersBytes, cachedBytes, sharedBytes } = memory
  if (
    !Number.isFinite(totalBytes) || totalBytes <= 0
    || !Number.isFinite(availableBytes) || availableBytes < 0 || availableBytes > totalBytes
    || !Number.isFinite(buffersBytes) || buffersBytes < 0
    || !Number.isFinite(cachedBytes) || cachedBytes < 0
    || (sharedBytes !== null && (!Number.isFinite(sharedBytes) || sharedBytes < 0))
  ) return null

  let remainingBytes = totalBytes
  const take = (bytes: number) => {
    const bounded = Math.min(Math.max(bytes, 0), remainingBytes)
    remainingBytes -= bounded
    return bounded * 100 / totalBytes
  }
  const candidates: MemorySegment[] = [
    { key: 'used', label: 'used', percent: take(totalBytes - availableBytes), className: 'bg-[#3f8f6f]' },
    { key: 'buffers', label: 'buffers', percent: take(buffersBytes), className: 'bg-[#3977a8]' },
    { key: 'cache', label: 'cache', percent: take(cachedBytes), className: 'bg-[#c1841a]' },
    { key: 'shared', label: 'shared', percent: take(sharedBytes ?? 0), className: 'bg-[#b34f43]' },
  ]
  return {
    segments: candidates.filter(({ percent }) => percent > 0),
    availablePercent: remainingBytes * 100 / totalBytes,
  }
}

function formatSegmentPercent(value: number) {
  return `${Number(value.toFixed(1))}%`
}

export function SystemsUtilizationBar({
  value,
  kind,
  memoryBreakdown = null,
}: {
  value: number
  kind: 'cpu' | 'memory' | 'storage'
  memoryBreakdown?: SystemsMemoryBreakdown | null
}) {
  const normalized = Math.min(Math.max(value, 0), 100)
  const rounded = Math.round(normalized)
  const label = rounded < 10 ? `0${rounded}%` : `${rounded}%`
  const tone = kind === 'storage'
    ? normalized >= 90 ? 'bg-[#b34f43]' : normalized >= 80 ? 'bg-[#c1841a]' : 'bg-[#3f8f6f]'
    : kind === 'memory' ? 'bg-[#3f8f6f]' : 'bg-[#3f7f9f]'
  const memorySegments = kind === 'memory' && memoryBreakdown ? boundedMemorySegments(memoryBreakdown) : null
  const ariaLabel = memorySegments
    ? `memory utilization ${rounded} percent; ${[
        ...memorySegments.segments.map((segment) => `${segment.label} ${formatSegmentPercent(segment.percent)}`),
        `available ${formatSegmentPercent(memorySegments.availablePercent)}`,
      ].join(', ')}`
    : `${kind} utilization ${rounded} percent`
  return (
    <div className="grid min-w-0 grid-cols-[4ch_minmax(4rem,1fr)] items-center gap-1.5" role="img" aria-label={ariaLabel}>
      <span className="w-[4ch] shrink-0 text-left text-[10px] font-semibold leading-none tabular-nums text-[#665f57]">{label}</span>
      <div className="relative h-1.5 min-w-16 flex-1 overflow-hidden rounded-[2px] bg-[#ded8cf]">
        <div className="absolute inset-0 flex">
          {memorySegments
            ? memorySegments.segments.map((segment) => (
                <div
                  key={segment.key}
                  data-memory-segment={segment.key}
                  className={segment.className}
                  style={{ width: `${segment.percent}%` }}
                />
              ))
            : <div data-memory-segment={kind === 'memory' ? 'used' : undefined} className={cn('h-full', tone)} style={{ width: `${normalized}%` }} />}
        </div>
        {[25, 50, 75].map((position) => (
          <span key={position} className="absolute inset-y-0 w-px bg-[#fffdf8]/80" style={{ left: `${position}%` }} aria-hidden="true" />
        ))}
      </div>
    </div>
  )
}
