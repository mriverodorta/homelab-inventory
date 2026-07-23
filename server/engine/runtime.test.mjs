import { beforeAll, describe, expect, it } from 'vitest'
import { buildWasm } from '../../scripts/build-wasm.mjs'
import { ServerEngineRuntime } from './runtime.mjs'

beforeAll(async () => {
  await buildWasm()
})

function store(revision, projectName) {
  return {
    getEngineSnapshot: () => ({ revision, project_name: projectName }),
  }
}

describe('ServerEngineRuntime', () => {
  it('keeps independent state for each LowDB or demo store', async () => {
    const runtime = await ServerEngineRuntime.create()
    const first = store(4, 'First Lab')
    const second = store(9, 'Second Lab')

    const updated = runtime.dispatch(first, {
      protocol_version: 1,
      request_id: 1,
      base_revision: 4,
      operation: { kind: 'update-project-metadata', payload: { name: 'Updated First' } },
    })
    const unchanged = runtime.dispatch(second, {
      protocol_version: 1,
      request_id: 2,
      base_revision: 9,
      operation: { kind: 'status' },
    })

    expect(updated.result).toMatchObject({
      kind: 'patch',
      payload: { revision: 5, forward: { payload: { name: 'Updated First' } } },
    })
    expect(unchanged.result).toEqual({
      kind: 'status',
      payload: {
        revision: 9,
        geometry_revision: 0,
        routing_revision: 0,
        project_name: 'Second Lab',
      },
    })
    expect(runtime.destroyStore(first)).toBe(true)
    expect(runtime.destroyStore(first)).toBe(false)
  })

  it('reloads a store from its latest canonical snapshot', async () => {
    const runtime = await ServerEngineRuntime.create()
    let snapshot = { revision: 2, project_name: 'Before' }
    const currentStore = { getEngineSnapshot: () => snapshot }
    runtime.forStore(currentStore)
    snapshot = { revision: 7, project_name: 'After' }
    runtime.reloadStore(currentStore)

    expect(runtime.dispatch(currentStore, {
      protocol_version: 1,
      request_id: 3,
      base_revision: 7,
      operation: { kind: 'status' },
    }).result).toEqual({
      kind: 'status',
      payload: {
        revision: 7,
        geometry_revision: 0,
        routing_revision: 0,
        project_name: 'After',
      },
    })
  })
})
