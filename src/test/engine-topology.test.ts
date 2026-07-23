import { describe, expect, it, vi } from 'vitest'
import {
  fromTopologyEndpointRef,
  createTopologyConnection,
  getCompatibleTopologyDestinations,
  getConnectionDerivedStates,
  getPowerTopology,
  getTopologyEndpoints,
  getTopologyNetworkTraces,
  toTopologyEndpointRef,
  removeTopologyConnection,
  traceTopologyNetworkPath,
  updateTopologyConnectionLabel,
  updateTopologyConnectionRoute,
  validateTopologyConnection,
} from '@/engine/topology'
import type { DomainEngineClient } from '@/engine/client'
import type { ProjectState } from '@/types/inventory'

const project = {
  id: 'default',
  revision: 3,
  metadata: {
    name: 'Topology Test',
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  items: {
    'server:1': { id: 1, type: 'server', name: 'Server', specs: {} },
    'network:2': { id: 2, type: 'network', name: 'NIC', specs: {} },
    'switch:3': { id: 3, type: 'switch', name: 'Switch', specs: {} },
  },
  placements: [],
  assignments: [],
  connections: [],
} as ProjectState

describe('WASM topology adapter', () => {
  it('converts runtime endpoint keys to numeric relational references', () => {
    const runtime = {
      itemId: 'server:1',
      hostedItemId: 'network:2',
      portId: 4,
      endpointId: 8,
    }

    const topology = toTopologyEndpointRef(project, runtime)
    expect(topology).toEqual({
      item: { item_type: 'server', id: 1 },
      hosted_item: { item_type: 'network', id: 2 },
      port_id: 4,
      endpoint_id: 8,
    })
    expect(fromTopologyEndpointRef(topology)).toEqual(runtime)
  })

  it('rejects runtime keys that do not match their persisted numeric identity', () => {
    expect(() => toTopologyEndpointRef(project, {
      itemId: 'server:2',
      portId: 1,
    })).toThrow('invalid inventory item server:2')
  })

  it('loads endpoint catalogs and compatible destinations from the engine', async () => {
    const descriptor = {
      endpoint: {
        item: { item_type: 'switch', id: 3 },
        port_id: 1,
        endpoint_id: null,
        hosted_item: null,
      },
      host: { item_type: 'switch', id: 3 },
      owner: { item_type: 'switch', id: 3 },
      port_type: 'rj45',
      slot_number: 1,
      side: null,
      speed: '2.5G',
      connection_ids: [],
      placed: true,
      available: true,
      power: null,
    }
    const queryConsistent = vi.fn()
      .mockResolvedValueOnce({
        result: { kind: 'topology-endpoints', payload: { endpoints: [descriptor] } },
      })
      .mockResolvedValueOnce({
        result: { kind: 'topology-endpoints', payload: { endpoints: [descriptor] } },
      })
    const client = { queryConsistent } as unknown as DomainEngineClient

    await expect(getTopologyEndpoints(client)).resolves.toMatchObject([{
      endpoint: { itemId: 'switch:3', portId: 1 },
      hostItemId: 'switch:3',
      ownerItemId: 'switch:3',
      available: true,
    }])
    await expect(getCompatibleTopologyDestinations(client, project, {
      itemId: 'server:1',
      hostedItemId: 'network:2',
      portId: 4,
    })).resolves.toHaveLength(1)
    expect(queryConsistent).toHaveBeenLastCalledWith({
      operation: {
        kind: 'compatible-destinations',
        payload: {
          source: {
            item: { item_type: 'server', id: 1 },
            hosted_item: { item_type: 'network', id: 2 },
            port_id: 4,
            endpoint_id: null,
          },
        },
      },
    })
  })

  it('returns typed validation results from the engine', async () => {
    const client = {
      queryConsistent: vi.fn().mockResolvedValue({
        result: {
          kind: 'connection-validation',
          payload: {
            ok: false,
            code: 'incompatible-port-type',
            message: 'The selected port types are not compatible.',
          },
        },
      }),
    } as unknown as DomainEngineClient

    await expect(validateTopologyConnection(
      client,
      project,
      { itemId: 'server:1', portId: 1 },
      { itemId: 'switch:3', portId: 1 },
    )).resolves.toEqual({
      ok: false,
      code: 'incompatible-port-type',
      message: 'The selected port types are not compatible.',
    })
  })

  it('loads Rust-derived connection classification and negotiated speed', async () => {
    const client = {
      queryConsistent: vi.fn().mockResolvedValue({
        result: {
          kind: 'connection-derived-states',
          payload: {
            states: [{
              connection_id: 8,
              connection_type: 'network',
              negotiated_speed_mbps: 1000,
            }],
          },
        },
      }),
    } as unknown as DomainEngineClient

    await expect(getConnectionDerivedStates(client)).resolves.toEqual([{
      connection_id: 8,
      connection_type: 'network',
      negotiated_speed_mbps: 1000,
    }])
  })

  it('converts numeric engine traces back to runtime endpoints', async () => {
    const client = {
      queryConsistent: vi.fn().mockResolvedValue({
        result: {
          kind: 'network-trace',
          payload: {
            trace: {
              start: {
                item: { item_type: 'server', id: 1 },
                hosted_item: { item_type: 'network', id: 2 },
                port_id: 4,
                endpoint_id: null,
              },
              steps: [
                {
                  endpoint: {
                    item: { item_type: 'server', id: 1 },
                    hosted_item: { item_type: 'network', id: 2 },
                    port_id: 4,
                    endpoint_id: null,
                  },
                  state: 'connected',
                  connection_id: null,
                },
                {
                  endpoint: {
                    item: { item_type: 'switch', id: 3 },
                    hosted_item: null,
                    port_id: 1,
                    endpoint_id: null,
                  },
                  state: 'connected',
                  connection_id: 8,
                },
              ],
              complete: true,
            },
          },
        },
      }),
    } as unknown as DomainEngineClient

    await expect(traceTopologyNetworkPath(client, project, {
      itemId: 'server:1',
      hostedItemId: 'network:2',
      portId: 4,
    })).resolves.toEqual({
      start: {
        itemId: 'server:1',
        hostedItemId: 'network:2',
        portId: 4,
      },
      steps: [
        {
          endpoint: {
            itemId: 'server:1',
            hostedItemId: 'network:2',
            portId: 4,
          },
          state: 'connected',
        },
        {
          endpoint: { itemId: 'switch:3', portId: 1 },
          state: 'connected',
          connectionId: 8,
        },
      ],
      complete: true,
    })
  })

  it('loads all network traces through the topology query boundary', async () => {
    const client = {
      queryConsistent: vi.fn().mockResolvedValue({
        result: {
          kind: 'network-traces',
          payload: {
            traces: [{
              start: {
                item: { item_type: 'server', id: 1 },
                hosted_item: null,
                port_id: 1,
                endpoint_id: null,
              },
              steps: [{
                endpoint: {
                  item: { item_type: 'server', id: 1 },
                  hosted_item: null,
                  port_id: 1,
                  endpoint_id: null,
                },
                state: 'open',
                connection_id: null,
              }],
              complete: false,
            }],
          },
        },
      }),
    } as unknown as DomainEngineClient

    await expect(getTopologyNetworkTraces(client)).resolves.toEqual([{
      start: { itemId: 'server:1', portId: 1 },
      steps: [{
        endpoint: { itemId: 'server:1', portId: 1 },
        state: 'open',
      }],
      complete: false,
    }])
  })

  it('adds presentation labels and messages to numeric power topology results', async () => {
    const powerProject = {
      ...project,
      items: {
        ...project.items,
        'ups:1': {
          id: 1,
          type: 'ups',
          name: 'Rack UPS',
          specs: {},
          ports: [{
            id: 1,
            kind: 'power-port',
            type: 'ac-outlet',
            slotNumber: 1,
            label: 'Battery 01',
          }],
        },
        'monitor:1': {
          id: 1,
          type: 'monitor',
          name: 'Main display',
          specs: {},
          ports: [{
            id: 1,
            key: 'ac-input',
            kind: 'power-port',
            type: 'ac-input',
            slotNumber: 1,
          }],
        },
      },
    } as ProjectState
    const client = {
      queryConsistent: vi.fn().mockResolvedValue({
        result: {
          kind: 'power-topology',
          payload: {
            topology: {
              endpoints: [{
                endpoint: {
                  item: { item_type: 'ups', id: 1 },
                  hosted_item: null,
                  port_id: 1,
                  endpoint_id: null,
                },
                host: { item_type: 'ups', id: 1 },
                owner: { item_type: 'ups', id: 1 },
                port_type: 'ac-outlet',
                slot_number: 1,
                side: null,
                speed: null,
                connection_ids: [],
                placed: true,
                available: true,
                power: {
                  direction: 'output',
                  kind: 'ups-outlet',
                  allow_fan_out: false,
                },
              }],
              findings: [{
                id: 'power.monitor.unpowered:monitor:1',
                code: 'power.monitor.unpowered',
                severity: 'warning',
                item: { item_type: 'monitor', id: 1 },
                connection_id: null,
                endpoint: {
                  item: { item_type: 'monitor', id: 1 },
                  hosted_item: null,
                  port_id: 1,
                  endpoint_id: null,
                },
              }],
            },
          },
        },
      }),
    } as unknown as DomainEngineClient

    await expect(getPowerTopology(client, powerProject)).resolves.toEqual({
      endpoints: [{
        endpoint: { itemId: 'ups:1', portId: 1 },
        direction: 'output',
        kind: 'ups-outlet',
        label: 'Rack UPS / Battery 01',
        allowFanOut: false,
      }],
      findings: [{
        id: 'power.monitor.unpowered:monitor:1',
        code: 'power.monitor.unpowered',
        severity: 'warning',
        message: 'Main display is not connected to a power source.',
        itemId: 'monitor:1',
        endpoint: { itemId: 'monitor:1', portId: 1 },
      }],
    })
  })

  it('sends numeric revision-checked connection commands to the engine', async () => {
    const mutate = vi.fn().mockResolvedValue({ result: { kind: 'patch' } })
    const client = { mutate } as unknown as DomainEngineClient

    await createTopologyConnection(
      client,
      project,
      { itemId: 'server:1', portId: 1 },
      { itemId: 'switch:3', portId: 1 },
    )
    await updateTopologyConnectionLabel(client, 7, ' Uplink ')
    await updateTopologyConnectionRoute(client, 7, {
      sourceSide: 'right',
      bendPoints: [{ x: 24, y: 48 }],
      avoidCableOverlap: true,
    })
    await removeTopologyConnection(client, 7)

    expect(mutate.mock.calls[0][0]).toMatchObject({
      operation: {
        kind: 'create-connection',
        payload: {
          from: { item: { item_type: 'server', id: 1 }, port_id: 1 },
          to: { item: { item_type: 'switch', id: 3 }, port_id: 1 },
          created_at: expect.any(String),
        },
      },
    })
    expect(mutate.mock.calls[1][0]).toEqual({
      operation: {
        kind: 'update-connection-label',
        payload: { connection_id: 7, label: ' Uplink ' },
      },
    })
    expect(mutate.mock.calls[2][0]).toEqual({
      operation: {
        kind: 'update-connection-route',
        payload: {
          connection_id: 7,
          route: {
            source_side: 'right',
            target_side: null,
            bend_points: [{ x: 24, y: 48 }],
            avoid_cable_overlap: true,
          },
        },
      },
    })
    expect(mutate.mock.calls[3][0]).toEqual({
      operation: { kind: 'remove-connection', payload: { connection_id: 7 } },
    })
  })
})
