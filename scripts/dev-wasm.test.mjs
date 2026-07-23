import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createWasmDevEnvironment } from './dev-wasm.mjs'

describe('WASM development launcher', () => {
  const root = path.resolve('/workspace/homelab-inventory')

  it('uses normal local data and required engine mode by default', () => {
    expect(createWasmDevEnvironment({ PORT: '5173' }, root)).toEqual({
      PORT: '5173',
      DATA_DIR: path.join(root, 'data'),
      HOMELAB_ENGINE_WASM: 'required',
      VITE_DOMAIN_ENGINE: 'required',
    })
  })

  it('honors an explicit development data directory', () => {
    expect(createWasmDevEnvironment({ DATA_DIR: '/tmp/homelab-data' }, root).DATA_DIR).toBe(
      '/tmp/homelab-data',
    )
  })
})
