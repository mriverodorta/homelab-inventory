import {
  isNasPowerConfiguration,
  withCanonicalPowerPorts,
} from '../../shared/power-ports.mjs'

function validAssignedAdapterNasIds(inventory, project) {
  const nasIds = new Set((inventory.nas ?? []).map((record) => record.id))
  const adapterIds = new Set((inventory.powerAdapters ?? []).map((record) => record.id))

  return new Set(
    (project.assignments ?? [])
      .filter((assignment) => (
        assignment.hostType === 'nas'
        && nasIds.has(assignment.hostId)
        && assignment.itemType === 'powerAdapter'
        && assignment.type === 'powerAdapter'
        && adapterIds.has(assignment.itemId)
      ))
      .map((assignment) => assignment.hostId),
  )
}

export function migrateSchema11To12(inventory, project) {
  const migratedInventory = structuredClone(inventory)
  const migratedProject = structuredClone(project)
  const assignedAdapterNasIds = validAssignedAdapterNasIds(
    migratedInventory,
    migratedProject,
  )

  migratedInventory.nas = (migratedInventory.nas ?? []).map((record) => {
    const configured = isNasPowerConfiguration(record.specs?.powerConfiguration)
    const powerConfiguration = assignedAdapterNasIds.has(record.id)
      ? 'external-adapter'
      : configured
        ? record.specs.powerConfiguration
        : 'internal-psu'
    const migrated = withCanonicalPowerPorts({
      ...record,
      type: 'nas',
      specs: {
        ...(record.specs ?? {}),
        powerConfiguration,
      },
    })
    delete migrated.type
    delete migrated.key
    return migrated
  })

  return { inventory: migratedInventory, project: migratedProject }
}
