import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const rustRoot = path.join(root, 'rust')
const sourceArtifact = path.join(
  rustRoot,
  'target',
  'wasm32-unknown-unknown',
  'release',
  'homelab_engine_wasm.wasm',
)
const outputs = [
  path.join(root, 'src', 'engine', 'generated', 'homelab_engine.wasm'),
  path.join(root, 'server', 'engine', 'generated', 'homelab_engine.wasm'),
]

export function isWasmBuildStale({ artifactMtime, sourceMtimes }) {
  return sourceMtimes.some((mtime) => mtime > artifactMtime)
}

export function wasmBuildCommands({ optimize }) {
  const commands = [[
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
  ]]
  if (optimize) commands.push(['wasm-opt', ['-Oz', sourceArtifact, '-o', sourceArtifact]])
  return commands
}

async function exists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function collectSourceMtimes(directory) {
  const mtimes = []
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.name === 'target') continue
    if (entry.isDirectory()) mtimes.push(...await collectSourceMtimes(entryPath))
    else if (entry.isFile()) mtimes.push((await fs.stat(entryPath)).mtimeMs)
  }
  mtimes.push((await fs.stat(path.join(root, 'rust-toolchain.toml'))).mtimeMs)
  return mtimes
}

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', env: process.env })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited with status ${String(code)}.`))
    })
  })
}

async function needsBuild() {
  if (process.env.HOMELAB_WASM_PREBUILT === '1') {
    const missingOutputs = []
    for (const output of outputs) {
      if (!(await exists(output))) missingOutputs.push(path.relative(root, output))
    }
    if (missingOutputs.length > 0) {
      throw new Error(`Prebuilt WASM artifacts are missing: ${missingOutputs.join(', ')}`)
    }
    return false
  }
  if (!(await exists(sourceArtifact)) || !(await Promise.all(outputs.map(exists))).every(Boolean)) {
    return true
  }
  const oldestOutput = Math.min(...await Promise.all(outputs.map(async (file) => (await fs.stat(file)).mtimeMs)))
  return isWasmBuildStale({
    artifactMtime: oldestOutput,
    sourceMtimes: await collectSourceMtimes(rustRoot),
  })
}

export async function buildWasm({ optimize = process.env.WASM_OPTIMIZE === '1' } = {}) {
  if (!(await needsBuild())) return { built: false, outputs }

  for (const [command, args] of wasmBuildCommands({ optimize })) {
    await run(command, args)
  }
  for (const output of outputs) {
    await fs.mkdir(path.dirname(output), { recursive: true })
    await fs.copyFile(sourceArtifact, output)
  }
  return { built: true, outputs }
}

if (import.meta.main) {
  await buildWasm()
}
