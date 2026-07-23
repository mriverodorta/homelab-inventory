import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  decodeEngineResponse,
  encodeEngineRequest,
  encodeEngineSnapshot,
} from '../../shared/engine/protocol.mjs'
import { WasmEngineRuntime } from '../../shared/engine/wasm-runtime.mjs'

const wasmPath = path.join(process.cwd(), 'src', 'engine', 'generated', 'homelab_engine.wasm')

describe('Rust WASM engine integration', () => {
  it('dispatches MessagePack requests with Unicode through the real module', async () => {
    const bytes = await fs.readFile(wasmPath)
    const runtime = await WasmEngineRuntime.instantiate(bytes)
    const handle = runtime.create(encodeEngineSnapshot({
      revision: 4,
      project_name: 'Laboratorio São José 日本',
    }))

    const response = decodeEngineResponse(runtime.dispatch(handle, encodeEngineRequest({
      protocol_version: 1,
      request_id: 8,
      base_revision: 4,
      operation: {
        kind: 'update-project-metadata',
        payload: { name: 'Núcleo 東京' },
      },
    })))

    expect(response).toMatchObject({
      request_id: 8,
      base_revision: 4,
      result: {
        kind: 'patch',
        payload: {
          revision: 5,
          forward: {
            kind: 'set-project-name',
            payload: { name: 'Núcleo 東京' },
          },
        },
      },
    })
    expect(runtime.destroy(handle)).toBe(true)
  })
})
