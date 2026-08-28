#!/usr/bin/env bun
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { releasePaths, releaseRemoteConfig } from './local-release/config.mjs'
import { parseLocalReleaseCommand } from './local-release/cli.mjs'
import { cleanupReleaseDockerState } from './local-release/cleanup.mjs'
import { cleanupDockerHubCandidateTags } from './local-release/docker-hub.mjs'
import { buildOciCandidate, loadOciCandidate, pruneReleaseBuilderCache, validateCandidateArtifact } from './local-release/oci.mjs'
import { publishCandidate } from './local-release/publish.mjs'
import { sanitizeStagingData } from './local-release/sanitize.mjs'
import { activateIncomingData, createRemoteSnapshot } from './local-release/snapshot.mjs'
import {
  assertIdentityMatches,
  currentReleaseIdentity,
  emptyReleaseState,
  readReleaseState,
  withReleaseLock,
  writeReleaseState,
} from './local-release/state.mjs'
import { checkStaging, createApproval, deployStaging, stagingLogs, stopStaging } from './local-release/staging.mjs'
import { validateLoadedCandidate } from './local-release/validate-image.mjs'
import { ensureCiVerification } from './ci/run.mjs'
import { formatTimingSummary, runTimedPhase, upsertPhaseReceipt } from './local-release/timing.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const paths = releasePaths()

function usage() {
  console.log(`Usage: bun run release:local <command> [options]

Commands:
  prepare                  Refresh live staging data and build ARM64
  status                   Show local candidate and publication state
  approve                  Approve the exact running ARM64 candidate
  publish --channel <name> Build AMD64 and publish exact OCI candidates
  logs                     Show staging container logs
  stop                     Stop the staging container
  reset                    Remove incomplete local release state
  cleanup-local            Remove release-owned Docker cache and volumes
  verify-push              Verify the current two-platform security receipt
  cleanup-candidates       Remove all temporary candidate tags from Docker Hub`)
}

async function status() {
  const [state, identity] = await Promise.all([readReleaseState(paths), currentReleaseIdentity(root)])
  console.log(JSON.stringify({
    phase: state.phase,
    version: identity.version,
    revision: identity.revision,
    trackedClean: identity.trackedClean,
    snapshot: state.snapshot,
    arm64: state.candidates.arm64,
    staging: state.staging,
    approval: state.approval,
    amd64: state.candidates.amd64,
    publication: state.publication,
    timings: state.timings,
  }, null, 2))
  console.log(`\n${formatTimingSummary(state.timings)}`)
}

function statePhase({ id, identity, paths, stateRef, operation }) {
  return runTimedPhase({
    id,
    sourceFingerprint: identity.sourceFingerprint,
    operation,
    onReceipt: async (receipt) => {
      const current = stateRef.get()
      stateRef.set(await writeReleaseState(paths, {
        ...current,
        timings: upsertPhaseReceipt(current.timings, receipt),
      }))
    },
  })
}

async function prepare() {
  await withReleaseLock(paths, async () => {
    const identity = await currentReleaseIdentity(root)
    let completed = false
    let state = { ...emptyReleaseState(), phase: 'verifying', identity }
    const stateRef = { get: () => state, set: (next) => { state = next } }
    const timed = (id, operation) => statePhase({ id, identity, paths, stateRef, operation })
    try {
      if (!identity.trackedClean) throw new Error(`Tracked worktree changes prevent release:\n${identity.trackedStatus}`)
      state = await writeReleaseState(paths, state)
      await timed('local-ci', () => ensureCiVerification({ root, receiptFile: paths.ciReceiptFile }))
      state = await writeReleaseState(paths, { ...state, phase: 'snapshotting' })
      const snapshot = await timed('production-snapshot', () => createRemoteSnapshot(releaseRemoteConfig(), paths, { root }))
      state = await writeReleaseState(paths, { ...state, phase: 'sanitizing', snapshot })
      const sanitizedData = await timed('sanitize-snapshot', async () => {
        const result = await sanitizeStagingData(paths.incomingDataDir)
        await activateIncomingData(paths)
        return result
      })
      state = await writeReleaseState(paths, { ...state, phase: 'building-arm64', sanitizedData })
      const built = await timed('arm64-build', () => buildOciCandidate({ root, paths, identity, architecture: 'arm64' }))
      const arm64 = await timed('arm64-validation', async () => {
        const loaded = await loadOciCandidate(built, paths)
        return validateLoadedCandidate(loaded)
      })
      state = await writeReleaseState(paths, {
        ...state,
        phase: 'staging',
        candidates: { ...state.candidates, arm64 },
      })
      const staging = await timed('staging-deploy', async () => {
        await deployStaging(arm64, paths)
        return checkStaging(arm64, paths)
      })
      await timed('approval-builder-prune', () => pruneReleaseBuilderCache())
      state = await writeReleaseState(paths, { ...state, phase: 'awaiting-approval', staging })
      completed = true
      console.log(`\nARM64 staging is ready at http://127.0.0.1:8799 for revision ${identity.revision}.`)
    } finally {
      if (!completed) await stopStaging()
      await timed('prepare-cleanup', () => cleanupReleaseDockerState({
        paths,
        revision: identity.revision,
        candidateArchitectures: completed ? [] : ['arm64', 'amd64'],
        preserveBuilder: completed,
        preserveScanner: completed,
      }))
    }
  })
}

