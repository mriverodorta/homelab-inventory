#!/usr/bin/env bun

import assert from 'node:assert/strict'
import { DockerHubUpdateChecker } from '../server/update-checker.mjs'

const HELP = `Usage: bun scripts/verify-published-image.mjs [options]

Verify OCI metadata on a published Homelab Inventory channel image.

Options:
  --tag <tag>                 Docker Hub channel or semantic-version tag
  --version <semver>          Expected application version
  --revision <sha>            Expected full Git revision
  --channel <channel>         Expected latest, stable, or release channel
  --help                      Show this help
`

function parseArguments(args) {
  if (args.includes('--help')) return { help: true }

  const values = {}
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (!key?.startsWith('--') || !value) throw new Error(`Invalid argument near ${key ?? 'end of input'}.`)
    values[key.slice(2)] = value
  }

  for (const key of ['tag', 'version', 'revision', 'channel']) {
    if (!values[key]) throw new Error(`Missing required --${key} argument.`)
  }
  if (!['latest', 'stable', 'release'].includes(values.channel)) throw new Error(`Unsupported channel: ${values.channel}`)
  if (values.channel === 'release' && !/^\d+\.\d+\.\d+$/.test(values.tag)) {
    throw new Error(`Unsupported release tag: ${values.tag}`)
  }
  if (values.channel !== 'release' && values.tag !== values.channel) {
    throw new Error('The channel tag and image channel must match.')
  }

  return values
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function verify({ tag, version, revision, channel }) {
  let lastResult = null

  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const platformResults = await Promise.all(['amd64', 'arm64'].map((platformArchitecture) => {
      const checker = new DockerHubUpdateChecker({
        channel,
        tag,
        platformArchitecture,
        runningVersion: version,
        runningRevision: revision,
      })
      return checker.check({ force: true })
    }))
    lastResult = platformResults.find((result) => (
      result.errorCode !== null
      || result.availableVersion !== version
      || result.availableRevision !== revision
      || result.channel !== channel
    )) ?? platformResults[0]

    if (platformResults.every((result) => (
      result.errorCode === null
      && result.availableVersion === version
      && result.availableRevision === revision
      && result.channel === channel
    ))) {
      console.log(`Verified ${tag} for amd64 and arm64: version ${version}, revision ${revision}, channel ${channel}.`)
      return
    }

    if (attempt < 12) await delay(5_000)
  }

  assert.equal(lastResult?.errorCode, null, `Registry verification failed: ${lastResult?.errorCode ?? 'no result'}`)
  assert.equal(lastResult?.availableVersion, version, 'Published image version does not match.')
  assert.equal(lastResult?.availableRevision, revision, 'Published image revision does not match.')
  assert.equal(lastResult?.channel, channel, 'Published image channel does not match.')
}

try {
  const options = parseArguments(process.argv.slice(2))
  if (options.help) {
    console.log(HELP)
  } else {
    await verify(options)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Unable to verify the published image.')
  process.exitCode = 1
}
