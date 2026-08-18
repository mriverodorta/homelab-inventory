import { useContext, useEffect, useRef } from 'react'
import { ApplicationLiveEventsContext } from './application-live-events-context'
import type { ApplicationLiveEvent, ApplicationLiveTopic } from './model'

export function useLiveEventTopic({
  topic,
  enabled,
  onEvent,
  onResync,
}: {
  topic: ApplicationLiveTopic
  enabled: boolean
  onEvent(event: ApplicationLiveEvent): void
  onResync(): void
}) {
  const context = useContext(ApplicationLiveEventsContext)
  const eventRef = useRef(onEvent)
  const resyncRef = useRef(onResync)
  eventRef.current = onEvent
  resyncRef.current = onResync

  useEffect(() => {
    if (!enabled || !context) return
    return context.subscribe({
      topic,
      onEvent: (event) => eventRef.current(event),
      onResync: () => resyncRef.current(),
    })
  }, [context, enabled, topic])
}

