import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { computeArtifactFingerprint } from '../release-artifacts/fingerprint.mjs'

function commandIdentity(phase) {
  return createHash('sha256')
    .update(JSON.stringify({ command: phase.command, env: phase.env ?? {} }))
    .digest('hex')
}

export async function computeCiPhaseFingerprint({ root, phase, contractVersion }) {
  return computeArtifactFingerprint(root, {
    id: `ci-phase:${phase.id}:${commandIdentity(phase)}`,
    version: contractVersion,
    inputs: phase.cacheInputs,
  })
}

async function readReceipt(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return null
    throw error
  }
}

async function writeReceipt(file, receipt) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${process.pid}-${randomUUID()}.tmp`
  await fs.writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 })
  await fs.rename(temporary, file)
  await fs.chmod(file, 0o600)
}

export async function runCachedCiPhase({ root, cacheDir, phase, contractVersion, runCommand }) {
  if (!Array.isArray(phase.cacheInputs) || phase.cacheInputs.length === 0) {
    throw new Error(`CI phase ${phase.id} has no cache inputs.`)
  }
  const fingerprint = await computeCiPhaseFingerprint({ root, phase, contractVersion })
  const receiptFile = path.join(cacheDir, `${phase.id}.json`)
  const existing = await readReceipt(receiptFile)
  if (
    existing?.version === 1
    && existing.phase === phase.id
    && existing.fingerprint === fingerprint
    && existing.passed === true
  ) return { reused: true, fingerprint, receiptFile }

  await fs.rm(receiptFile, { force: true })
  await runCommand(phase.command, { cwd: root, env: phase.env })
  await writeReceipt(receiptFile, {
    version: 1,
    phase: phase.id,
    fingerprint,
    passed: true,
    completedAt: new Date().toISOString(),
  })
  return { reused: false, fingerprint, receiptFile }
}
