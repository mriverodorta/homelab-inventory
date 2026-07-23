import express from 'express'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  decodeEngineSnapshot,
  EMPTY_ENGINE_TOPOLOGY,
  encodeEngineRequest,
  encodeEngineResponse,
} from '../shared/engine/protocol.mjs'
import { InventoryLifecycleError } from './db/inventory-lifecycle.mjs'
import { ENGINE_MEDIA_TYPE, registerEngineRoutes } from './engine-routes.mjs'

const servers = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
})

async function startApp({ store, commandService }) {
  const app = express()
  const withStore = async (_request, response, handler, options = {}) => {
    try {
      await handler(store)
    } catch (error) {
      response.status(options.status ?? 500).json({ message: error.message })
    }
  }
  registerEngineRoutes(app, {
    withStore,
    commandService,
    sseHub: { connect: vi.fn() },
  })
  const server = app.listen(0)
  servers.push(server)
  await new Promise((resolve) => server.once('listening', resolve))
  return `http://127.0.0.1:${server.address().port}`
}

describe('engine routes', () => {
  it('returns a binary canonical snapshot', async () => {
    const url = await startApp({
      store: { getEngineSnapshot: () => ({
        revision: 7,
        project_name: 'Rack Lab',
        topology: EMPTY_ENGINE_TOPOLOGY,
      }) },
      commandService: {},
    })

    const response = await fetch(`${url}/api/engine/snapshot`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain(ENGINE_MEDIA_TYPE)
    expect(decodeEngineSnapshot(await response.arrayBuffer())).toEqual({
      revision: 7,
      project_name: 'Rack Lab',
      topology: EMPTY_ENGINE_TOPOLOGY,
    })
  })

  it('accepts and returns binary engine commands', async () => {
    const responseBytes = encodeEngineResponse({
      protocol_version: 1,
      request_id: 9,
      base_revision: 7,
      result: { kind: 'status', payload: { revision: 7, project_name: 'Rack Lab' } },
    })
    const commandService = { execute: vi.fn(async () => ({ responseBytes })) }
    const url = await startApp({ store: {}, commandService })
    const requestBytes = encodeEngineRequest({
      protocol_version: 1,
      request_id: 9,
      base_revision: 7,
      operation: { kind: 'status' },
    })

    const response = await fetch(`${url}/api/engine/commands`, {
      method: 'POST',
      headers: { 'Content-Type': ENGINE_MEDIA_TYPE },
      body: requestBytes,
    })

    expect(response.status).toBe(200)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(responseBytes)
    expect(commandService.execute).toHaveBeenCalledOnce()
  })

  it('returns lifecycle errors without masking their status or code', async () => {
    const commandService = {
      execute: vi.fn(async () => {
        throw new InventoryLifecycleError('Revision is stale.', {
          code: 'revision-conflict',
          status: 409,
        })
      }),
    }
    const url = await startApp({ store: {}, commandService })

    const response = await fetch(`${url}/api/engine/commands`, {
      method: 'POST',
      headers: { 'Content-Type': ENGINE_MEDIA_TYPE },
      body: Uint8Array.from([1]),
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'revision-conflict' })
  })
})
