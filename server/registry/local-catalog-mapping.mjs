const PHYSICAL_EQUIPMENT_CLASSES = new Set(['desktop', 'server'])
const USAGE_ROLES = new Set(['server', 'desktop', 'workstation', 'other'])

export function localInventoryTypeForCatalogType(type) {
  return PHYSICAL_EQUIPMENT_CLASSES.has(type) ? 'server' : type
}

export function projectLocalItemForCatalog(item, localType = item.type) {
  const projected = structuredClone(item)
  projected.type = localType
  if (localType === 'server') {
    projected.type = projected.hardwareClass === 'server' ? 'server' : 'desktop'
    delete projected.hardwareClass
    delete projected.usageRole
  }
  if (PHYSICAL_EQUIPMENT_CLASSES.has(projected.type) || projected.type === 'nas') {
    const manufacturer = typeof projected.manufacturer === 'string' ? projected.manufacturer.trim() : ''
    const model = typeof projected.model === 'string' ? projected.model.trim() : ''
    if (manufacturer && model) projected.name = `${manufacturer} ${model}`
  }
  return projected
}

export function materializeCatalogItem(item, options = {}) {
  const materialized = structuredClone(item)
  if (!PHYSICAL_EQUIPMENT_CLASSES.has(materialized.type)) return materialized
  const usageRole = USAGE_ROLES.has(options.usageRole) ? options.usageRole : 'server'
  const hardwareClass = materialized.type
  materialized.type = 'server'
  materialized.hardwareClass = hardwareClass
  materialized.usageRole = usageRole
  return materialized
}
