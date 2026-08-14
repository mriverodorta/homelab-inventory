import fs from 'node:fs/promises'
import path from 'node:path'
import { createBranchReleasePlan } from '../release-plan.mjs'
import { cleanupDockerHubCandidateTags } from './docker-hub.mjs'
import { startLocalRegistry, stopLocalRegistry } from './local-registry.mjs'
import { buildOciCandidate, loadOciCandidate, validateCandidateArtifact } from './oci.mjs'
import { run } from './process.mjs'
import { assertIdentityMatches, writeReleaseState } from './state.mjs'
import { ensurePinnedOras } from './tools.mjs'
import { validateLoadedCandidate } from './validate-image.mjs'

export const IMAGE_REPOSITORY = 'docker.io/mriverodorta/homelab-inventory'

function candidateTag(identity, architecture) {
  return `candidate-${identity.revision.slice(0, 12)}-${architecture}`
}

export function assertPublicationReady({ state, identity, channel }) {
  assertIdentityMatches(state.identity, identity)
  const promotesPublishedLatest = channel === 'stable'
    && state.phase === 'published'
    && state.publication?.channel === 'latest'
    && state.publication?.dryRun === false
  if (!state.approval || (!['approved', 'building-amd64', 'publishing'].includes(state.phase) && !promotesPublishedLatest)) {
    throw new Error('The ARM64 staging candidate has not been approved.')
  }
  if (state.approval.candidateDigest !== state.candidates.arm64?.digest) {
    throw new Error('The ARM64 candidate no longer matches its approval.')
  }
}

function assertPublicationBranch(plan, identity) {
  if (identity.branch !== plan.branch) {
    throw new Error(`The ${plan.channel} channel must be published from the checked-out ${plan.branch} branch.`)
  }
}

export function publicationPlan({ channel, identity, repository = IMAGE_REPOSITORY, localRegistry = null }) {
  const branch = channel === 'latest' ? 'main' : channel === 'stable' ? 'stable' : null
  if (!branch) throw new Error('Publication channel must be latest or stable.')
  const release = createBranchReleasePlan({ branch, version: identity.version, revision: identity.revision, existingTagRevision: '' })
  const destination = localRegistry || repository
  const arm64 = `${destination}:${candidateTag(identity, 'arm64')}`
  const amd64 = `${destination}:${candidateTag(identity, 'amd64')}`
  const finalTags = channel === 'latest'
    ? [`${destination}:latest`]
    : [`${destination}:stable`, `${destination}:${release.exactTag}`, `${destination}:${release.minorTag}`]
  return { branch, channel, release, destination, arm64, amd64, finalTags }
}

export function candidateUploadCommand({ oras, candidate, destination, plainHttp = false }) {
  return [
    oras, 'cp', '--from-oci-layout', '--no-tty',
    ...(plainHttp ? ['--to-plain-http'] : []),
    `${candidate.archive}@${candidate.digest}`, destination,
  ]
}

export function candidateCleanupTags(plan, { dryRun = false } = {}) {
  if (dryRun) return []
  return [plan.arm64, plan.amd64].map((reference) => reference.slice(reference.lastIndexOf(':') + 1))
}

export function indexCreateCommand(plan, { dryRun = false } = {}) {
  return [
    'docker', 'buildx', 'imagetools', 'create',
    ...(dryRun ? ['--dry-run'] : []),
    ...plan.finalTags.flatMap((tag) => ['--tag', tag]),
    plan.arm64, plan.amd64,
  ]
}

async function ensureImmutableTagAvailable(tag, identity) {
  const inspect = await run(['docker', 'buildx', 'imagetools', 'inspect', tag], { capture: true, allowFailure: true, log: false })
  if (inspect.exitCode !== 0) return false
  const verification = await run([
    'bun', 'scripts/verify-published-image.mjs', '--tag', tag.split(':').at(-1),
    '--version', identity.version, '--revision', identity.revision, '--channel', 'release',
  ], { capture: true, allowFailure: true })
  if (verification.exitCode !== 0) throw new Error(`Immutable Docker tag ${tag} already exists with different release metadata.`)
  return true
}

export function publicationWritePlan(plan, { immutableTagExists = false } = {}) {
  if (!immutableTagExists || plan.channel !== 'stable') return plan
  const immutableTag = `${plan.destination}:${plan.release.exactTag}`
  return { ...plan, finalTags: plan.finalTags.filter((tag) => tag !== immutableTag) }
}

async function verifyIndex(plan) {
  const { stdout } = await run(['docker', 'buildx', 'imagetools', 'inspect', '--raw', plan.finalTags[0]], { capture: true })
  const manifest = JSON.parse(stdout)
  const platforms = new Set((manifest.manifests ?? []).map((entry) => `${entry.platform?.os}/${entry.platform?.architecture}`))
  if (!platforms.has('linux/arm64') || !platforms.has('linux/amd64')) {
    throw new Error('Published OCI index does not contain both required runtime platforms.')
  }
  return { tag: plan.finalTags[0], platforms: [...platforms].sort() }
}

