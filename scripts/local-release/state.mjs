import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { RELEASE_STATE_VERSION } from './config.mjs'
import { run } from './process.mjs'

const IMAGE_INPUTS = [
  'Dockerfile',
  'package.json',
  'bun.lock',
  'server/agent-release-pin.json',
  'rust-toolchain.toml',
]

export function emptyReleaseState() {
  return {
    version: RELEASE_STATE_VERSION,
    phase: 'idle',
    identity: null,
    snapshot: null,
    sanitizedData: null,
    candidates: { arm64: null, amd64: null, index: null },
    staging: null,
    approval: null,
    publication: null,
    updatedAt: null,
  }
}

async function exists(file) {
  try { await fs.access(file); return true } catch { return false }
}

export async function readReleaseState(paths) {
  if (!await exists(paths.stateFile)) return emptyReleaseState()
  const parsed = JSON.parse(await fs.readFile(paths.stateFile, 'utf8'))
  if (parsed?.version !== RELEASE_STATE_VERSION) {
    throw new Error(`Unsupported local release state version ${String(parsed?.version)}.`)
  }
  return parsed
}

export async function writeReleaseState(paths, state) {
  await fs.mkdir(paths.supportRoot, { recursive: true, mode: 0o700 })
  const next = { ...state, version: RELEASE_STATE_VERSION, updatedAt: new Date().toISOString() }
  const temporary = `${paths.stateFile}.${process.pid}-${randomUUID()}.tmp`
  await fs.writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
  await fs.rename(temporary, paths.stateFile)
  await fs.chmod(paths.stateFile, 0o600)
  return next
}

export async function withReleaseLock(paths, operation) {
  await fs.mkdir(paths.supportRoot, { recursive: true, mode: 0o700 })
  let handle
  try {
    handle = await fs.open(paths.lockFile, 'wx', 0o600)
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`)
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error(`Another local release operation owns ${paths.lockFile}.`)
    throw error
  }
  try {
    return await operation()
  } finally {
    await handle.close().catch(() => {})
    await fs.rm(paths.lockFile, { force: true })
  }
}

async function hashFiles(root, files) {
  const hash = createHash('sha256')
  for (const relative of files) {
    hash.update(`${relative}\0`)
    hash.update(await fs.readFile(path.join(root, relative)))
    hash.update('\0')
  }
  return hash.digest('hex')
}

export async function currentReleaseIdentity(root) {
  const [{ stdout: revision }, { stdout: trackedStatus }, { stdout: submoduleStatus }] = await Promise.all([
    run(['git', 'rev-parse', 'HEAD'], { cwd: root, capture: true, log: false }),
    run(['git', 'status', '--porcelain', '--untracked-files=no'], { cwd: root, capture: true, log: false }),
    run(['git', 'submodule', 'status', '--recursive'], { cwd: root, capture: true, log: false }),
  ])
  const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
  const sourceFingerprint = createHash('sha256')
    .update(`${revision}\n${submoduleStatus}\n${await hashFiles(root, IMAGE_INPUTS)}`)
    .digest('hex')
  return {
    revision,
    version: packageJson.version,
    trackedClean: trackedStatus === '',
    trackedStatus,
    submodules: submoduleStatus,
    sourceFingerprint,
  }
}

export function assertIdentityMatches(expected, actual) {
  if (!expected || expected.revision !== actual.revision || expected.sourceFingerprint !== actual.sourceFingerprint) {
    throw new Error('Release inputs changed; prepare a new candidate before continuing.')
  }
  if (!actual.trackedClean) throw new Error(`Tracked worktree changes prevent release:\n${actual.trackedStatus}`)
}
