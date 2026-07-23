import {
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { decodeEngineResponse } from '../../shared/engine/protocol.mjs'
import { DomainEngineClient } from '@/engine/client'
import {
  DomainEngineContext,
  type DomainEngineContextValue,
  type DomainEngineSyncEvent,
} from '@/engine/react-context'
import type { DomainEngineState } from '@/engine/types'

const defaultEventSourceFactory = (url: string) => new EventSource(url)

function decodeBase64(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export function DomainEngineProvider({
  children,
  enabled,
  client: providedClient,
  eventSourceFactory = defaultEventSourceFactory,
}: {
  children: ReactNode
  enabled: boolean
  client?: DomainEngineClient
  eventSourceFactory?: (url: string) => EventSource
}) {
  const client = useMemo(() => providedClient ?? new DomainEngineClient(), [providedClient])
  const [state, setState] = useState<DomainEngineState>(() => (
    enabled ? client.status() : { phase: 'ready', revision: null }
  ))
  const [syncEvent, setSyncEvent] = useState<DomainEngineSyncEvent | null>(null)
  const sequenceRef = useRef(0)
  const disposeTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (!enabled) return
    if (disposeTimerRef.current !== null) window.clearTimeout(disposeTimerRef.current)
    const unsubscribe = client.subscribe(setState)
    void client.start().catch(() => {})
    return () => {
      unsubscribe()
      disposeTimerRef.current = window.setTimeout(() => client.dispose(), 0)
    }
  }, [client, enabled])

  useEffect(() => {
    if (!enabled || state.phase !== 'ready') return
    const source = eventSourceFactory('/api/engine/events')
    const onPatch = (event: Event) => {
      const message = event as MessageEvent<string>
      void (async () => {
        try {
          const data = JSON.parse(message.data) as { payload: string }
          const bytes = decodeBase64(data.payload)
          const response = decodeEngineResponse(bytes)
          const beforeRevision = client.status().revision
          const result = await client.applyCommittedResponse(bytes)
          sequenceRef.current += 1
          setSyncEvent({
            sequence: sequenceRef.current,
            kind: 'patch',
            external: result.kind === 'applied' && response.base_revision === beforeRevision,
            response,
          })
        } catch {
          await client.rebuild('A committed project event could not be decoded.').catch(() => {})
          sequenceRef.current += 1
          setSyncEvent({ sequence: sequenceRef.current, kind: 'invalidation' })
        }
      })()
    }
    const onInvalidation = (event: Event) => {
      const message = event as MessageEvent<string>
      const invalidatedRevision = (() => {
        try {
          const data = JSON.parse(message.data) as { revision?: unknown }
          return typeof data.revision === 'number' ? data.revision : null
        } catch {
          return null
        }
      })()

      if (
        invalidatedRevision !== null
        && client.status().phase === 'ready'
        && client.status().revision === invalidatedRevision
      ) {
        return
      }

      void client.rebuild('Project data changed outside the domain command stream.')
        .then(() => {
          sequenceRef.current += 1
          setSyncEvent({ sequence: sequenceRef.current, kind: 'invalidation' })
        })
        .catch(() => {})
    }
    source.addEventListener('project-patch', onPatch)
    source.addEventListener('project-invalidated', onInvalidation)
    return () => source.close()
  }, [client, enabled, eventSourceFactory, state.phase])

  const value = useMemo<DomainEngineContextValue>(() => ({
    enabled,
    client,
    state,
    syncEvent,
    retry: () => client.start(),
  }), [client, enabled, state, syncEvent])

  return <DomainEngineContext.Provider value={value}>{children}</DomainEngineContext.Provider>
}
