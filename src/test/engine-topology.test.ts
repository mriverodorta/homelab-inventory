import { describe, expect, it, vi } from 'vitest'
import {
  fromTopologyEndpointRef,
  getCompatibleTopologyDestinations,
  getTopologyEndpoints,
  toTopologyEndpointRef,
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
})
