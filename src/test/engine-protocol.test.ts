import { describe, expect, it } from 'vitest'
import {
  decodeEngineRequest,
  decodeEngineSnapshot,
  EMPTY_ENGINE_TOPOLOGY,
  encodeEngineRequest,
  encodeEngineSnapshot,
} from '../../shared/engine/protocol.mjs'

describe('engine MessagePack protocol', () => {
  it('round-trips Unicode snapshot strings', () => {
    const snapshot = {
      revision: 3,
      project_name: 'Laboratorio São José 日本',
      topology: EMPTY_ENGINE_TOPOLOGY,
    }

    expect(decodeEngineSnapshot(encodeEngineSnapshot(snapshot))).toEqual(snapshot)
  })

  it('round-trips typed requests', () => {
    const request = {
      protocol_version: 1 as const,
      request_id: 9,
      base_revision: 3,
      operation: {
        kind: 'update-project-metadata' as const,
        payload: { name: 'Rack Lab' },
      },
    }

    expect(decodeEngineRequest(encodeEngineRequest(request))).toEqual(request)
  })

  it('round-trips assignment changes with allocation metadata', () => {
    const assignment = {
      id: 7,
      host: { item_type: 'server', id: 1 },
      item: { item_type: 'powerAdapter', id: 3 },
      component_type: 'powerAdapter',
      assigned_at: '2026-07-23T12:00:00.000Z',
      allocation: {
        resource_type: 'power',
        group_id: null,
        positions: [0],
      },
    }
    const request = {
      protocol_version: 1 as const,
      request_id: 10,
      base_revision: 4,
      operation: {
        kind: 'update-assignments' as const,
        payload: { changes: [{ previous: null, next: assignment }] },
      },
    }

    expect(decodeEngineRequest(encodeEngineRequest(request))).toEqual(request)
  })

  it('rejects unsupported protocol versions', () => {
    expect(() => encodeEngineRequest({
      protocol_version: 2 as never,
      request_id: 1,
      base_revision: 1,
      operation: { kind: 'status' },
    })).toThrow(/unsupported protocol version 2/)
  })
})
