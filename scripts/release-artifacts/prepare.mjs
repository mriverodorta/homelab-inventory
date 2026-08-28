#!/usr/bin/env bun
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { releasePaths } from '../local-release/config.mjs'
import { verifyCurrentGoToolchain } from '../container-security/go-toolchain-policy.mjs'
import { ensureAgentArtifact, materializeAgentArtifact } from './agent-store.mjs'
import { ensureWasmArtifact, materializeWasmArtifact } from './store.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const paths = releasePaths()
await verifyCurrentGoToolchain()
const wasm = await ensureWasmArtifact({ root, paths })
const agent = await ensureAgentArtifact({ root, paths })
await Promise.all([
  materializeWasmArtifact({ root, receipt: wasm }),
  materializeAgentArtifact({ root, receipt: agent }),
])
console.log(`${wasm.reused ? 'Reused' : 'Built'} canonical WASM artifact ${wasm.sha256}.`)
console.log(`${agent.reused ? 'Reused' : 'Built'} canonical Agent artifact ${agent.bundleSha256}.`)
