import {
  decodeEngineResponse,
  encodeEngineRequest,
  type EngineRequest,
  type EngineResponse,
  type EngineOperation,
  type ProjectPatch,
} from '../../shared/engine/protocol.mjs'
import { createDomainEngineApi, DomainEngineApiError } from './api'
import type {
  DomainEngineClientOptions,
  DomainEngineState,
  EngineRequestInput,
  PendingWorkerRequest,
  WorkerLike,
} from './types'

const disposedError = () => new Error('Workspace engine client is disposed.')

function operationForCommittedPatch(
  patch: ProjectPatch,
  inversePatch?: ProjectPatch,
): EngineOperation | null {
  if (patch.kind === 'set-project-name') {
    return { kind: 'update-project-metadata', payload: { name: patch.payload.name } }
  }
  if (patch.kind === 'add-connection') {
    const connection = patch.payload.connection
    return {
      kind: 'create-connection',
      payload: {
        from: connection.from,
        to: connection.to,
        created_at: connection.created_at,
      },
    }
  }
  if (patch.kind === 'remove-connection') {
    return {
      kind: 'remove-connection',
      payload: { connection_id: patch.payload.connection.id },
    }
  }
  if (patch.kind === 'set-connection-label') {
    return { kind: 'update-connection-label', payload: patch.payload }
  }
  if (patch.kind === 'set-connection-route') {
    return { kind: 'update-connection-route', payload: patch.payload }
  }
  if (patch.kind === 'patch-placements' && inversePatch?.kind === 'patch-placements') {
    const placementKey = (placement: { item: { item_type: string; id: number } }) => (
      `${placement.item.item_type}:${String(placement.item.id)}`
    )
    const itemKey = (item: { item_type: string; id: number }) => (
      `${item.item_type}:${String(item.id)}`
    )
    const previous = new Map(inversePatch.payload.upsert.map((placement) => [
      placementKey(placement),
      placement,
    ]))
    const next = new Map(patch.payload.upsert.map((placement) => [
      placementKey(placement),
      placement,
    ]))
    const keys = new Set([
      ...previous.keys(),
      ...next.keys(),
      ...inversePatch.payload.remove_items.map(itemKey),
      ...patch.payload.remove_items.map(itemKey),
    ])
    return {
      kind: 'update-placements',
      payload: {
        changes: [...keys].map((key) => ({
          previous: previous.get(key) ?? null,
          next: next.get(key) ?? null,
        })),
      },
    }
  }
  if (patch.kind === 'patch-assignments' && inversePatch?.kind === 'patch-assignments') {
    const previous = new Map(inversePatch.payload.upsert.map((assignment) => [
      assignment.id,
      assignment,
    ]))
    const next = new Map(patch.payload.upsert.map((assignment) => [
      assignment.id,
      assignment,
    ]))
    const ids = [...new Set([
      ...previous.keys(),
      ...next.keys(),
      ...inversePatch.payload.remove_assignment_ids,
      ...patch.payload.remove_assignment_ids,
    ])].sort((left, right) => left - right)
    return {
      kind: 'update-assignments',
      payload: {
        changes: ids.map((id) => ({
          previous: previous.get(id) ?? null,
          next: next.get(id) ?? null,
        })),
      },
    }
  }
  if (patch.kind === 'batch') {
    const inverseChildren = inversePatch?.kind === 'batch'
      ? inversePatch.payload.patches
      : []
    for (const [index, child] of patch.payload.patches.entries()) {
      const operation = operationForCommittedPatch(child, inverseChildren.at(-(index + 1)))
      if (operation) return operation
    }
  }
  return null
}

export class SupersededEngineQueryError extends Error {
  constructor() {
    super('Engine query was superseded by a newer read.')
    this.name = 'SupersededEngineQueryError'
  }
}

export class DomainEngineInterruptedError extends Error {
  readonly code = 'domain-engine-interrupted'

  constructor(message = 'Workspace engine worker was replaced.') {
    super(message)
    this.name = 'DomainEngineInterruptedError'
  }
}

export function isDomainEngineInterruptedError(
  error: unknown,
): error is DomainEngineInterruptedError {
  return error instanceof DomainEngineInterruptedError
}

