import { useContext } from 'react'
import { DomainEngineContext, type DomainEngineContextValue } from '@/engine/react-context'

const disabledDomainEngine: DomainEngineContextValue = {
  enabled: false,
  runtimeKey: null,
  generation: 0,
  session: 0,
  client: null as never,
  state: { phase: 'idle' as const, revision: null },
  syncEvent: null,
  activateCanvas: () => {},
  setRuntimeBusy: () => {},
  removeCanvasRuntime: () => {},
  clearCanvasRuntimes: () => {},
  getCanvasRuntimeKeys: () => [],
  getCanvasRuntime: () => null,
  setEnabled: () => {},
  retry: async () => {},
}

export function useDomainEngine() {
  const context = useContext(DomainEngineContext)
  return context ?? disabledDomainEngine
}
