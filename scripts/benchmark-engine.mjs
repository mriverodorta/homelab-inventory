import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  decodeEngineResponse,
  EMPTY_ENGINE_TOPOLOGY,
  encodeEngineRequest,
  encodeEngineSnapshot,
} from '../shared/engine/protocol.mjs'
import { WasmEngineRuntime } from '../shared/engine/wasm-runtime.mjs'
import { buildWasm } from './build-wasm.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const wasmPath = path.join(root, 'server', 'engine', 'generated', 'homelab_engine.wasm')
const iterations = 10_000
const routeIterations = 100
const topologyIterations = 500

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

function cablePlan(sourceOffset = 0) {
  const obstacles = Array.from({ length: 18 }, (_, index) => ({
    item_id: `equipment:${String(index + 1)}`,
    bounds: {
      x: 180 + (index % 6) * 144,
      y: 120 + Math.floor(index / 6) * 192,
      width: 96,
      height: 96,
    },
  }))
  const requests = Array.from({ length: 48 }, (_, index) => {
    const connectionId = index + 1
    const y = 72 + index * 18 + (connectionId === 1 ? sourceOffset : 0)
    return {
      avoid_cable_overlap: index % 3 === 0,
      request: {
        definition: {
          connection_id: connectionId,
          source: { x: 0, y },
          target: { x: 1_200, y },
          source_side: 'right',
          target_side: 'left',
          lane_offset: 24,
          manual_bends: [],
        },
        source_item_id: `source:${String(connectionId)}`,
        target_item_id: `target:${String(connectionId)}`,
        obstacles: [],
        reserved_segments: [],
        snap_to_grid: true,
        grid_size: 12,
        previous_valid_route: null,
      },
    }
  })
  return { kind: 'plan-cable-routes', payload: { plan: { obstacles, requests } } }
}

function itemRef(itemType, id) {
  return { item_type: itemType, id }
}

function endpoint(itemType, id, portId, hostedItem = null) {
  return {
    item: itemRef(itemType, id),
    port_id: portId,
    endpoint_id: null,
    hosted_item: hostedItem,
  }
}

function port(id, portType, speed = null) {
  return {
    id,
    key: null,
    port_type: portType,
    slot_number: id,
    speed,
    endpoints: [],
  }
}

function topologyFixture() {
  const items = []
  const assignments = []
  const connections = []
  const placements = []
  let assignmentId = 1
  let connectionId = 1

  for (let id = 1; id <= 24; id += 1) {
    const server = itemRef('server', id)
    const adapter = itemRef('powerAdapter', id)
    items.push({
      item: server,
      archived: false,
      power_configuration: null,
      allow_outlet_fan_out: false,
      ports: [port(1, 'rj45', id % 3 === 0 ? '2.5G' : '1G')],
    })
    items.push({
      item: adapter,
      archived: false,
      power_configuration: null,
      allow_outlet_fan_out: false,
      ports: [port(1, 'ac-input')],
    })
    assignments.push({
      id: assignmentId,
      host: server,
      item: adapter,
      component_type: 'powerAdapter',
      assigned_at: '2026-07-23T00:00:00.000Z',
      allocation: null,
    })
    assignmentId += 1
    placements.push(server)
  }

  for (let id = 1; id <= 4; id += 1) {
    const switchItem = itemRef('switch', id)
    items.push({
      item: switchItem,
      archived: false,
      power_configuration: null,
      allow_outlet_fan_out: false,
      ports: Array.from({ length: 16 }, (_, index) => port(
        index + 1,
        index >= 14 ? 'sfp-plus' : 'rj45',
        index >= 14 ? '10G' : '2.5G',
      )),
    })
    placements.push(switchItem)
  }

  const ups = itemRef('ups', 1)
  items.push({
    item: ups,
    archived: false,
    power_configuration: null,
    allow_outlet_fan_out: false,
    ports: Array.from({ length: 24 }, (_, index) => port(index + 1, 'ac-outlet')),
  })
  placements.push(ups)

  for (let id = 1; id <= 24; id += 1) {
    const switchId = Math.floor((id - 1) / 6) + 1
    const switchPort = ((id - 1) % 6) + 1
    connections.push({
      id: connectionId,
      from: endpoint('server', id, 1),
      to: endpoint('switch', switchId, switchPort),
      connection_type: 'network',
      negotiated_speed_mbps: id % 3 === 0 ? 2_500 : 1_000,
      label: null,
      route: null,
      created_at: '2026-07-23T00:00:00.000Z',
    })
    connectionId += 1
    connections.push({
      id: connectionId,
      from: endpoint('ups', 1, id),
      to: endpoint('server', id, 1, itemRef('powerAdapter', id)),
      connection_type: 'power',
      negotiated_speed_mbps: null,
      label: null,
      route: null,
      created_at: '2026-07-23T00:00:00.000Z',
    })
    connectionId += 1
  }

  return { items, assignments, connections, placements }
}

function measureQuery(runtime, handle, snapshotRevision, operation, count = topologyIterations) {
  const encoded = request(1, snapshotRevision, operation)
  const started = performance.now()
  for (let index = 0; index < count; index += 1) {
    decodeEngineResponse(runtime.dispatch(handle, encoded))
  }
  return measurement(performance.now() - started, count)
}

