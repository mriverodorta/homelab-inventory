import { describe, expect, it, vi } from 'vitest'
import { encodeEngineRequest, encodeEngineResponse } from '../../shared/engine/protocol.mjs'
import { EngineCommandService } from './command-service.mjs'

function request(baseRevision = 4) {
  return encodeEngineRequest({
    protocol_version: 1,
    request_id: 1,
    base_revision: baseRevision,
    operation: { kind: 'update-project-metadata', payload: { name: 'Rack Lab' } },
  })
}

function response(result) {
  return encodeEngineResponse({
    protocol_version: 1,
    request_id: 1,
    base_revision: 4,
    result,
  })
}

describe('EngineCommandService', () => {
  it('persists an accepted Rust patch before returning', async () => {
    const responseBytes = response({
      kind: 'patch',
      payload: {
        revision: 5,
        forward: { kind: 'set-project-name', payload: { name: 'Rack Lab' } },
        inverse: { kind: 'set-project-name', payload: { name: 'Before' } },
      },
    })
    const runtime = {
      dispatchBytes: vi.fn(() => responseBytes),
      reloadStore: vi.fn(),
    }
    const store = {
      applyEnginePatch: vi.fn(async () => ({ revision: 5 })),
    }

    const result = await new EngineCommandService(runtime).execute(store, request())

    expect(store.applyEnginePatch).toHaveBeenCalledWith(expect.objectContaining({
      baseRevision: 4,
      patchSet: expect.objectContaining({ revision: 5 }),
    }))
    expect(result.project).toEqual({ revision: 5 })
    expect(runtime.reloadStore).not.toHaveBeenCalled()
  })

  it('rejects Rust errors without touching persistence', async () => {
    const runtime = {
      dispatchBytes: () => response({
        kind: 'error',
        payload: { code: 'revision-conflict', message: 'Revision is stale.' },
      }),
      reloadStore: vi.fn(),
    }
    const store = { applyEnginePatch: vi.fn() }

    await expect(new EngineCommandService(runtime).execute(store, request(3))).rejects.toMatchObject({
      code: 'revision-conflict',
      status: 409,
    })
    expect(store.applyEnginePatch).not.toHaveBeenCalled()
  })

  it('reloads canonical engine state after persistence failure', async () => {
    const runtime = {
      dispatchBytes: () => response({
        kind: 'patch',
        payload: {
          revision: 5,
          forward: { kind: 'set-project-name', payload: { name: 'Rack Lab' } },
          inverse: { kind: 'set-project-name', payload: { name: 'Before' } },
        },
      }),
      reloadStore: vi.fn(),
    }
    const store = { applyEnginePatch: vi.fn(async () => { throw new Error('disk full') }) }

    await expect(new EngineCommandService(runtime).execute(store, request())).rejects.toThrow('disk full')
    expect(runtime.reloadStore).toHaveBeenCalledWith(store)
  })
})
