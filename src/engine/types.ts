import type { EngineRequest, EngineResponse, EngineSnapshot } from '../../shared/engine/protocol.mjs'

export type DomainEnginePhase =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'conflict'
  | 'rebuilding'
  | 'failed'
  | 'unsupported'
  | 'disposed'

export type DomainEngineState = {
  phase: DomainEnginePhase
  revision: number | null
  reason?: string
  error?: string
}

export type DomainWorkerRequest =
  | { kind: 'initialize'; snapshot: ArrayBuffer }
  | { kind: 'dispatch'; requestId: number; request: ArrayBuffer }
  | { kind: 'dispose' }

export type DomainWorkerResponse =
  | { kind: 'ready'; revision: number }
  | { kind: 'response'; requestId: number; response: ArrayBuffer }
  | { kind: 'failure'; requestId?: number; message: string }

export type WorkerLike = Pick<Worker, 'postMessage' | 'terminate'> & {
  onmessage: ((event: MessageEvent<DomainWorkerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
}

export type DomainEngineApi = {
  fetchSnapshot(): Promise<{ snapshot: EngineSnapshot; bytes: Uint8Array }>
  postCommand(bytes: Uint8Array): Promise<{ response: EngineResponse; bytes: Uint8Array }>
}

export type DomainEngineClientOptions = {
  api?: DomainEngineApi
  workerFactory?: () => WorkerLike
  supportsWasm?: () => boolean
  maxStartupAttempts?: number
}

export type PendingWorkerRequest = {
  resolve(response: EngineResponse): void
  reject(error: Error): void
}

export type EngineRequestInput = Omit<EngineRequest, 'protocol_version' | 'request_id' | 'base_revision'>
