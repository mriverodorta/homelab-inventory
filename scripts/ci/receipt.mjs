import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { CI_CONTRACT_FILES, CI_CONTRACT_VERSION, PINNED_BUN_VERSION, PINNED_RUST_VERSION } from './contract.mjs'
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

export async function collectCiState(root) {
  const [{ stdout: revision }, { stdout: trackedStatus }, { stdout: submodules }, { stdout: rustOutput }] = await Promise.all([
    run(['git', 'rev-parse', 'HEAD'], { cwd: root, capture: true, log: false }),
    run(['git', 'status', '--porcelain=v1', '--untracked-files=no', '--ignore-submodules=none'], { cwd: root, capture: true, log: false }),
    run(['git', 'submodule', 'foreach', '--recursive', '--quiet', 'printf "%s=%s\\n" "$sm_path" "$(git rev-parse HEAD)"'], { cwd: root, capture: true, log: false }),
    run(['rustc', '--version'], { cwd: root, capture: true, log: false }),
  ])

  return {
    revision,
    trackedStatus,
    submodules,
    bunVersion: Bun.version,
    rustVersion: parseRustVersion(rustOutput),
    contractVersion: CI_CONTRACT_VERSION,
    contractHashes: await hashContractFiles(root),
  }
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
  if (current.trackedStatus) throw new Error(`Tracked worktree changes invalidate CI proof:\n${current.trackedStatus}`)
  if (current.revision !== expectedRevision || receipt.revision !== expectedRevision) {
    throw new Error('The local CI receipt does not match the pushed revision.')
  }
  if (receipt.contractVersion !== current.contractVersion) throw new Error('The local CI contract version changed.')
  if (!sameObject(receipt.contractHashes, current.contractHashes)) throw new Error('The local CI contract files changed.')
  if (receipt.submodules !== current.submodules) throw new Error('The agent submodule changed after local CI passed.')
  if (receipt.bunVersion !== current.bunVersion) throw new Error('The Bun toolchain changed after local CI passed.')
  if (receipt.rustVersion !== current.rustVersion) throw new Error('The Rust toolchain changed after local CI passed.')
  assertPinnedToolchains(current)
  return receipt
}

export async function writeCiReceipt(receiptFile, state) {
  await fs.mkdir(path.dirname(receiptFile), { recursive: true, mode: 0o700 })
  const temporary = `${receiptFile}.${process.pid}-${randomUUID()}.tmp`
  const receipt = { ...state, completedAt: new Date().toISOString() }
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
