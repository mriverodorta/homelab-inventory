import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  decodeEngineResponse,
  encodeEngineRequest,
  encodeEngineSnapshot,
} from '../../shared/engine/protocol.mjs'
import { WasmEngineRuntime } from '../../shared/engine/wasm-runtime.mjs'

const defaultWasmPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'generated',
  'homelab_engine.wasm',
)

export class ServerEngineRuntime {
  constructor(runtime) {
    this.runtime = runtime
    this.handles = new WeakMap()
  }

  static async create({ wasmPath = defaultWasmPath } = {}) {
    const bytes = await fs.readFile(wasmPath)
    return new ServerEngineRuntime(await WasmEngineRuntime.instantiate(bytes))
  }

  forStore(store) {
    return this.entryForStore(store).handle
  }

  entryForStore(store) {
    const existing = this.handles.get(store)
    const snapshot = typeof store.getEngineRevision === 'function'
      ? null
      : store.getEngineSnapshot()
    const canonicalRevision = snapshot?.revision ?? store.getEngineRevision()
    if (existing?.revision === canonicalRevision) return existing

    if (existing) {
      this.runtime.destroy(existing.handle)
      this.handles.delete(store)
    }

    const canonicalSnapshot = snapshot ?? store.getEngineSnapshot()
    const entry = {
      handle: this.runtime.create(encodeEngineSnapshot(canonicalSnapshot)),
      revision: canonicalSnapshot.revision,
    }
    this.handles.set(store, entry)
    return entry
  }

  dispatch(store, request) {
    const bytes = encodeEngineRequest(request)
    return decodeEngineResponse(this.dispatchBytes(store, bytes))
  }

  dispatchBytes(store, requestBytes) {
    const entry = this.entryForStore(store)
    const responseBytes = this.runtime.dispatch(entry.handle, requestBytes)
    const response = decodeEngineResponse(responseBytes)
    if (response.result.kind === 'patch') {
      entry.revision = response.result.payload.revision
    }
    return responseBytes
  }

  reloadStore(store) {
    this.destroyStore(store)
    return this.forStore(store)
  }

  destroyStore(store) {
    const entry = this.handles.get(store)
    if (!entry) return false
    this.handles.delete(store)
    return this.runtime.destroy(entry.handle)
  }
}
