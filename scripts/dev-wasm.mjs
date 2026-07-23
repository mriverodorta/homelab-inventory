import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildWasm } from './build-wasm.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function createWasmDevEnvironment(environment = process.env, projectRoot = root) {
  return {
    ...environment,
    DATA_DIR: environment.DATA_DIR ?? path.join(projectRoot, 'data'),
    HOMELAB_ENGINE_WASM: 'required',
    VITE_DOMAIN_ENGINE: 'required',
  }
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
  await buildWasm()
  runServer(environment)
}
