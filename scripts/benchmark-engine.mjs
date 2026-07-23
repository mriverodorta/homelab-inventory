import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  decodeEngineResponse,
  encodeEngineRequest,
  encodeEngineSnapshot,
} from '../shared/engine/protocol.mjs'
import { WasmEngineRuntime } from '../shared/engine/wasm-runtime.mjs'
import { buildWasm } from './build-wasm.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const wasmPath = path.join(root, 'server', 'engine', 'generated', 'homelab_engine.wasm')
const iterations = 10_000

function measurement(durationMs, count) {
  return {
    count,
    durationMs,
    operationsPerSecond: count / (durationMs / 1_000),
  }
}

function request(requestId, baseRevision, operation) {
  return encodeEngineRequest({
    protocol_version: 1,
    request_id: requestId,
    base_revision: baseRevision,
    operation,
  })
}

export async function benchmarkEngine() {
  await buildWasm()
  const wasmBytes = await fs.readFile(wasmPath)
  const runtime = await WasmEngineRuntime.instantiate(wasmBytes)
  const snapshot = encodeEngineSnapshot({ revision: 1, project_name: 'Benchmark' })

  const creationCount = 500
  let started = performance.now()
  for (let index = 0; index < creationCount; index += 1) {
    const handle = runtime.create(snapshot)
    runtime.destroy(handle)
  }
  const creation = measurement(performance.now() - started, creationCount)

  const statusHandle = runtime.create(snapshot)
  const statusRequest = request(1, 1, { kind: 'status' })
  started = performance.now()
  for (let index = 0; index < iterations; index += 1) {
    runtime.dispatch(statusHandle, statusRequest)
  }
  const statusQueries = measurement(performance.now() - started, iterations)
  runtime.destroy(statusHandle)

  const patchHandle = runtime.create(snapshot)
  let revision = 1
  started = performance.now()
  for (let index = 0; index < iterations; index += 1) {
    const response = decodeEngineResponse(runtime.dispatch(
      patchHandle,
      request(index + 1, revision, {
        kind: 'update-project-metadata',
        payload: { name: `Benchmark ${String(index % 2)}` },
      }),
    ))
    revision = response.result.kind === 'patch' ? response.result.payload.revision : revision
  }
  const patchCalculations = measurement(performance.now() - started, iterations)
  runtime.destroy(patchHandle)

  const roundTripHandle = runtime.create(snapshot)
  started = performance.now()
  for (let index = 0; index < iterations; index += 1) {
    decodeEngineResponse(runtime.dispatch(
      roundTripHandle,
      request(index + 1, 1, { kind: 'status' }),
    ))
  }
  const binaryRoundTrips = measurement(performance.now() - started, iterations)
  runtime.destroy(roundTripHandle)

  const result = {
    generatedAt: new Date().toISOString(),
    runtime: `bun ${Bun.version}`,
    wasmBytes: wasmBytes.byteLength,
    measurements: {
      engineCreation: creation,
      statusQueries,
      metadataPatchCalculations: patchCalculations,
      binaryEncodeDispatchDecode: binaryRoundTrips,
    },
  }
  const outputDir = path.join(root, 'artifacts', 'engine-benchmarks')
  await fs.mkdir(outputDir, { recursive: true })
  await fs.writeFile(path.join(outputDir, 'phase1.json'), `${JSON.stringify(result, null, 2)}\n`)
  return result
}

if (import.meta.main) console.log(JSON.stringify(await benchmarkEngine(), null, 2))
