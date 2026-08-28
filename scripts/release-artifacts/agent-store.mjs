import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { AgentReleaseService } from '../../server/agents/release-service.mjs'
import { run } from '../local-release/process.mjs'
import { computeArtifactFingerprint } from './fingerprint.mjs'

export const AGENT_ARTIFACT_CONTRACT = Object.freeze({
  id: 'homelab-inventory-agent-release',
  version: 1,
  inputs: [
    'server/agent-release-pin.json',
    'vendor/homelab-inventory-agent',
    'docker/agent-artifact.Dockerfile',
  ],
})

const ARTIFACT_BUILDER = 'homelab-release-artifacts'

async function collectBundleFiles(directory, relative = '') {
  const entries = await fs.readdir(path.join(directory, relative), { withFileTypes: true })
  const files = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const child = path.join(relative, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Agent artifact cannot contain a symbolic link: ${child}`)
    if (entry.isDirectory()) files.push(...await collectBundleFiles(directory, child))
    else if (entry.isFile()) files.push(child)
    else throw new Error(`Agent artifact contains an unsupported entry: ${child}`)
  }
  return files
}

export async function hashAgentBundle(directory) {
  const hash = createHash('sha256')
  for (const relative of await collectBundleFiles(directory)) {
    hash.update(`${relative}\0`)
    hash.update(await fs.readFile(path.join(directory, relative)))
    hash.update('\0')
  }
  return hash.digest('hex')
}

async function verifyBundle({ directory, pin, expectedHash = null }) {
  await new AgentReleaseService({
    directory,
    expectedVersion: pin.version,
    expectedSourceRevision: pin.sourceRevision,
  }).initialize()
  const bundleSha256 = await hashAgentBundle(directory)
  if (expectedHash && expectedHash !== bundleSha256) throw new Error('Canonical Agent bundle changed after verification.')
  return bundleSha256
}

async function readVerifiedReceipt(paths, inputFingerprint, pin, verify, contractId) {
  try {
    const receiptFile = path.join(paths.agentArtifactsDir, 'receipt.json')
    const bundle = path.join(paths.agentArtifactsDir, 'bundle')
    const receipt = JSON.parse(await fs.readFile(receiptFile, 'utf8'))
    if (
      receipt.version !== 1
      || receipt.id !== contractId
      || receipt.inputFingerprint !== inputFingerprint
      || receipt.agentVersion !== pin.version
      || receipt.sourceRevision !== pin.sourceRevision
    ) return null
    await verify({ directory: bundle, pin, expectedHash: receipt.bundleSha256 })
    return { ...receipt, bundle, receiptFile }
  } catch {
    return null
  }
}

export async function buildCanonicalAgent({ root, destination, pin, runCommand = run }) {
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
      '--file', 'docker/agent-artifact.Dockerfile',
      '--build-arg', `AGENT_VERSION=${pin.version}`,
      '--build-arg', `AGENT_SOURCE_REVISION=${pin.sourceRevision}`,
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

export async function ensureAgentArtifact({
  root,
  paths,
  contract = AGENT_ARTIFACT_CONTRACT,
  build = buildCanonicalAgent,
  verify = verifyBundle,
}) {
  const pin = JSON.parse(await fs.readFile(path.join(root, 'server', 'agent-release-pin.json'), 'utf8'))
  const inputFingerprint = await computeArtifactFingerprint(root, contract)
  const existing = await readVerifiedReceipt(paths, inputFingerprint, pin, verify, contract.id)
  if (existing) return { ...existing, reused: true }

  await fs.mkdir(path.dirname(paths.agentArtifactsDir), { recursive: true, mode: 0o700 })
  const temporary = path.join(path.dirname(paths.agentArtifactsDir), `.building-${process.pid}-${randomUUID()}`)
  const bundle = path.join(temporary, 'bundle')
  await fs.rm(temporary, { recursive: true, force: true })
  await fs.mkdir(bundle, { recursive: true, mode: 0o700 })
  try {
    await build({ root, destination: bundle, pin })
    const receipt = {
      version: 1,
      id: contract.id,
      inputFingerprint,
      agentVersion: pin.version,
      sourceRevision: pin.sourceRevision,
      bundleSha256: await verify({ directory: bundle, pin }),
      createdAt: new Date().toISOString(),
    }
    await fs.writeFile(path.join(temporary, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 })
    await fs.rm(paths.agentArtifactsDir, { recursive: true, force: true })
    await fs.rename(temporary, paths.agentArtifactsDir)
  } catch (error) {
    await fs.rm(temporary, { recursive: true, force: true })
    throw error
  }
  const verified = await readVerifiedReceipt(paths, inputFingerprint, pin, verify, contract.id)
  if (!verified) throw new Error('Canonical Agent artifact failed post-build verification.')
  return { ...verified, reused: false }
}

export async function materializeAgentArtifact({ root, receipt, verify = verifyBundle }) {
  const pin = JSON.parse(await fs.readFile(path.join(root, 'server', 'agent-release-pin.json'), 'utf8'))
  await verify({ directory: receipt.bundle, pin, expectedHash: receipt.bundleSha256 })
  const outputs = [
    path.join(root, '.release-artifacts', 'agent'),
    path.join(root, 'server', 'agent-release'),
  ]
  for (const output of outputs) {
    await fs.rm(output, { recursive: true, force: true })
    await fs.mkdir(path.dirname(output), { recursive: true })
    await fs.cp(receipt.bundle, output, { recursive: true, preserveTimestamps: true })
  }
  return outputs
}
