import { act, render } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ApplicationLiveEventsProvider } from './application-live-events-provider'
import { useLiveEventTopic } from './use-live-event-topic'

class FakeEventSource {
  listeners = new Map<string, Set<(event: Event) => void>>()
  close = vi.fn()
  readonly url: string
  constructor(url: string) { this.url = url }
  addEventListener(name: string, listener: EventListener) {
    const callback = listener as (event: Event) => void
    const values = this.listeners.get(name) ?? new Set()
    values.add(callback)
    this.listeners.set(name, values)
  }
  emit(name: string, data: object) {
    for (const listener of this.listeners.get(name) ?? []) listener(new MessageEvent(name, { data: JSON.stringify(data) }))
  }
}

function Consumer({ topic, enabled = true, onEvent, onResync }: { topic: 'agents:fleet' | 'notifications:summary'; enabled?: boolean; onEvent: () => void; onResync: () => void }) {
  useLiveEventTopic({ topic, enabled, onEvent, onResync })
  return null
}

describe('ApplicationLiveEventsProvider', () => {
  it('owns one normalized stream and dispatches ordered topic events', async () => {
    const sources: FakeEventSource[] = []
    const events = vi.fn()
    const resync = vi.fn()
    const factory = (url: string) => { const source = new FakeEventSource(url); sources.push(source); return source }
    function Fixture() {
      const [notifications, setNotifications] = useState(true)
      return <><button onClick={() => setNotifications(false)}>close</button><Consumer topic="agents:fleet" onEvent={events} onResync={resync} />{notifications ? <Consumer topic="notifications:summary" onEvent={events} onResync={resync} /> : null}</>
    }
    const view = render(<ApplicationLiveEventsProvider eventSourceFactory={factory}><Fixture /></ApplicationLiveEventsProvider>)
    await act(async () => {})
    expect(sources).toHaveLength(1)
    expect(decodeURIComponent(sources[0].url)).toContain('agents:fleet,notifications:summary')
    act(() => sources[0].emit('stream-ready', { version: 1, generationId: 'g1', sequence: 2, topics: ['agents:fleet', 'notifications:summary'] }))
    expect(resync).toHaveBeenCalledTimes(2)
    act(() => sources[0].emit('app-event', { version: 1, generationId: 'g1', sequence: 3, topic: 'agents:fleet', topics: ['agents:fleet'], kind: 'changed', occurredAt: 'now', payload: {} }))
    expect(events).toHaveBeenCalledTimes(1)
    act(() => sources[0].emit('app-event', { version: 1, generationId: 'g1', sequence: 3, topic: 'agents:fleet', topics: ['agents:fleet'], kind: 'changed', occurredAt: 'now', payload: {} }))
    expect(events).toHaveBeenCalledTimes(1)
    act(() => view.getByRole('button').click())
    expect(sources[0].close).toHaveBeenCalledOnce()
    expect(sources).toHaveLength(2)
    expect(decodeURIComponent(sources[1].url)).toContain('agents:fleet')
  })
})
