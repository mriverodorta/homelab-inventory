import { Activity } from 'lucide-react'
import { InspectorSection } from '@/components/inspector/inspector-section'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { AgentTelemetrySample } from '@/types/agent'
import { cn } from '@/lib/utils'
import {
  AGENT_HEARTBEAT_WINDOW_MINUTES,
  buildHeartbeatBuckets,
} from './agent-heartbeat-model'

export function AgentHeartbeatTimeline({
  samples,
  expected,
  serverTime,
}: {
  samples: AgentTelemetrySample[]
  expected: boolean
  serverTime?: string
}) {
  const parsedServerTime = serverTime ? Date.parse(serverTime) : Number.NaN
  const buckets = buildHeartbeatBuckets(samples, Number.isFinite(parsedServerTime) ? parsedServerTime : Date.now())
  const received = buckets.filter((bucket) => bucket.received).length

  return (
    <InspectorSection
      title="Heartbeat History"
      icon={Activity}
      badge={<span className="text-xs font-bold tabular-nums text-[#75695d]">{received}/{AGENT_HEARTBEAT_WINDOW_MINUTES}</span>}
    >
      <TooltipProvider>
        <div className="grid grid-cols-[repeat(15,minmax(0,1fr))] gap-1 sm:grid-cols-[repeat(30,minmax(0,1fr))]" aria-label={`${received} of the last ${AGENT_HEARTBEAT_WINDOW_MINUTES} expected heartbeats received`}>
          {buckets.map((bucket) => (
            <Tooltip key={bucket.minute}>
              <TooltipTrigger asChild>
                <span
                  className={cn(
                    'h-5 min-w-0 rounded-[3px]',
                    bucket.received
                      ? 'bg-[#368675]'
                      : expected
                        ? 'bg-[#cb6b57]'
                        : 'bg-[#d8d1c6]',
                  )}
                  aria-label={`${bucket.label}: ${bucket.received ? 'heartbeat received' : expected ? 'heartbeat missed' : 'not expected'}`}
                />
              </TooltipTrigger>
              <TooltipContent>{bucket.label}: {bucket.received ? 'Received' : expected ? 'Missed' : 'Not expected'}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      </TooltipProvider>
      <div className="mt-2 flex justify-between text-[11px] font-semibold text-[#75695d]">
        <span>30 minutes ago</span>
        <span>Now</span>
      </div>
    </InspectorSection>
  )
}
