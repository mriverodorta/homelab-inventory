import { Activity } from 'lucide-react'
import { InspectorSection } from '@/components/inspector/inspector-section'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { AGENT_HEARTBEAT_WINDOW_MINUTES } from './agent-heartbeat-model'

export function AgentHeartbeatTimeline({
  buckets,
  expected,
}: {
  buckets: Array<{ at: string; received: boolean }>
  expected: boolean
}) {
  const received = buckets.filter((bucket) => bucket.received).length

  return (
    <InspectorSection
      title="Heartbeat History"
      icon={Activity}
      badge={<span className="text-xs font-bold tabular-nums text-[#75695d]">{received}/{AGENT_HEARTBEAT_WINDOW_MINUTES}</span>}
    >
      <TooltipProvider>
        <div className="grid grid-cols-[repeat(15,minmax(0,1fr))] gap-1 sm:grid-cols-[repeat(30,minmax(0,1fr))]" aria-label={`${received} of the last ${AGENT_HEARTBEAT_WINDOW_MINUTES} expected heartbeats received`}>
          {buckets.map((bucket) => {
            const at = Date.parse(bucket.at)
            const label = Number.isFinite(at) ? new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Unknown time'
            return <Tooltip key={bucket.at}>
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
                  aria-label={`${label}: ${bucket.received ? 'heartbeat received' : expected ? 'heartbeat missed' : 'not expected'}`}
                />
              </TooltipTrigger>
              <TooltipContent>{label}: {bucket.received ? 'Received' : expected ? 'Missed' : 'Not expected'}</TooltipContent>
            </Tooltip>
          })}
        </div>
      </TooltipProvider>
      <div className="mt-2 flex justify-between text-[11px] font-semibold text-[#75695d]">
        <span>30 minutes ago</span>
        <span>Now</span>
      </div>
    </InspectorSection>
  )
}
