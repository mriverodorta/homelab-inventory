import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  CI_CONTRACT_FILES,
  CI_CONTRACT_VERSION,
  CI_ENVIRONMENT_KEYS,
  CI_PHASES,
  CI_RECEIPT_VERSION,
  PINNED_BUN_VERSION,
  PINNED_RUST_VERSION,
} from './contract.mjs'
import { run } from '../local-release/process.mjs'

function sameObject(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

async function hashContractFiles(root) {
  const entries = await Promise.all(CI_CONTRACT_FILES.map(async (relative) => {
    const contents = await fs.readFile(path.join(root, relative))
    return [relative, createHash('sha256').update(contents).digest('hex')]
  }))
  return Object.fromEntries(entries)
}

function parseRustVersion(output) {
  const match = /^rustc\s+(\d+\.\d+\.\d+)/.exec(output)
  if (!match) throw new Error(`Unable to parse Rust version from ${JSON.stringify(output)}.`)
  return match[1]
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function normalizeCiEnvironment(environment = process.env) {
  return Object.fromEntries(CI_ENVIRONMENT_KEYS.map((key) => [key, environment[key] ?? null]))
}

export function computeCiInputFingerprint(state) {
  return sha256(JSON.stringify({
    receiptVersion: state.receiptVersion,
    revision: state.revision,
    submodules: state.submodules,
    bunVersion: state.bunVersion,
    rustVersion: state.rustVersion,
    host: state.host,
    environment: state.environment,
    contractVersion: state.contractVersion,
    contractHashes: state.contractHashes,
    phaseContractHash: state.phaseContractHash,
  }))
}

function phaseContractHash() {
  return sha256(JSON.stringify(CI_PHASES))
}

export function assertCleanCiState(state) {
  if (state.trackedStatus) throw new Error(`Commit tracked changes before running CI parity:\n${state.trackedStatus}`)
  if (state.untrackedStatus) throw new Error(`Commit or ignore unexpected untracked files before running CI parity:\n${state.untrackedStatus}`)
}

export async function collectCiState(root, { environment = process.env, host } = {}) {
  const [{ stdout: revision }, { stdout: trackedStatus }, { stdout: untrackedStatus }, { stdout: submodules }, { stdout: rustOutput }] = await Promise.all([
    run(['git', 'rev-parse', 'HEAD'], { cwd: root, capture: true, log: false }),
    run(['git', 'status', '--porcelain=v1', '--untracked-files=no', '--ignore-submodules=none'], { cwd: root, capture: true, log: false }),
    run(['git', 'ls-files', '--others', '--exclude-standard'], { cwd: root, capture: true, log: false }),
    run(['git', 'submodule', 'foreach', '--recursive', '--quiet', 'printf "%s=%s\\n" "$sm_path" "$(git rev-parse HEAD)"'], { cwd: root, capture: true, log: false }),
    run(['rustc', '--version'], { cwd: root, capture: true, log: false }),
  ])

  const state = {
    receiptVersion: CI_RECEIPT_VERSION,
    revision,
    trackedStatus,
    untrackedStatus,
    submodules,
    bunVersion: Bun.version,
    rustVersion: parseRustVersion(rustOutput),
    host: host ?? { platform: process.platform, architecture: process.arch, release: os.release() },
    environment: normalizeCiEnvironment(environment),
    contractVersion: CI_CONTRACT_VERSION,
    contractHashes: await hashContractFiles(root),
    phaseContractHash: phaseContractHash(),
  }
  return { ...state, inputFingerprint: computeCiInputFingerprint(state) }
}

export function assertPinnedToolchains(state) {
  if (state.bunVersion !== PINNED_BUN_VERSION) {
    throw new Error(`Bun ${PINNED_BUN_VERSION} is required for CI parity; found ${state.bunVersion}.`)
  }
  if (state.rustVersion !== PINNED_RUST_VERSION) {
    throw new Error(`Rust ${PINNED_RUST_VERSION} is required for CI parity; found ${state.rustVersion}.`)
  }
}

export function validateCiReceipt(receipt, current, expectedRevision = current.revision) {
  if (!receipt) throw new Error('The local CI receipt is missing. Run bun run ci:verify.')
  if (receipt.receiptVersion !== CI_RECEIPT_VERSION) throw new Error('The local CI receipt version changed.')
  if (receipt.passed !== true) throw new Error('The local CI receipt does not record successful validation.')
  if (current.trackedStatus) throw new Error(`Tracked worktree changes invalidate CI proof:\n${current.trackedStatus}`)
  if (current.untrackedStatus) throw new Error(`Unexpected untracked files invalidate CI proof:\n${current.untrackedStatus}`)
  if (current.revision !== expectedRevision || receipt.revision !== expectedRevision) {
    throw new Error('The local CI receipt does not match the pushed revision.')
  }
  if (receipt.contractVersion !== current.contractVersion) throw new Error('The local CI contract version changed.')
  if (!sameObject(receipt.contractHashes, current.contractHashes)) throw new Error('The local CI contract files changed.')
  if (receipt.phaseContractHash !== current.phaseContractHash) throw new Error('The local CI phase contract changed.')
  if (receipt.submodules !== current.submodules) throw new Error('The agent submodule changed after local CI passed.')
  if (receipt.bunVersion !== current.bunVersion) throw new Error('The Bun toolchain changed after local CI passed.')
  if (receipt.rustVersion !== current.rustVersion) throw new Error('The Rust toolchain changed after local CI passed.')
  if (!sameObject(receipt.host, current.host)) throw new Error('The local CI host platform changed.')
  if (!sameObject(receipt.environment, current.environment)) throw new Error('The local CI environment changed.')
  const receiptFingerprint = computeCiInputFingerprint(receipt)
  const currentFingerprint = computeCiInputFingerprint(current)
  if (receipt.inputFingerprint !== receiptFingerprint) throw new Error('The local CI receipt input fingerprint is invalid.')
  if (current.inputFingerprint !== currentFingerprint) throw new Error('The current local CI input fingerprint is invalid.')
  if (receipt.inputFingerprint !== current.inputFingerprint) throw new Error('The local CI receipt inputs changed.')
  assertPinnedToolchains(current)
  return receipt
}

export async function writeCiReceipt(receiptFile, state) {
  await fs.mkdir(path.dirname(receiptFile), { recursive: true, mode: 0o700 })
  const temporary = `${receiptFile}.${process.pid}-${randomUUID()}.tmp`
  const receipt = { ...state, passed: true, completedAt: new Date().toISOString() }
  await fs.writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 })
  await fs.rename(temporary, receiptFile)
  await fs.chmod(receiptFile, 0o600)
  return receipt
}

export async function readCiReceipt(receiptFile) {
  try {
    return JSON.parse(await fs.readFile(receiptFile, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

export async function verifyCiReceipt({ root, receiptFile, expectedRevision }) {
  const [receipt, current] = await Promise.all([readCiReceipt(receiptFile), collectCiState(root)])
  return validateCiReceipt(receipt, current, expectedRevision ?? current.revision)
}
