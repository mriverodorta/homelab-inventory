import { withCanonicalPowerPorts } from '../../shared/power-ports.mjs'

const PHYSICAL_EQUIPMENT_CLASSES = new Set(['desktop', 'workstation', 'server', 'laptop'])
const USAGE_ROLES = new Set(['server', 'desktop', 'workstation', 'other'])

export function localInventoryTypeForCatalogType(type) {
  return PHYSICAL_EQUIPMENT_CLASSES.has(type) ? 'server' : type
}

export function projectLocalItemForCatalog(item, localType = item.type) {
  const projected = structuredClone(item)
  projected.type = localType
  if (localType === 'server') {
    projected.type = projected.hardwareClass === 'laptop' || PHYSICAL_EQUIPMENT_CLASSES.has(projected.hardwareClass)
      ? projected.hardwareClass
      : 'desktop'
    delete projected.hardwareClass
    delete projected.usageRole
  }
  // v13 canonicalization owns its public name; keep the local name here for
  // non-destructive linked updates. Historical projections remain unchanged.
  if ((PHYSICAL_EQUIPMENT_CLASSES.has(projected.type) && projected.type !== 'laptop') || projected.type === 'nas') {
    const manufacturer = typeof projected.manufacturer === 'string' ? projected.manufacturer.trim() : ''
    const model = typeof projected.model === 'string' ? projected.model.trim() : ''
    if (manufacturer && model) projected.name = `${manufacturer} ${model}`
  }
  return projected
}

export function materializeCatalogItem(item, options = {}) {
  const materialized = structuredClone(item)
  if (PHYSICAL_EQUIPMENT_CLASSES.has(materialized.type)) {
    const usageRole = USAGE_ROLES.has(options.usageRole) ? options.usageRole : 'server'
    const hardwareClass = materialized.type
    materialized.type = 'server'
    materialized.hardwareClass = hardwareClass
    materialized.usageRole = usageRole
  }
  return withCanonicalPowerPorts(materialized)
}
