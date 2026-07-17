#!/usr/bin/env bun

import { appendFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export function parseReleaseVersion(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version)
  if (!match) throw new Error(`Expected a strict X.Y.Z version, received: ${version}`)

  return {
    version,
    gitTag: `v${version}`,
    exactTag: version,
    minorTag: `${match[1]}.${match[2]}`,
  }
}

export function createStableReleasePlan({ version, revision, existingTagRevision, imageName }) {
  const parsed = parseReleaseVersion(version)
  if (!revision || !imageName) throw new Error('revision and imageName are required')
  if (existingTagRevision && existingTagRevision !== revision) {
    throw new Error(`${parsed.gitTag} already points to ${existingTagRevision}; refusing to reuse it for ${revision}.`)
  }

  const state = existingTagRevision === revision ? 'existing' : 'create'
  const dockerTags = [`${imageName}:stable`]
  if (state === 'create') {
    dockerTags.push(`${imageName}:${parsed.exactTag}`, `${imageName}:${parsed.minorTag}`)
  }

  return {
    state,
    channel: 'stable',
    verificationTag: 'stable',
    ...parsed,
    dockerTags,
  }
}

export function createBranchReleasePlan(options) {
  if (options.branch === 'main') {
    const parsed = parseReleaseVersion(options.version)
    if (!options.imageName) throw new Error('imageName is required')
    return {
      state: 'channel',
      channel: 'latest',
      verificationTag: 'latest',
      ...parsed,
      dockerTags: [`${options.imageName}:latest`],
    }
  }
  if (options.branch === 'stable') return createStableReleasePlan(options)
  throw new Error(`Publication is limited to main and stable, received: ${options.branch}`)
}

function parseArguments(args) {
  const values = {}
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error(`Invalid argument near ${key ?? 'end of input'}.`)
    }
    values[key.slice(2)] = value
  }

  for (const key of ['branch', 'version', 'revision', 'image-name']) {
    if (!values[key]) throw new Error(`Missing required --${key} argument.`)
  }
  return values
}

async function main() {
  const values = parseArguments(process.argv.slice(2))
  const plan = createBranchReleasePlan({
    branch: values.branch,
    version: values.version,
    revision: values.revision,
    existingTagRevision: values['existing-tag-revision'] ?? '',
    imageName: values['image-name'],
  })
  const output = [
    `state=${plan.state}`,
    `channel=${plan.channel}`,
    `verification_tag=${plan.verificationTag}`,
    `git_tag=${plan.gitTag}`,
    `exact_tag=${plan.exactTag}`,
    `minor_tag=${plan.minorTag}`,
    'docker_tags<<EOF',
    ...plan.dockerTags,
    'EOF',
  ].join('\n') + '\n'

  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, output)
  else process.stdout.write(output)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Unable to compute the release plan.')
    process.exitCode = 1
  })
}
