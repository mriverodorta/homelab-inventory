import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApplicationLiveEventsContext, type ApplicationLiveSubscription } from './application-live-events-context'
import type { ApplicationLiveEvent, ApplicationStreamReady } from './model'

type EventSourceLike = Readonly<{
  addEventListener(name: string, listener: EventListener): void
  close(): void
}>
const defaultEventSourceFactory = (url: string): EventSourceLike => new EventSource(url) as EventSourceLike

function parseReady(value: string): ApplicationStreamReady | null {
  try {
    const parsed = JSON.parse(value) as ApplicationStreamReady
    return parsed?.version === 1 && typeof parsed.generationId === 'string' && Number.isSafeInteger(parsed.sequence) ? parsed : null
  } catch { return null }
}

function parseEvent(value: string): ApplicationLiveEvent | null {
  try {
    const parsed = JSON.parse(value) as ApplicationLiveEvent
    return parsed?.version === 1
      && typeof parsed.generationId === 'string'
      && Number.isSafeInteger(parsed.sequence)
      && typeof parsed.topic === 'string'
      && typeof parsed.kind === 'string'
      ? parsed
      : null
  } catch { return null }
}

export function ApplicationLiveEventsProvider({
  children,
  eventSourceFactory = defaultEventSourceFactory,
}: {
  children: ReactNode
  eventSourceFactory?: (url: string) => EventSourceLike
}) {
  const subscriptions = useRef(new Map<symbol, ApplicationLiveSubscription>())
  const [revision, setRevision] = useState(0)
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden')
  const generation = useRef<string | null>(null)
  const sequence = useRef<number | null>(null)

  const subscribe = useCallback((subscription: ApplicationLiveSubscription) => {
    const id = Symbol(subscription.topic)
    subscriptions.current.set(id, subscription)
    setRevision((value) => value + 1)
    return () => {
      if (!subscriptions.current.delete(id)) return
      setRevision((value) => value + 1)
    }
  }, [])

  const topics = useMemo(() => {
    void revision
    return [...new Set([...subscriptions.current.values()].map((subscription) => subscription.topic))].sort()
  }, [revision])
  const topicKey = topics.join(',')

  useEffect(() => {
    const onVisibility = () => setVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  useEffect(() => {
    if (!visible || !topicKey) return
    const source = eventSourceFactory(`/api/events?topics=${encodeURIComponent(topicKey)}`)
    const resync = () => {
      for (const subscription of subscriptions.current.values()) {
        if (topics.includes(subscription.topic)) subscription.onResync()
      }
    }
    const onReady = (raw: Event) => {
      const ready = parseReady((raw as MessageEvent<string>).data)
      if (!ready) return
      generation.current = ready.generationId
      sequence.current = ready.sequence
      resync()
    }
    const onEvent = (raw: Event) => {
      const event = parseEvent((raw as MessageEvent<string>).data)
      if (!event || !topics.includes(event.topic)) return
      if (generation.current !== null && event.generationId !== generation.current) {
        generation.current = event.generationId
        sequence.current = event.sequence
        resync()
        return
      }
      if (sequence.current !== null && event.sequence <= sequence.current) return
      if (sequence.current !== null && event.sequence > sequence.current + 1) resync()
      generation.current = event.generationId
      sequence.current = event.sequence
      for (const subscription of subscriptions.current.values()) {
        if (subscription.topic === event.topic) subscription.onEvent(event)
      }
    }
    source.addEventListener('stream-ready', onReady)
    source.addEventListener('app-event', onEvent)
    return () => source.close()
  }, [eventSourceFactory, topicKey, topics, visible])

  const value = useMemo(() => ({ subscribe }), [subscribe])
  return <ApplicationLiveEventsContext.Provider value={value}>{children}</ApplicationLiveEventsContext.Provider>
}