async function finalizeGitHubRelease(plan, identity, { dryRun }) {
  if (dryRun || plan.channel !== 'stable') return { skipped: true }
  const remoteTag = await run(['git', 'ls-remote', '--refs', 'origin', `refs/tags/${plan.release.gitTag}`], { capture: true, log: false })
  if (remoteTag.stdout && !remoteTag.stdout.startsWith(identity.revision)) {
    throw new Error(`${plan.release.gitTag} already belongs to another revision.`)
  }
  if (!remoteTag.stdout) {
    await run(['git', 'tag', plan.release.gitTag, identity.revision])
    await run(['git', 'push', 'origin', `refs/tags/${plan.release.gitTag}`])
  }
  const existing = await run(['gh', 'release', 'view', plan.release.gitTag], { capture: true, allowFailure: true, log: false })
  if (existing.exitCode !== 0) {
    await run(['gh', 'release', 'create', plan.release.gitTag, '--verify-tag', '--title', plan.release.gitTag, '--generate-notes'])
  }
  return { tag: plan.release.gitTag, release: 'verified' }
}

export async function publishCandidate({ root, paths, state, identity, channel, dryRun = false }) {
  assertPublicationReady({ state, identity, channel })
  await validateCandidateArtifact(state.candidates.arm64)
  let next = await writeReleaseState(paths, { ...state, phase: 'building-amd64' })
  let amd64 = state.candidates.amd64
  if (!amd64) {
    const built = await buildOciCandidate({ root, paths, identity, architecture: 'amd64' })
    await loadOciCandidate(built, paths)
    amd64 = await validateLoadedCandidate(built)
    next = await writeReleaseState(paths, {
      ...next,
      phase: 'publishing',
      candidates: { ...next.candidates, amd64 },
    })
  } else {
    if (amd64.revision !== identity.revision || amd64.sourceFingerprint !== identity.sourceFingerprint) {
      throw new Error('The AMD64 candidate belongs to different release inputs.')
    }
    await validateCandidateArtifact(amd64)
  }

  const oras = await ensurePinnedOras(paths)
  let local = null
  try {
    if (dryRun) local = await startLocalRegistry()
    const plan = publicationPlan({ channel, identity, localRegistry: local?.repository })
    assertPublicationBranch(plan, identity)
    await Promise.all(publicationPlan({ channel, identity }).finalTags.map((tag) => (
      run(['docker', 'buildx', 'imagetools', 'inspect', tag], { capture: true, allowFailure: true, log: false })
    )))
    const immutableTagExists = !dryRun && channel === 'stable'
      ? await ensureImmutableTagAvailable(`${plan.destination}:${plan.release.exactTag}`, identity)
      : false
    const writePlan = publicationWritePlan(plan, { immutableTagExists })
    await run(candidateUploadCommand({ oras, candidate: state.candidates.arm64, destination: plan.arm64, plainHttp: dryRun }))
    await run(candidateUploadCommand({ oras, candidate: amd64, destination: plan.amd64, plainHttp: dryRun }))
    await run(indexCreateCommand(writePlan))
    const index = await verifyIndex(writePlan)
    const cleanupTags = candidateCleanupTags(plan, { dryRun })
    const candidateCleanup = cleanupTags.length === 0
      ? { skipped: true, deleted: [], remaining: [] }
      : { skipped: false, ...await cleanupDockerHubCandidateTags({ tags: cleanupTags }) }
    if (!dryRun) await verifyIndex(writePlan)
    if (!dryRun) {
      await run(['git', 'push', 'origin', `${identity.revision}:refs/heads/${plan.branch}`])
    }
    const github = await finalizeGitHubRelease(plan, identity, { dryRun })
    const publication = {
      channel,
      dryRun,
      tags: plan.finalTags,
      immutableTagReused: immutableTagExists,
      index,
      github,
      candidateCleanup,
      publishedAt: new Date().toISOString(),
    }
    await fs.mkdir(paths.receiptsDir, { recursive: true, mode: 0o700 })
    await fs.writeFile(
      path.join(paths.receiptsDir, `${identity.revision}-${channel}${dryRun ? '-dry-run' : ''}.json`),
      `${JSON.stringify({ identity, approval: state.approval, candidates: { arm64: state.candidates.arm64, amd64 }, publication }, null, 2)}\n`,
      { mode: 0o600 },
    )
    return await writeReleaseState(paths, {
      ...next,
      phase: dryRun ? 'approved' : 'published',
      candidates: { ...next.candidates, amd64, index },
      publication,
    })
  } finally {
    await stopLocalRegistry(local)
  }
}
