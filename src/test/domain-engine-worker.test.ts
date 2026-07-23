import { describe, expect, it, vi } from 'vitest'
import {
  decodeEngineRequest,
  encodeEngineRequest,
  encodeEngineResponse,
  encodeEngineSnapshot,
} from '../../shared/engine/protocol.mjs'
import type { DomainWorkerRequest, DomainWorkerResponse } from '../engine/types'
import { attachDomainEngineWorker } from '../workers/domain-engine.worker'

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('domain engine worker', () => {
  it('initializes once and transfers binary dispatch responses', async () => {
    const messages: DomainWorkerResponse[] = []
    const scope: {
      onmessage: ((event: MessageEvent<DomainWorkerRequest>) => void) | null
      postMessage: ReturnType<typeof vi.fn>
    } = {
      onmessage: null,
      postMessage: vi.fn((message: DomainWorkerResponse) => messages.push(message)),
    }
    const runtime = {
      create: vi.fn(() => 4),
      dispatch: vi.fn((_handle: number, bytes: Uint8Array) => {
        const request = decodeEngineRequest(bytes)
        return encodeEngineResponse({
          protocol_version: 1,
          request_id: request.request_id,
          base_revision: request.base_revision,
          result: {
            kind: 'status',
            payload: {
              revision: request.base_revision,
              geometry_revision: 0,
              routing_revision: 0,
              project_name: 'Rack Lab',
            },
          },
        })
      }),
      destroy: vi.fn(() => true),
    }
    const loadRuntime = vi.fn(async () => runtime)
    attachDomainEngineWorker(scope as never, { loadRuntime: loadRuntime as never })

    const snapshot = encodeEngineSnapshot({ revision: 5, project_name: 'Rack Lab' })
    scope.onmessage?.({ data: {
      kind: 'initialize',
      snapshot: snapshot.buffer.slice(snapshot.byteOffset, snapshot.byteOffset + snapshot.byteLength),
    } } as MessageEvent<DomainWorkerRequest>)
    await settle()

    const request = encodeEngineRequest({
      protocol_version: 1,
      request_id: 3,
      base_revision: 5,
      operation: { kind: 'status' },
    })
    scope.onmessage?.({ data: {
      kind: 'dispatch',
      requestId: 3,
      request: request.buffer.slice(request.byteOffset, request.byteOffset + request.byteLength),
    } } as MessageEvent<DomainWorkerRequest>)
    await settle()

    expect(loadRuntime).toHaveBeenCalledOnce()
    expect(messages[0]).toEqual({ kind: 'ready', revision: 5 })
    expect(messages[1]).toMatchObject({ kind: 'response', requestId: 3 })
    expect(scope.postMessage.mock.calls[1]?.[1]).toHaveLength(1)
  })

  it('reports initialization failures without creating a handle', async () => {
    const messages: DomainWorkerResponse[] = []
    const scope = {
      onmessage: null as ((event: MessageEvent<DomainWorkerRequest>) => void) | null,
      postMessage: (message: DomainWorkerResponse) => messages.push(message),
    }
    attachDomainEngineWorker(scope, {
      loadRuntime: async () => { throw new Error('WASM unavailable') },
    })
    const snapshot = encodeEngineSnapshot({ revision: 1, project_name: 'Lab' })

    scope.onmessage?.({ data: {
      kind: 'initialize',
      snapshot: snapshot.buffer.slice(snapshot.byteOffset, snapshot.byteOffset + snapshot.byteLength),
    } } as MessageEvent<DomainWorkerRequest>)
    await settle()

    expect(messages).toEqual([{ kind: 'failure', message: 'WASM unavailable' }])
  })
})
