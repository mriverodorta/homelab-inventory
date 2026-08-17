import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { decodeEngineResponse } from '../../shared/engine/protocol.mjs'
import { DomainEngineClient } from '@/engine/client'
import { scopedEngineUrl } from '@/engine/api'
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
  const [active, setActive] = useState(enabled)
  const activeRef = useRef(active)
  const [client, setClient] = useState(() => providedClient ?? new DomainEngineClient())
  const [state, setState] = useState<DomainEngineState>(() => (
    active ? client.status() : { phase: 'ready', revision: null }
  ))
  const [syncEvent, setSyncEvent] = useState<DomainEngineSyncEvent | null>(null)
  const sequenceRef = useRef(0)
  const disposeTimerRef = useRef<{ client: DomainEngineClient; timer: number } | null>(null)
  const setEnabled = useCallback((nextEnabled: boolean) => {
    if (activeRef.current === nextEnabled) return
    activeRef.current = nextEnabled
    if (nextEnabled && !providedClient) setClient(new DomainEngineClient())
    setActive(nextEnabled)
  }, [providedClient])

  useEffect(() => setEnabled(enabled), [enabled, setEnabled])
  useEffect(() => {
    if (providedClient) setClient(providedClient)
  }, [providedClient])

  useEffect(() => {
    if (!active) {
      setState({ phase: 'ready', revision: null })
      setSyncEvent(null)
      return
    }
    if (disposeTimerRef.current?.client === client) {
      window.clearTimeout(disposeTimerRef.current.timer)
      disposeTimerRef.current = null
    }
    const unsubscribe = client.subscribe(setState)
    void client.start().catch(() => {})
    return () => {
      unsubscribe()
      const timer = window.setTimeout(() => {
        client.dispose()
        if (disposeTimerRef.current?.timer === timer) disposeTimerRef.current = null
      }, 0)
      disposeTimerRef.current = { client, timer }
    }
  }, [active, client])

  useEffect(() => {
    if (!active || state.phase !== 'ready') return
    const source = eventSourceFactory(scopedEngineUrl('/api/engine/events'))
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
  }, [active, client, eventSourceFactory, state.phase])

  const value = useMemo<DomainEngineContextValue>(() => ({
    enabled: active,
    client,
    state,
    syncEvent,
    setEnabled,
    retry: () => client.start(),
  }), [active, client, setEnabled, state, syncEvent])

  return <DomainEngineContext.Provider value={value}>{children}</DomainEngineContext.Provider>
}
