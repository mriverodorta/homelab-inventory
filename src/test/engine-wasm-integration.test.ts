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

  it('indexes direct and hosted topology endpoints through the real module', async () => {
    const bytes = await fs.readFile(wasmPath)
    const runtime = await WasmEngineRuntime.instantiate(bytes)
    const serverRef = { item_type: 'server', id: 1 }
    const nicRef = { item_type: 'network', id: 1 }
    const switchRef = { item_type: 'switch', id: 1 }
    const freeSwitchRef = { item_type: 'switch', id: 2 }
    const panelRef = { item_type: 'patchPanel', id: 1 }
    const serverEndpoint = {
      item: serverRef,
      hosted_item: null,
      port_id: 1,
      endpoint_id: null,
    }
    const hostedEndpoint = {
      item: serverRef,
      hosted_item: nicRef,
      port_id: 4,
      endpoint_id: null,
    }
    const switchEndpoint = {
      item: switchRef,
      hosted_item: null,
      port_id: 1,
      endpoint_id: null,
    }
    const freeSwitchEndpoint = {
      item: freeSwitchRef,
      hosted_item: null,
      port_id: 1,
      endpoint_id: null,
    }
    const panelFrontEndpoint = {
      item: panelRef,
      hosted_item: null,
      port_id: 1,
      endpoint_id: 1,
    }
    const panelBackEndpoint = {
      item: panelRef,
      hosted_item: null,
      port_id: 1,
      endpoint_id: 2,
    }
    const handle = runtime.create(encodeEngineSnapshot({
      revision: 2,
      project_name: 'Topology Lab',
      topology: {
        items: [
          {
            item: serverRef,
            archived: false,
            power_configuration: null,
            allow_outlet_fan_out: false,
            ports: [{
              id: 1,
              key: null,
              port_type: 'rj45',
              slot_number: 1,
              speed: '1G',
              endpoints: [],
            }],
          },
          {
            item: nicRef,
            archived: false,
            power_configuration: null,
            allow_outlet_fan_out: false,
            ports: [{
              id: 4,
              key: null,
              port_type: 'rj45',
              slot_number: 1,
              speed: '2.5G',
              endpoints: [],
            }],
          },
          {
            item: switchRef,
            archived: false,
            power_configuration: null,
            allow_outlet_fan_out: false,
            ports: [{
              id: 1,
              key: null,
              port_type: 'rj45',
              slot_number: 1,
              speed: '2.5G',
              endpoints: [],
            }],
          },
          {
            item: freeSwitchRef,
            archived: false,
            power_configuration: null,
            allow_outlet_fan_out: false,
            ports: [{
              id: 1,
              key: null,
              port_type: 'rj45',
              slot_number: 1,
              speed: '10G',
              endpoints: [],
            }],
          },
          {
            item: panelRef,
            archived: false,
            power_configuration: null,
            allow_outlet_fan_out: false,
            ports: [{
              id: 1,
              key: null,
              port_type: 'rj45',
              slot_number: 1,
              speed: null,
              endpoints: [
                { id: 1, side: 'front' },
                { id: 2, side: 'back' },
              ],
            }],
          },
        ],
        assignments: [{
          id: 1,
          host: serverRef,
          item: nicRef,
          component_type: 'network',
        }],
        connections: [
          {
            id: 8,
            from: hostedEndpoint,
            to: switchEndpoint,
            connection_type: 'network',
            negotiated_speed_mbps: 2500,
            label: null,
            route: null,
            created_at: '2026-01-01T00:00:00.000Z',
          },
          {
            id: 9,
            from: freeSwitchEndpoint,
            to: panelFrontEndpoint,
            connection_type: 'network',
            negotiated_speed_mbps: 10000,
            label: null,
            route: null,
            created_at: '2026-01-01T00:00:00.000Z',
          },
        ],
        placements: [serverRef, switchRef, freeSwitchRef, panelRef],
      },
    }))
    expect(handle).toBeGreaterThan(0)

    const response = decodeEngineResponse(runtime.dispatch(handle, encodeEngineRequest({
      protocol_version: 1,
      request_id: 1,
      base_revision: 2,
      operation: { kind: 'topology-endpoints' },
    })))
    expect(response.result).toMatchObject({
      kind: 'topology-endpoints',
      payload: {
        endpoints: expect.arrayContaining([
          expect.objectContaining({
            endpoint: hostedEndpoint,
            owner: nicRef,
            connection_ids: [8],
          }),
          expect.objectContaining({
            endpoint: switchEndpoint,
            owner: switchRef,
            connection_ids: [8],
          }),
        ]),
      },
    })

    const destinations = decodeEngineResponse(runtime.dispatch(handle, encodeEngineRequest({
      protocol_version: 1,
      request_id: 2,
      base_revision: 2,
      operation: {
        kind: 'compatible-destinations',
        payload: { source: serverEndpoint },
      },
    })))
    expect(destinations.result).toEqual({
      kind: 'topology-endpoints',
      payload: {
        endpoints: [expect.objectContaining({
          endpoint: panelBackEndpoint,
          available: true,
        })],
      },
    })

    const validation = decodeEngineResponse(runtime.dispatch(handle, encodeEngineRequest({
      protocol_version: 1,
      request_id: 3,
      base_revision: 2,
      operation: {
        kind: 'validate-connection',
        payload: { from: hostedEndpoint, to: panelBackEndpoint },
      },
    })))
    expect(validation.result).toEqual({
      kind: 'connection-validation',
      payload: {
        ok: false,
        code: 'source-occupied',
        message: 'The source port is already connected.',
      },
    })

    const created = decodeEngineResponse(runtime.dispatch(handle, encodeEngineRequest({
      protocol_version: 1,
      request_id: 4,
      base_revision: 2,
      operation: {
        kind: 'create-connection',
        payload: {
          from: serverEndpoint,
          to: panelBackEndpoint,
          created_at: '2026-07-23T00:00:00.000Z',
        },
      },
    })))
    expect(created.result).toMatchObject({
      kind: 'patch',
      payload: {
        revision: 3,
        inverse: {
          kind: 'batch',
        },
      },
    })
    expect(created.result).toMatchObject({
      kind: 'patch',
      payload: {
        forward: {
          kind: 'batch',
          payload: {
            patches: [
              {
                kind: 'add-connection',
                payload: {
                  connection: {
                    id: 10,
                    from: serverEndpoint,
                    to: panelBackEndpoint,
                    connection_type: 'network',
                    negotiated_speed_mbps: 1000,
                  },
                },
              },
              {
                kind: 'set-connection-derived',
                payload: {
                  states: [{
                    connection_id: 9,
                    connection_type: 'network',
                    negotiated_speed_mbps: 1000,
                  }],
                },
              },
            ],
          },
        },
      },
    })

    const trace = decodeEngineResponse(runtime.dispatch(handle, encodeEngineRequest({
      protocol_version: 1,
      request_id: 5,
      base_revision: 3,
      operation: {
        kind: 'trace-network-path',
        payload: { start: serverEndpoint },
      },
    })))
    expect(trace.result).toEqual({
      kind: 'network-trace',
      payload: {
        trace: {
          start: serverEndpoint,
          steps: [
            {
              endpoint: serverEndpoint,
              state: 'connected',
              connection_id: null,
            },
            {
              endpoint: panelBackEndpoint,
              state: 'connected',
              connection_id: 10,
            },
            {
              endpoint: panelFrontEndpoint,
              state: 'internal',
              connection_id: null,
            },
            {
              endpoint: freeSwitchEndpoint,
              state: 'connected',
              connection_id: 9,
            },
          ],
          complete: true,
        },
      },
    })

    const traces = decodeEngineResponse(runtime.dispatch(handle, encodeEngineRequest({
      protocol_version: 1,
      request_id: 51,
      base_revision: 3,
      operation: { kind: 'network-traces' },
    })))
    expect(traces.result).toMatchObject({
      kind: 'network-traces',
      payload: {
        traces: expect.arrayContaining([
          expect.objectContaining({ start: serverEndpoint, complete: true }),
        ]),
      },
    })

    const derived = decodeEngineResponse(runtime.dispatch(handle, encodeEngineRequest({
      protocol_version: 1,
      request_id: 52,
      base_revision: 3,
      operation: { kind: 'connection-derived-states' },
    })))
    expect(derived.result).toMatchObject({
      kind: 'connection-derived-states',
      payload: {
        states: expect.arrayContaining([
          expect.objectContaining({
            connection_id: 9,
            connection_type: 'network',
            negotiated_speed_mbps: 1000,
          }),
          expect.objectContaining({
            connection_id: 10,
            connection_type: 'network',
            negotiated_speed_mbps: 1000,
          }),
        ]),
      },
    })

    const removed = decodeEngineResponse(runtime.dispatch(handle, encodeEngineRequest({
      protocol_version: 1,
      request_id: 6,
      base_revision: 3,
      operation: {
        kind: 'remove-connection',
        payload: { connection_id: 10 },
      },
    })))
    expect(removed.result).toMatchObject({
      kind: 'patch',
      payload: {
        revision: 4,
        forward: {
          kind: 'batch',
          payload: {
            patches: [
              { kind: 'remove-connection', payload: { connection: { id: 10 } } },
              {
                kind: 'set-connection-derived',
                payload: {
                  states: [{ connection_id: 9, negotiated_speed_mbps: 10000 }],
                },
              },
            ],
          },
        },
      },
    })
    expect(runtime.destroy(handle)).toBe(true)
  })

  it('derives power endpoints and findings through the real module', async () => {
    const bytes = await fs.readFile(wasmPath)
    const runtime = await WasmEngineRuntime.instantiate(bytes)
    const upsRef = { item_type: 'ups', id: 1 }
    const monitorRef = { item_type: 'monitor', id: 1 }
    const powerStripRef = { item_type: 'powerStrip', id: 1 }
    const handle = runtime.create(encodeEngineSnapshot({
      revision: 5,
      project_name: 'Power Lab',
      topology: {
        items: [
          {
            item: upsRef,
            archived: false,
            power_configuration: null,
            allow_outlet_fan_out: false,
            ports: [{
              id: 1,
              key: 'outlet-1',
              port_type: 'ac-outlet',
              slot_number: 1,
              speed: null,
              endpoints: [],
            }],
          },
          {
            item: monitorRef,
            archived: false,
            power_configuration: null,
            allow_outlet_fan_out: false,
            ports: [{
              id: 1,
              key: 'ac-input',
              port_type: 'ac-input',
              slot_number: 1,
              speed: null,
              endpoints: [],
            }],
          },
          {
            item: powerStripRef,
            archived: false,
            power_configuration: null,
            allow_outlet_fan_out: false,
            ports: [{
              id: 1,
              key: 'ac-input',
              port_type: 'ac-input',
              slot_number: 0,
              speed: null,
              endpoints: [],
            }],
          },
        ],
        assignments: [],
        connections: [{
          id: 1,
          from: {
            item: upsRef,
            hosted_item: null,
            port_id: 99,
            endpoint_id: null,
          },
          to: {
            item: monitorRef,
            hosted_item: null,
            port_id: 1,
            endpoint_id: null,
          },
          connection_type: 'power',
          negotiated_speed_mbps: null,
          label: null,
          route: null,
          created_at: '2026-01-01T00:00:00.000Z',
        }],
        placements: [upsRef, monitorRef],
      },
    }))
    expect(handle).toBeGreaterThan(0)

    const response = decodeEngineResponse(runtime.dispatch(handle, encodeEngineRequest({
      protocol_version: 1,
      request_id: 7,
      base_revision: 5,
      operation: { kind: 'power-topology' },
    })))
    expect(response.result.kind).toBe('power-topology')
    if (response.result.kind === 'power-topology') {
      expect(response.result.payload.topology.endpoints).toEqual(expect.arrayContaining([
        expect.objectContaining({
          endpoint: {
            item: upsRef,
            hosted_item: null,
            port_id: 1,
            endpoint_id: null,
          },
          power: expect.objectContaining({ direction: 'output', kind: 'ups-outlet' }),
        }),
        expect.objectContaining({
          endpoint: {
            item: powerStripRef,
            hosted_item: null,
            port_id: 1,
            endpoint_id: null,
          },
          slot_number: 0,
          power: expect.objectContaining({ direction: 'input', kind: 'power-strip-input' }),
        }),
      ]))
      expect(response.result.payload.topology.findings).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: 'power.connection.stale-endpoint',
          connection_id: 1,
        }),
        expect.objectContaining({
          code: 'power.monitor.unpowered',
          item: monitorRef,
        }),
      ]))
    }
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
