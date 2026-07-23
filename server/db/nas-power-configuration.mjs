import {
  isNasPowerConfiguration,
  withCanonicalPowerPorts,
} from '../../shared/power-ports.mjs'
import { InventoryLifecycleError } from './inventory-lifecycle.mjs'

function requireNas(inventory, ref) {
  if (ref.type !== 'nas' || !Number.isSafeInteger(ref.id) || ref.id < 1) {
    throw new InventoryLifecycleError('A valid NAS reference is required.', {
      code: 'invalid-nas-reference',
      status: 400,
    })
  }

  const index = (inventory.nas ?? []).findIndex((record) => record.id === ref.id)
  if (index < 0) {
    throw new InventoryLifecycleError('NAS inventory item was not found.', {
      code: 'inventory-item-not-found',
      status: 404,
    })
  }

  return { index, record: inventory.nas[index] }
}

function requireTarget(target) {
  if (!isNasPowerConfiguration(target)) {
    throw new InventoryLifecycleError('Select a valid NAS power configuration.', {
      code: 'invalid-nas-power-configuration',
      status: 400,
    })
  }
  return target
}

function endpointMatches(endpoint, expected) {
  return endpoint?.itemType === 'nas'
    && endpoint.itemId === expected.nasId
    && endpoint.portId === expected.portId
    && endpoint.hostedItemType === expected.hostedItemType
    && endpoint.hostedItemId === expected.hostedItemId
}

function assignedAdapter(inventory, project, nasId) {
  const assignment = (project.assignments ?? []).find((candidate) => (
    candidate.hostType === 'nas'
    && candidate.hostId === nasId
    && candidate.itemType === 'powerAdapter'
    && candidate.type === 'powerAdapter'
  ))
  if (!assignment) return null

  const adapter = (inventory.powerAdapters ?? []).find((record) => record.id === assignment.itemId)
  if (!adapter) {
    throw new InventoryLifecycleError('The assigned NAS power adapter no longer exists.', {
      code: 'stale-nas-power-adapter',
      status: 409,
    })
  }

  const port = adapter.ports?.find((candidate) => (
    candidate.key === 'ac-input' && candidate.type === 'ac-input'
  ))
  if (!port) {
    throw new InventoryLifecycleError('The assigned NAS power adapter has no AC input.', {
      code: 'missing-power-adapter-input',
      status: 409,
    })
  }

  return { assignment, adapter, port }
}

function activeInput(inventory, project, nas) {
  if (nas.specs?.powerConfiguration === 'internal-psu') {
    const port = nas.ports?.find((candidate) => (
      candidate.key === 'ac-input' && candidate.type === 'ac-input'
    ))
    return port
      ? { nasId: nas.id, portId: port.id, hostedItemType: undefined, hostedItemId: undefined }
      : null
  }

  const adapter = assignedAdapter(inventory, project, nas.id)
  return adapter
    ? {
        nasId: nas.id,
        portId: adapter.port.id,
        hostedItemType: 'powerAdapter',
        hostedItemId: adapter.adapter.id,
      }
    : null
}

export function inspectNasPowerConfigurationChange(context, ref, rawTarget) {
  const target = requireTarget(rawTarget)
  const { record: nas } = requireNas(context.inventory, ref)
  const from = nas.specs?.powerConfiguration

  if (!isNasPowerConfiguration(from)) {
    throw new InventoryLifecycleError('The NAS does not have a valid current power configuration.', {
      code: 'invalid-current-nas-power-configuration',
      status: 409,
    })
  }

  const input = activeInput(context.inventory, context.project, nas)
  const connections = input
    ? (context.project.connections ?? []).filter((connection) => (
        endpointMatches(connection.from, input) || endpointMatches(connection.to, input)
      ))
    : []
  const adapter = from === 'external-adapter'
    ? assignedAdapter(context.inventory, context.project, nas.id)
    : null
  const releasedAdapter = adapter
    ? { type: 'powerAdapter', id: adapter.adapter.id, name: adapter.adapter.name }
    : null

  return {
    from,
    to: target,
    connectionIds: connections.map((connection) => connection.id),
    assignmentId: releasedAdapter ? adapter.assignment.id : null,
    requiresConfirmation: from !== target && (connections.length > 0 || releasedAdapter !== null),
    publicImpact: {
      from,
      to: target,
      connections: connections.map((connection) => ({
        id: connection.id,
        label: connection.label?.trim() || `Power cable ${connection.id}`,
      })),
      releasedAdapter,
    },
  }
}

export function applyNasPowerConfigurationChange(draft, ref, rawTarget) {
  const target = requireTarget(rawTarget)
  const impact = inspectNasPowerConfigurationChange(draft, ref, target)
  if (impact.from === target) return impact

  const connectionIds = new Set(impact.connectionIds)
  draft.project.connections = (draft.project.connections ?? []).filter(
    (connection) => !connectionIds.has(connection.id),
  )

  if (impact.assignmentId !== null) {
    draft.project.assignments = (draft.project.assignments ?? []).filter(
      (assignment) => assignment.id !== impact.assignmentId,
    )
  }

  const { index, record } = requireNas(draft.inventory, ref)
  const migrated = withCanonicalPowerPorts({
    ...record,
    type: 'nas',
    specs: {
      ...(record.specs ?? {}),
      powerConfiguration: target,
    },
  })
  delete migrated.type
  delete migrated.key
  draft.inventory.nas[index] = migrated
  return impact
}
