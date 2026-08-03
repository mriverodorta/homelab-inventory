import express from 'express'
import { decodeEngineRequest, encodeEngineSnapshot } from '../shared/engine/protocol.mjs'
import { deriveAuthenticationMode } from './auth/model.mjs'
import { permissionForEngineOperation } from './auth/engine-permissions.mjs'
import { InventoryLifecycleError } from './db/inventory-lifecycle.mjs'

export const ENGINE_MEDIA_TYPE = 'application/vnd.homelab-engine+msgpack'

function respondWithLifecycleError(response, error) {
  if (!(error instanceof InventoryLifecycleError)) throw error
  response.status(error.status).json({
    message: error.message,
    code: error.code,
    ...(error.details === undefined ? {} : { details: error.details }),
  })
}

export function registerEngineRoutes(app, { withStore, commandService, sseHub, authService = null, authorization = null, demo = false }) {
  app.get('/api/engine/snapshot', (request, response) => {
    void withStore(request, response, async (store) => {
      const bytes = encodeEngineSnapshot(store.getEngineSnapshot())
      response.set('Cache-Control', 'no-store')
      response.type(ENGINE_MEDIA_TYPE).send(Buffer.from(bytes))
    }, { message: 'Unable to load engine snapshot.' })
  })

  app.post(
    '/api/engine/commands',
    express.raw({ type: () => true, limit: '1mb' }),
    (request, response) => {
      void withStore(request, response, async (store) => {
        try {
          if (!Buffer.isBuffer(request.body) || request.body.byteLength === 0) {
            throw new InventoryLifecycleError('Engine command body is required.', {
              code: 'invalid-engine-command',
              status: 400,
            })
          }
          if (!demo && authService && deriveAuthenticationMode(authService.state()) !== 'disabled') {
            const command = decodeEngineRequest(request.body)
            const permission = permissionForEngineOperation(command.operation?.kind)
            if (!permission) {
              return response.status(403).json({
                message: 'This engine operation has no authorization policy.',
                code: 'authorization-policy-missing',
              })
            }
            const accountId = request.authentication?.account?.id
            const decision = accountId ? await authorization?.authorize(accountId, permission) : { allowed: false }
            if (!decision?.allowed) {
              return response.status(403).json({
                message: 'You do not have permission to perform this action.',
                code: 'permission-denied',
                permission,
              })
            }
          }
          const result = await commandService.execute(store, request.body)
          response.set('Cache-Control', 'no-store')
          response.type(ENGINE_MEDIA_TYPE).send(Buffer.from(result.responseBytes))
        } catch (error) {
          respondWithLifecycleError(response, error)
        }
      }, { message: 'Unable to execute engine command.' })
    },
  )

  app.get('/api/engine/events', (request, response) => {
    void withStore(request, response, async (store) => {
      sseHub.connect(store, request, response)
    }, { message: 'Unable to open engine event stream.' })
  })
}
