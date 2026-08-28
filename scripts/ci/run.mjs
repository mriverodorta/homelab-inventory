#!/usr/bin/env bun
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CI_PHASES } from './contract.mjs'
import { assertPinnedToolchains, collectCiState, writeCiReceipt } from './receipt.mjs'
import { runCachedCiPhase } from './phase-cache.mjs'
import { releasePaths } from '../local-release/config.mjs'
import { commandText, run } from '../local-release/process.mjs'

export async function runCiVerification({
  root,
  receiptFile = releasePaths().ciReceiptFile,
  phases = CI_PHASES,
  runCommand = run,
  collectState = collectCiState,
  writeReceipt = writeCiReceipt,
  removeReceipt = (file) => fs.rm(file, { force: true }),
} = {}) {
  const repositoryRoot = root ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  await removeReceipt(receiptFile)

  const before = await collectState(repositoryRoot)
  if (before.trackedStatus) throw new Error(`Commit tracked changes before running CI parity:\n${before.trackedStatus}`)
  assertPinnedToolchains(before)

  for (const [index, phase] of phases.entries()) {
    console.log(`\n[CI ${index + 1}/${phases.length}] ${phase.id}: ${commandText(phase.command)}`)
    if (phase.cacheInputs) {
      const result = await runCachedCiPhase({
        root: repositoryRoot,
        cacheDir: releasePaths().ciPhaseCacheDir,
        phase,
        contractVersion: before.contractVersion,
        runCommand,
      })
      if (result.reused) console.log(`[CI cache] ${phase.id} reused verified unchanged inputs.`)
    } else {
      await runCommand(phase.command, { cwd: repositoryRoot, env: phase.env })
    }
  }

  const after = await collectState(repositoryRoot)
  if (after.revision !== before.revision || after.trackedStatus) {
    throw new Error('Repository inputs changed while local CI was running; no receipt was written.')
  }
  const receipt = await writeReceipt(receiptFile, after)
  console.log(`\nLocal CI parity passed for ${receipt.revision}.`)
  return receipt
}

if (import.meta.main) await runCiVerification()
