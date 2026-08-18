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
  it('packages the staging policy imported by the production server', async () => {
    const dockerfile = await fs.readFile(path.resolve('Dockerfile'), 'utf8')

    expect(dockerfile).toContain('server/staging-policy.mjs')
  })

  it('packages every production Systems backend module', async () => {
    const dockerfile = await fs.readFile(path.resolve('Dockerfile'), 'utf8')

    for (const module of [
      'server/systems/attention-projector.mjs',
      'server/systems/memory-pressure.mjs',
      'server/systems/read-service.mjs',
      'server/systems/routes.mjs',
      'server/systems/saved-view-service.mjs',
    ]) {
      expect(dockerfile).toContain(module)
    }
  })

  it('packages the canonical compatibility audit runtime', async () => {
    const dockerfile = await fs.readFile(path.resolve('Dockerfile'), 'utf8')

    expect(dockerfile).toContain('server/compatibility/audit-service.mjs')
    expect(dockerfile).toContain('server/compatibility/routes.mjs')
  })

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

  it('rejects missing relative modules imported by the production server graph', async () => {
    const root = await runtimeFixture()
    await fs.writeFile(path.join(root, 'server', 'index.mjs'), "import './missing-runtime-module.mjs'\n")

    await expect(verifyWasmRuntime(root)).rejects.toThrow('server/missing-runtime-module.mjs')
  })

  it('follows Bun-compatible extensionless TypeScript imports', async () => {
    const root = await runtimeFixture()
    await fs.writeFile(path.join(root, 'server', 'index.mjs'), "import '../packages/runtime/src/index.ts'\n")
    await fs.mkdir(path.join(root, 'packages', 'runtime', 'src'), { recursive: true })
    await fs.writeFile(
      path.join(root, 'packages', 'runtime', 'src', 'index.ts'),
      "export { value } from './value'\n",
    )
    await fs.writeFile(path.join(root, 'packages', 'runtime', 'src', 'value.ts'), 'export const value = true\n')

    await expect(verifyWasmRuntime(root)).resolves.toMatchObject({ ok: true })
  })

  it('rejects unresolved extensionless imports', async () => {
    const root = await runtimeFixture()
    await fs.writeFile(path.join(root, 'server', 'index.mjs'), "import './missing-runtime-module'\n")

    await expect(verifyWasmRuntime(root)).rejects.toThrow('server/missing-runtime-module')
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
