import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertSafeWasmDataDir, createWasmDevEnvironment } from './dev-wasm.mjs'

describe('WASM development launcher', () => {
  const root = path.resolve('/workspace/homelab-inventory')

  it('forces the isolated data directory and required engine mode', () => {
    expect(createWasmDevEnvironment({ PORT: '5173' }, root)).toEqual({
      PORT: '5173',
      DATA_DIR: path.join(root, 'data-wasm'),
      HOMELAB_ENGINE_WASM: 'required',
      VITE_DOMAIN_ENGINE: 'required',
    })
  })

  it('rejects the repository production data directory', () => {
    expect(() => assertSafeWasmDataDir(path.join(root, 'data'), root)).toThrow(/cannot use/)
    expect(assertSafeWasmDataDir(path.join(root, 'data-wasm'), root)).toBe(
      path.join(root, 'data-wasm'),
    )
  })
})