export class DomainEngineClient {
  private readonly api
  private readonly workerFactory
  private readonly supportsWasm
  private readonly maxStartupAttempts
  private readonly listeners = new Set<(state: DomainEngineState) => void>()
  private readonly pending = new Map<number, PendingWorkerRequest>()
  private currentState: DomainEngineState = { phase: 'idle', revision: null }
  private workerRevision: number | null = null
  private activeMutationRequestId: number | null = null
  private worker: WorkerLike | null = null
  private initialization: { resolve(): void; reject(error: Error): void } | null = null
  private nextRequestId = 1
  private mutationTail: Promise<void> = Promise.resolve()
  private recoveryPromise: Promise<void> | null = null
  private queuedQuery: {
    input: EngineRequestInput
    resolve(response: EngineResponse): void
    reject(error: Error): void
  } | null = null

  constructor(options: DomainEngineClientOptions = {}) {
    this.api = options.api ?? createDomainEngineApi()
    this.workerFactory = options.workerFactory ?? (() => new Worker(
      new URL('../workers/domain-engine.worker.ts', import.meta.url),
      { type: 'module' },
    ))
    this.supportsWasm = options.supportsWasm ?? (() => (
      typeof WebAssembly !== 'undefined'
      && (options.workerFactory !== undefined || typeof Worker !== 'undefined')
    ))
    this.maxStartupAttempts = options.maxStartupAttempts ?? 3
  }

  status() {
    return this.currentState
  }

  subscribe(listener: (state: DomainEngineState) => void) {
    this.listeners.add(listener)
    listener(this.currentState)
    return () => this.listeners.delete(listener)
  }

  async start() {
    if (this.currentState.phase === 'disposed') throw disposedError()
    if (!this.supportsWasm()) {
      this.setState({ phase: 'unsupported', revision: null })
      return
    }
    await this.recover('loading', 'Starting workspace engine')
  }

  query(input: EngineRequestInput) {
    if (this.currentState.phase !== 'ready') {
      return Promise.reject(new Error('Workspace engine is not ready.'))
    }
    return new Promise<EngineResponse>((resolve, reject) => {
      this.queuedQuery?.reject(new SupersededEngineQueryError())
      this.queuedQuery = { input, resolve, reject }
      queueMicrotask(() => {
        const queued = this.queuedQuery
        if (!queued) return
        this.queuedQuery = null
        void this.dispatch(queued.input).then(queued.resolve, queued.reject)
      })
    })
  }

  async queryConsistent(input: EngineRequestInput) {
    await this.mutationTail
    if (this.currentState.phase !== 'ready') {
      throw new Error('Workspace engine is not ready.')
    }
    return this.dispatch(input)
  }

  transient(input: EngineRequestInput) {
    const operation = this.mutationTail.then(async () => {
      if (this.currentState.phase !== 'ready') {
        throw new Error('Workspace engine is not ready.')
      }
      return this.dispatch(input)
    })
    this.mutationTail = operation.then(() => undefined, () => undefined)
    return operation
  }

  mutate(input: EngineRequestInput) {
    const mutation = this.mutationTail.then(async () => {
      if (this.currentState.phase !== 'ready') {
        throw new Error('Workspace engine is not ready.')
      }

      const request = this.createMutationRequest(input)
      const requestBytes = encodeEngineRequest(request)
      const optimistic = await this.dispatchRequest(request, requestBytes)
      if (optimistic.result.kind !== 'patch') return optimistic
      this.activeMutationRequestId = request.request_id

      try {
        const canonical = await this.api.postCommand(requestBytes)
        if (
          canonical.response.result.kind !== 'patch'
          || canonical.response.result.payload.revision !== optimistic.result.payload.revision
        ) {
          throw new Error('Canonical engine response did not match the optimistic result.')
        }
        this.workerRevision = canonical.response.result.payload.revision
        this.setState({ phase: 'ready', revision: canonical.response.result.payload.revision })
        return canonical.response
      } catch (error) {
        if (error instanceof DomainEngineApiError && error.code === 'revision-conflict') {
          this.setState({ phase: 'conflict', revision: this.currentState.revision, reason: error.message })
        }
        await this.rebuild(error instanceof Error ? error.message : 'Mutation was rejected.')
        throw error
      } finally {
        if (this.activeMutationRequestId === request.request_id) {
          this.activeMutationRequestId = null
        }
      }
    })
    this.mutationTail = mutation.then(() => undefined, () => undefined)
    return mutation
  }

