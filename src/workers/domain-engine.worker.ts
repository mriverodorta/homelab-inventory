/// <reference lib="webworker" />

import { decodeEngineSnapshot } from '../../shared/engine/protocol.mjs'
import { WasmEngineRuntime } from '../../shared/engine/wasm-runtime.mjs'
import type { DomainWorkerRequest, DomainWorkerResponse } from '../engine/types'

type WorkerScope = {
  onmessage: ((event: MessageEvent<DomainWorkerRequest>) => void) | null
  postMessage(message: DomainWorkerResponse, transfer?: Transferable[]): void
}

type WorkerDependencies = {
  loadRuntime(): Promise<WasmEngineRuntime>
}

export function attachDomainEngineWorker(scope: WorkerScope, dependencies: WorkerDependencies) {
  let runtimePromise: Promise<WasmEngineRuntime> | null = null
  let runtime: WasmEngineRuntime | null = null
  let handle: number | null = null

  const fail = (error: unknown, requestId?: number) => {
    scope.postMessage({
      kind: 'failure',
      ...(requestId === undefined ? {} : { requestId }),
      message: error instanceof Error ? error.message : 'Workspace engine worker failed.',
    })
  }

  scope.onmessage = (event) => {
    const message = event.data
    void (async () => {
      try {
        if (message.kind === 'initialize') {
          if (runtime && handle) runtime.destroy(handle)
          runtimePromise ??= dependencies.loadRuntime()
          runtime = await runtimePromise
          const snapshot = decodeEngineSnapshot(message.snapshot)
          handle = runtime.create(new Uint8Array(message.snapshot))
          scope.postMessage({ kind: 'ready', revision: snapshot.revision })
          return
        }

        if (message.kind === 'dispose') {
          if (runtime && handle) runtime.destroy(handle)
          handle = null
          return
        }

        if (!runtime || !handle) throw new Error('Workspace engine worker is not initialized.')
        const bytes = runtime.dispatch(handle, new Uint8Array(message.request))
        const response = Uint8Array.from(bytes).buffer
        scope.postMessage({ kind: 'response', requestId: message.requestId, response }, [response])
      } catch (error) {
        fail(error, message.kind === 'dispatch' ? message.requestId : undefined)
      }
    })()
  }
}

if (typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope) {
  const scope = globalThis as unknown as WorkerScope
  attachDomainEngineWorker(scope, {
    async loadRuntime() {
      const wasmUrl = new URL('../engine/generated/homelab_engine.wasm', import.meta.url)
      const response = await fetch(wasmUrl)
      if (!response.ok) throw new Error(`Unable to load workspace engine (${String(response.status)}).`)
      return WasmEngineRuntime.instantiate(response)
    },
  })
}
