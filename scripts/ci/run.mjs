#!/usr/bin/env bun
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CI_PHASES } from './contract.mjs'
import {
  assertCleanCiState,
  assertPinnedToolchains,
  collectCiState,
  readCiReceipt,
  validateCiReceipt,
  writeCiReceipt,
} from './receipt.mjs'
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
  assertCleanCiState(before)
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
  if (after.revision !== before.revision || after.trackedStatus || after.untrackedStatus) {
    throw new Error('Repository inputs changed while local CI was running; no receipt was written.')
  }
  const receipt = await writeReceipt(receiptFile, after)
  console.log(`\nLocal CI parity passed for ${receipt.revision}.`)
  return receipt
}

export async function ensureCiVerification({
  root,
  receiptFile = releasePaths().ciReceiptFile,
  phases = CI_PHASES,
  runCommand = run,
  collectState = collectCiState,
  readReceipt = readCiReceipt,
  validateReceipt = validateCiReceipt,
  runFullVerification = runCiVerification,
  log = console.log,
} = {}) {
  const repositoryRoot = root ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  try {
    const before = await collectState(repositoryRoot)
    const receipt = await readReceipt(receiptFile)
    validateReceipt(receipt, before)

    const artifactPhase = phases.find((phase) => phase.id === 'release-artifacts')
    if (!artifactPhase) throw new Error('The CI contract does not define release artifact restoration.')
    await runCommand(artifactPhase.command, { cwd: repositoryRoot, env: artifactPhase.env })

    const after = await collectState(repositoryRoot)
    validateReceipt(receipt, after)
    log(`[CI receipt] Reused trusted proof for ${receipt.revision}.`)
    return { receipt, reused: true, timingOutcome: 'passed-reused' }
  } catch (error) {
    log(`[CI receipt] ${error.message.split('\n')[0]} Running complete CI.`)
    const receipt = await runFullVerification({
      root: repositoryRoot,
      receiptFile,
      phases,
      runCommand,
      collectState,
    })
    return { receipt, reused: false, timingOutcome: 'passed' }
  }
}

if (import.meta.main) await runCiVerification()
