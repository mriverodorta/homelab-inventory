import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { verifyWasmRuntime } from './verify-wasm-runtime.mjs'

async function runtimeFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'homelab-wasm-runtime-'))
  for (const file of [
    'server/engine/generated/homelab_engine.wasm',
    'shared/engine/protocol.mjs',
    'shared/engine/wasm-runtime.mjs',
    'dist/assets/domain-engine.wasm',
  ]) {
    const filePath = path.join(root, file)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, 'runtime')
  }
  return root
}

describe('WASM runtime verifier', () => {
  it('accepts the minimal generated runtime', async () => {
    const root = await runtimeFixture()
    await expect(verifyWasmRuntime(root)).resolves.toMatchObject({ ok: true })
  })

  it('rejects missing server or browser WASM artifacts', async () => {
    const root = await runtimeFixture()
    await fs.rm(path.join(root, 'server', 'engine', 'generated', 'homelab_engine.wasm'))
    await fs.rm(path.join(root, 'dist', 'assets', 'domain-engine.wasm'))
    await expect(verifyWasmRuntime(root)).rejects.toThrow(/server\/engine.*dist\/assets/u)
  })

  it.each([
    ['rust source', 'rust/crates/core/src/lib.rs'],
    ['Cargo manifest', 'Cargo.toml'],
    ['build target', 'target/release/output'],
    ['WASM development data', 'data-wasm/stores/project.json'],
    ['server test', 'server/engine/runtime.test.mjs'],
  ])('rejects %s in the runtime image', async (_label, forbiddenPath) => {
    const root = await runtimeFixture()
    const filePath = path.join(root, forbiddenPath)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, 'forbidden')
    await expect(verifyWasmRuntime(root)).rejects.toThrow('Forbidden runtime content')
  })
})
