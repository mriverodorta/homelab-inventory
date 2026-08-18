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
    return parsed?.version === 1
      && typeof parsed.generationId === 'string'
      && Number.isSafeInteger(parsed.sequence)
      && Array.isArray(parsed.topics)
      && parsed.topicSequences !== null
      && typeof parsed.topicSequences === 'object'
      ? parsed
      : null
  } catch { return null }
}

function parseEvent(value: string): ApplicationLiveEvent | null {
  try {
    const parsed = JSON.parse(value) as ApplicationLiveEvent
    return parsed?.version === 1
      && typeof parsed.generationId === 'string'
      && Number.isSafeInteger(parsed.sequence)
      && typeof parsed.topic === 'string'
      && Array.isArray(parsed.topics)
      && parsed.topics.every((topic) => typeof topic === 'string')
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
  const topicSequences = useRef(new Map<string, number>())

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
    const resync = (resyncTopics = topics) => {
      for (const subscription of subscriptions.current.values()) {
        if (resyncTopics.includes(subscription.topic)) subscription.onResync()
      }
    }
    const onReady = (raw: Event) => {
      const ready = parseReady((raw as MessageEvent<string>).data)
      if (!ready) return
      const changedGeneration = generation.current !== null && generation.current !== ready.generationId
      const staleTopics = topics.filter((topic) => {
        const previous = topicSequences.current.get(topic)
        const current = ready.topicSequences[topic] ?? 0
        return previous === undefined || changedGeneration || current > previous
      })
      generation.current = ready.generationId
      for (const topic of topics) topicSequences.current.set(topic, ready.topicSequences[topic] ?? 0)
      if (staleTopics.length > 0) resync(staleTopics)
    }
    const onEvent = (raw: Event) => {
      const event = parseEvent((raw as MessageEvent<string>).data)
      if (!event) return
      const matchingTopics = event.topics.filter((topic) => topics.includes(topic))
      if (matchingTopics.length === 0) return
      if (generation.current !== null && event.generationId !== generation.current) {
        generation.current = event.generationId
        for (const topic of matchingTopics) topicSequences.current.set(topic, event.sequence)
        resync(matchingTopics)
        return
      }
      generation.current = event.generationId
      const freshTopics = matchingTopics.filter((topic) => event.sequence > (topicSequences.current.get(topic) ?? 0))
      if (freshTopics.length === 0) return
      for (const topic of freshTopics) topicSequences.current.set(topic, event.sequence)
      for (const subscription of subscriptions.current.values()) {
        if (freshTopics.includes(subscription.topic)) subscription.onEvent(event)
      }
    }
    source.addEventListener('stream-ready', onReady)
    source.addEventListener('app-event', onEvent)
    return () => source.close()
  }, [eventSourceFactory, topicKey, topics, visible])

  const value = useMemo(() => ({ subscribe }), [subscribe])
  return <ApplicationLiveEventsContext.Provider value={value}>{children}</ApplicationLiveEventsContext.Provider>
}