  async applyCommittedResponse(responseBytes: ArrayBuffer | Uint8Array) {
    const response = decodeEngineResponse(responseBytes)
    if (response.result.kind !== 'patch') return { kind: 'ignored' as const, response }

    const committedRevision = response.result.payload.revision
    const currentRevision = this.currentState.revision
    if (currentRevision === committedRevision) {
      return { kind: 'acknowledged' as const, response }
    }
    if (
      response.request_id === this.activeMutationRequestId
      && response.base_revision === currentRevision
      && this.workerRevision === committedRevision
    ) {
      this.setState({ phase: 'ready', revision: committedRevision })
      return { kind: 'acknowledged' as const, response }
    }
    if (currentRevision === null || response.base_revision !== currentRevision) {
      await this.rebuild('A committed project revision was missed.')
      return { kind: 'rebuilt' as const, response }
    }

    const operation = operationForCommittedPatch(
      response.result.payload.forward,
      response.result.payload.inverse,
    )
    if (!operation) {
      await this.rebuild('The committed project patch is not supported locally.')
      return { kind: 'rebuilt' as const, response }
    }

    const applied = await this.dispatch({ operation })
    if (applied.result.kind !== 'patch' || applied.result.payload.revision !== committedRevision) {
      await this.rebuild('The committed project patch could not be reconciled.')
      return { kind: 'rebuilt' as const, response }
    }
    this.workerRevision = committedRevision
    this.setState({ phase: 'ready', revision: committedRevision })
    return { kind: 'applied' as const, response }
  }

  async rebuild(reason: string) {
    if (this.currentState.phase === 'disposed') throw disposedError()
    await this.recover('rebuilding', reason)
  }

