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
