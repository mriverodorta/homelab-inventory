import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { computeArtifactFingerprint } from './fingerprint.mjs'
import { ensureWasmArtifact, materializeWasmArtifact } from './store.mjs'

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hli-release-artifact-'))
  const root = path.join(directory, 'repo')
  const supportRoot = path.join(directory, 'support')
  const cacheRoot = path.join(directory, 'cache')
  await fs.mkdir(path.join(root, 'rust', 'src'), { recursive: true })
  await fs.writeFile(path.join(root, 'rust', 'Cargo.toml'), '[workspace]\n')
  await fs.writeFile(path.join(root, 'rust', 'src', 'lib.rs'), 'pub fn value() -> u8 { 1 }\n')
  await fs.writeFile(path.join(root, 'rust-toolchain.toml'), '[toolchain]\nchannel = "1.94.1"\n')
  await fs.writeFile(path.join(root, 'scripts-build-wasm.mjs'), 'export {}\n')
  await fs.writeFile(path.join(root, 'wasm.Dockerfile'), 'FROM scratch\n')
  return {
    directory,
    root,
    paths: {
      supportRoot,
      cacheRoot,
      artifactsRoot: path.join(supportRoot, 'artifacts'),
      portableArtifactsDir: path.join(supportRoot, 'artifacts', 'current'),
    },
    contract: {
      id: 'wasm',
      version: 1,
      inputs: ['rust', 'rust-toolchain.toml', 'scripts-build-wasm.mjs', 'wasm.Dockerfile'],
    },
  }
}

async function fakeBuild(destination, bytes = 'canonical-wasm') {
  await fs.mkdir(path.join(destination, 'wasm'), { recursive: true })
  await fs.writeFile(path.join(destination, 'wasm', 'homelab_engine.wasm'), bytes)
  await fs.writeFile(path.join(destination, 'wasm', 'toolchain.txt'), 'rustc 1.94.1\nwasm-opt version 123\n')
}

describe('portable release artifacts', () => {
  test('the production image consumes portable compiler outputs without Rust or Go build stages', async () => {
    const dockerfile = await fs.readFile(path.resolve(import.meta.dir, '../..', 'Dockerfile'), 'utf8')
    expect(dockerfile).not.toMatch(/^FROM rust:/m)
    expect(dockerfile).not.toMatch(/^FROM golang:/m)
    expect(dockerfile).toContain('COPY .release-artifacts/wasm/homelab_engine.wasm')
    expect(dockerfile).toContain('COPY --chown=10001:10001 .release-artifacts/agent ./server/agent-release')
  })

  test('fingerprint is stable and changes with a Rust input', async () => {
    const context = await fixture()
    try {
      const first = await computeArtifactFingerprint(context.root, context.contract)
      const second = await computeArtifactFingerprint(context.root, context.contract)
      expect(second).toBe(first)
      await fs.writeFile(path.join(context.root, 'rust', 'src', 'lib.rs'), 'pub fn value() -> u8 { 2 }\n')
      expect(await computeArtifactFingerprint(context.root, context.contract)).not.toBe(first)
    } finally {
      await fs.rm(context.directory, { recursive: true, force: true })
    }
  })

  test('reuses verified bytes and rebuilds a corrupted current artifact', async () => {
    const context = await fixture()
    let builds = 0
    const build = async ({ destination }) => {
      builds += 1
      await fakeBuild(destination, `wasm-${builds}`)
    }
    try {
      const first = await ensureWasmArtifact({ ...context, contract: context.contract, build })
      const second = await ensureWasmArtifact({ ...context, contract: context.contract, build })
      expect(builds).toBe(1)
      expect(second.sha256).toBe(first.sha256)

      await fs.writeFile(first.artifact, 'corrupted')
      const repaired = await ensureWasmArtifact({ ...context, contract: context.contract, build })
      expect(builds).toBe(2)
      expect(repaired.sha256).not.toBe(first.sha256)
      expect(await fs.readdir(context.paths.artifactsRoot)).toEqual(['current'])
    } finally {
      await fs.rm(context.directory, { recursive: true, force: true })
    }
  })

  test('materializes identical bytes for browser, server, and Docker contexts', async () => {
    const context = await fixture()
    try {
      const receipt = await ensureWasmArtifact({
        ...context,
        contract: context.contract,
        build: ({ destination }) => fakeBuild(destination),
      })
      const outputs = await materializeWasmArtifact({ root: context.root, receipt })
      expect(outputs).toHaveLength(3)
      for (const output of outputs) {
        expect(await fs.readFile(output, 'utf8')).toBe('canonical-wasm')
      }
    } finally {
      await fs.rm(context.directory, { recursive: true, force: true })
    }
  })
})
