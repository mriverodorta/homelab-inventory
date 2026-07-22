import { execFile } from 'node:child_process'
import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const tempDirs = []
const scriptPath = path.resolve('scripts/check-release-notes.mjs')
const bunCandidates = [
  process.versions.bun ? process.execPath : undefined,
  process.env.npm_execpath?.includes('bun') ? process.env.npm_execpath : undefined,
  path.join(os.homedir(), '.bun/bin/bun'),
  'bun',
].filter(Boolean)
const bunExecutable =
  bunCandidates.find((candidate) => path.isAbsolute(candidate) && fsSync.existsSync(candidate)) ??
  'bun'

async function run(command, args, options) {
  try {
    const result = await execFileAsync(command, args, options)

    return {
      exitCode: 0,
      stdout: result.stdout,
      stderr: result.stderr,
    }
  } catch (error) {
    error.exitCode = error.code
    throw error
  }
}

async function runCheck(repo, args = [], env = {}) {
  return run(bunExecutable, [scriptPath, '--base', 'HEAD', ...args], {
    cwd: repo,
    env: { ...process.env, ...env },
  })
}

async function makeRepo() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'release-notes-check-'))
  tempDirs.push(dir)

  await run('git', ['init'], { cwd: dir })
  await run('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
  await run('git', ['config', 'user.name', 'Test User'], { cwd: dir })
  await fs.mkdir(path.join(dir, 'src'), { recursive: true })
  await fs.writeFile(
    path.join(dir, 'package.json'),
    `${JSON.stringify({ version: '0.1.10' }, null, 2)}\n`,
  )
  await fs.writeFile(
    path.join(dir, 'src', 'release-notes.ts'),
    "export const RELEASE_NOTES = [{ version: '0.1.10' }]\n",
  )
  await run('git', ['add', '.'], { cwd: dir })
  await run('git', ['commit', '-m', 'initial'], { cwd: dir })

  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('check-release-notes', () => {
  it('fails for runtime changes without release notes', async () => {
    const repo = await makeRepo()
    await fs.writeFile(path.join(repo, 'src', 'App.tsx'), 'export function App() { return null }\n')

    await expect(runCheck(repo)).rejects.toMatchObject({
      exitCode: 1,
    })
  })

  it('passes for runtime changes with release notes', async () => {
    const repo = await makeRepo()
    await fs.writeFile(path.join(repo, 'src', 'App.tsx'), 'export function App() { return null }\n')
    await fs.writeFile(
      path.join(repo, 'src', 'release-notes.ts'),
      "export const RELEASE_NOTES = [{ version: '0.1.10' }, { version: '0.1.11' }]\n",
    )

    const result = await runCheck(repo)

    expect(result.exitCode).toBe(0)
  })

  it('passes for test-only changes', async () => {
    const repo = await makeRepo()
    await fs.mkdir(path.join(repo, 'src', 'test'), { recursive: true })
    await fs.writeFile(path.join(repo, 'src', 'test', 'sample.test.ts'), 'import { it } from "vitest"\n')

    const result = await runCheck(repo)

    expect(result.exitCode).toBe(0)
  })

  it('passes with the skip marker', async () => {
    const repo = await makeRepo()
    await fs.writeFile(path.join(repo, 'src', 'App.tsx'), 'export function App() { return null }\n')

    const result = await runCheck(repo, ['--message', '[skip release-notes]'])

    expect(result.exitCode).toBe(0)
  })

  it('reads the skip marker from the pull-request head commit', async () => {
    const repo = await makeRepo()
    await fs.writeFile(path.join(repo, 'src', 'App.tsx'), 'export function App() { return null }\n')
    await run('git', ['add', '.'], { cwd: repo })
    await run('git', ['commit', '-m', 'maintenance [skip release-notes]'], { cwd: repo })
    await run('git', [
      'update-ref',
      'refs/remotes/origin/dependabot/test-update',
      'HEAD',
    ], { cwd: repo })
    await run('git', ['reset', '--hard', 'HEAD~1'], { cwd: repo })
    await fs.writeFile(path.join(repo, 'src', 'App.tsx'), 'export function App() { return null }\n')

    const result = await runCheck(repo, [], {
      GITHUB_HEAD_REF: 'dependabot/test-update',
    })

    expect(result.exitCode).toBe(0)
  })

  it('passes for Dependabot-only GitHub Actions updates', async () => {
    const repo = await makeRepo()
    const workflowDir = path.join(repo, '.github', 'workflows')
    await fs.mkdir(workflowDir, { recursive: true })
    await fs.writeFile(
      path.join(workflowDir, 'publish.yml'),
      'steps:\n  - uses: docker/build-push-action@v7\n',
    )

    const result = await runCheck(repo, [], { GITHUB_ACTOR: 'dependabot[bot]' })

    expect(result.exitCode).toBe(0)
  })

  it('fails for non-Dependabot GitHub Actions updates without release notes', async () => {
    const repo = await makeRepo()
    const workflowDir = path.join(repo, '.github', 'workflows')
    await fs.mkdir(workflowDir, { recursive: true })
    await fs.writeFile(
      path.join(workflowDir, 'publish.yml'),
      'steps:\n  - uses: docker/build-push-action@v7\n',
    )

    await expect(runCheck(repo, [], { GITHUB_ACTOR: 'octocat' })).rejects.toMatchObject({
      exitCode: 1,
    })
  })

  it('fails for Dependabot runtime source updates without release notes', async () => {
    const repo = await makeRepo()
    await fs.writeFile(path.join(repo, 'src', 'App.tsx'), 'export function App() { return null }\n')

    await expect(
      runCheck(repo, [], { GITHUB_ACTOR: 'dependabot[bot]' }),
    ).rejects.toMatchObject({
      exitCode: 1,
    })
  })

  it('fails when the current package version has no release note', async () => {
    const repo = await makeRepo()
    await fs.writeFile(
      path.join(repo, 'package.json'),
      `${JSON.stringify({ version: '0.1.11' }, null, 2)}\n`,
    )

    await expect(runCheck(repo, ['--require-current-version'])).rejects.toMatchObject({
      exitCode: 1,
    })
  })

  it('does not skip the current-version check with the skip marker', async () => {
    const repo = await makeRepo()
    await fs.writeFile(
      path.join(repo, 'package.json'),
      `${JSON.stringify({ version: '0.1.11' }, null, 2)}\n`,
    )

    await expect(
      runCheck(repo, ['--require-current-version', '--message', '[skip release-notes]']),
    ).rejects.toMatchObject({
      exitCode: 1,
    })
  })
})
