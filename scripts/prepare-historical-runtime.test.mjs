import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareHistoricalRuntime } from './prepare-historical-runtime.mjs'

const tempDirectories = []
const serverCopy = 'COPY --chown=10001:10001 server/index.mjs server/agent-routes.mjs ./server/'
const releaseNotesCopy = 'COPY --chown=10001:10001 src/release-notes.ts ./src/release-notes.ts'
const extendedServerCopy = 'COPY --chown=10001:10001 server/index.mjs server/agent-routes.mjs server/update-checker.mjs server/update-routes.mjs server/update-scheduler.mjs ./server/'
const rateLimitCopy = 'COPY --chown=10001:10001 server/rate-limit.mjs ./server/rate-limit.mjs'

async function createHistoricalSource({
  dockerfile = `${serverCopy}\nUSER 10001:10001\n`,
  serverSource = "import { currentVersion } from '../src/release-notes.ts'\n",
  includeReleaseNotes = true,
} = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'historical-runtime-'))
  tempDirectories.push(directory)
  await fs.mkdir(path.join(directory, 'server'), { recursive: true })
  await fs.mkdir(path.join(directory, 'src'), { recursive: true })
  await fs.writeFile(path.join(directory, 'Dockerfile'), dockerfile)
  await fs.writeFile(path.join(directory, 'server', 'index.mjs'), serverSource)
  if (includeReleaseNotes) {
    await fs.writeFile(path.join(directory, 'src', 'release-notes.ts'), 'export const currentVersion = "0.1.11"\n')
  }
  return directory
}

async function createRateLimitSource({
  dockerfile = `${extendedServerCopy}\nUSER 10001:10001\n`,
  serverSource = "import { readRateLimitConfig } from './rate-limit.mjs'\n",
  includeRateLimit = true,
} = {}) {
  const directory = await createHistoricalSource({ dockerfile, serverSource })
  if (includeRateLimit) {
    await fs.writeFile(path.join(directory, 'server', 'rate-limit.mjs'), 'export function readRateLimitConfig() {}\n')
  }
  return directory
}

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })))
})

describe('prepareHistoricalRuntime', () => {
  it('adds the missing release-notes COPY for 0.1.11', async () => {
    const sourceDir = await createHistoricalSource()

    await expect(prepareHistoricalRuntime({ sourceDir, version: '0.1.11' })).resolves.toEqual({
      repaired: true,
      reason: 'release-notes-copy-added',
    })

    const dockerfile = await fs.readFile(path.join(sourceDir, 'Dockerfile'), 'utf8')
    expect(dockerfile).toContain(`${serverCopy}\n${releaseNotesCopy}`)
    expect(dockerfile.match(new RegExp(releaseNotesCopy.replaceAll('.', '\\.'), 'g'))).toHaveLength(1)
  })

  it('is idempotent when the repair is already present', async () => {
    const sourceDir = await createHistoricalSource({ dockerfile: `${serverCopy}\n${releaseNotesCopy}\n` })

    await expect(prepareHistoricalRuntime({ sourceDir, version: '0.1.11' })).resolves.toEqual({
      repaired: false,
      reason: 'already-repaired',
    })
  })

  it('does not modify unaffected versions', async () => {
    const sourceDir = await createHistoricalSource()
    const originalDockerfile = await fs.readFile(path.join(sourceDir, 'Dockerfile'), 'utf8')

    await expect(prepareHistoricalRuntime({ sourceDir, version: '0.1.12' })).resolves.toEqual({
      repaired: false,
      reason: 'version-not-affected',
    })
    await expect(fs.readFile(path.join(sourceDir, 'Dockerfile'), 'utf8')).resolves.toBe(originalDockerfile)
  })

  it('adds the missing rate-limit COPY for 0.1.18', async () => {
    const sourceDir = await createRateLimitSource()

    await expect(prepareHistoricalRuntime({ sourceDir, version: '0.1.18' })).resolves.toEqual({
      repaired: true,
      reason: 'rate-limit-copy-added',
    })

    const dockerfile = await fs.readFile(path.join(sourceDir, 'Dockerfile'), 'utf8')
    expect(dockerfile).toContain(`${extendedServerCopy}\n${rateLimitCopy}`)
  })

  it('fails if the imported rate-limit file is missing', async () => {
    const sourceDir = await createRateLimitSource({ includeRateLimit: false })
    await expect(prepareHistoricalRuntime({ sourceDir, version: '0.1.18' })).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('fails if the affected source no longer imports release notes', async () => {
    const sourceDir = await createHistoricalSource({ serverSource: 'console.log("server")\n' })
    await expect(prepareHistoricalRuntime({ sourceDir, version: '0.1.11' })).rejects.toThrow(
      'expected src/release-notes.ts import defect',
    )
  })

  it('fails if the imported release-notes file is missing', async () => {
    const sourceDir = await createHistoricalSource({ includeReleaseNotes: false })
    await expect(prepareHistoricalRuntime({ sourceDir, version: '0.1.11' })).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('fails if the Dockerfile no longer has the expected repair anchor', async () => {
    const sourceDir = await createHistoricalSource({ dockerfile: 'FROM scratch\n' })
    await expect(prepareHistoricalRuntime({ sourceDir, version: '0.1.11' })).rejects.toThrow(
      'exactly one expected server COPY instruction',
    )
  })
})
