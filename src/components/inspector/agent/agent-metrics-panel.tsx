import { Cpu, MemoryStick } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { InspectorSection } from '@/components/inspector/inspector-section'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import type { AgentMetrics } from '@/types/agent'
import { AGENT_PERCENTAGE_TICKS } from './agent-telemetry-formatters'

const chartConfig = {
  cpu: { label: 'CPU', color: '#2f7668' },
  memory: { label: 'Memory', color: '#c58a32' },
} satisfies ChartConfig

function bucketRows(buckets: Array<{ at: string; metrics: AgentMetrics | null }>) {
  return buckets.map((bucket) => ({
    time: new Date(bucket.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    cpu: typeof bucket.metrics?.cpu?.percent === 'number' ? bucket.metrics.cpu.percent : null,
    memory: typeof bucket.metrics?.memory?.usedPercent === 'number' ? bucket.metrics.memory.usedPercent : null,
  }))
}

function MetricChart({
  rows,
  dataKey,
  color,
}: {
  rows: ReturnType<typeof bucketRows>
  dataKey: 'cpu' | 'memory'
  color: string
}) {
  return (
    <ChartContainer config={chartConfig} className="h-32 w-full aspect-auto" initialDimension={{ width: 320, height: 128 }}>
      <AreaChart data={rows} margin={{ left: 0, right: 8, top: 8, bottom: 0 }} accessibilityLayer>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="time" hide />
        <YAxis domain={[0, 100]} ticks={[...AGENT_PERCENTAGE_TICKS]} tickLine={false} axisLine={false} width={44} tickFormatter={(value) => `${value}%`} />
        <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
        <Area dataKey={dataKey} type="monotone" stroke={color} fill={color} fillOpacity={0.12} strokeWidth={2} connectNulls={false} isAnimationActive={false} />
      </AreaChart>
    </ChartContainer>
  )
}

export function AgentMetricsPanel({ metricBuckets }: { metricBuckets: Array<{ at: string; metrics: AgentMetrics | null }> }) {
  const rows = bucketRows(metricBuckets)
  const hasCpu = rows.some((row) => row.cpu !== null)
  const hasMemory = rows.some((row) => row.memory !== null)

  if (!hasCpu && !hasMemory) {
    return (
      <InspectorSection title="Host Metrics" icon={Cpu}>
        <p className="text-sm font-semibold text-[#75695d]">CPU and memory history are unavailable for this host.</p>
      </InspectorSection>
    )
  }

  return (
    <InspectorSection title="Host Metrics" icon={Cpu}>
      <div className="grid gap-5">
        {hasCpu ? (
          <section aria-label="CPU utilization history">
            <div className="mb-1 flex items-center gap-2 text-xs font-bold text-[#3c342b]"><Cpu className="size-3.5" />CPU utilization</div>
            <MetricChart rows={rows} dataKey="cpu" color="var(--color-cpu)" />
          </section>
        ) : null}
        {hasMemory ? (
          <section aria-label="Memory utilization history" className={hasCpu ? 'border-t border-[#e5dccf] pt-4' : ''}>
            <div className="mb-1 flex items-center gap-2 text-xs font-bold text-[#3c342b]"><MemoryStick className="size-3.5" />Memory utilization</div>
            <MetricChart rows={rows} dataKey="memory" color="var(--color-memory)" />
          </section>
        ) : null}
      </div>
    </InspectorSection>
  )
}
