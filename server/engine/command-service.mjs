import { decodeEngineRequest, decodeEngineResponse } from '../../shared/engine/protocol.mjs'
import { InventoryLifecycleError } from '../db/inventory-lifecycle.mjs'

export class EngineCommandService {
  constructor(runtime) {
    this.runtime = runtime
  }

  async execute(store, requestBytes) {
    let request
    try {
      request = decodeEngineRequest(requestBytes)
    } catch (error) {
      throw new InventoryLifecycleError(
        error instanceof Error ? error.message : 'Engine command is malformed.',
        { code: 'invalid-engine-command', status: 400 },
      )
    }

    const responseBytes = this.runtime.dispatchBytes(store, requestBytes)
    const response = decodeEngineResponse(responseBytes)
    if (response.result.kind === 'error') {
      const conflict = response.result.payload.code === 'revision-conflict'
      throw new InventoryLifecycleError(response.result.payload.message, {
        code: response.result.payload.code,
        status: conflict ? 409 : 400,
      })
    }
    if (response.result.kind !== 'patch') {
      return { response, responseBytes, project: null }
    }

    try {
      const project = await store.applyEnginePatch({
        baseRevision: request.base_revision,
        patchSet: response.result.payload,
        responseBytes,
      })
      return { response, responseBytes, project }
    } catch (error) {
      this.runtime.reloadStore(store)
      throw error
    }
  }
}
