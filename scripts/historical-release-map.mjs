#!/usr/bin/env bun

import { appendFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const RELEASES = {
  '0.1.10': '57c3cb280f8c32e766d967429cbc29a071b952c4',
  '0.1.11': '9753e65689321b94404360b0f6dfde8a9cc3ccf5',
  '0.1.12': 'cec20d794e72fa37ce3fdb19396983a9a628825c',
  '0.1.13': '292175b59b84aca2a98e2789bfc892901c455e1e',
  '0.1.14': 'bd63db4731bf68feec1c4d6e09af3bb630e7eedc',
  '0.1.15': 'a68d8ab6caad2bd208b6ed27b4c0435b6e79ee6d',
  '0.1.16': '1dfb3aafb68d46b7f12bd0da08d764cba09c97a3',
  '0.1.17': '02ff99c215ee09a53b814a4b7b23e05c4157f7c4',
  '0.1.18': '0e1a85b3828626067247b1f6644b197de2eec220',
  '0.1.19': 'a41f8bc79bcb2aab12a687ad4929c5d697b34817',
}

export const HISTORICAL_RELEASE_MAP = Object.freeze(RELEASES)

export function validateFullRevision(revision) {
  if (!/^[0-9a-f]{40}$/i.test(revision)) {
    throw new Error(`Expected a full 40-character Git SHA, received: ${revision}`)
  }

  return revision.toLowerCase()
}

export function getHistoricalRelease(version) {
  const revision = HISTORICAL_RELEASE_MAP[version]
  if (!revision) {
    throw new Error(`Unsupported historical release version: ${version}`)
  }

  const [major, minor] = version.split('.')
  return {
    version,
    revision,
    gitTag: `v${version}`,
    minorTag: `${major}.${minor}`,
  }
}

export function validateHistoricalRelease({ version, revision }) {
  const normalizedRevision = validateFullRevision(revision)
  const release = getHistoricalRelease(version)

  if (normalizedRevision !== release.revision) {
    throw new Error(
      `${version} is mapped to ${release.revision}; refusing mismatched revision ${normalizedRevision}.`,
    )
  }

  return release
}

export function parseHistoricalReleaseArguments(args) {
  const values = {}

  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error(`Invalid argument near ${key ?? 'end of input'}.`)
    }

    const name = key.slice(2)
    if (!['version', 'revision'].includes(name)) {
      throw new Error(`Unknown argument: --${name}`)
    }
    if (values[name] !== undefined) {
      throw new Error(`Duplicate argument: --${name}`)
    }
    values[name] = value
  }

  for (const name of ['version', 'revision']) {
    if (!values[name]) throw new Error(`Missing required --${name} argument.`)
  }

  return values
}

export function formatHistoricalReleaseOutput(release) {
  return [
    `version=${release.version}`,
    `revision=${release.revision}`,
    `git_tag=${release.gitTag}`,
    `minor_tag=${release.minorTag}`,
  ].join('\n') + '\n'
}

async function main() {
  const values = parseHistoricalReleaseArguments(process.argv.slice(2))
  const release = validateHistoricalRelease(values)
  const output = formatHistoricalReleaseOutput(release)

  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, output)
  else process.stdout.write(output)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Unable to validate the historical release.')
    process.exitCode = 1
  })
}