export async function benchmarkEngine() {
  await buildWasm()
  const wasmBytes = await fs.readFile(wasmPath)
  const runtime = await WasmEngineRuntime.instantiate(wasmBytes)
  const snapshot = encodeEngineSnapshot({
    revision: 1,
    project_name: 'Benchmark',
    topology: EMPTY_ENGINE_TOPOLOGY,
  })
  const topologySnapshot = encodeEngineSnapshot({
    revision: 1,
    project_name: 'Topology Benchmark',
    topology: topologyFixture(),
  })

  const creationCount = 500
  let started = performance.now()
  for (let index = 0; index < creationCount; index += 1) {
    const handle = runtime.create(snapshot)
    runtime.destroy(handle)
  }
  const creation = measurement(performance.now() - started, creationCount)

  const topologyCreationCount = 100
  started = performance.now()
  for (let index = 0; index < topologyCreationCount; index += 1) {
    const handle = runtime.create(topologySnapshot)
    runtime.destroy(handle)
  }
  const topologyCreation = measurement(performance.now() - started, topologyCreationCount)

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

  const topologyHandle = runtime.create(topologySnapshot)
  const topologyEndpoints = measureQuery(runtime, topologyHandle, 1, { kind: 'topology-endpoints' })
  const compatibleDestinations = measureQuery(runtime, topologyHandle, 1, {
    kind: 'compatible-destinations',
    payload: { source: endpoint('switch', 1, 7) },
  })
  const connectionValidation = measureQuery(runtime, topologyHandle, 1, {
    kind: 'validate-connection',
    payload: {
      from: endpoint('switch', 1, 7),
      to: endpoint('switch', 2, 7),
    },
  })
  const connectionDerivedStates = measureQuery(
    runtime,
    topologyHandle,
    1,
    { kind: 'connection-derived-states' },
  )
  const networkTraces = measureQuery(runtime, topologyHandle, 1, { kind: 'network-traces' })
  const powerTopology = measureQuery(runtime, topologyHandle, 1, { kind: 'power-topology' })

  let topologyRevision = 1
  const topologyCommandCycles = 250
  started = performance.now()
  for (let index = 0; index < topologyCommandCycles; index += 1) {
    const created = decodeEngineResponse(runtime.dispatch(
      topologyHandle,
      request(index * 2 + 1, topologyRevision, {
        kind: 'create-connection',
        payload: {
          from: endpoint('switch', 1, 7),
          to: endpoint('switch', 2, 7),
          created_at: '2026-07-23T00:00:00.000Z',
        },
      }),
    ))
    topologyRevision = created.result.kind === 'patch'
      ? created.result.payload.revision
      : topologyRevision
    const connectionId = created.result.kind === 'patch'
      && created.result.payload.forward.kind === 'add-connection'
      ? created.result.payload.forward.payload.connection.id
      : null
    if (connectionId === null) throw new Error('Topology command benchmark could not create a connection.')
    const removed = decodeEngineResponse(runtime.dispatch(
      topologyHandle,
      request(index * 2 + 2, topologyRevision, {
        kind: 'remove-connection',
        payload: { connection_id: connectionId },
      }),
    ))
    topologyRevision = removed.result.kind === 'patch'
      ? removed.result.payload.revision
      : topologyRevision
  }
  const topologyCommandPatches = measurement(
    performance.now() - started,
    topologyCommandCycles * 2,
  )
  runtime.destroy(topologyHandle)

  const routeHandle = runtime.create(snapshot)
  started = performance.now()
  decodeEngineResponse(runtime.dispatch(routeHandle, request(1, 1, cablePlan())))
  const initialCablePlan = measurement(performance.now() - started, 48)

  const cachedPlanRequest = request(2, 1, cablePlan())
  started = performance.now()
  for (let index = 0; index < routeIterations; index += 1) {
    decodeEngineResponse(runtime.dispatch(routeHandle, cachedPlanRequest))
  }
  const cachedCablePlans = measurement(
    performance.now() - started,
    routeIterations * 48,
  )

  started = performance.now()
  for (let index = 0; index < routeIterations; index += 1) {
    decodeEngineResponse(runtime.dispatch(
      routeHandle,
      request(index + 3, 1, cablePlan(index % 2 === 0 ? 12 : 0)),
    ))
  }
  const targetedCableReplans = measurement(performance.now() - started, routeIterations)
  runtime.destroy(routeHandle)

  const result = {
    generatedAt: new Date().toISOString(),
    runtime: `bun ${Bun.version}`,
    wasmBytes: wasmBytes.byteLength,
    measurements: {
      engineCreation: creation,
      topologyEngineCreation: topologyCreation,
      statusQueries,
      metadataPatchCalculations: patchCalculations,
      binaryEncodeDispatchDecode: binaryRoundTrips,
      topologyEndpoints,
      compatibleDestinations,
      connectionValidation,
      connectionDerivedStates,
      networkTraces,
      powerTopology,
      topologyCommandPatches,
      initialCablePlan,
      cachedCablePlans,
      targetedCableReplans,
    },
  }
  const outputDir = path.join(root, 'artifacts', 'engine-benchmarks')
  await fs.mkdir(outputDir, { recursive: true })
  await fs.writeFile(path.join(outputDir, 'current.json'), `${JSON.stringify(result, null, 2)}\n`)
  return result
}

if (import.meta.main) console.log(JSON.stringify(await benchmarkEngine(), null, 2))
