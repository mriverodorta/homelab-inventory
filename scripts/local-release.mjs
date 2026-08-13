#!/usr/bin/env bun
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { releasePaths } from './local-release/config.mjs'
import { currentReleaseIdentity, readReleaseState } from './local-release/state.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const paths = releasePaths()

function usage() {
  console.log(`Usage: bun run release:local <command> [options]

Commands:
  prepare                  Refresh live staging data and build ARM64
  status                   Show local candidate and publication state
  approve                  Approve the exact running ARM64 candidate
  publish --channel <name> Build AMD64 and publish exact OCI candidates
  logs                     Show staging container logs
  stop                     Stop the staging container
  reset                    Remove incomplete local release state
  warm-cache               Restore release build and scanner caches`)
}

async function status() {
  const [state, identity] = await Promise.all([readReleaseState(paths), currentReleaseIdentity(root)])
  console.log(JSON.stringify({
    phase: state.phase,
    version: identity.version,
    revision: identity.revision,
    trackedClean: identity.trackedClean,
    snapshot: state.snapshot,
    arm64: state.candidates.arm64,
    staging: state.staging,
    approval: state.approval,
    amd64: state.candidates.amd64,
    publication: state.publication,
  }, null, 2))
}

const command = process.argv[2]
if (!command || ['help', '--help', '-h'].includes(command)) {
  usage()
} else if (command === 'status') {
  await status()
} else if (['prepare', 'approve', 'publish', 'logs', 'stop', 'reset', 'warm-cache'].includes(command)) {
  throw new Error(`${command} is not available until its local release phase is installed.`)
} else {
  usage()
  process.exitCode = 2
}
