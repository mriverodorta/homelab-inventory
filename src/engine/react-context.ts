import { createContext } from 'react'
import type { EngineResponse } from '../../shared/engine/protocol.mjs'
import type { DomainEngineClient } from './client'
import type { DomainEngineState } from './types'

export type DomainEngineSyncEvent =
  | { sequence: number; kind: 'patch'; external: boolean; response: EngineResponse }
  | { sequence: number; kind: 'invalidation' }

export type DomainEngineContextValue = {
  enabled: boolean
  client: DomainEngineClient
  state: DomainEngineState
  syncEvent: DomainEngineSyncEvent | null
  retry(): Promise<void>
}

export const DomainEngineContext = createContext<DomainEngineContextValue | null>(null)
