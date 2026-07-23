import { useContext } from 'react'
import { DomainEngineContext } from '@/engine/react-context'

const disabledDomainEngine = {
  enabled: false,
  client: null as never,
  state: { phase: 'ready' as const, revision: null },
  syncEvent: null,
  retry: async () => {},
}

export function useDomainEngine() {
  const context = useContext(DomainEngineContext)
  return context ?? disabledDomainEngine
}
