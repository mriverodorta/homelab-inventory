import { useContext } from 'react'
import { DomainEngineContext } from '@/engine/react-context'

const disabledDomainEngine = {
  enabled: false,
  session: 0,
  client: null as never,
  state: { phase: 'idle' as const, revision: null },
  syncEvent: null,
  setEnabled: () => {},
  retry: async () => {},
}

export function useDomainEngine() {
  const context = useContext(DomainEngineContext)
  return context ?? disabledDomainEngine
}
