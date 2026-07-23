import { describe, expect, it, vi } from 'vitest'
import {
  decodeEngineRequest,
  encodeEngineResponse,
  encodeEngineSnapshot,
  type EngineRequest,
  type EngineResponse,
} from '../../shared/engine/protocol.mjs'
import { DomainEngineApiError } from '../engine/api'
import { DomainEngineClient, SupersededEngineQueryError } from '../engine/client'
import type { DomainEngineApi, DomainWorkerRequest, DomainWorkerResponse, WorkerLike } from '../engine/types'

class FakeWorker implements WorkerLike {
  onmessage: ((event: MessageEvent<DomainWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  terminated = false
  readonly requests: EngineRequest[] = []
  private revision = 1
  private projectName = 'Lab'
  private readonly failInitialization: boolean

  constructor(failInitialization = false) {
    this.failInitialization = failInitialization
  }

  postMessage(message: DomainWorkerRequest) {
    queueMicrotask(() => {
      if (message.kind === 'initialize') {
        if (this.failInitialization) {
          this.onmessage?.({ data: { kind: 'failure', message: 'startup failed' } } as MessageEvent<DomainWorkerResponse>)
          return
        }
        this.onmessage?.({ data: { kind: 'ready', revision: this.revision } } as MessageEvent<DomainWorkerResponse>)
        return
      }
      if (message.kind !== 'dispatch') return
      const request = decodeEngineRequest(message.request)
      this.requests.push(request)
      let result: EngineResponse['result']
      if (request.operation.kind === 'update-project-metadata') {
        this.revision += 1
        this.projectName = request.operation.payload.name
        result = {
          kind: 'patch',
          payload: {
            revision: this.revision,
            forward: { kind: 'set-project-name', payload: { name: this.projectName } },
            inverse: { kind: 'set-project-name', payload: { name: 'Lab' } },
          },
        }
      } else {
        result = {
          kind: 'status',
          payload: {
            revision: this.revision,
            geometry_revision: 0,
            project_name: this.projectName,
          },
        }
      }
      const bytes = encodeEngineResponse({
        protocol_version: 1,
        request_id: request.request_id,
        base_revision: request.base_revision,
        result,
      })
      this.onmessage?.({
        data: {
          kind: 'response',
          requestId: request.request_id,
          response: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        },
      } as MessageEvent<DomainWorkerResponse>)
    })
  }

  terminate() {
    this.terminated = true
  }
}

function api(overrides: Partial<DomainEngineApi> = {}): DomainEngineApi {
  const snapshot = { revision: 1, project_name: 'Lab' }
  return {
    fetchSnapshot: vi.fn(async () => ({ snapshot, bytes: encodeEngineSnapshot(snapshot) })),
    postCommand: vi.fn(async (bytes) => {
      const request = decodeEngineRequest(bytes)
      const response: EngineResponse = {
        protocol_version: 1,
        request_id: request.request_id,
        base_revision: request.base_revision,
        result: {
          kind: 'patch',
          payload: {
            revision: request.base_revision + 1,
            forward: { kind: 'set-project-name', payload: { name: 'Rack Lab' } },
            inverse: { kind: 'set-project-name', payload: { name: 'Lab' } },
          },
        },
      }
      return { response, bytes: encodeEngineResponse(response) }
    }),
    ...overrides,
  }
}

describe('DomainEngineClient', () => {
  it('moves from idle through loading to ready', async () => {
    const states: string[] = []
    const client = new DomainEngineClient({ api: api(), workerFactory: () => new FakeWorker() })
    client.subscribe((state) => states.push(state.phase))

    await client.start()

    expect(states).toEqual(['idle', 'loading', 'ready'])
    expect(client.status()).toMatchObject({ phase: 'ready', revision: 1 })
    client.dispose()
  })

  it('retries startup three times before entering failed', async () => {
    const workerFactory = vi.fn(() => new FakeWorker(true))
    const client = new DomainEngineClient({ api: api(), workerFactory })

    await expect(client.start()).rejects.toThrow('startup failed')

    expect(workerFactory).toHaveBeenCalledTimes(3)
    expect(client.status().phase).toBe('failed')
  })

  it('enters unsupported when Worker or WebAssembly is unavailable', async () => {
    const client = new DomainEngineClient({ supportsWasm: () => false })

    await client.start()

    expect(client.status().phase).toBe('unsupported')
  })

  it('coalesces reads so only the newest queued query runs', async () => {
    const worker = new FakeWorker()
    const client = new DomainEngineClient({ api: api(), workerFactory: () => worker })
    await client.start()

    const first = client.query({ operation: { kind: 'status' } })
    const second = client.query({ operation: { kind: 'status' } })

    await expect(first).rejects.toBeInstanceOf(SupersededEngineQueryError)
    await expect(second).resolves.toMatchObject({ result: { kind: 'status' } })
    expect(worker.requests).toHaveLength(1)
    client.dispose()
  })

  it('serializes mutations and waits for the prior server commit', async () => {
    let releaseFirst = () => {}
    const firstCommit = new Promise<void>((resolve) => { releaseFirst = resolve })
    let commandCount = 0
    const testApi = api({
      postCommand: vi.fn(async (bytes) => {
        commandCount += 1
        if (commandCount === 1) await firstCommit
        const request = decodeEngineRequest(bytes)
        const response: EngineResponse = {
          protocol_version: 1,
          request_id: request.request_id,
          base_revision: request.base_revision,
          result: {
            kind: 'patch',
            payload: {
              revision: request.base_revision + 1,
              forward: { kind: 'set-project-name', payload: { name: request.operation.kind === 'update-project-metadata' ? request.operation.payload.name : 'Lab' } },
              inverse: { kind: 'set-project-name', payload: { name: 'Lab' } },
            },
          },
        }
        return { response, bytes: encodeEngineResponse(response) }
      }),
    })
    const worker = new FakeWorker()
    const client = new DomainEngineClient({ api: testApi, workerFactory: () => worker })
    await client.start()

    const first = client.mutate({ operation: { kind: 'update-project-metadata', payload: { name: 'First' } } })
    const second = client.mutate({ operation: { kind: 'update-project-metadata', payload: { name: 'Second' } } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(testApi.postCommand).toHaveBeenCalledTimes(1)
    expect(worker.requests).toHaveLength(1)

    releaseFirst()
    await Promise.all([first, second])
    expect(testApi.postCommand).toHaveBeenCalledTimes(2)
    expect(worker.requests[1]?.base_revision).toBe(2)
    client.dispose()
  })

  it('rebuilds canonical state after a revision conflict without retrying mutation', async () => {
    const testApi = api({
      postCommand: vi.fn(async () => {
        throw new DomainEngineApiError('stale', { status: 409, code: 'revision-conflict' })
      }),
    })
    const states: string[] = []
    const client = new DomainEngineClient({ api: testApi, workerFactory: () => new FakeWorker() })
    client.subscribe((state) => states.push(state.phase))
    await client.start()

    await expect(client.mutate({
      operation: { kind: 'update-project-metadata', payload: { name: 'Rejected' } },
    })).rejects.toThrow('stale')

    expect(states).toContain('conflict')
    expect(states.at(-1)).toBe('ready')
    expect(testApi.postCommand).toHaveBeenCalledOnce()
    client.dispose()
  })

  it('acknowledges an already optimistic commit without dispatching it twice', async () => {
    const worker = new FakeWorker()
    const client = new DomainEngineClient({ api: api(), workerFactory: () => worker })
    await client.start()
    const response = await client.mutate({
      operation: { kind: 'update-project-metadata', payload: { name: 'Rack Lab' } },
    })
    const requestCount = worker.requests.length

    const result = await client.applyCommittedResponse(encodeEngineResponse(response))

    expect(result.kind).toBe('acknowledged')
    expect(worker.requests).toHaveLength(requestCount)
    client.dispose()
  })

  it('applies the next external commit locally and rebuilds on a revision gap', async () => {
    const worker = new FakeWorker()
    const testApi = api()
    const client = new DomainEngineClient({ api: testApi, workerFactory: () => worker })
    await client.start()
    const nextCommit: EngineResponse = {
      protocol_version: 1,
      request_id: 22,
      base_revision: 1,
      result: {
        kind: 'patch',
        payload: {
          revision: 2,
          forward: { kind: 'set-project-name', payload: { name: 'External' } },
          inverse: { kind: 'set-project-name', payload: { name: 'Lab' } },
        },
      },
    }

    await expect(client.applyCommittedResponse(encodeEngineResponse(nextCommit))).resolves.toMatchObject({
      kind: 'applied',
    })
    expect(client.status().revision).toBe(2)

    const gap = {
      ...nextCommit,
      base_revision: 4,
      result: {
        ...nextCommit.result,
        payload: { ...nextCommit.result.payload, revision: 5 },
      },
    } as EngineResponse
    await expect(client.applyCommittedResponse(encodeEngineResponse(gap))).resolves.toMatchObject({
      kind: 'rebuilt',
    })
    expect(testApi.fetchSnapshot).toHaveBeenCalledTimes(2)
    client.dispose()
  })

  it('rejects pending requests when disposed', async () => {
    const worker = new FakeWorker()
    worker.postMessage = vi.fn()
    const client = new DomainEngineClient({ api: api(), workerFactory: () => worker })
    const starting = client.start()
    await Promise.resolve()
    client.dispose()

    await expect(starting).rejects.toThrow(/disposed|replaced/u)
    expect(worker.terminated).toBe(true)
  })
})
