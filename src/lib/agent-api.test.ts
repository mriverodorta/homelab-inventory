import { describe, expect, it } from 'vitest'
import { AGENT_STATUS_REFRESH_INTERVAL_MS } from '@/lib/agent-api'

describe('agent API polling contract', () => {
  it('refreshes the compact fleet status at the one-minute heartbeat cadence', () => {
    expect(AGENT_STATUS_REFRESH_INTERVAL_MS).toBe(60_000)
  })
})
