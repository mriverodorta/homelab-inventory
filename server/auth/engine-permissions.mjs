const CONNECTION_OPERATIONS = new Set([
  'create-connection',
  'remove-connection',
  'update-connection-label',
  'update-connection-route',
  'resolve-connection-route-sides',
  'reset-all-connection-bends',
  'restore-automatic-connection-routes',
  'replace-routes',
  'build-route',
  'route-around-obstacles',
  'plan-cable-routes',
  'preview-planned-route-segment',
  'insert-planned-manual-bend',
  'preview-move-route-segment',
  'insert-manual-bend',
  'remove-manual-bend',
  'move-route-segment',
  'reset-route',
])

const CANVAS_EDIT_OPERATIONS = new Set([
  'update-placements',
  'snap-placements-to-grid',
  'replace-geometry',
  'update-geometry',
  'arrange-items',
])

const CANVAS_VIEW_OPERATIONS = new Set([
  'status',
  'topology-endpoints',
  'compatible-destinations',
  'validate-connection',
  'trace-network-path',
  'network-traces',
  'power-topology',
  'connection-derived-states',
  'check-placement',
  'check-group-move',
  'find-nearest-placement',
])

export function permissionForEngineOperation(kindInput) {
  const kind = String(kindInput ?? '')
  if (CONNECTION_OPERATIONS.has(kind)) return 'connections.edit'
  if (CANVAS_EDIT_OPERATIONS.has(kind)) return 'canvas.edit'
  if (CANVAS_VIEW_OPERATIONS.has(kind)) return 'canvas.view'
  if (kind === 'update-assignments') return 'inventory.edit'
  if (kind === 'update-project-metadata') return 'project.settings.manage'
  return null
}
