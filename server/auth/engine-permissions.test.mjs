import { describe, expect, it } from 'vitest'
import { permissionForEngineOperation } from './engine-permissions.mjs'

describe('engine operation permissions', () => {
  it.each([
    ['status', 'canvas.view'],
    ['update-placements', 'canvas.edit'],
    ['update-assignments', 'inventory.edit'],
    ['create-connection', 'connections.edit'],
    ['move-route-segment', 'connections.edit'],
    ['update-project-metadata', 'project.settings.manage'],
  ])('maps %s to %s', (kind, permission) => {
    expect(permissionForEngineOperation(kind)).toBe(permission)
  })

  it('defaults unknown operations to no policy', () => {
    expect(permissionForEngineOperation('future-dangerous-operation')).toBeNull()
  })
})
