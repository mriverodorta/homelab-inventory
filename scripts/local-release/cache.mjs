import fs from 'node:fs/promises'
import path from 'node:path'
import { ensureReleaseBuilder } from './oci.mjs'
import { run } from './process.mjs'
import { ensurePinnedOras } from './tools.mjs'
import { refreshTrivyDatabase, TRIVY_IMAGE } from '../container-security/trivy.mjs'

const PINNED_WARM_IMAGES = Object.freeze([
  'oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0',
  'oven/bun:1.3.14-slim@sha256:d56a2534ffd262e92c12fd3249d3924d296d97086da773f821d7d0477435ea04',
  'gcr.io/distroless/static-debian13:nonroot@sha256:f7f8f729987ad0fdf6b05eeeae94b26e6a0f613bdf46feea7fc40f7bd72953e6',
  TRIVY_IMAGE,
])

export function releaseStateSurvivesDockerCleanup(paths) {
  const protectedRoots = [paths.supportRoot, paths.cacheRoot]
  return protectedRoots.every((root) => (
    path.isAbsolute(root)
    && !root.startsWith('/var/lib/docker')
    && !root.includes('/Docker.raw')
    && !root.includes('/containers/')
  ))
}

export async function pruneCandidateArchives(paths, state, { keepRevisions = 2 } = {}) {
  if (!Number.isSafeInteger(keepRevisions) || keepRevisions < 1) {
    throw new Error('Candidate retention must keep at least one revision.')
  }
  const entries = await fs.readdir(paths.candidatesDir, { withFileTypes: true }).catch((error) => {
    if (error?.code === 'ENOENT') return []
    throw error
  })
  const candidates = await Promise.all(entries
    .filter((entry) => entry.isDirectory())
    .map(async (entry) => ({
      name: entry.name,
      mtimeMs: (await fs.stat(path.join(paths.candidatesDir, entry.name))).mtimeMs,
    })))
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs || left.name.localeCompare(right.name))

  const retained = new Set()
  const activeRevision = state?.identity?.revision
  if (typeof activeRevision === 'string' && candidates.some(({ name }) => name === activeRevision)) {
    retained.add(activeRevision)
  }
  for (const { name } of candidates) {
    if (retained.size >= keepRevisions) break
    retained.add(name)
  }

  const removed = []
  for (const { name } of candidates) {
    if (retained.has(name)) continue
    await fs.rm(path.join(paths.candidatesDir, name), { recursive: true, force: true })
    removed.push(name)
  }
  return { retained: [...retained], removed }
}

const SHA256_DIGEST = /^sha256:([0-9a-f]{64})$/

export async function compactOciCache(cacheDirectory) {
  const indexFile = path.join(cacheDirectory, 'index.json')
  const index = await fs.readFile(indexFile, 'utf8').then(JSON.parse, (error) => {
    if (error?.code === 'ENOENT') return null
    throw error
  })
  if (!index) return { removedBlobs: 0, reclaimedBytes: 0 }

  const blobsDirectory = path.join(cacheDirectory, 'blobs', 'sha256')
  const reachable = new Set()
  const visit = async (value) => {
    if (Array.isArray(value)) {
      for (const item of value) await visit(item)
      return
    }
    if (!value || typeof value !== 'object') return
    const match = typeof value.digest === 'string' ? value.digest.match(SHA256_DIGEST) : null
    if (match && !reachable.has(match[1])) {
      reachable.add(match[1])
      const blob = await fs.readFile(path.join(blobsDirectory, match[1]))
      try {
        await visit(JSON.parse(blob.toString('utf8')))
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error
      }
    }
    for (const child of Object.values(value)) await visit(child)
  }
  await visit(index)

  let removedBlobs = 0
  let reclaimedBytes = 0
  const entries = await fs.readdir(blobsDirectory, { withFileTypes: true }).catch((error) => {
    if (error?.code === 'ENOENT') return []
    throw error
  })
  for (const entry of entries) {
    if (!entry.isFile() || reachable.has(entry.name)) continue
    const target = path.join(blobsDirectory, entry.name)
    reclaimedBytes += (await fs.stat(target)).size
    await fs.rm(target)
    removedBlobs += 1
  }
  return { removedBlobs, reclaimedBytes }
}

export async function warmReleaseCache(paths) {
  if (!releaseStateSurvivesDockerCleanup(paths)) throw new Error('Release storage overlaps Docker-managed cleanup paths.')
  await Promise.all([
    fs.mkdir(paths.cacheRoot, { recursive: true, mode: 0o700 }),
    fs.mkdir(paths.supportRoot, { recursive: true, mode: 0o700 }),
  ])
  await ensurePinnedOras(paths)
  await ensureReleaseBuilder()
  for (const image of PINNED_WARM_IMAGES) await run(['docker', 'pull', '--quiet', image])
  await refreshTrivyDatabase(run)
  return { warmedAt: new Date().toISOString(), images: [...PINNED_WARM_IMAGES] }
}

export async function pruneReleaseCache(paths, { maxAgeDays = 30 } = {}) {
  const threshold = Date.now() - maxAgeDays * 86_400_000
  let removed = 0
  for (const architecture of ['arm64', 'amd64']) {
    const directory = path.join(paths.buildkitCacheDir, architecture)
    for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const target = path.join(directory, entry.name)
      if ((await fs.stat(target)).mtimeMs < threshold) {
        await fs.rm(target, { recursive: true, force: true })
        removed += 1
      }
    }
  }
  return { removed, maxAgeDays }
}