  async synchronizeCanonicalRevision(expectedRevision: number, reason: string) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
      throw new Error('The canonical workspace revision is invalid.')
    }

    await this.mutationTail
    if (
      this.currentState.phase === 'ready'
      && this.currentState.revision === expectedRevision
      && this.workerRevision === expectedRevision
    ) {
      return expectedRevision
    }

    await this.rebuild(reason)
    const revision = this.currentState.revision
    if (this.currentState.phase !== 'ready' || revision === null) {
      throw new Error('The workspace engine did not return to a ready state.')
    }
    return revision
  }

  dispose() {
    if (this.currentState.phase === 'disposed') return
    this.queuedQuery?.reject(disposedError())
    this.queuedQuery = null
    this.terminateWorker(disposedError())
    this.setState({ phase: 'disposed', revision: null })
    this.listeners.clear()
  }

  private async dispatch(input: EngineRequestInput) {
    const request = this.createWorkerRequest(input)
    return this.dispatchRequest(request, encodeEngineRequest(request))
  }

  private createWorkerRequest(input: EngineRequestInput): EngineRequest {
    const revision = this.workerRevision
    if (revision === null) throw new Error('Workspace engine worker revision is unavailable.')
    return {
      protocol_version: 1,
      request_id: this.takeRequestId(),
      base_revision: revision,
      ...input,
    }
  }

  private createMutationRequest(input: EngineRequestInput): EngineRequest {
    const revision = this.currentState.revision
    if (revision === null) throw new Error('Canonical workspace revision is unavailable.')
    if (this.workerRevision !== revision) {
      throw new Error('Workspace engine has an uncommitted optimistic revision.')
    }
    return {
      protocol_version: 1,
      request_id: this.takeRequestId(),
      base_revision: revision,
      ...input,
    }
  }

  private dispatchRequest(request: EngineRequest, bytes: Uint8Array) {
    const worker = this.worker
    if (!worker) return Promise.reject(new Error('Workspace engine worker is unavailable.'))
    return new Promise<EngineResponse>((resolve, reject) => {
      this.pending.set(request.request_id, { resolve, reject })
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      worker.postMessage(
        { kind: 'dispatch', requestId: request.request_id, request: buffer },
        [buffer],
      )
    })
  }

  private recover(phase: 'loading' | 'rebuilding', reason: string) {
    if (this.recoveryPromise) return this.recoveryPromise
    const recovery = this.performRecovery(phase, reason)
    const trackedRecovery = recovery.finally(() => {
      if (this.recoveryPromise === trackedRecovery) this.recoveryPromise = null
    })
    this.recoveryPromise = trackedRecovery
    return trackedRecovery
  }

  private async performRecovery(phase: 'loading' | 'rebuilding', reason: string) {
    this.setState({ phase, revision: this.currentState.revision, reason })
    let lastError = new Error('Workspace engine failed to start.')
    for (let attempt = 0; attempt < this.maxStartupAttempts; attempt += 1) {
      if (this.isDisposed()) throw disposedError()
      try {
        const snapshot = await this.api.fetchSnapshot()
        if (this.isDisposed()) throw disposedError()
        await this.initializeWorker(snapshot.bytes)
        if (this.isDisposed()) throw disposedError()
        this.workerRevision = snapshot.snapshot.revision
        this.setState({ phase: 'ready', revision: snapshot.snapshot.revision })
        return
      } catch (error) {
        lastError = error instanceof Error ? error : lastError
        this.terminateWorker(lastError)
        if (this.isDisposed()) throw disposedError()
      }
    }
    this.setState({
      phase: 'failed',
      revision: this.currentState.revision,
      reason,
      error: lastError.message,
    })
    throw lastError
  }

  private initializeWorker(snapshotBytes: Uint8Array) {
    this.terminateWorker(new DomainEngineInterruptedError())
    const worker = this.workerFactory()
    this.worker = worker
    worker.onmessage = (event) => this.handleWorkerMessage(event.data)
    worker.onerror = (event) => {
      const error = new Error(event.message || 'Workspace engine worker crashed.')
      const shouldRecover = this.currentState.phase === 'ready'
      this.initialization?.reject(error)
      this.initialization = null
      this.terminateWorker(error)
      if (shouldRecover) void this.recover('rebuilding', error.message).catch(() => {})
    }

    return new Promise<void>((resolve, reject) => {
      this.initialization = { resolve, reject }
      const buffer = snapshotBytes.buffer.slice(
        snapshotBytes.byteOffset,
        snapshotBytes.byteOffset + snapshotBytes.byteLength,
      )
      worker.postMessage({ kind: 'initialize', snapshot: buffer }, [buffer])
    })
  }

  private handleWorkerMessage(message: import('./types').DomainWorkerResponse) {
    if (message.kind === 'ready') {
      this.initialization?.resolve()
      this.initialization = null
      return
    }
    if (message.kind === 'failure') {
      const error = new Error(message.message)
      if (message.requestId === undefined) {
        this.initialization?.reject(error)
        this.initialization = null
      } else {
        this.pending.get(message.requestId)?.reject(error)
        this.pending.delete(message.requestId)
      }
      return
    }

    const pending = this.pending.get(message.requestId)
    if (!pending) return
    this.pending.delete(message.requestId)
    try {
      const response = decodeEngineResponse(message.response)
      if (response.result.kind === 'patch') {
        this.workerRevision = response.result.payload.revision
      }
      pending.resolve(response)
    } catch (error) {
      pending.reject(error instanceof Error ? error : new Error('Invalid worker response.'))
    }
  }

  private terminateWorker(error: Error) {
    this.worker?.postMessage({ kind: 'dispose' })
    this.worker?.terminate()
    this.worker = null
    this.workerRevision = null
    this.activeMutationRequestId = null
    this.initialization?.reject(error)
    this.initialization = null
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }

  private takeRequestId() {
    const id = this.nextRequestId
    this.nextRequestId = id >= 0xffff_ffff ? 1 : id + 1
    return id
  }

  private isDisposed() {
    return this.currentState.phase === 'disposed'
  }

  private setState(state: DomainEngineState) {
    this.currentState = state
    for (const listener of this.listeners) listener(state)
  }
}