async function approve() {
  await withReleaseLock(paths, async () => {
    const [state, identity] = await Promise.all([readReleaseState(paths), currentReleaseIdentity(root)])
    assertIdentityMatches(state.identity, identity)
    if (state.phase !== 'awaiting-approval' || !state.candidates.arm64) {
      throw new Error('No ARM64 staging candidate is awaiting approval.')
    }
    const staging = await checkStaging(state.candidates.arm64, paths)
    const approval = createApproval({
      identity,
      candidate: state.candidates.arm64,
      snapshot: state.snapshot,
      sanitizedData: state.sanitizedData,
      check: staging,
    })
    await writeReleaseState(paths, { ...state, phase: 'approved', staging, approval })
    console.log(`Approved ARM64 candidate ${state.candidates.arm64.digest}.`)
  })
}

async function reset() {
  await withReleaseLock(paths, async () => {
    const state = await readReleaseState(paths)
    await stopStaging()
    await cleanupReleaseDockerState({
      paths,
      revision: state.identity?.revision,
      candidateArchitectures: ['arm64', 'amd64'],
    })
    if (state.identity?.revision) {
      await fs.rm(path.join(paths.candidatesDir, state.identity.revision), { recursive: true, force: true })
    }
    await writeReleaseState(paths, emptyReleaseState())
  })
}

function option(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? null : process.argv[index + 1]
}

async function publish() {
  const channel = option('channel')
  const dryRun = process.argv.includes('--dry-run')
  if (!channel) throw new Error('publish requires --channel latest or --channel stable.')
  await withReleaseLock(paths, async () => {
    const [state, identity] = await Promise.all([readReleaseState(paths), currentReleaseIdentity(root)])
    let completed = false
    try {
      await publishCandidate({ root, paths, state, identity, channel, dryRun })
      completed = true
    } finally {
      if (completed) await stopStaging()
      await cleanupReleaseDockerState({
        paths,
        revision: identity.revision,
        candidateArchitectures: completed ? ['arm64', 'amd64'] : ['amd64'],
      })
    }
  })
}

async function verifyPush() {
  const [state, identity] = await Promise.all([readReleaseState(paths), currentReleaseIdentity(root)])
  assertIdentityMatches(state.identity, identity)
  if (!state.approval) throw new Error('No staging approval exists for this revision.')
  for (const architecture of ['arm64', 'amd64']) {
    const candidate = state.candidates[architecture]
    if (!candidate || candidate.security !== 'passed' || candidate.smoke !== 'passed' || !candidate.validatedAt) {
      throw new Error(`The ${architecture} zero-vulnerability validation receipt is missing.`)
    }
    await validateCandidateArtifact(candidate)
  }
  console.log(`Verified current local release receipt for ${identity.revision}.`)
}

async function cleanupCandidates() {
  await withReleaseLock(paths, async () => {
    const result = await cleanupDockerHubCandidateTags()
    console.log(`Removed ${result.deleted.length} Docker Hub candidate tag(s).`)
  })
}

async function cleanupLocal() {
  await withReleaseLock(paths, async () => {
    const state = await readReleaseState(paths)
    await cleanupReleaseDockerState({
      paths,
      revision: state.identity?.revision,
      reclaimDockerRaw: !process.argv.includes('--skip-raw-reclaim'),
    })
    console.log('Removed release-owned Docker cache and volumes.')
  })
}

const { command } = parseLocalReleaseCommand(process.argv.slice(2))
if (command === 'help') {
  usage()
} else if (command === 'status') {
  await status()
} else if (command === 'prepare') {
  await prepare()
} else if (command === 'approve') {
  await approve()
} else if (command === 'logs') {
  await stagingLogs()
} else if (command === 'stop') {
  await stopStaging()
} else if (command === 'reset') {
  await reset()
} else if (command === 'publish') {
  await publish()
} else if (command === 'cleanup-local') {
  await cleanupLocal()
} else if (command === 'verify-push') {
  await verifyPush()
} else if (command === 'cleanup-candidates') {
  await cleanupCandidates()
} else {
  usage()
  process.exitCode = 2
}
