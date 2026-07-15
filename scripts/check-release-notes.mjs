#!/usr/bin/env bun
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

const SKIP_MARKER = '[skip release-notes]'

const args = process.argv.slice(2)

function readFlagValue(flag) {
  const index = args.indexOf(flag)

  if (index === -1) {
    return null
  }

  const value = args[index + 1]

  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}.`)
  }

  return value
}

const requireCurrentVersion = args.includes('--require-current-version')
const explicitBase = readFlagValue('--base')
const explicitMessage = readFlagValue('--message')

function git(gitArgs) {
  return execFileSync('git', gitArgs, { encoding: 'utf8' }).trim()
}

function gitOrEmpty(gitArgs) {
  try {
    return git(gitArgs)
  } catch {
    return ''
  }
}

function uniqueFiles(output) {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function defaultBase() {
  if (process.env.GITHUB_BASE_REF) {
    return `origin/${process.env.GITHUB_BASE_REF}`
  }

  return 'HEAD~1'
}

function changedFiles() {
  const base = explicitBase ?? defaultBase()
  const files = new Set([
    ...uniqueFiles(gitOrEmpty(['diff', '--name-only', `${base}...HEAD`])),
    ...uniqueFiles(gitOrEmpty(['diff', '--name-only', '--cached'])),
    ...uniqueFiles(gitOrEmpty(['diff', '--name-only'])),
    ...uniqueFiles(gitOrEmpty(['ls-files', '--others', '--exclude-standard'])),
  ])

  return [...files].sort()
}

function commitMessage() {
  if (explicitMessage !== null) {
    return explicitMessage
  }

  return gitOrEmpty(['log', '-1', '--pretty=%B'])
}

function isRuntimePath(file) {
  return (
    file.startsWith('src/')
    || file.startsWith('server/')
    || file === 'Dockerfile'
    || file === 'package.json'
    || file.startsWith('.github/workflows/')
  )
}

function isExemptPath(file) {
  return (
    file === 'src/release-notes.ts'
    || file === 'CHANGELOG.md'
    || file === 'DOCKERHUB.md'
    || file === 'README.md'
    || file === 'scripts/check-release-notes.mjs'
    || file.endsWith('.test.ts')
    || file.endsWith('.test.tsx')
    || file.endsWith('.test.mjs')
    || file.includes('/test/')
    || file.startsWith('docs/')
  )
}

function isDependabotWorkflowOnlyUpdate(files, runtimeFiles) {
  return (
    process.env.GITHUB_ACTOR === 'dependabot[bot]'
    && runtimeFiles.length > 0
    && files.every((file) => file.startsWith('.github/workflows/'))
  )
}

function packageVersion() {
  return JSON.parse(fs.readFileSync('package.json', 'utf8')).version
}

function releaseNotesSource() {
  return fs.readFileSync('src/release-notes.ts', 'utf8')
}

function sourceHasVersion(version) {
  const escapedVersion = version.replaceAll('.', '\\.')

  return new RegExp(`version:\\s*['"]${escapedVersion}['"]`).test(releaseNotesSource())
}

try {
  const files = changedFiles()
  const message = commitMessage()

  if (requireCurrentVersion) {
    const version = packageVersion()

    if (!sourceHasVersion(version)) {
      console.error(`No release-note entry found for package.json version ${version}.`)
      console.error('Add the current version to src/release-notes.ts before publishing.')
      process.exit(1)
    }
  }

  if (message.includes(SKIP_MARKER)) {
    process.exit(0)
  }

  const runtimeFiles = files.filter((file) => isRuntimePath(file) && !isExemptPath(file))

  if (isDependabotWorkflowOnlyUpdate(files, runtimeFiles)) {
    process.exit(0)
  }

  if (runtimeFiles.length > 0 && !files.includes('src/release-notes.ts')) {
    console.error('Runtime files changed without a release note entry.')
    console.error(`Add an entry to src/release-notes.ts or include ${SKIP_MARKER} in the commit message.`)
    console.error(`Runtime files: ${runtimeFiles.join(', ')}`)
    process.exit(1)
  }
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
