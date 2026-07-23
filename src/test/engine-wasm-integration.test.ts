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

  it('indexes geometry and answers placement queries through the real module', async () => {
    const bytes = await fs.readFile(wasmPath)
    const runtime = await WasmEngineRuntime.instantiate(bytes)
    const handle = runtime.create(encodeEngineSnapshot({
      revision: 7,
      project_name: 'Geometry Lab',
    }))

    const replaced = decodeEngineResponse(runtime.dispatch(handle, encodeEngineRequest({
      protocol_version: 1,
      request_id: 9,
      base_revision: 7,
      operation: {
        kind: 'replace-geometry',
        payload: {
          nodes: [{
            item_id: 'server:1',
            bounds: { x: 0, y: 0, width: 100, height: 100 },
          }],
          handles: [],
        },
      },
    })))
    expect(replaced.result).toEqual({
      kind: 'geometry-updated',
      payload: { geometry_revision: 1 },
    })

    const checked = decodeEngineResponse(runtime.dispatch(handle, encodeEngineRequest({
      protocol_version: 1,
      request_id: 10,
      base_revision: 7,
      operation: {
        kind: 'check-placement',
        payload: {
          item_id: 'server:2',
          bounds: { x: 50, y: 0, width: 100, height: 100 },
          exclude_item_ids: [],
        },
      },
    })))
    expect(checked.result).toEqual({
      kind: 'placement-check',
      payload: { valid: false, colliding_item_ids: ['server:1'] },
    })

    const arranged = decodeEngineResponse(runtime.dispatch(handle, encodeEngineRequest({
      protocol_version: 1,
      request_id: 11,
      base_revision: 7,
      operation: {
        kind: 'arrange-items',
        payload: {
          items: [
            { item_id: 'switch:1', name: 'Core', column: 2, width: 300, height: 100 },
            { item_id: 'server:1', name: 'Node', column: 0, width: 282, height: 120 },
          ],
          grid_size: 24,
          column_gap: 78,
          item_gap: 24,
        },
      },
    })))
    expect(arranged.result).toEqual({
      kind: 'arrangement',
      payload: {
        nodes: [
          { item_id: 'server:1', bounds: { x: 0, y: 0, width: 282, height: 120 } },
          { item_id: 'switch:1', bounds: { x: 360, y: 0, width: 300, height: 100 } },
        ],
      },
    })
    expect(runtime.destroy(handle)).toBe(true)
  })
})
