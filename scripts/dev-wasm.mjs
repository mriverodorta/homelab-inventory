import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildWasm } from './build-wasm.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function createWasmDevEnvironment(environment = process.env, projectRoot = root) {
  return {
    ...environment,
    DATA_DIR: path.join(projectRoot, 'data-wasm'),
    HOMELAB_ENGINE_WASM: 'required',
  }
}

export function assertSafeWasmDataDir(dataDir, projectRoot = root) {
  const resolved = path.resolve(dataDir)
  const protectedDataDir = path.join(path.resolve(projectRoot), 'data')
  if (resolved === protectedDataDir) {
    throw new Error('WASM development cannot use the repository data/ directory. Use data-wasm/.')
  }
  return resolved
}

function runServer(environment) {
  const child = spawn('bun', ['server/index.mjs'], {
    cwd: root,
    env: environment,
    stdio: 'inherit',
  })
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => child.kill(signal))
  }
  child.once('error', (error) => {
    console.error(error)
    process.exitCode = 1
  })
  child.once('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal)
    else process.exitCode = code ?? 1
  })
}

if (import.meta.main) {
  const environment = createWasmDevEnvironment()
  const dataDir = assertSafeWasmDataDir(environment.DATA_DIR)
  try {
    await fs.access(dataDir)
  } catch {
    throw new Error('data-wasm/ is missing. Copy data/ explicitly before starting WASM development.')
  }
  await buildWasm()
  runServer(environment)
}
