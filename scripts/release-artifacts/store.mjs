import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { computeArtifactFingerprint } from './fingerprint.mjs'
import { run } from '../local-release/process.mjs'

export const WASM_ARTIFACT_CONTRACT = Object.freeze({
  id: 'homelab-engine-wasm',
  version: 1,
  inputs: [
    'rust',
    'rust-toolchain.toml',
    'scripts/build-wasm.mjs',
    'docker/wasm-artifact.Dockerfile',
  ],
})

const ARTIFACT_BUILDER = 'homelab-release-artifacts'
const WASM_RELATIVE_PATH = path.join('wasm', 'homelab_engine.wasm')
const TOOLCHAIN_RELATIVE_PATH = path.join('wasm', 'toolchain.txt')

async function sha256(file) {
  return createHash('sha256').update(await fs.readFile(file)).digest('hex')
}

async function readVerifiedReceipt(paths, inputFingerprint, contractId = WASM_ARTIFACT_CONTRACT.id) {
  try {
    const receiptFile = path.join(paths.portableArtifactsDir, 'receipt.json')
    const receipt = JSON.parse(await fs.readFile(receiptFile, 'utf8'))
    const artifact = path.join(paths.portableArtifactsDir, WASM_RELATIVE_PATH)
    const toolchain = path.join(paths.portableArtifactsDir, TOOLCHAIN_RELATIVE_PATH)
    if (
      receipt.version !== 1
      || receipt.id !== contractId
      || receipt.inputFingerprint !== inputFingerprint
      || receipt.sha256 !== await sha256(artifact)
      || receipt.toolchainSha256 !== await sha256(toolchain)
    ) return null
    return { ...receipt, artifact, toolchain, receiptFile }
  } catch {
    return null
  }
}

export async function buildCanonicalWasm({ root, destination, runCommand = run }) {
  await runCommand(['docker', 'buildx', 'rm', '--force', ARTIFACT_BUILDER], {
    allowFailure: true,
    capture: true,
    log: false,
  })
  try {
    await runCommand(['docker', 'buildx', 'create', '--name', ARTIFACT_BUILDER, '--driver', 'docker-container'])
    await runCommand(['docker', 'buildx', 'inspect', ARTIFACT_BUILDER, '--bootstrap'])
    await runCommand([
      'docker', 'buildx', 'build', '--builder', ARTIFACT_BUILDER,
      '--pull', '--no-cache', '--platform', 'linux/arm64',
      '--file', 'docker/wasm-artifact.Dockerfile',
      '--output', `type=local,dest=${destination}`,
      root,
    ], { cwd: root })
  } finally {
    await runCommand(['docker', 'buildx', 'rm', '--force', ARTIFACT_BUILDER], {
      allowFailure: true,
      capture: true,
      log: false,
    })
  }
}

export async function ensureWasmArtifact({
  root,
  paths,
  contract = WASM_ARTIFACT_CONTRACT,
  build = buildCanonicalWasm,
}) {
  const inputFingerprint = await computeArtifactFingerprint(root, contract)
  const existing = await readVerifiedReceipt(paths, inputFingerprint, contract.id)
  if (existing) return { ...existing, reused: true }

  await fs.mkdir(paths.artifactsRoot, { recursive: true, mode: 0o700 })
  const temporary = path.join(paths.artifactsRoot, `.building-${process.pid}-${randomUUID()}`)
  await fs.rm(temporary, { recursive: true, force: true })
  await fs.mkdir(temporary, { recursive: true, mode: 0o700 })
  try {
    await build({ root, destination: temporary })
    const artifact = path.join(temporary, WASM_RELATIVE_PATH)
    const toolchain = path.join(temporary, TOOLCHAIN_RELATIVE_PATH)
    const receipt = {
      version: 1,
      id: contract.id,
      inputFingerprint,
      sha256: await sha256(artifact),
      toolchainSha256: await sha256(toolchain),
      createdAt: new Date().toISOString(),
    }
    await fs.writeFile(path.join(temporary, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 })
    await fs.rm(paths.portableArtifactsDir, { recursive: true, force: true })
    await fs.rename(temporary, paths.portableArtifactsDir)
  } catch (error) {
    await fs.rm(temporary, { recursive: true, force: true })
    throw error
  }
  const verified = await readVerifiedReceipt(paths, inputFingerprint, contract.id)
  if (!verified) throw new Error('Canonical WASM artifact failed post-build verification.')
  return { ...verified, reused: false }
}

export async function materializeWasmArtifact({ root, receipt }) {
  if (receipt.sha256 !== await sha256(receipt.artifact)) throw new Error('Canonical WASM artifact changed before materialization.')
  const outputs = [
    path.join(root, '.release-artifacts', WASM_RELATIVE_PATH),
    path.join(root, 'src', 'engine', 'generated', 'homelab_engine.wasm'),
    path.join(root, 'server', 'engine', 'generated', 'homelab_engine.wasm'),
  ]
  for (const output of outputs) {
    await fs.mkdir(path.dirname(output), { recursive: true })
    await fs.copyFile(receipt.artifact, output)
  }
  await fs.copyFile(receipt.receiptFile, path.join(root, '.release-artifacts', 'receipt.json'))
  await fs.copyFile(receipt.toolchain, path.join(root, '.release-artifacts', TOOLCHAIN_RELATIVE_PATH))
  return outputs
}
