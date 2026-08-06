import type { AgentTelemetrySample } from '@/types/agent'

const MINUTE_MS = 60_000
export const AGENT_HEARTBEAT_WINDOW_MINUTES = 30

export type HeartbeatBucket = {
  minute: number
  received: boolean
  label: string
}

export function buildHeartbeatBuckets(samples: AgentTelemetrySample[], now = Date.now()): HeartbeatBucket[] {
  const currentMinute = Math.floor(now / MINUTE_MS) * MINUTE_MS
  const receivedMinutes = new Set(samples.map((sample) => Math.floor(Date.parse(sample.receivedAt) / MINUTE_MS) * MINUTE_MS))
  return Array.from({ length: AGENT_HEARTBEAT_WINDOW_MINUTES }, (_, index) => {
    const minute = currentMinute - ((AGENT_HEARTBEAT_WINDOW_MINUTES - 1 - index) * MINUTE_MS)
    return {
      minute,
      received: receivedMinutes.has(minute),
      label: new Date(minute).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    }
  })
}
