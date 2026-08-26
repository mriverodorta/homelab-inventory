import { createContext } from 'react'
import type { EngineResponse } from '../../shared/engine/protocol.mjs'
import type { DomainEngineClient } from './client'
import type { DomainEngineState } from './types'
import type { CanvasRuntimeScope } from './runtime-scope'

export type DomainEngineSyncEvent =
  | { runtimeKey: string; sequence: number; kind: 'patch'; external: boolean; response: EngineResponse }
  | { runtimeKey: string; sequence: number; kind: 'invalidation' }

export type DomainEngineContextValue = {
  enabled: boolean
  runtimeKey: string | null
  generation: number
  session: number
  client: DomainEngineClient
  state: DomainEngineState
  syncEvent: DomainEngineSyncEvent | null
  activateCanvas(scope: CanvasRuntimeScope | null): void
  setRuntimeBusy(runtimeKey: string, busy: boolean): void
  removeCanvasRuntime(scope: CanvasRuntimeScope): void
  clearCanvasRuntimes(): void
  getCanvasRuntimeKeys(): string[]
  setEnabled(enabled: boolean): void
  retry(): Promise<void>
}

export const DomainEngineContext = createContext<DomainEngineContextValue | null>(null)
