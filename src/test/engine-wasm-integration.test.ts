import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  decodeEngineResponse,
  EMPTY_ENGINE_TOPOLOGY,
  encodeEngineRequest,
  encodeEngineSnapshot,
} from '../../shared/engine/protocol.mjs'
import { WasmEngineRuntime } from '../../shared/engine/wasm-runtime.mjs'

const wasmPath = path.join(process.cwd(), 'src', 'engine', 'generated', 'homelab_engine.wasm')

describe('Rust WASM engine integration', () => {
  it('dispatches MessagePack requests with Unicode through the real module', async () => {
    const bytes = await fs.readFile(wasmPath)
    const runtime = await WasmEngineRuntime.instantiate(bytes)
    const handle = runtime.create(encodeEngineSnapshot({
      revision: 4,
      project_name: 'Laboratorio São José 日本',
      topology: EMPTY_ENGINE_TOPOLOGY,
    }))

    const response = decodeEngineResponse(runtime.dispatch(handle, encodeEngineRequest({
      protocol_version: 1,
      request_id: 8,
      base_revision: 4,
      operation: {
        kind: 'update-project-metadata',
        payload: { name: 'Núcleo 東京' },
      },
    })))

    expect(response).toMatchObject({
      request_id: 8,
      base_revision: 4,
      result: {
        kind: 'patch',
        payload: {
          revision: 5,
          forward: {
            kind: 'set-project-name',
            payload: { name: 'Núcleo 東京' },
          },
        },
      },
    })
    expect(runtime.destroy(handle)).toBe(true)
  })

  it('indexes geometry and answers placement queries through the real module', async () => {
    const bytes = await fs.readFile(wasmPath)
    const runtime = await WasmEngineRuntime.instantiate(bytes)
    const handle = runtime.create(encodeEngineSnapshot({
      revision: 7,
      project_name: 'Geometry Lab',
      topology: EMPTY_ENGINE_TOPOLOGY,
    }))

    const replaced = decodeEngineResponse(runtime.dispatch(handle, encodeEngineRequest({
      protocol_version: 1,
      request_id: 9,
      base_revision: 7,
      operation: {
        kind: 'replace-geometry',
        payload: {
          nodes: [{
            item_id: 'server:1',
            bounds: { x: 0, y: 0, width: 100, height: 100 },
          }],
          handles: [],
        },
      },
    })))
    expect(replaced.result).toEqual({
      kind: 'geometry-updated',
      payload: { geometry_revision: 1 },
    })

    const checked = decodeEngineResponse(runtime.dispatch(handle, encodeEngineRequest({
      protocol_version: 1,
      request_id: 10,
      base_revision: 7,
      operation: {
        kind: 'check-placement',
        payload: {
          item_id: 'server:2',
          bounds: { x: 50, y: 0, width: 100, height: 100 },
          exclude_item_ids: [],
        },
      },
    })))
    expect(checked.result).toEqual({
      kind: 'placement-check',
      payload: { valid: false, colliding_item_ids: ['server:1'] },
    })

    const arranged = decodeEngineResponse(runtime.dispatch(handle, encodeEngineRequest({
      protocol_version: 1,
      request_id: 11,
      base_revision: 7,
      operation: {
        kind: 'arrange-items',
        payload: {
          items: [
            { item_id: 'switch:1', name: 'Core', column: 2, width: 300, height: 100 },
            { item_id: 'server:1', name: 'Node', column: 0, width: 282, height: 120 },
          ],
          grid_size: 24,
          column_gap: 78,
          item_gap: 24,
        },
      },
    })))
    expect(arranged.result).toEqual({
      kind: 'arrangement',
      payload: {
        nodes: [
          { item_id: 'server:1', bounds: { x: 0, y: 0, width: 282, height: 120 } },
          { item_id: 'switch:1', bounds: { x: 360, y: 0, width: 300, height: 100 } },
        ],
      },
    })

    const routes = decodeEngineResponse(runtime.dispatch(handle, encodeEngineRequest({
      protocol_version: 1,
      request_id: 12,
      base_revision: 7,
      operation: {
        kind: 'replace-routes',
        payload: {
          routes: [{
            connection_id: 4,
            source: { x: 100, y: 200 },
            target: { x: 460, y: 80 },
            source_side: 'right',
            target_side: 'left',
            lane_offset: 24,
            manual_bends: [],
          }],
        },
      },
    })))
    expect(routes.result).toEqual({
      kind: 'routes-updated',
      payload: { routing_revision: 1 },
    })

    const moved = decodeEngineResponse(runtime.dispatch(handle, encodeEngineRequest({
      protocol_version: 1,
      request_id: 13,
      base_revision: 7,
      operation: {
        kind: 'move-route-segment',
        payload: {
          connection_id: 4,
          segment_index: 2,
          coordinate: 131,
          snap_grid: null,
          endpoint_snap_threshold: 8,
        },
      },
    })))
    expect(moved.result).toMatchObject({
      kind: 'route-edited',
      payload: {
        routing_revision: 2,
        edit: {
          route: { connection_id: 4 },
          inverse: { connection_id: 4, bend_points: [] },
        },
      },
    })

    const obstacleRoute = decodeEngineResponse(runtime.dispatch(handle, encodeEngineRequest({
      protocol_version: 1,
      request_id: 14,
      base_revision: 7,
      operation: {
        kind: 'route-around-obstacles',
        payload: {
          request: {
            definition: {
              connection_id: 5,
              source: { x: 0, y: 72 },
              target: { x: 300, y: 72 },
              source_side: 'right',
              target_side: 'left',
              lane_offset: 24,
              manual_bends: [],
            },
            source_item_id: 'server:1',
            target_item_id: 'patchPanel:1',
            obstacles: [{
              item_id: 'switch:1',
              bounds: { x: 84, y: 12, width: 132, height: 120 },
            }],
            reserved_segments: [],
            snap_to_grid: true,
            grid_size: 12,
            previous_valid_route: null,
          },
        },
      },
    })))
    expect(obstacleRoute.result).toMatchObject({
      kind: 'obstacle-route',
      payload: {
        used_fallback: false,
        warning: null,
        route: {
          connection_id: 5,
        },
      },
    })
    expect(obstacleRoute.result.kind).toBe('obstacle-route')
    if (obstacleRoute.result.kind !== 'obstacle-route') throw new Error('Expected obstacle route')
    expect(obstacleRoute.result.payload.route.points.some((point) => (
      point.y === 12 || point.y === 132
    ))).toBe(true)

    const laneRequests = [1, 2].map((connectionId) => ({
      avoid_cable_overlap: connectionId === 2,
      request: {
        definition: {
          connection_id: connectionId,
          source: { x: 0, y: 24 },
          target: { x: 240, y: 24 },
          source_side: 'right' as const,
          target_side: 'left' as const,
          lane_offset: 24,
          manual_bends: [],
        },
        source_item_id: 'server:1',
        target_item_id: 'switch:1',
        obstacles: [],
        reserved_segments: [],
        snap_to_grid: true,
        grid_size: 12,
        previous_valid_route: null,
      },
    }))
    const planned = decodeEngineResponse(runtime.dispatch(handle, encodeEngineRequest({
      protocol_version: 1,
      request_id: 15,
      base_revision: 7,
      operation: {
        kind: 'plan-cable-routes',
        payload: { plan: { obstacles: [], requests: laneRequests } },
      },
    })))
    expect(planned.result).toMatchObject({
      kind: 'cable-routes-planned',
      payload: { recalculated_connection_ids: [1, 2] },
    })

    const reused = decodeEngineResponse(runtime.dispatch(handle, encodeEngineRequest({
      protocol_version: 1,
      request_id: 16,
      base_revision: 7,
      operation: {
        kind: 'plan-cable-routes',
        payload: { plan: { obstacles: [], requests: laneRequests } },
      },
    })))
    expect(reused.result).toMatchObject({
      kind: 'cable-routes-planned',
      payload: { recalculated_connection_ids: [] },
    })
    expect(runtime.destroy(handle)).toBe(true)
  })
})
