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
    const existing = this.handles.get(store)
    if (existing) return existing

    const handle = this.runtime.create(encodeEngineSnapshot(store.getEngineSnapshot()))
    this.handles.set(store, handle)
    return handle
  }

  dispatch(store, request) {
    const bytes = encodeEngineRequest(request)
    return decodeEngineResponse(this.runtime.dispatch(this.forStore(store), bytes))
  }

  dispatchBytes(store, requestBytes) {
    return this.runtime.dispatch(this.forStore(store), requestBytes)
  }

  reloadStore(store) {
    this.destroyStore(store)
    return this.forStore(store)
  }

  destroyStore(store) {
    const handle = this.handles.get(store)
    if (!handle) return false
    this.handles.delete(store)
    return this.runtime.destroy(handle)
  }
}
