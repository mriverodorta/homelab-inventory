import { describe, expect, it } from 'vitest'
import { isWasmBuildStale, wasmBuildCommands } from './build-wasm.mjs'

describe('WASM build script', () => {
  it('detects stale source files', () => {
    expect(isWasmBuildStale({ artifactMtime: 100, sourceMtimes: [90, 99] })).toBe(false)
    expect(isWasmBuildStale({ artifactMtime: 100, sourceMtimes: [101] })).toBe(true)
  })

  it('builds the release wasm target without optimization by default', () => {
    expect(wasmBuildCommands({ optimize: false })).toEqual([[
      'cargo',
      [
        'build',
        '--release',
        '--manifest-path',
        'rust/Cargo.toml',
        '-p',
        'homelab-engine-wasm',
        '--target',
        'wasm32-unknown-unknown',
      ],
    ]])
  })
})
